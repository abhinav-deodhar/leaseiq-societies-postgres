import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import RegistrationForm from "@/components/auth/chairman-registration";
import {
  getSessionFromToken,
  sessionCookieName,
} from "@/lib/server/auth/session";

export default async function ResidentRegistrationPage() {
  const cookieStore = await cookies();
  const session = await getSessionFromToken(
    cookieStore.get(sessionCookieName("resident"))?.value,
    "resident",
  );

  if (session) redirect("/resident");
  return <RegistrationForm portal="resident" />;
}
