import Link from "next/link";
import type { ChairmanDashboard } from "@/lib/contracts/chairman-dashboard";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";
import { getChairmanDashboard } from "@/lib/server/services/chairman-dashboard.service";

export default async function ChairmanDashboardPage() {
  const session = await requirePortalSession("chairman");
  const application = await getChairmanApplication(session.userId);
  let summary: ChairmanDashboard | null = null;
  let unavailable = false;

  if (
    application?.status === "approved" &&
    application.serviceStatus !== "suspended"
  ) {
    try {
      summary = await getChairmanDashboard(
        session.userId,
        application.societyId,
      );
    } catch {
      unavailable = true;
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
        Society overview
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Dashboard</h1>
      <p className="mt-3 text-slate-600">Welcome, {session.fullName}.</p>

      <Link
        href={application ? "/chairman/society" : "/chairman/society/new"}
        className="mt-7 block rounded-2xl bg-[#142a3b] p-6 text-white transition hover:bg-[#1b374c] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
      >
        <p className="text-xs uppercase tracking-widest text-emerald-200">
          Your society
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          {application?.name ?? "Register your society"}
        </h2>
        {application && (
          <p className="mt-3 text-sm text-slate-200">
            Application: {application.status.replaceAll("_", " ")}
            {" · "}Services: {application.serviceStatus}
          </p>
        )}
        <p className="mt-5 text-sm font-semibold text-emerald-200">
          {application ? "View society details →" : "Start your application →"}
        </p>
      </Link>

      {unavailable && (
        <div role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          Dashboard counts are unavailable. Access may have changed, or the server
          could not load the summary. Reload to try again.
        </div>
      )}

      {application && !summary && !unavailable && (
        <p className="mt-6 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          {application.serviceStatus === "suspended"
            ? "Society access is suspended. Contact the administrator."
            : "Unit insights become available after society approval."}
        </p>
      )}

      {summary && (
        <>
          <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Approved units", summary.approvedUnits, "Application capacity"],
              ["Registered flats", summary.registeredUnits, "Individual flats recorded"],
              ["Still to register", summary.remainingUnits, "Remaining approved capacity"],
              ["Type unassigned", summary.unassignedUnits, "Flats needing a unit type"],
            ].map(([label, value, description]) => (
              <section key={label} className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-medium text-slate-600">{label}</h2>
                <p className="mt-3 text-3xl font-bold tabular-nums">{value}</p>
                <p className="mt-2 text-xs text-slate-500">{description}</p>
              </section>
            ))}
          </div>

          {(summary.excessUnits > 0 ||
            summary.categories.some((category) => category.excess > 0)) && (
            <p role="alert" className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
              Some registered counts exceed the approved breakdown. Review the
              unit register and correct the affected entries.
            </p>
          )}

          <section aria-labelledby="unit-types-title" className="mt-9">
            <div className="mb-5">
              <h2
                id="unit-types-title"
                className="text-xl font-bold tracking-tight text-slate-900"
              >
                Units by type
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Registered flats against approved capacity
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {summary.categories.map((category) => {
                const overCapacity = category.excess > 0;
                const notIncluded =
                  category.approved === 0 && category.registered === 0;
                const progress = category.approved > 0
                  ? Math.min(100, Math.max(
                      0,
                      (category.registered / category.approved) * 100,
                    ))
                  : category.registered > 0 ? 100 : 0;

                return (
                  <article
                    key={category.category}
                    className={`flex flex-col rounded-2xl border bg-white p-6 ${
                      overCapacity
                        ? "border-amber-300"
                        : "border-slate-200"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-700">
                        {category.label}
                      </h3>
                      {notIncluded && (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
                          Not included
                        </span>
                      )}
                    </div>

                    <div className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p
                        className={`text-4xl font-bold tracking-tight tabular-nums ${
                          overCapacity
                            ? "text-amber-800"
                            : notIncluded
                              ? "text-slate-400"
                              : "text-emerald-800"
                        }`}
                      >
                        {category.registered}
                      </p>
                      <span className="text-sm text-slate-500">
                        / {category.approved} approved
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-slate-500">
                      Registered flats
                    </p>

                    <div
                      aria-hidden="true"
                      className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-100"
                    >
                      <div
                        className={`h-full rounded-full ${
                          overCapacity ? "bg-amber-500" : "bg-emerald-600"
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>

                    <p
                      className={`mt-3 text-xs font-medium ${
                        overCapacity ? "text-amber-800" : "text-slate-500"
                      }`}
                    >
                      {overCapacity
                        ? `${category.excess} over approved capacity`
                        : notIncluded
                          ? "No capacity allocated"
                          : category.remaining === 0
                            ? "Approved count reached"
                            : `${category.remaining} remaining`}
                    </p>
                  </article>
                );
              })}
            </div>

            <p className="mt-4 max-w-3xl text-xs leading-5 text-slate-500">
              Unassigned flats count toward the registered total, but are not
              included in a unit type. These figures describe flats, not residents.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
