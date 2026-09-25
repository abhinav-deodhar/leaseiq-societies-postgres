"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Review = {
  draftId: string;
  title: string;
  dueDate: string;
  reviewFingerprint: string;
  recipientCount: number;
  amountPerBillPaise: number;
  combinedAmountPaise: number;
  recipients: Array<{
    id: string;
    wing: string;
    flatNumber: string;
    owners: string[];
  }>;
  lines: Array<{
    position: number;
    description: string;
    amountPaise: number;
  }>;
};

type IssueResult = {
  invoiceCount: number;
};

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(paise / 100);

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function IssueInvoiceDraft({
  societyId,
  draftId,
  initialReview = null,
  initialError = "",
}: {
  societyId: string;
  draftId: string;
  initialReview?: Review | null;
  initialError?: string;
}) {
  const router = useRouter();
  const pending = useRef(false);
  const [review, setReview] = useState<Review | null>(initialReview);
  const [result, setResult] = useState<IssueResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(initialError);

  const endpoint =
    `/api/chairman/societies/${societyId}` +
    `/invoices/drafts/${draftId}/issue`;

  async function loadReview() {
    if (pending.current) return;

    pending.current = true;
    setBusy(true);
    setError("");

    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });

      if (response.status === 401) {
        router.replace("/chairman/login");
        return;
      }

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.message || "Unable to prepare the review.");
      }

      setReview(body as Review);
      setUncertain(false);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to prepare the review. Please retry.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function issue() {
    if (!review || pending.current) return;

    pending.current = true;
    setBusy(true);
    setError("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewFingerprint: review.reviewFingerprint,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (response.status === 401) {
        router.replace("/chairman/login");
        return;
      }

      const body = await response.json();

      if (!response.ok) {
        if (response.status >= 500) {
          setUncertain(true);
          setError(
            "The result could not be confirmed. Retry issuance to check safely; existing bills will not be duplicated.",
          );
          return;
        }

        setReview(null);
        setUncertain(false);
        setError(
          body.message || "Unable to issue this draft. Review it again.",
        );
        return;
      }

      setResult({ invoiceCount: body.invoiceCount });
      router.replace(`/chairman/invoices/${draftId}`);
      router.refresh();
      setUncertain(false);
      setReview(null);
    } catch {
      setUncertain(true);
      setError(
        "The connection ended before we could confirm the result. Retry issuance; existing bills will not be duplicated.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  if (result) {
    return (
      <section
        role="status"
        className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6"
      >
        <h2 className="text-lg font-semibold text-emerald-950">
          {result.invoiceCount} {result.invoiceCount === 1 ? "bill" : "bills"} issued
        </h2>
        <p className="mt-2 text-sm leading-6 text-emerald-900">
          The numbered bills are saved and their notifications are queued.
        </p>
        <Link
          href="/chairman/invoices/flats"
          className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white hover:bg-emerald-900"
        >
          View bills by flat
        </Link>
      </section>
    );
  }

  return (
    <section
      id="issue-review"
      aria-label="Issue invoice draft"
      aria-busy={busy}
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-6"
    >
      <h2 className="text-lg font-semibold">
        {review ? "Confirm issuance" : "Ready to issue?"}
      </h2>

      {!review ? (
        <>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Review the current recipients and amounts before creating
            numbered bills.
          </p>
          <button
            type="button"
            onClick={loadReview}
            disabled={busy}
            className="mt-4 min-h-11 rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white transition hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50"
          >
            {busy ? "Preparing review…" : "Review and issue"}
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 font-medium">{review.title}</p>
          <p className="mt-1 text-sm text-slate-500">
            Due {dateLabel(review.dueDate)}
          </p>

          <dl className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              ["Bills to create", String(review.recipientCount)],
              ["Each bill", money(review.amountPerBillPaise)],
              ["Combined amount", money(review.combinedAmountPaise)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-4">
                <dt className="text-sm text-slate-500">{label}</dt>
                <dd className="mt-2 text-lg font-semibold tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <h3 className="mt-6 font-semibold">Bill items</h3>
          <ul className="mt-2 divide-y divide-slate-100">
            {review.lines.map((line) => (
              <li
                key={line.position}
                className="flex justify-between gap-4 py-3 text-sm"
              >
                <span>{line.description}</span>
                <span className="whitespace-nowrap tabular-nums">
                  {money(line.amountPaise)}
                </span>
              </li>
            ))}
          </ul>

          <h3 className="mt-6 font-semibold">Recipients</h3>
          <div
            role="region"
            aria-label="Recipient list"
            tabIndex={0}
            className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-slate-200 focus-visible:outline-2 focus-visible:outline-emerald-700"
          >
            <ul className="divide-y divide-slate-100">
              {review.recipients.map((unit) => (
                <li key={unit.id} className="px-4 py-3 text-sm">
                  <p className="font-medium">
                    {unit.wing ? `Wing ${unit.wing} · ` : ""}
                    Flat {unit.flatNumber}
                  </p>
                  <p className="mt-1 text-slate-500">
                    Owner: {unit.owners.join(", ") || "Not linked"}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            Issuing creates numbered bills and queues their notifications.
            These bills can no longer be deleted as drafts.
            Notification delivery and the resident inbox are not connected yet.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={issue}
              disabled={busy}
              className="min-h-11 rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white transition hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50"
            >
              {busy
                ? "Confirming issuance…"
                : uncertain
                  ? "Retry issuance safely"
                  : "Issue and notify"}
            </button>

            {!uncertain && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setReview(null);
                  setError("");
                }}
                className="min-h-11 rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Keep as draft
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm leading-6 text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
