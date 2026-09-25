import Link from "next/link";
export default function BillingNavigation({ active }: { active: "drafts" | "schedules" | "flats" }) {
  return <nav aria-label="Invoice sections" className="my-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2">
    {[["drafts","Drafts","/chairman/invoices"],["schedules","Recurring schedules","/chairman/invoices/schedules"],["flats","Bills by flat","/chairman/invoices/flats"]].map(([key,label,href]) =>
      <Link key={key} href={href} aria-current={active===key ? "page" : undefined} className={`rounded-xl px-4 py-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-emerald-700 ${active===key ? "bg-emerald-800 text-white" : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-900"}`}>{label}</Link>)}
  </nav>;
}
