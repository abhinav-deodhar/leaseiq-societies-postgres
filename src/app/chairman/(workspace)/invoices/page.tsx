import BillingNavigation from "@/components/chairman/billing-navigation";
import Link from "next/link";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";
import { listInvoiceDrafts } from "@/lib/server/services/invoice-draft-reading.service";

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(paise / 100);

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const session = await requirePortalSession("chairman");
  const application = await getChairmanApplication(session.userId);
  const query = await searchParams;
  const rawPage = typeof query.page === "string" ? query.page : "1";
  const page = /^[1-9][0-9]{0,5}$/.test(rawPage) ? Number(rawPage) : 1;

  let result: Awaited<ReturnType<typeof listInvoiceDrafts>> | null = null;
  let message = "";

  if (!application || application.status !== "approved") {
    message = "Invoice preparation becomes available after society approval.";
  } else if (application.serviceStatus === "suspended") {
    message = "Society access is suspended. Contact the administrator.";
  } else {
    try {
      result = await listInvoiceDrafts(session.userId, application.societyId, page);
    } catch {
      message = "Invoice drafts could not be loaded. Access may have changed, or the service may be unavailable.";
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
        Chairman workspace
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Invoices</h1>
      <BillingNavigation active="drafts" />
      <p className="mt-3 text-slate-600">
        Prepare charges, review recipients, and track invoice drafts.
      </p>

      {result && (
        <Link
          href="/chairman/invoices/new"
          className="mt-6 inline-flex rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-900"
        >
          Create invoice
        </Link>
      )}

      {application?.serviceStatus === "inactive" && result && (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Draft preparation is available. Issuing invoices requires active society services.
        </p>
      )}

      {!result ? (
        <p role="alert" className="mt-7 rounded-2xl border border-slate-200 bg-white p-6">
          {message}
        </p>
      ) : (
        <section className="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 p-6">
            <h2 className="text-lg font-semibold">Saved drafts</h2>
            <p className="mt-1 text-sm text-slate-500">{result.total} records</p>
          </div>

          {result.drafts.length === 0 ? (
            <div className="p-8">
              <h3 className="font-semibold">
                {result.total === 0 ? "No invoice drafts yet" : "No drafts on this page"}
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                {result.total === 0
                  ? "Saved invoice drafts will appear here before they are issued."
                  : "Return to the first page to see your drafts."}
              </p>
              {page > 1 && (
                <Link href="/chairman/invoices" className="mt-4 inline-block text-sm font-semibold text-emerald-800">
                  First page
                </Link>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {result.drafts.map((draft) => (
                <li key={draft.id}>
                  <Link
                    href={`/chairman/invoices/${draft.id}`}
                    className="flex flex-wrap items-center justify-between gap-4 p-6 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-700"
                  >
                    <div>
                      <h3 className="font-semibold">{draft.title}</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Billing month {draft.billingMonth} · Due {draft.dueDate}
                      </p>
                      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-emerald-800">
                        {draft.status}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{money(draft.totalPaise)}</p>
                      <p className="mt-1 text-xs text-slate-500">Per flat · View details →</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-4 border-t border-slate-100 p-5 text-sm">
            <span className="text-slate-500">
              Page {page} of {Math.max(1, Math.ceil(result.total / result.pageSize))}
            </span>
            <div className="flex gap-4">
              {page > 1 && (
                <Link href={`/chairman/invoices?page=${page - 1}`} className="font-semibold text-emerald-800">
                  Previous
                </Link>
              )}
              {page * result.pageSize < result.total && (
                <Link href={`/chairman/invoices?page=${page + 1}`} className="font-semibold text-emerald-800">
                  Next
                </Link>
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
