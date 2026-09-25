import Link from "next/link";

import UnitRegister from "@/components/chairman/unit-register";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";
import { listUnitsForChairman } from "@/lib/server/services/units.service";
import { SocietyAccessError } from "@/lib/server/services/society-access.service";

export default async function ChairmanUnitsPage() {
  const session = await requirePortalSession("chairman");
  const application = await getChairmanApplication(session.userId);

  let data: Awaited<ReturnType<typeof listUnitsForChairman>> | null = null;
  let message = "";

  if (!application) {
    message = "Submit your society application before setting up its unit register.";
  } else if (application.status !== "approved") {
    message = "Unit setup becomes available after your society application is approved.";
  } else if (application.serviceStatus === "suspended") {
    message = "Your society's access is suspended. Contact the administrator.";
  } else {
    try {
      data = await listUnitsForChairman(
        session.userId,
        application.societyId,
        { page: 1, search: "" },
      );
    } catch (error) {
      message = error instanceof SocietyAccessError
        ? error.message
        : "The unit register is temporarily unavailable. Please reload this page.";
    }
  }

  return (
    <main className="min-h-screen bg-[#f3f6f4] font-sans text-slate-900">
      

      <div className="mx-auto max-w-7xl px-6 py-8 sm:py-10">
        

        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
            Chairman workspace
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Every flat. One register.
          </h1>
          <p className="mt-3 text-slate-600">
            {application?.name ?? "Your society"} · Physical units and their details
          </p>
        </div>

        {application && data ? (
          <>
            <div className="mt-6 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
              Application unit count:{" "}
              <strong className="text-slate-900">{application.totalUnits}</strong>.
              {" "}The register tracks individual flats; it is not a count of registered residents.
              {application.serviceStatus === "inactive" && (
                <p className="mt-2">
                  Unit setup is available. Your society subscription has not been activated.
                </p>
              )}
            </div>
            <UnitRegister societyId={application.societyId} initialData={data} />
          </>
        ) : (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-8">
            <h2 className="text-lg font-semibold">Unit register unavailable</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">{message}</p>
            <Link
              href="/chairman/society"
              className="mt-5 inline-flex font-semibold text-emerald-800 underline underline-offset-4"
            >
              Open society overview
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
