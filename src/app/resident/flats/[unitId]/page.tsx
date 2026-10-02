import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { loadResidentDashboard } from "@/lib/server/services/resident-dashboard.service";

export default async function ResidentFlatPage({
  params,
}: {
  params: Promise<{ unitId: string }>;
}) {
  const session = await requirePortalSession("resident");
  const { unitId } = await params;
  if (!z.uuid().safeParse(unitId).success) notFound();

  const dashboard = await loadResidentDashboard(session.userId);
  const flat = dashboard.homes.find(home => home.unitId === unitId);
  if (!flat) notFound();

  return <main className="min-h-screen bg-[#f3f6f4] px-5 py-8 text-slate-900 sm:px-8">
    <div className="mx-auto max-w-5xl">
      <Link href="/resident" className="font-semibold text-emerald-800">
        ← Resident dashboard
      </Link>
      <p className="mt-8 text-sm font-semibold text-emerald-700">My home</p>
      <h1 className="mt-2 text-3xl font-semibold">{flat.societyName}</h1>
      <p className="mt-2 text-slate-600">{flat.city}</p>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
        <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-900">
          Registered {flat.relationship}
        </span>
        {flat.accessState === "upcoming" && <p className="mt-5 rounded-lg bg-amber-50 p-4 text-amber-950">
          Approved · Upcoming tenancy. Access starts on {flat.moveInDate}.
        </p>}
        <dl className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3">
          {[
            ["Wing", flat.wing || "No wing"],
            ["Floor", flat.floor || "Not specified"],
            ["Flat number", flat.flatNumber],
          ].map(([label, value]) => <div key={label}>
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd className="mt-1 text-lg font-semibold">{value}</dd>
          </div>)}
        </dl>
        <div className="mt-6 flex flex-wrap gap-4 border-t border-slate-100 pt-5">
          <Link href={`/resident/applications?application=${flat.sourceRequestId}`}
            className="inline-flex min-h-11 items-center font-semibold text-emerald-800 underline">
            View approved application
          </Link>
          <Link href="/resident/onboarding"
            className="inline-flex min-h-11 items-center font-semibold text-emerald-800 underline">
            Connect another flat
          </Link>
        </div>
      </section>
    </div>
  </main>;
}
