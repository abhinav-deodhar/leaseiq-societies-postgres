import type { NextRequest } from "next/server";
import { escapeSearchLike, searchWordPatterns } from "@/lib/locations/search-words";
import { findCity } from "@/lib/locations/cities";
import { getLocationCities } from "@/lib/server/services/location-cities.service";
import { z } from "zod";
import { getDatabase } from "@/lib/server/db";
import {
  getSessionFromToken,
  readSessionToken,
} from "@/lib/server/auth/session";
import {
  checkRequestOrigin,
  HttpError,
  readJsonBody,
} from "@/lib/server/http";
import { jsonNoStore } from "@/lib/server/http/json";
import {
  replaceResidentDraft,
  createResidentRequestDraft,
  updateResidentRequestDraft,
  ResidentRequestError,
} from "@/lib/server/services/resident-requests.service";
import {
  residentRequestSchema,
  residentRequestSubmissionSchema,
} from "@/lib/contracts/resident-associations";
import { residentProfileSchema } from "@/lib/contracts/resident-profile";

export const runtime = "nodejs";

async function authenticate(request: NextRequest) {
  const session = await getSessionFromToken(
    readSessionToken(request, "resident"), "resident",
  );
  if (!session) throw new HttpError(401, "Sign in to your resident account.");
  return session;
}

function failure(error: unknown) {
  if (error instanceof HttpError || error instanceof ResidentRequestError) {
    return jsonNoStore({ message: error.message }, error.status);
  }
  console.error("Resident onboarding request failed.");
  return jsonNoStore({ message: "Unable to complete this request. Please try again." }, 503);
}

const availableSociety = `
  s.service_status IN ('inactive', 'active')
  AND EXISTS (
    SELECT 1 FROM society_applications a
    WHERE a.society_id = s.id AND a.status = 'approved'
  )
`;

export async function GET(request: NextRequest) {
  try {
    const session = await authenticate(request);
    const params = request.nextUrl.searchParams;
    const kind = params.get("kind");
    const database = getDatabase();

    if (kind === "account") {
      const account = await database.query(
        `SELECT full_name AS "fullName", email, phone,
                email_verified_at IS NOT NULL AS "emailVerified",
                phone_verified_at IS NOT NULL AS "phoneVerified"
         FROM users WHERE id = $1 AND status = 'active'`,
        [session.userId],
      );
      if (!account.rows[0]) throw new HttpError(404, "Account not found.");
      return jsonNoStore({ account: account.rows[0] });
    }

    if (kind === "draft") {
      const societyId = z.uuid().safeParse(params.get("societyId"));
      const unitId = z.uuid().safeParse(params.get("unitId"));
      if (!societyId.success || !unitId.success) {
        throw new HttpError(400, "Choose a valid society and flat.");
      }
      const requestId = params.get("requestId");
      if (requestId && !z.uuid().safeParse(requestId).success) throw new HttpError(400,"Invalid draft.");
      const result = await database.query(
        `SELECT id, society_id AS "societyId", unit_id AS "unitId",
                relationship, status, revision,
                move_in_date::text AS "moveInDate",
                tenancy_end_date::text AS "tenancyEndDate",
                applicant_note AS "applicantNote",
                applicant_profile AS "applicantProfile"
         FROM resident_unit_requests
         WHERE user_id = $1 AND society_id = $2 AND unit_id = $3
           AND status IN ('draft', 'pending', 'changes_requested')
           AND ($4::uuid IS NULL OR id=$4) AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [session.userId, societyId.data, unitId.data, requestId],
      );
      const membership = await database.query<{
        relationship: "owner" | "tenant";
        sourceRequestId: string;
      }>(
        `SELECT relationship, source_request_id AS "sourceRequestId"
         FROM resident_unit_memberships
         WHERE user_id = $1 AND society_id = $2 AND unit_id = $3
           AND status = 'active'
         LIMIT 1`,
        [session.userId, societyId.data, unitId.data],
      );
      if(requestId && !result.rows[0]) throw new HttpError(409,"This draft is no longer editable. Return to applications.");
      return jsonNoStore({
        request: result.rows[0] ?? null,
        membership: membership.rows[0] ?? null,
      });
    }

    if (kind === "requests") {
      const result = await database.query(
        `SELECT r.id, r.status, r.relationship, r.revision,
                s.name AS "societyName",
                u.wing, u.flat_number AS "flatNumber"
         FROM resident_unit_requests r
         JOIN societies s ON s.id = r.society_id
         JOIN society_units u ON u.id = r.unit_id AND u.society_id = r.society_id
         WHERE r.user_id = $1 AND r.deleted_at IS NULL
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT 50`,
        [session.userId],
      );
      return jsonNoStore({ items: result.rows });
    }

    const search = params.get("search")?.trim() ?? "";
    if (search.length > 100) throw new HttpError(400, "Use a shorter search.");
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;

    if (kind === "cities") {
      const cities = await getLocationCities();
      const term = search.toLowerCase();
      return jsonNoStore({ items: cities.filter((city) =>
        city.name.toLowerCase().includes(term) ||
        city.state.toLowerCase().includes(term) ||
        city.aliases.some((alias) => alias.includes(term))) });
    }

    if (kind === "societies") {
      const cityId = params.get("city")?.trim() ?? "";
      if (!cityId || cityId.length > 250) {
        throw new HttpError(400, "Choose a city first.");
      }
      const city = findCity(await getLocationCities(), cityId);
      if (!city) throw new HttpError(400, "Choose a city from the list.");
      if (!search.length) return jsonNoStore({ items: [] });
      const result = await database.query(
        `SELECT s.id, s.name || ' · ' || s.city AS label
         FROM societies s
         WHERE ${availableSociety}
           AND lower(btrim(s.city)) = ANY($2::text[])
           AND lower(btrim(s.state_or_union_territory)) = $3
           AND s.name ILIKE ALL($1::text[])
         ORDER BY
           CASE
             WHEN lower(s.name) = lower($4) THEN 0
             WHEN s.name ILIKE $5 THEN 1
             ELSE 2
           END,
           s.name, s.id
         LIMIT 20`,
        [
          searchWordPatterns(search),
          city.aliases,
          city.state.toLowerCase(),
          search,
          escapeSearchLike(search) + "%",
        ],
      );
      return jsonNoStore({ items: result.rows });
    }

    if (kind === "wings" || kind === "floors" || kind === "flats") {
      const societyId = z.uuid().safeParse(params.get("societyId"));
      if (!societyId.success) throw new HttpError(400, "Choose a valid society.");

      const wing = params.get("wing");
      const floor = params.get("floor");
      if ((wing?.length ?? 0) > 50 || (floor?.length ?? 0) > 50) {
        throw new HttpError(400, "Choose a valid wing and floor.");
      }

      if (kind === "wings") {
        const result = await database.query(
          `SELECT DISTINCT u.wing AS id,
                  CASE WHEN u.wing = '' THEN 'No wing' ELSE u.wing END AS label
           FROM society_units u
           JOIN societies s ON s.id = u.society_id
           WHERE s.id = $1 AND ${availableSociety}
             AND ($2 = '' OR u.wing ILIKE $3)
           ORDER BY label, id LIMIT 20`,
          [societyId.data, search, pattern],
        );
        return jsonNoStore({ items: result.rows });
      }

      if (wing === null) throw new HttpError(400, "Select a wing first.");

      if (kind === "floors") {
        const result = await database.query(
          `SELECT DISTINCT COALESCE(u.floor_label, '') AS id,
                  COALESCE(NULLIF(u.floor_label, ''), 'Not specified') AS label
           FROM society_units u
           JOIN societies s ON s.id = u.society_id
           WHERE s.id = $1 AND ${availableSociety}
             AND u.wing = $2
             AND ($3 = '' OR COALESCE(u.floor_label, '') ILIKE $4)
           ORDER BY label, id LIMIT 20`,
          [societyId.data, wing, search, pattern],
        );
        return jsonNoStore({ items: result.rows });
      }

      if (floor === null) throw new HttpError(400, "Select a floor first.");
      if (!search.length) return jsonNoStore({ items: [] });

      const result = await database.query(
        `SELECT u.id, u.flat_number AS label
         FROM society_units u
         JOIN societies s ON s.id = u.society_id
         WHERE s.id = $1 AND ${availableSociety}
           AND u.wing = $2
           AND COALESCE(u.floor_label, '') = $3
           AND u.flat_number ILIKE $4
         ORDER BY u.flat_number, u.id LIMIT 20`,
        [societyId.data, wing, floor, pattern],
      );
      return jsonNoStore({ items: result.rows });
    }

    throw new HttpError(400, "Choose a valid search.");
  } catch (error) {
    return failure(error);
  }
}

function requireOccupancyChoice(details: { relationship: string }, profile: { residesInFlat: boolean; occupancyWhenAway?: string } | undefined) {
  if (details.relationship === "owner" && profile && !profile.residesInFlat && !profile.occupancyWhenAway) {
    throw new HttpError(400, "Choose the flat's occupancy when you do not live there.");
  }
}

const createSchema = z.strictObject({
  societyId: z.uuid(),
  details: residentRequestSchema,
  profile: residentProfileSchema.refine(
    (value) => value.correspondenceAccountRevision !== undefined,
    "Choose and confirm your account correspondence address first.",
  ).optional(),
});

export async function POST(request: NextRequest) {
  try {
    checkRequestOrigin(request);
    const session = await authenticate(request);
    const parsed = createSchema.safeParse(await readJsonBody(request, 65536));
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? "Check the details.");
    }
    requireOccupancyChoice(parsed.data.details, parsed.data.profile);
    const draft = await createResidentRequestDraft(
      session.userId, parsed.data.societyId, parsed.data.details,
      parsed.data.profile,
    );
    return jsonNoStore({ request: draft, message: "Draft saved." }, 201);
  } catch (error) {
    return failure(error);
  }
}

const updateSchema = createSchema.extend({
  targetSocietyId: z.uuid().optional(),
  replaceDraft: z.boolean().optional(),
  requestId: z.uuid(),
  expectedRevision: residentRequestSubmissionSchema.shape.expectedRevision,
});

export async function PATCH(request: NextRequest) {
  try {
    checkRequestOrigin(request);
    const session = await authenticate(request);
    const parsed = updateSchema.safeParse(await readJsonBody(request, 65536));
    if (!parsed.success) {
      throw new HttpError(400,
        parsed.error.issues[0]?.message ?? "Check your details.");
    }
    requireOccupancyChoice(parsed.data.details, parsed.data.profile);
    const draft = parsed.data.replaceDraft
      ? await replaceResidentDraft(session.userId,parsed.data.societyId,parsed.data.requestId,parsed.data.expectedRevision,
          parsed.data.targetSocietyId ?? parsed.data.societyId,parsed.data.details,parsed.data.profile)
      : await updateResidentRequestDraft(
      session.userId,
      parsed.data.societyId,
      parsed.data.requestId,
      parsed.data.expectedRevision,
      parsed.data.details,
      parsed.data.profile,
    );
    return jsonNoStore({ request: draft, message: "Draft saved." });
  } catch (error) {
    return failure(error);
  }
}
