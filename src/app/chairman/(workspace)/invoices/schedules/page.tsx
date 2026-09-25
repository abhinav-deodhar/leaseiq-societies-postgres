import Link from "next/link";
import BillingNavigation from "@/components/chairman/billing-navigation";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";
import { listInvoiceSchedules } from "@/lib/server/services/invoice-schedule-reading.service";

export default async function SchedulesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await requirePortalSession("chairman");
  const app = await getChairmanApplication(session.userId);
  const q = await searchParams;
  const page = /^[1-9][0-9]{0,5}$/.test(q.page ?? "") ? Number(q.page) : 1;
  let data: Awaited<ReturnType<typeof listInvoiceSchedules>> | null = null;
  if (app) { try { data = await listInvoiceSchedules(session.userId,app.societyId,page); } catch {} }
  return <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
    <h1 className="text-3xl font-bold">Invoices</h1><BillingNavigation active="schedules" />
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">Recurring schedules</h2><p className="mt-2 text-sm text-slate-500">Monthly billing instructions and their current status.</p></div>
    {data && <Link href="/chairman/invoices/new" className="rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white">Create invoice</Link>}</div>
    {!data ? <p role="alert">Schedules could not be loaded. Check your access and retry.</p> : <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {!data.schedules.length && <p className="p-8 text-slate-500">No recurring schedules on this page.</p>}
      <ul className="divide-y divide-slate-100">{data.schedules.map(s => <li key={s.id}><Link href={`/chairman/invoices/schedules/${s.id}`} className="flex flex-wrap items-center justify-between gap-4 p-6 hover:bg-emerald-50/50"><div><h3 className="font-semibold">{s.title}</h3><p className="mt-2 text-sm text-slate-500">Monthly · Day {s.generationDay} · {s.targetKind === "unit" ? "Individual flat" : "Unit type"}</p><span className="mt-3 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize">{s.status}</span></div><div className="text-right"><p className="font-semibold">{new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(s.totalPaise/100)}</p><p className="mt-1 text-xs text-slate-500">For each bill · View schedule →</p></div></Link></li>)}</ul>
      <div className="flex justify-between border-t border-slate-100 p-5 text-sm"><span>Page {page}</span><div className="flex gap-5">{page>1 && <Link href={`?page=${page-1}`}>Previous</Link>}{page*20<data.total && <Link href={`?page=${page+1}`}>Next</Link>}</div></div>
    </section>}
  </main>;
}
