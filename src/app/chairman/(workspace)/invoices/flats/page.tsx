import Link from "next/link";
import BillingSummary from "@/components/chairman/billing-summary";
import BillingNavigation from "@/components/chairman/billing-navigation";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";
import { listFlatBilling, parseBillingFilter } from "@/lib/server/services/flat-billing.service";
const money = (p: string) => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(Number(p)/100);
const occupancy: Record<string,string> = { unknown:"Not recorded",vacant:"Vacant",owner_occupied:"Owner-occupied",rented:"Tenant-occupied" };
export default async function FlatBillingPage({ searchParams }: { searchParams: Promise<{ page?: string; search?: string; status?: string }> }) {
  const session=await requirePortalSession("chairman");
  const app=await getChairmanApplication(session.userId);
  const q=await searchParams;
  const search=typeof q.search === "string" ? q.search.slice(0,120).trim() : "";
  const page=/^[1-9][0-9]{0,5}$/.test(q.page??"") ? Number(q.page) : 1;
  const filter = parseBillingFilter(q.status);
  const paid = filter === "paid";
  const url=(p:number,status=filter) => `?${new URLSearchParams({search,page:String(p),status})}`;
  let data: Awaited<ReturnType<typeof listFlatBilling>> | null=null;
  if(app) { try { data=await listFlatBilling(session.userId,app.societyId,page,search,filter); } catch {} }
  return <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
    <h1 className="text-3xl font-bold">Invoices</h1><BillingNavigation active="flats" />
    <h2 className="text-xl font-semibold">Bills by flat</h2><p className="mt-2 text-sm text-slate-500">Find a flat, see who owns and occupies it, and review its billing history.</p>
    {app && <BillingSummary userId={session.userId} societyId={app.societyId} />}
    <form className="my-6 flex flex-wrap gap-3"><label className="grow"><span className="sr-only">Search flat, owner or tenant</span><input name="search" defaultValue={search} maxLength={120} placeholder="Search flat, owner or tenant" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3" /></label><input type="hidden" name="status" value={filter}/><button className="rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white">Search</button></form>
    <nav aria-label="Payment filter" className="mb-5 flex flex-wrap gap-3">
      {(["all", "paid", "outstanding", "overdue"] as const).map(status => (
        <Link
          key={status}
          href={url(1, status)}
          aria-current={filter === status ? "page" : undefined}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 ${
            filter === status
              ? "bg-emerald-800 text-white"
              : "bg-white text-slate-600 hover:bg-emerald-50"
          }`}
        >
          {{all: "All flats", paid: "With paid bills", outstanding: "Outstanding", overdue: "Overdue"}[status]}
        </Link>
      ))}
    </nav>
    {!data ? <p role="alert" className="rounded-xl bg-white p-6">Billing could not be loaded. Check your access and retry.</p> : <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {!data.flats.length && <div className="p-8"><h3 className="font-semibold">{filter === "all" ? "No matching flats" : `No matching ${filter} bills`}</h3><p className="mt-2 text-sm text-slate-500">{paid ? "Bills appear here after confirmed receipts cover their total. Drafts do not count as bills." : "Try another search or payment filter."}</p></div>}
      <ul className="divide-y divide-slate-100">{data.flats.map(f=><li key={f.id}><Link href={`/chairman/invoices/flats/${f.id}?status=${filter}`} className="grid gap-4 p-6 transition hover:bg-emerald-50/40 sm:grid-cols-3">
        <div><h3 className="font-semibold">{f.wing?`Wing ${f.wing} · `:""}Flat {f.flatNumber}</h3><span className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">{occupancy[f.occupancy]??"Not recorded"}</span></div>
        <div className="text-sm"><p><span className="text-slate-500">Owner: </span>{f.owners.join(", ")||"Not linked"}</p>{f.tenants.length>0 && <p className="mt-2"><span className="text-slate-500">Tenant: </span>{f.tenants.join(", ")}</p>}</div>
        <div className="text-sm sm:text-right"><p className="font-semibold">{f.billCount} bills · {f.paidCount} paid · {f.overdueCount} overdue</p><p className="mt-2 text-slate-500">Received {money(f.receivedPaise)}</p><p className="mt-1 text-slate-500">Outstanding {money(String(BigInt(f.billedPaise)-BigInt(f.receivedPaise)))}</p><p className="mt-2 font-semibold text-emerald-800">View bills →</p></div>
      </Link></li>)}</ul>
      <div className="flex justify-between border-t border-slate-100 p-5 text-sm"><span>Page {page}</span><div className="flex gap-5">{page>1&&<Link href={url(page-1)}>Previous</Link>}{page*20<data.total&&<Link href={url(page+1)}>Next</Link>}</div></div>
    </section>}
  </main>;
}
