import "server-only";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getDatabase } from "@/lib/server/db";

export type Portal = "chairman" | "admin" | "resident";

export type AuthenticatedSession = {
  sessionId: string;
  userId: string;
  fullName: string;
  portal: Portal;
  expiresAt: Date;
};

export function parsePortal(value: string | null): Portal | null {
  return value === "chairman" || value === "admin" || value === "resident"
    ? value
    : null;
}

export function sessionCookieName(portal: Portal): string {
  return `leaseiq_${portal}_session`;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readSessionToken(
  request: NextRequest,
  portal: Portal,
): string | null {
  const authorization = request.headers.get("authorization");

  // An explicit Authorization header takes precedence.
  // Invalid bearer credentials must not fall back to browser cookies.
  if (authorization !== null) {
    const match = /^Bearer ([0-9a-f]{64})$/i.exec(authorization);
    return match ? match[1] : null;
  }

  const token = request.cookies.get(sessionCookieName(portal))?.value;

  return token && /^[0-9a-f]{64}$/.test(token) ? token : null;
}

export async function getSessionFromToken(
  token: string | null | undefined,
  portal: Portal,
): Promise<AuthenticatedSession | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    return null;
  }

  const result = await getDatabase().query<AuthenticatedSession>(
    `SELECT
       s.id AS "sessionId",
       u.id AS "userId",
       u.full_name AS "fullName",
       s.portal,
       s.expires_at AS "expiresAt"
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.portal = $2
       AND s.revoked_at IS NULL
       AND s.expires_at > clock_timestamp()
       AND u.status = 'active'
       AND u.email_verified_at IS NOT NULL
       AND (
         u.phone_verified_at IS NOT NULL
         OR (
           u.verification_policy = 'email_only'
           AND NOT EXISTS (
             SELECT 1 FROM platform_admins verification_admin
             WHERE verification_admin.user_id = u.id
           )
         )
       )
       AND (
         s.mobile_session_id IS NULL
         OR EXISTS (
           SELECT 1
           FROM mobile_sessions m
           WHERE m.id = s.mobile_session_id
             AND m.user_id = s.user_id
             AND m.portal = s.portal
             AND m.revoked_at IS NULL
         )
       )
       AND (
         (
           s.portal IN ('chairman', 'resident')
           AND NOT EXISTS (
             SELECT 1
             FROM platform_admins a
             WHERE a.user_id = u.id
           )
         )
         OR (
           s.portal = 'admin'
           AND EXISTS (
             SELECT 1
             FROM platform_admins a
             WHERE a.user_id = u.id
           )
         )
       )`,
    [hashSessionToken(token), portal],
  );

  return result.rows[0] ?? null;
}
