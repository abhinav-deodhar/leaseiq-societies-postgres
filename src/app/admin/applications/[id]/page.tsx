import ResidentialLayoutSummary from "@/components/society/residential-layout-summary";
import Link from "next/link";
import { notFound } from "next/navigation";
import LogoutButton from "@/components/auth/logout-button";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getApplicationForAdmin } from "@/lib/server/services/application-review.service";
import ApplicationReviewForm from "@/components/admin/application-review-form";

const statusLabels = {
  draft: "Draft",
  pending_review: "Pending review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
};

function formatDate(value: string | null) {
  if (!value) return "Not submitted";

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export default async function ApplicationDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePortalSession("admin");
  const { id } = await params;

  const application = await getApplicationForAdmin(session.userId, id);

  if (!application) {
    notFound();
  }

  const unitBreakdown = [
    { label: "Studio / 1 RK", count: application.studioUnits },
    { label: "1 BHK", count: application.oneBhkUnits },
    { label: "2 BHK", count: application.twoBhkUnits },
    { label: "3 BHK", count: application.threeBhkUnits },
    { label: "4+ BHK", count: application.fourPlusBhkUnits },
    { label: "Other residential", count: application.otherResidentialUnits },
  ];

  return (
    <main className="min-h-screen bg-[#f3f6f4] font-sans text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <Link href="/admin" className="text-xl font-semibold text-emerald-900">
            leaseIq societies
          </Link>
          <LogoutButton portal="admin" />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <Link
          href="/admin/applications"
          className="text-sm font-medium text-emerald-800 underline underline-offset-4"
        >
          Back to pending applications
        </Link>

        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-emerald-700">
              Society application
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {application.societyName}
            </h1>
            <p className="mt-3 text-sm text-slate-600">
              Submitted {formatDate(application.submittedAt)} IST
              {" · "}Revision {application.revision}
            </p>
          </div>

          <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold">
            {statusLabels[application.status]}
          </span>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold">Society details</h2>

            <dl className="mt-5 grid gap-6 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-sm text-slate-500">Address</dt>
                <dd className="mt-1 leading-7">
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
                  <br />
                  India
                </dd>
              </div>

              <div>
                <dt className="text-sm text-slate-500">Residential units</dt>
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

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">Chairman</h2>

            <dl className="mt-5 space-y-5">
              <div>
                <dt className="text-sm text-slate-500">Name</dt>
                <dd className="mt-1 font-medium">
                  {application.chairmanName}
                </dd>
              </div>

              <div>
                <dt className="text-sm text-slate-500">Mobile number</dt>
                <dd className="mt-1">{application.chairmanPhone}</dd>
              </div>

              <div>
                <dt className="text-sm text-slate-500">Email</dt>
                <dd className="mt-1 break-all">
                  {application.chairmanEmail}
                </dd>
              </div>
            </dl>
          </section>
        </div>

                {!application.residentialLayout && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">
              Residential unit breakdown
            </h2>

            <dl className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3">
              {unitBreakdown.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl bg-slate-50 p-4"
                >
                  <dt className="text-sm text-slate-600">
                    {item.label}
                  </dt>
                  <dd className="mt-2 text-2xl font-semibold">
                    {item.count}
                  </dd>
                </div>
              ))}
            </dl>

            {application.otherResidentialDescription && (
              <p className="mt-5 text-sm leading-6 text-slate-600">
                Other residential units:{" "}
                {application.otherResidentialDescription}
              </p>
            )}
          </section>
        )}        {!application.residentialLayout && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">
              Residential unit breakdown
            </h2>

            <dl className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3">
              {unitBreakdown.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl bg-slate-50 p-4"
                >
                  <dt className="text-sm text-slate-600">
                    {item.label}
                  </dt>
                  <dd className="mt-2 text-2xl font-semibold">
                    {item.count}
                  </dd>
                </div>
              ))}
            </dl>

            {application.otherResidentialDescription && (
              <p className="mt-5 text-sm leading-6 text-slate-600">
                Other residential units:{" "}
                {application.otherResidentialDescription}
              </p>
            )}
          </section>
        )}
        
                   {(application.status === "pending_review" ||
          application.status === "changes_requested") && (
          <ApplicationReviewForm
            key={`${application.id}:${application.revision}:${application.status}`}
            applicationId={application.id}
            societyName={application.societyName}
            revision={application.revision}
            status={application.status}
          />
        )}

        <ResidentialLayoutSummary layout={application.residentialLayout} />

        {application.reviewNote && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">Latest review note</h2>
            <p className="mt-3 whitespace-pre-wrap leading-7 text-slate-700">
              {application.reviewNote}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}