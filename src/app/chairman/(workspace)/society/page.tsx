import ResidentialLayoutSummary from "@/components/society/residential-layout-summary";
import Link from "next/link";

import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";

const statusPresentation = {
  draft: {
    label: "Draft",
    description: "Your society application has not been submitted.",
    colour: "border-slate-200 bg-slate-50 text-slate-800",
  },
  pending_review: {
    label: "Pending review",
    description:
      "Your application is with the administrator. Submitted details are read-only while it is being reviewed.",
    colour: "border-amber-200 bg-amber-50 text-amber-900",
  },
  changes_requested: {
    label: "Changes requested",
    description:
      "The administrator has requested corrections. Read the review note below.",
    colour: "border-blue-200 bg-blue-50 text-blue-900",
  },
  approved: {
    label: "Approved",
    description:
      "Your society application has been approved. Subscription payment and service activation are separate steps.",
    colour: "border-emerald-200 bg-emerald-50 text-emerald-900",
  },
  rejected: {
    label: "Application rejected",
    description:
      "This application is closed. The administrator’s reason is shown below.",
    colour: "border-red-200 bg-red-50 text-red-900",
  },
};

function formatDate(value: string | null) {
  if (!value) return "Not submitted";

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export default async function ChairmanSocietyPage() {
  const session = await requirePortalSession("chairman");
  const application = await getChairmanApplication(session.userId);

  const presentation = application
    ? statusPresentation[application.status]
    : null;

  const units = application
    ? [
        ["Studio / 1 RK", application.studioUnits],
        ["1 BHK", application.oneBhkUnits],
        ["2 BHK", application.twoBhkUnits],
        ["3 BHK", application.threeBhkUnits],
        ["4+ BHK", application.fourPlusBhkUnits],
        ["Other residential", application.otherResidentialUnits],
      ]
    : [];

  return (
    <main className="min-h-screen bg-[#f3f6f4] font-sans text-slate-900">
      

      <div className="mx-auto max-w-5xl px-6 py-10">
        

        <p className="text-sm font-semibold text-emerald-700">
          Society overview
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          My Society
        </h1>

        {!application || !presentation ? (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-8">
            <h2 className="text-lg font-semibold">
              No society application yet
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              No society application is linked to your account.
            </p>

                        <Link
              href="/chairman/society/new"
              className="mt-5 inline-flex rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-900"
            >
              Register your society
            </Link>
          </section>
        ) : (
          <>
            <section
              className={`mt-8 rounded-2xl border p-6 ${presentation.colour}`}
            >
              <h2 className="text-lg font-semibold">
                {application.status === "approved" &&
                application.serviceStatus === "inactive"
                  ? "Approved — awaiting payment"
                  : presentation.label}
              </h2>

              <p className="mt-2 text-sm leading-6">
                {presentation.description}
              </p>

                            {application.status === "changes_requested" && (
                <Link
                  href="/chairman/society/edit"
                  className="mt-5 inline-flex rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-900"
                >
                  Edit application
                </Link>
              )}

              {application.reviewNote && (
                <div className="mt-5 rounded-xl bg-white/70 p-4">
                  <h3 className="text-sm font-semibold">
                    Administrator’s review note
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                    {application.reviewNote}
                  </p>
                </div>
              )}
            </section>

            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
              <h2 className="text-xl font-semibold">{application.name}</h2>
              <p className="mt-2 text-sm text-slate-500">
                Revision {application.revision}
                {" · "}Last submitted: {formatDate(application.submittedAt)}
              </p>

              <dl className="mt-6 grid gap-6 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-sm text-slate-500">Address</dt>
                  <dd className="mt-2 leading-7">
                    {application.addressLine1}
                    {application.addressLine2 && (
                      <>
                        <br />
                        {application.addressLine2}
                      </>
                    )}
                    <br />
                    {application.city}, {application.state}
                    {" — "}{application.pinCode}
                  </dd>
                </div>

                <div>
                  <dt className="text-sm text-slate-500">
                    Residential units
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold">
                    {application.totalUnits}
                  </dd>
                </div>

                <div>
                  <dt className="text-sm text-slate-500">Wings</dt>
                  <dd className="mt-1 text-lg font-semibold">
                    {application.wingCount === 0
                      ? "Standalone building"
                      : application.wingCount}
                  </dd>
                </div>
              </dl>
            </section>

                        {!application.residentialLayout && (
              <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-semibold">
                  Residential unit breakdown
                </h2>

                <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {units.map(([label, count]) => (
                    <div
                      key={label}
                      className="rounded-xl bg-slate-50 p-4"
                    >
                      <dt className="text-sm text-slate-600">
                        {label}
                      </dt>
                      <dd className="mt-2 text-2xl font-semibold">
                        {count}
                      </dd>
                    </div>
                  ))}
                </dl>

                {application.otherResidentialDescription && (
                  <p className="mt-5 text-sm text-slate-600">
                    Other residential units:{" "}
                    {application.otherResidentialDescription}
                  </p>
                )}
              </section>
            )}
            <ResidentialLayoutSummary layout={application.residentialLayout} />
          </>
        )}
      </div>
    </main>
  );
}