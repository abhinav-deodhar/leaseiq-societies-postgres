import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ChairmanRegistration from "@/components/auth/chairman-registration";
import {
  getSessionFromToken,
  sessionCookieName,
} from "@/lib/server/auth/session";

export default async function ChairmanRegistrationPage() {
  const cookieStore = await cookies();

  const session = await getSessionFromToken(
    cookieStore.get(sessionCookieName("chairman"))?.value,
    "chairman",
  );

  if (session) {
    redirect("/chairman");
  }

  return <ChairmanRegistration />;
}