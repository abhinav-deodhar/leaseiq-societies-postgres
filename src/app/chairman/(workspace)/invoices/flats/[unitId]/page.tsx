import Link from "next/link";
import { notFound } from "next/navigation";
import { societyIdSchema } from "@/lib/contracts/units";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";
import { getFlatBills, parseBillingFilter } from "@/lib/server/services/flat-billing.service";
const money=(p:string)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}).format(Number(p)/100);
export default async function FlatBillsPage({params,searchParams}:{params:Promise<{unitId:string}>;searchParams:Promise<{page?:string;status?:string}>}) {
  const session=await requirePortalSession("chairman");const app=await getChairmanApplication(session.userId);
  const id=societyIdSchema.safeParse((await params).unitId);if(!app||!id.success)notFound();
  const q=await searchParams;const page=/^[1-9][0-9]{0,5}$/.test(q.page??"")?Number(q.page):1;const filter=parseBillingFilter(q.status);
  const data=await getFlatBills(session.userId,app.societyId,id.data,page,filter);if(!data)notFound();
  return <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8"><Link href={`/chairman/invoices/flats?status=${filter}`} className="inline-flex py-2 font-semibold text-emerald-800">← Bills by flat</Link>
    <h1 className="mt-5 text-3xl font-bold">{data.flat.wing?`Wing ${data.flat.wing} · `:""}Flat {data.flat.flatNumber}</h1>
    <p className="mt-3 text-slate-500">Current owner: {data.contacts.filter(c=>c.role==="owner").map(c=>c.fullName).join(", ")||"Not linked"}</p>
    <p className="mt-2 text-sm text-slate-500">{({unknown:"Occupancy not recorded",vacant:"Vacant",owner_occupied:"Owner-occupied",rented:"Tenant-occupied"} as Record<string,string>)[data.flat.occupancy]}{data.contacts.some(c=>c.role==="tenant")?` · ${data.contacts.filter(c=>c.role==="tenant").map(c=>c.fullName).join(", ")}`:""}</p>
    <nav className="my-6 flex flex-wrap gap-3" aria-label="Bills filter">
      {(["all", "paid", "outstanding", "overdue"] as const).map(status => (
        <Link
          key={status}
          href={`?status=${status}`}
          aria-current={filter === status ? "page" : undefined}
          className={`rounded-xl px-4 py-3 font-semibold transition ${
            filter === status ? "bg-emerald-800 text-white" : "bg-white text-emerald-800 hover:bg-emerald-50"
          }`}
        >
          {{all: "All bills", paid: "Paid", outstanding: "Outstanding", overdue: "Overdue"}[status]}
        </Link>
      ))}
    </nav>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><h2 className="border-b border-slate-100 p-6 text-lg font-semibold">{{all: "Billing history", paid: "Paid bills", outstanding: "Outstanding bills", overdue: "Overdue bills"}[filter]}</h2>
    {!data.bills.length&&<p className="p-8 text-slate-500">{"No bills match this filter on this page."}</p>}
    <ul className="divide-y divide-slate-100">{data.bills.map(b=><li key={b.id} className="flex flex-wrap justify-between gap-5 p-6"><div><p className="text-xs text-slate-500">Invoice #{b.number}</p><h3 className="mt-1 font-semibold">{b.title}</h3><Link
      href={`/chairman/invoices/bills/${b.id}?${new URLSearchParams({status: filter, fromPage: String(page)})}`}
      className="mt-3 inline-flex rounded-lg py-2 text-sm font-semibold text-emerald-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
    >View invoice →</Link><p className="mt-2 text-sm text-slate-500">Due {b.dueDate}</p></div><div className="text-right"><p className="font-semibold">{money(b.totalPaise)}</p><p className="mt-1 text-sm text-slate-500">Received {money(b.receivedPaise)}</p>
      <p className="mt-1 text-sm font-semibold">Remaining {money(b.outstandingPaise)}</p>
      {b.isOverdue && b.status !== "Overdue" && (
        <span className="mr-2 mt-2 inline-block rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
          Overdue
        </span>
      )}<span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${b.status==="Paid"?"bg-emerald-50 text-emerald-800":b.status==="Overdue"?"bg-amber-50 text-amber-900":"bg-slate-100 text-slate-600"}`}>{b.status}</span></div></li>)}</ul>
    <div className="flex justify-between border-t border-slate-100 p-5 text-sm"><span>Page {page}</span><div className="flex gap-4">{page>1&&<Link href={`?page=${page-1}&status=${filter}`}>Previous</Link>}{page*20<data.total&&<Link href={`?page=${page+1}&status=${filter}`}>Next</Link>}</div></div></section>
  </main>;
}
