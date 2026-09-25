import Link from "next/link";
import type { getInvoiceSchedule } from "@/lib/server/services/invoice-schedule-reading.service";

type History = Awaited<ReturnType<typeof getInvoiceSchedule>>["history"];

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

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export default function InvoiceScheduleHistory({
  scheduleId,
  history,
}: {
  scheduleId: string;
  history: History;
}) {
  const pageHref = (page: number) =>
    `/chairman/invoices/schedules/${scheduleId}?historyPage=${page}#run-history`;

  return (
    <section
      id="run-history"
      aria-labelledby="run-history-heading"
      className="mt-6 scroll-mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white"
    >
      <header className="border-b border-slate-100 p-6">
        <h2 id="run-history-heading" className="text-lg font-semibold">
          Generation history
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {history.total} recorded {history.total === 1 ? "billing cycle" : "billing cycles"}.
          Processing times use India Standard Time.
        </p>
      </header>

      {history.runs.length === 0 ? (
        <div className="p-6 sm:p-8">
          <h3 className="font-semibold">No billing cycles processed yet</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Activating a schedule does not create a history entry.
            Entries appear when the billing runner processes a due cycle.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {history.runs.map((run) => (
            <li key={run.id} className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold">
                  {dateLabel(run.billingMonth, true)}
                </h3>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  run.status === "generated"
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-amber-50 text-amber-900"
                }`}>
                  {run.status === "generated" ? "Generated" : "Skipped"}
                </span>
              </div>

              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Scheduled date</dt>
                  <dd className="mt-1 font-medium">
                    {dateLabel(run.scheduledDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Processed</dt>
                  <dd className="mt-1 font-medium">
                    {timeLabel(run.processedAt)} IST
                  </dd>
                </div>

                {run.status === "generated" && (
                  <>
                    <div>
                      <dt className="text-slate-500">Bills created</dt>
                      <dd className="mt-1 font-medium">{run.recipientCount}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Original issued value</dt>
                      <dd className="mt-1 font-medium tabular-nums">
                        {money(run.issuedValuePaise)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Payment deadline</dt>
                      <dd className="mt-1 font-medium">
                        {dateLabel(run.dueDate)}
                      </dd>
                    </div>
                  </>
                )}
              </dl>

              {run.status === "skipped" && (
                <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
                  {run.skipReason ?? "This billing cycle was skipped."}
                  {" "}No bills were created.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {history.total > 0 && (
        <footer className="border-t border-slate-100 p-5">
          <p className="text-xs leading-5 text-slate-500">
            Issued values are historical bill totals, not collected payments.
            Payment status is available in Bills by flat.
          </p>
          {history.totalPages > 1 && (
            <nav
              aria-label="Generation history pages"
              className="mt-4 flex flex-wrap items-center justify-between gap-4 text-sm"
            >
              <span className="text-slate-500">
                Page {history.page} of {history.totalPages}
              </span>
              <div className="flex gap-4">
                {history.page > 1 && (
                  <Link
                    href={pageHref(history.page - 1)}
                    className="rounded-lg px-3 py-2 font-semibold text-emerald-800 hover:bg-emerald-50"
                  >
                    Previous
                  </Link>
                )}
                {history.page < history.totalPages && (
                  <Link
                    href={pageHref(history.page + 1)}
                    className="rounded-lg px-3 py-2 font-semibold text-emerald-800 hover:bg-emerald-50"
                  >
                    Next
                  </Link>
                )}
              </div>
            </nav>
          )}
        </footer>
      )}
    </section>
  );
}
