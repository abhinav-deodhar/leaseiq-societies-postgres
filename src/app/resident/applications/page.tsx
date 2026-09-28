import Link from "next/link";
import ApplicationInbox from "@/components/resident/application-inbox";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";

export default async function ResidentApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ application?: string | string[] }>;
}) {
  await requirePortalSession("resident");
  const query = await searchParams;
  return <main className="min-h-screen bg-[#f3f6f4] px-5 py-8 font-sans text-slate-900 sm:px-8">
    <div className="mx-auto max-w-7xl">
      <Link href="/resident" className="text-sm font-semibold text-emerald-800">← Resident dashboard</Link>
      <div className="mt-7 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Your homes</p>
          <h1 className="mt-2 text-3xl font-semibold">My applications</h1>
          <p className="mt-3 text-slate-600">Review saved details, submit an owner application and track its decision.</p>
        </div>
        <Link href="/resident/onboarding"
          className="rounded-lg bg-emerald-800 px-5 py-3 text-sm font-semibold text-white">
          Connect another flat
        </Link>
      </div>
      <ApplicationInbox initialApplication={
        typeof query.application === "string" ? query.application : ""
      } />
    </div>
  </main>;
}
