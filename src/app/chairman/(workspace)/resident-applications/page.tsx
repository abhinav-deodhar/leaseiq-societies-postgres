import Link from "next/link";
import ApplicationInbox from "@/components/resident/application-inbox";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";

export default async function ChairmanResidentApplicationsPage() {
  const session = await requirePortalSession("chairman");
  const application = await getChairmanApplication(session.userId);
  const available = application?.status === "approved" &&
    application.serviceStatus !== "suspended";

  return <main className="min-h-screen bg-[#f3f6f4] px-5 py-8 font-sans text-slate-900 sm:px-8">
    <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Chairman workspace</p>
    <h1 className="mt-2 text-3xl font-semibold">Resident applications</h1>
    <p className="mt-3 text-slate-600">
      {application?.name ?? "Your society"} · Review submitted owner applications.
    </p>
    {available && application
      ? <ApplicationInbox societyId={application.societyId} />
      : <section className="mt-7 rounded-xl border border-slate-200 bg-white p-6">
          <p>Your society must be approved and not suspended before you can review applications.</p>
          <Link href="/chairman/society" className="mt-4 inline-block font-semibold text-emerald-800 underline">
            View society status
          </Link>
        </section>}
  </main>;
}
