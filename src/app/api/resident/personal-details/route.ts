import type { NextRequest } from "next/server";
import { getSessionFromToken, readSessionToken } from "@/lib/server/auth/session";
import { HttpError, checkRequestOrigin, readJsonBody } from "@/lib/server/http";
import { jsonNoStore } from "@/lib/server/http/json";
import {
  getPersonalDetails, savePersonalDetails,
} from "@/lib/server/services/personal-details.service";

export const runtime = "nodejs";

async function authenticate(request: NextRequest) {
  const session = await getSessionFromToken(
    readSessionToken(request, "resident"), "resident",
  );
  if (!session) throw new HttpError(401, "Sign in to your resident account.");
  return session.userId;
}

function failure(error: unknown) {
  if (error instanceof HttpError) {
    return jsonNoStore({ message: error.message }, error.status);
  }
  console.error("Personal details operation failed.");
  return jsonNoStore({
    message: "The result could not be confirmed. Reload your saved details before trying again.",
  }, 503);
}

export async function GET(request: NextRequest) {
  try {
    return jsonNoStore(await getPersonalDetails(await authenticate(request)));
  } catch (error) { return failure(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    checkRequestOrigin(request);
    const userId = await authenticate(request);
    return jsonNoStore(await savePersonalDetails(
      userId, await readJsonBody(request, 4096),
    ));
  } catch (error) { return failure(error); }
}
