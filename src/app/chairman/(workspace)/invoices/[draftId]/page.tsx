import { prepareInvoiceIssue } from "@/lib/server/services/invoice-issuance.service";
import IssueInvoiceDraft from "@/components/chairman/issue-invoice-draft";
import DeleteInvoiceDraft from "@/components/chairman/delete-invoice-draft";
import Link from "next/link";
import { notFound } from "next/navigation";
import { societyIdSchema } from "@/lib/contracts/units";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";
import { getInvoiceDraft } from "@/lib/server/services/invoice-draft-reading.service";
import { InvoiceDraftError } from "@/lib/server/services/invoice-drafts.service";

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(paise / 100);

function dateLabel(value: string, monthOnly = false) {
  return new Intl.DateTimeFormat("en-IN", {
    ...(monthOnly
      ? { month: "long" as const, year: "numeric" as const }
      : {
          day: "numeric" as const,
          month: "short" as const,
          year: "numeric" as const,
        }),
    timeZone: "UTC",
  }).format(new Date(`${value}${monthOnly ? "-01" : ""}T00:00:00Z`));
}

export default async function InvoiceDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>;
  searchParams: Promise<{ review?: string | string[] }>;
}) {
  const session = await requirePortalSession("chairman");
  const application = await getChairmanApplication(session.userId);
  const parsed = societyIdSchema.safeParse((await params).draftId);
  if (!parsed.success || !application) notFound();

  let result: Awaited<ReturnType<typeof getInvoiceDraft>> | null = null;
  try {
    result = await getInvoiceDraft(
      session.userId,
      application.societyId,
      parsed.data,
    );
  } catch (error) {
    if (error instanceof InvoiceDraftError && error.status === 404) notFound();
  }

  if (!result) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <h1 className="text-2xl font-bold">Bill unavailable</h1>
        <p role="alert" className="mt-4 text-slate-600">
          Check your society access or reload to try again.
        </p>
      </main>
    );
  }

  const { draft, preview } = result;
  let issueReview: Awaited<ReturnType<typeof prepareInvoiceIssue>> | null = null;
  let issueError = "";

  if ((await searchParams).review === "1" && draft.status === "draft") {
    try {
      issueReview = await prepareInvoiceIssue(
        session.userId, application.societyId, draft.id,
      );
    } catch (error) {
      issueError = error instanceof InvoiceDraftError
        ? error.message
        : "Unable to prepare the review. Your draft is saved; please retry.";
    }
  }
  const individual = draft.targetKind === "unit";
  const recipient = individual ? preview?.recipients[0] : null;

  return (
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
      <Link href="/chairman/invoices" className="mb-6 inline-flex rounded-lg py-2 font-semibold text-emerald-800">← Invoices</Link>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
          Billing workspace
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Bill preview</h1>
        <p className="mt-2 text-sm text-slate-500">
          {draft.status === "draft"
            ? "Review the recipient and itemised amounts before issuance."
            : "Saved bill preparation record."}
        </p>
      </div>

      <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 px-6 py-7 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-sm font-semibold text-emerald-800">{application.name}</p>
              <h2 className="mt-3 break-words text-3xl font-bold tracking-tight">
                {draft.title}
              </h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {draft.status}
            </span>
          </div>
          <div className="mt-6 flex flex-wrap gap-x-10 gap-y-3 text-sm">
            <p><span className="text-slate-500">Billing period </span>
              <strong className="font-medium">{dateLabel(draft.billingMonth, true)}</strong>
            </p>
            <p><span className="text-slate-500">Due date </span>
              <strong className="font-medium">{dateLabel(draft.dueDate)}</strong>
            </p>
          </div>
        </header>

        <div className="grid gap-7 border-b border-slate-200 px-6 py-6 sm:grid-cols-2 sm:px-8">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">From</h3>
            <p className="mt-3 font-semibold">{application.name}</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">
              {[
                application.addressLine1,
                application.addressLine2,
                `${application.city}, ${application.state} — ${application.pinCode}`,
              ].filter(Boolean).join("\n")}
            </p>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Bill to</h3>
            {recipient ? (
              <>
                <p className="mt-3 font-semibold">
                  {recipient.wing ? `Wing ${recipient.wing} · ` : ""}
                  Flat {recipient.flatNumber}
                </p>
                <p className="mt-2 text-sm text-slate-600">{recipient.unitTypeName ?? "Unit type unassigned"}</p>
                <p className="mt-2 text-sm text-amber-800">Owner not linked</p>
              </>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {preview
                  ? individual
                    ? "No matching flat is currently available."
                    : `${preview.recipientCount} flats in the selected unit type. Each will receive a separate bill.`
                  : "Recipient details for issued bills belong to their individual invoice records."}
              </p>
            )}
          </section>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Bill items and amounts</caption>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="w-14 px-6 py-4 sm:px-8">No.</th>
                <th scope="col" className="px-4 py-4">Description</th>
                <th scope="col" className="px-6 py-4 text-right sm:px-8">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {draft.lines.map((line) => (
                <tr key={line.position}>
                  <td className="px-6 py-4 text-slate-400 sm:px-8">{line.position}</td>
                  <td className="px-4 py-4 font-medium">{line.description}</td>
                  <td className="whitespace-nowrap px-6 py-4 text-right tabular-nums sm:px-8">
                    {money(line.amountPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 bg-emerald-50/60 px-6 py-6 sm:px-8">
          <p className="font-semibold">{individual ? "Bill total" : "Total for each bill"}</p>
          <p className="text-2xl font-bold tabular-nums text-emerald-900">{money(draft.totalPaise)}</p>
        </div>

        {draft.status === "draft" && (
          <p className="px-6 py-5 text-xs leading-5 text-slate-500 sm:px-8">
            Draft only. No invoice number has been assigned and no payment request
            or notification has been sent.
          </p>
        )}
      </article>

      {draft.status === "issued" && (
        <section role="status" className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <h2 className="font-semibold text-emerald-950">Bills issued</h2>
          <p className="mt-2 text-sm text-emerald-900">
            The numbered bills are saved and their notifications are queued.
          </p>
          <Link href="/chairman/invoices/flats" className="mt-4 inline-flex rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white">
            View bills by flat
          </Link>
        </section>
      )}

      {draft.status === "draft" && <DeleteInvoiceDraft societyId={application.societyId} draftId={draft.id} />}

      {draft.status === "draft" && (
        <IssueInvoiceDraft
          societyId={application.societyId}
          draftId={draft.id}
          initialReview={issueReview}
          initialError={issueError}
        />
      )}

      {!individual && preview && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Recipient summary</h2>
          <p className="mt-2 text-sm text-slate-600">
            {preview.recipientCount} separate bills · Combined value {money(preview.combinedAmountPaise)}
          </p>
          <ul className="mt-4 divide-y divide-slate-100">
            {preview.recipients.map((unit) => (
              <li key={unit.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
                <span>{unit.wing ? `Wing ${unit.wing} · ` : ""}Flat {unit.flatNumber}</span>
                <span className="text-slate-500">Owner not linked</span>
              </li>
            ))}
          </ul>
          {preview.hasMoreRecipients && (
            <p className="mt-3 text-xs text-slate-500">
              Showing {preview.previewLimit} of {preview.recipientCount} flats.
            </p>
          )}
          <p className="mt-4 text-xs text-slate-500">
            Recipients reflect the current register and will be checked again before issuance.
          </p>
        </section>
      )}
    </main>
  );
}
