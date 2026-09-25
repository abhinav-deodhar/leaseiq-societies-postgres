import Link from "next/link";
import ApplicationsList from "@/components/admin/applications-list";
import LogoutButton from "@/components/auth/logout-button";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";

export default async function AdminApplicationsPage() {
  await requirePortalSession("admin");

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
          href="/admin"
          className="mb-6 inline-block text-sm font-medium text-emerald-800 underline underline-offset-4"
        >
          Back to admin home
        </Link>
        <ApplicationsList />
      </div>
    </main>
  );
}