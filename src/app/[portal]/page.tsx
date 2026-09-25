import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import LogoutButton from "@/components/auth/logout-button";
import {
  getSessionFromToken,
  parsePortal,
  sessionCookieName,
} from "@/lib/server/auth/session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";

export default async function PortalHome({
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

  if (!session) {
    redirect(`/${portal}/login`);
  }

  if (portal === "resident") {
    return (
      <main className="min-h-screen bg-[#f3f6f4] font-sans text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
            <div>
              <p className="text-xl font-bold tracking-tight text-emerald-900">
                LeaseIQ
              </p>
              <p className="mt-1 text-sm text-slate-500">Resident portal</p>
            </div>
            <LogoutButton portal="resident" />
          </div>
        </header>

        <section className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
          <p className="text-sm font-semibold text-emerald-700">
            Your resident account
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Welcome, {session.fullName}
          </h1>
          <p className="mt-3 max-w-2xl leading-7 text-slate-600">
            One place for your home and community.
          </p>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
              Signed in
            </div>
            <h2 className="mt-4 text-xl font-semibold">
              Access to your society
            </h2>
            <p className="mt-3 max-w-2xl leading-7 text-slate-600">
              Owners and tenants use this portal. Access to a flat’s bills,
              documents and society services requires an approved association
              with that flat.
            </p>
          </div>
        </section>
      </main>
    );
  }

  const isAdmin = portal === "admin";

    const application = isAdmin
    ? null
    : await getChairmanApplication(session.userId);

  return (
    <main className="min-h-screen bg-[#f3f6f4] font-sans text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <p className="text-xl font-semibold text-emerald-900">
              leaseIq societies
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {isAdmin ? "Admin portal" : "Chairman portal"}
            </p>
          </div>

          <LogoutButton portal={portal} />
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <p className="text-sm font-semibold text-emerald-700">
          {isAdmin ? "Platform administration" : "Your account"}
        </p>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Welcome, {session.fullName}
        </h1>

        <p className="mt-3 leading-7 text-slate-600">
          You are signed in to your {isAdmin ? "admin" : "chairman"} account.
        </p>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Account access confirmed</h2>
          <p className="mt-2 max-w-2xl leading-7 text-slate-600">
            {isAdmin
              ? "Your platform administrator access has been verified."
              : "Your email and mobile number are verified. Society approval and subscription activation are separate from account access."}
          </p>
        </div>
        {isAdmin && (
  <Link
    href="/admin/applications"
    className="mt-6 inline-flex rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
  >
    View pending applications
  </Link>
)}
        {!isAdmin && (
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={
                application
                  ? "/chairman/society"
                  : "/chairman/society/new"
              }
              className="inline-flex items-center justify-center rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
            >
              {application ? "View application" : "Register your society"}
            </Link>

            {application?.status === "approved" &&
              application.serviceStatus !== "suspended" && (
                <Link
                  href="/chairman/units"
                  className="inline-flex items-center justify-center rounded-xl border border-emerald-800 bg-white px-5 py-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
                >
                  Unit register
                </Link>
              )}
          </div>
        )}
      </section>
    </main>
  );
}