import Link from "next/link";
import { getBillingSummary } from "@/lib/server/services/billing-summary.service";

function money(paise: string): string {
  const amount = BigInt(paise);
  const rupees = amount / BigInt(100);
  const fraction = (amount % BigInt(100)).toString().padStart(2, "0");
  return `₹${new Intl.NumberFormat("en-IN").format(rupees)}.${fraction}`;
}

export default async function BillingSummary({
  userId,
  societyId,
}: {
  userId: string;
  societyId: string;
}) {
  let summary: Awaited<ReturnType<typeof getBillingSummary>>;

  try {
    summary = await getBillingSummary(userId, societyId);
  } catch {
    return (
      <div role="alert" className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        Payment totals could not be loaded. Refresh the page to retry.
      </div>
    );
  }

  const cards = [
    {
      label: "Paid",
      data: summary.paid,
      description: "Value of fully paid bills",
      colour: "text-emerald-800",
    },
    {
      label: "Outstanding",
      data: summary.outstanding,
      description: "Balance remaining, including partial payments",
      colour: "text-slate-900",
    },
    {
      label: "Overdue",
      data: summary.overdue,
      description: "Past-due balance within outstanding",
      colour: "text-amber-800",
    },
  ];

  return (
    <section aria-label="Payment overview" className="mt-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={`/chairman/invoices/flats?status=${card.label.toLowerCase()}`}
            aria-label={`View flats with ${card.label.toLowerCase()} bills`}
            className="block rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-emerald-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
          >
            <h3 className="text-sm font-semibold text-slate-600">{card.label}</h3>
            <p className={`mt-3 break-words text-2xl font-bold tracking-tight ${card.colour}`}>
              {money(card.data.amountPaise)}
            </p>
            <p className="mt-2 text-sm font-medium text-slate-700">
              {card.data.billCount} {card.data.billCount === 1 ? "bill" : "bills"}
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-500">{card.description}</p>
            <p className="mt-4 text-sm font-semibold text-emerald-800">View flats →</p>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-500">
        Society-wide totals · {summary.flatsOwingCount} flats with an outstanding balance.
        Overdue is included in outstanding. Dates use India time.
      </p>
    </section>
  );
}
