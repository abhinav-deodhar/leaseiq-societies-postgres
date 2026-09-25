import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getSessionFromToken,
  sessionCookieName,
  type Portal,
} from "./session";

export async function requirePortalSession(portal: Portal) {
  const cookieStore = await cookies();

  const session = await getSessionFromToken(
    cookieStore.get(sessionCookieName(portal))?.value,
    portal,
  );

  if (!session) {
    redirect(`/${portal}/login`);
  }

  return session;
}
