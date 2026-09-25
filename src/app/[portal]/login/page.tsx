import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import LoginForm from "@/components/auth/login-form";
import {
  getSessionFromToken,
  parsePortal,
  sessionCookieName,
} from "@/lib/server/auth/session";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ portal: string }>;
}) {
  const { portal: value } = await params;
  const portal = parsePortal(value);

  if (!portal) notFound();

  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName(portal))?.value;
  const session = await getSessionFromToken(token, portal);

  if (session) {
    redirect(`/${portal}`);
  }

  return <LoginForm key={portal} portal={portal} />;
}