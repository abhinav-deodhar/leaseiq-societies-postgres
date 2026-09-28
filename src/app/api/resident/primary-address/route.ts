import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/lib/server/db";
import { getSessionFromToken, readSessionToken } from "@/lib/server/auth/session";
import { checkRequestOrigin, HttpError, readJsonBody } from "@/lib/server/http";
import { jsonNoStore } from "@/lib/server/http/json";
import {
  primaryAddressUpdateSchema,
  correspondenceAddressSchema,
  type PrimaryAddress,
  type PrimaryAddressState,
} from "@/lib/contracts/primary-address";

export const runtime = "nodejs";

async function authenticate(request: NextRequest) {
  const session = await getSessionFromToken(
    readSessionToken(request, "resident"), "resident",
  );
  if (!session) throw new HttpError(401, "Sign in to your resident account.");
  return session;
}

function context(request: NextRequest) {
  const society = request.nextUrl.searchParams.get("societyId");
  const unit = request.nextUrl.searchParams.get("unitId");
  if (society === null && unit === null) return { society: null, unit: null };
  if (!z.uuid().safeParse(society).success || !z.uuid().safeParse(unit).success) {
    throw new HttpError(400, "Choose a valid society and flat.");
  }
  return { society, unit };
}

async function options(userId: string, request: NextRequest) {
  const selected = context(request);
  const result = await getDatabase().query<
    PrimaryAddressState["options"][number]
  >(
    `SELECT u.id AS "unitId",
       concat_ws(' · ', s.name, NULLIF(u.wing, ''), u.flat_number, s.city) AS label,
       jsonb_build_object(
         'line1', concat_ws(', ',
           'Flat ' || u.flat_number,
           CASE WHEN u.wing <> '' THEN 'Wing ' || u.wing END,
           CASE WHEN COALESCE(u.floor_label, '') <> ''
             THEN 'Floor ' || u.floor_label END,
           s.name),
         'line2', concat_ws(', ', s.address_line_1, s.address_line_2),
         'city', s.city,
         'state', s.state_or_union_territory,
         'pinCode', s.pin_code
       ) AS address
     FROM society_units u
     JOIN societies s ON s.id = u.society_id
     WHERE s.service_status IN ('active', 'inactive')
       AND EXISTS (
         SELECT 1 FROM society_applications a
         WHERE a.society_id = s.id AND a.status = 'approved'
       )
       AND (
         EXISTS (
           SELECT 1 FROM resident_unit_memberships m
           WHERE m.user_id = $1 AND m.unit_id = u.id
             AND m.society_id = s.id AND m.status = 'active'
             AND (m.relationship = 'owner' OR
               m.tenancy_end_date IS NULL OR
               m.tenancy_end_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)
         )
         OR (s.id = $2::uuid AND u.id = $3::uuid)
       )
     ORDER BY s.name, u.wing, u.flat_number, u.id`,
    [userId, selected.society, selected.unit],
  );
  return result.rows.map((item) => ({
    ...item,
    address: correspondenceAddressSchema.parse(item.address),
  }));
}

function failure(error: unknown) {
  if (error instanceof HttpError) {
    return jsonNoStore({ message: error.message }, error.status);
  }
  console.error("Primary correspondence address request failed.");
  return jsonNoStore({ message: "Unable to save or load your address. Please retry." }, 503);
}

export async function GET(request: NextRequest) {
  try {
    const session = await authenticate(request);
    const result = await getDatabase().query<{
      primary: PrimaryAddress | null; revision: number;
    }>(
      `SELECT primary_correspondence_address AS primary,
              correspondence_revision AS revision
       FROM users WHERE id = $1 AND status = 'active'`,
      [session.userId],
    );
    if (!result.rows[0]) throw new HttpError(401, "Please sign in again.");
    return jsonNoStore({
      ...result.rows[0],
      options: await options(session.userId, request),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    checkRequestOrigin(request);
    const session = await authenticate(request);
    const parsed = primaryAddressUpdateSchema.safeParse(
      await readJsonBody(request, 16384),
    );
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the address.");
    }

    const available = await options(session.userId, request);
    const selection = parsed.data.selection;
    let primary: PrimaryAddress;

    if (selection.kind === "flat") {
      const flat = available.find((item) => item.unitId === selection.unitId);
      if (!flat) throw new HttpError(400, "Choose a flat from the available list.");
      primary = { unitId: flat.unitId, address: flat.address };
    } else {
      primary = { unitId: null, address: selection.address };
    }

    // One atomic comparison/update: a stale tab cannot replace a newer choice.
    const result = await getDatabase().query<{
      primary: PrimaryAddress; revision: number;
    }>(
      `UPDATE users
       SET primary_correspondence_address = $2::jsonb,
           correspondence_revision = correspondence_revision + 1
       WHERE id = $1 AND status = 'active'
         AND correspondence_revision = $3
       RETURNING primary_correspondence_address AS primary,
                 correspondence_revision AS revision`,
      [session.userId, JSON.stringify(primary), parsed.data.expectedRevision],
    );
    if (!result.rows[0]) {
      throw new HttpError(409, "Your address changed in another session. Reload it before saving.");
    }

    // This changes a contact preference only, never flat access or applications.
    return jsonNoStore({ ...result.rows[0], options: available });
  } catch (error) {
    return failure(error);
  }
}
