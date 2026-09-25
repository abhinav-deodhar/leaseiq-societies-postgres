import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";
import { getIssuedBillDetail } from "@/lib/server/services/issued-bill-detail.service";
import { parseBillingFilter } from "@/lib/server/services/flat-billing.service";

function money(value: string) {
  const paise = BigInt(value);
  return `₹${new Intl.NumberFormat("en-IN").format(paise / BigInt(100))}.${(paise % BigInt(100)).toString().padStart(2, "0")}`;
}

function date(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value.length === 10 ? `${value}T00:00:00+05:30` : value));
}

function pageNumber(value: string | undefined) {
  return /^[1-9][0-9]{0,5}$/.test(value ?? "") ? Number(value) : 1;
}

export default async function IssuedBillPage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{
    status?: string;
    fromPage?: string;
    receiptPage?: string;
  }>;
}) {
  const session = await requirePortalSession("chairman");
  const application = await getChairmanApplication(session.userId);
  const invoiceId = z.uuid().safeParse((await params).invoiceId);
  if (!application || !invoiceId.success) notFound();

  const query = await searchParams;
  const filter = parseBillingFilter(query.status);
  const fromPage = pageNumber(query.fromPage);
  const receiptPage = pageNumber(query.receiptPage);
  const detail = await getIssuedBillDetail(
    session.userId,
    application.societyId,
    invoiceId.data,
    receiptPage,
  );
  if (!detail) notFound();

  const { invoice, receipts } = detail;
  const recipient = invoice.recipient;
  const flatLabel = [
    recipient.wing ? `Wing ${recipient.wing}` : null,
    recipient.flatNumber ? `Flat ${recipient.flatNumber}` : null,
  ].filter(Boolean).join(" · ");

  const back = `/chairman/invoices/flats/${invoice.unitId}?${new URLSearchParams({
    status: filter,
    page: String(fromPage),
  })}`;
  const receiptUrl = (page: number) => `?${new URLSearchParams({
    status: filter,
    fromPage: String(fromPage),
    receiptPage: String(page),
  })}`;

  const paymentLabel = {
    unpaid: "Unpaid",
    part_paid: "Part-paid",
    paid: "Paid",
    void: "Voided",
  }[invoice.paymentStatus];

  const occupancy = {
    unknown: "Occupancy not recorded",
    vacant: "Vacant",
    owner_occupied: "Owner occupied",
    rented: "Tenant occupied",
  }[recipient.occupancyStatus ?? "unknown"] ?? "Occupancy not recorded";

  return (
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
      <Link
        href={back}
        className="inline-flex rounded-lg py-2 font-semibold text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        ← Back to flat’s bills
      </Link>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-800">Invoice #{invoice.number}</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{invoice.title}</h1>
          <p className="mt-3 text-sm text-slate-500">
            Issued {date(invoice.issuedAt)} · Due {date(invoice.dueDate)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900">
            {paymentLabel}
          </span>
          {invoice.isOverdue && (
            <span className="rounded-full bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">
              Overdue
            </span>
          )}
        </div>
      </div>

      {invoice.status === "void" && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <p className="font-semibold">This invoice is void. No amount is collectible.</p>
          <p className="mt-2">{invoice.voidReason}</p>
          {invoice.voidedAt && <p className="mt-2 text-sm">Voided {date(invoice.voidedAt)}</p>}
        </div>
      )}

      <section className="mt-6 grid gap-4 sm:grid-cols-2" aria-label="Invoice parties">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-500">Issued by</h2>
          <p className="mt-3 text-lg font-semibold">
            {invoice.society.name ?? "Society name not recorded"}
          </p>
          <p className="mt-2 leading-6 text-slate-600">
            {invoice.society.address || "Address not recorded"}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-slate-500">Issued to</h2>
          <p className="mt-3 text-lg font-semibold">{flatLabel || "Flat details not recorded"}</p>
          <p className="mt-2 text-sm">Owner: {recipient.owners.join(", ") || "Not recorded at issuance"}</p>
          {recipient.tenants.length > 0 && (
            <p className="mt-2 text-sm">Tenant: {recipient.tenants.join(", ")}</p>
          )}
          <p className="mt-2 text-sm text-slate-500">
            {[recipient.unitTypeName, occupancy].filter(Boolean).join(" · ")}
          </p>
        </div>
      </section>
      <p className="mt-3 text-xs text-slate-500">
        Society and recipient details reflect the invoice when it was issued.
      </p>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 p-6 text-lg font-semibold">Charge breakdown</h2>
        <dl className="divide-y divide-slate-100">
          {invoice.lines.map((line, index) => (
            <div key={index} className="flex justify-between gap-6 px-6 py-4">
              <dt className="min-w-0 break-words">{line.description}</dt>
              <dd className="shrink-0 font-medium">{money(line.amountPaise)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-6 bg-slate-50 px-6 py-5 font-bold">
            <dt>Invoice total</dt>
            <dd>{money(invoice.totalPaise)}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2" aria-label="Payment balance">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm text-slate-500">Received · excluding reversals</h2>
          <p className="mt-3 text-2xl font-bold text-emerald-800">{money(invoice.receivedPaise)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-sm text-slate-500">Remaining balance</h2>
          <p className={`mt-3 text-2xl font-bold ${invoice.isOverdue ? "text-amber-800" : "text-slate-900"}`}>
            {money(invoice.outstandingPaise)}
          </p>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 p-6 text-lg font-semibold">Payment history</h2>
        {receipts.items.length === 0 && (
          <p className="p-6 text-slate-500">
            {receipts.total === 0 ? "No payment receipts recorded." : "No receipts on this page."}
          </p>
        )}
        <ul className="divide-y divide-slate-100">
          {receipts.items.map(receipt => (
            <li key={receipt.id} className="flex flex-wrap justify-between gap-4 p-6">
              <div className="min-w-0">
                <p className="font-semibold">{date(receipt.paidAt)}</p>
                <p className="mt-2 break-all text-sm text-slate-600">Reference: {receipt.reference}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {receipt.source === "gateway" ? "Payment gateway" : "Manually recorded"}
                </p>
                {receipt.reversedAt && (
                  <p className="mt-2 text-sm text-amber-900">
                    Reversed {date(receipt.reversedAt)} · {receipt.reversalReason}
                  </p>
                )}
              </div>
              <div>
                <p className="font-semibold">{money(receipt.amountPaise)}</p>
                <p className={`mt-2 text-sm ${receipt.reversedAt ? "text-amber-800" : "text-emerald-800"}`}>
                  {receipt.reversedAt ? "Excluded from balance" : "Confirmed"}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {(receipts.total > receipts.pageSize || receiptPage > 1) && (
          <nav aria-label="Receipt pages" className="flex justify-between gap-4 border-t border-slate-100 p-5 text-sm">
            <span>Page {receiptPage}</span>
            <div className="flex gap-5 font-semibold text-emerald-800">
              {receiptPage > 1 && <Link href={receiptUrl(receiptPage - 1)}>Previous</Link>}
              {receiptPage * receipts.pageSize < receipts.total && (
                <Link href={receiptUrl(receiptPage + 1)}>Next</Link>
              )}
            </div>
          </nav>
        )}
      </section>
    </main>
  );
}
