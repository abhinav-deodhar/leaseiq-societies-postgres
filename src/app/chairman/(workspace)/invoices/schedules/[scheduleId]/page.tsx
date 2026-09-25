import InvoiceScheduleHistory from "@/components/chairman/invoice-schedule-history";
import InvoiceScheduleControls from "@/components/chairman/invoice-schedule-controls";
import { prepareScheduleControl } from "@/lib/server/services/invoice-schedule-control.service";
import DeleteInvoiceDraft from "@/components/chairman/delete-invoice-draft";
import Link from "next/link";
import { notFound } from "next/navigation";
import { societyIdSchema } from "@/lib/contracts/units";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";
import { getInvoiceSchedule } from "@/lib/server/services/invoice-schedule-reading.service";
import { InvoiceScheduleError } from "@/lib/server/services/invoice-schedules.service";

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR",
  }).format(paise / 100);

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ scheduleId: string }>;
  searchParams: Promise<{
    review?: string | string[];
    historyPage?: string | string[];
  }>;
}) {
  const session = await requirePortalSession("chairman");
  const application = await getChairmanApplication(session.userId);
  const id = societyIdSchema.safeParse((await params).scheduleId);
  if (!application || !id.success) notFound();

  const query = await searchParams;
  const rawPage = typeof query.historyPage === "string"
    ? query.historyPage
    : "1";
  const historyPage = /^[1-9][0-9]{0,5}$/.test(rawPage)
    ? Number(rawPage)
    : 1;

  let result: Awaited<ReturnType<typeof getInvoiceSchedule>> | null = null;
  try {
    result = await getInvoiceSchedule(
      session.userId, application.societyId, id.data, historyPage,
    );
  } catch (error) {
    if (error instanceof InvoiceScheduleError && error.status === 404) notFound();
  }

  let controlReview: Awaited<ReturnType<typeof prepareScheduleControl>> | null = null;
  let controlError = "";

  if (
    query.review === "1" &&
    result?.schedule.status === "draft"
  ) {
    try {
      controlReview = await prepareScheduleControl(
        session.userId, application.societyId, id.data, "activate",
      );
    } catch (error) {
      controlError = error instanceof InvoiceScheduleError
        ? error.message
        : "Unable to prepare activation. Your schedule draft is saved; please retry.";
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
      <Link href="/chairman/invoices/schedules" className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800">
        ← Recurring schedules
      </Link>
      {!result ? (
        <p role="alert" className="mt-6 rounded-xl bg-white p-6">
          This schedule could not be loaded. Check your access or reload.
        </p>
      ) : (
        <>
          <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-emerald-700">
            Monthly schedule · {result.schedule.status}
          </p>
          <h1 className="mt-2 text-3xl font-bold">{result.schedule.title}</h1>
          <p className="mt-3 text-slate-600">{application.name}</p>

          {result.schedule.status === "draft" && (
            <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              Schedule draft saved. Automatic invoice generation is not active.
            </p>
          )}

          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">Schedule</h2>
            <dl className="mt-5 grid gap-5 sm:grid-cols-2">
              {[
                ["Starts", result.schedule.firstBillingMonth],
                ["Ends", result.schedule.finalBillingMonth ?? "Until paused"],
                ["Generation day", `Day ${result.schedule.generationDay} each month`],
                ["Payment window", `${result.schedule.paymentWindowDays} days`],
                ["Time zone", "India Standard Time"],
                ["Recipients", result.schedule.targetKind === "unit" ? "Individual flat" : "Selected unit type"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-sm text-slate-500">{label}</dt>
                  <dd className="mt-1 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">Bill items</h2>
            <ul className="mt-4 divide-y divide-slate-100">
              {result.schedule.lines.map((line) => (
                <li key={line.position} className="flex justify-between gap-5 py-4 text-sm">
                  <span>{line.description}</span>
                  <span className="whitespace-nowrap tabular-nums">{money(line.amountPaise)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between gap-4 border-t border-slate-200 pt-5 font-bold">
              <span>Total for each bill</span>
              <span>{money(result.schedule.totalPaise)}</span>
            </div>
            <p className="mt-5 text-sm text-slate-500">
              Currently matches {result.preview.recipientCount} flats.
              Combined monthly value: {money(result.preview.combinedAmountPaise)}.
              Recipients will be checked again during generation.
            </p>
          </section>
          <InvoiceScheduleControls
            key={`${result.schedule.id}:${result.schedule.revision}`}
            societyId={application.societyId}
            scheduleId={result.schedule.id}
            status={result.schedule.status}
            initialReview={controlReview}
            initialError={controlError}
          />

          <InvoiceScheduleHistory
            scheduleId={result.schedule.id}
            history={result.history}
          />

          {result.schedule.status === "draft" && <DeleteInvoiceDraft societyId={application.societyId} draftId={result.schedule.id} schedule />}
        </>
      )}
    </main>
  );
}
