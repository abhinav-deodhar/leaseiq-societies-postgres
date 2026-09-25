"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { prepareScheduleControl } from "@/lib/server/services/invoice-schedule-control.service";

type Review = Awaited<ReturnType<typeof prepareScheduleControl>>;
type Action = Review["action"];

const labels: Record<Action, string> = {
  activate: "Activate schedule",
  pause: "Pause schedule",
  resume: "Resume schedule",
};

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(paise / 100);

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export default function InvoiceScheduleControls({
  societyId,
  scheduleId,
  status,
  initialReview = null,
  initialError = "",
}: {
  societyId: string;
  scheduleId: string;
  status: string;
  initialReview?: Review | null;
  initialError?: string;
}) {
  const router = useRouter();
  const pending = useRef(false);
  const savedRequest = useRef<string | null>(null);
  const [review, setReview] = useState<Review | null>(initialReview);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [completed, setCompleted] = useState(false);

  const action: Action | null =
    status === "draft" ? "activate"
      : status === "active" ? "pause"
        : status === "paused" ? "resume"
          : null;

  const endpoint =
    `/api/chairman/societies/${societyId}` +
    `/invoices/schedules/${scheduleId}/control`;

  async function loadReview() {
    if (!action || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`${endpoint}?action=${action}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });

      if (response.status === 401) {
        router.replace("/chairman/login");
        return;
      }

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.message || "Unable to review this action.");
      }

      savedRequest.current = null;
      setReview(body as Review);
      setUncertain(false);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to load the review.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function confirm() {
    if (!review || pending.current) return;

    if (!savedRequest.current) {
      savedRequest.current = JSON.stringify({
        requestKey: crypto.randomUUID(),
        action: review.action,
        reviewFingerprint: review.reviewFingerprint,
      });
    }

    pending.current = true;
    setBusy(true);
    setError("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: savedRequest.current,
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
            "The result could not be confirmed. Retry safely using the same request.",
          );
        } else {
          setReview(null);
          savedRequest.current = null;
          setUncertain(false);
          setError(body.message || "Review the schedule again.");
        }
        return;
      }

      setCompleted(true);
      router.replace(`/chairman/invoices/schedules/${scheduleId}`);
      router.refresh();
    } catch {
      setUncertain(true);
      setError(
        "The connection ended before confirmation. Retry safely; the action will not be repeated.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  if (!action) return null;

  return (
    <section
      id="schedule-review"
      aria-label="Recurring schedule controls"
      aria-busy={busy}
      className="mt-6 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6"
    >
      {completed ? (
        <p role="status" className="font-semibold text-emerald-800">
          Schedule updated.
        </p>
      ) : (
        <>
          <h2 className="text-lg font-semibold">
            {review ? `Confirm: ${labels[review.action]}` : "Schedule controls"}
          </h2>

          {review ? (
            <>
              {review.action === "pause" ? (
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Future generation will stop. Bills already issued remain
                  unchanged and payable.
                </p>
              ) : (
                <>
                  <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                    {[
                      [
                        "First eligible generation",
                        review.firstGenerationDate
                          ? dateLabel(review.firstGenerationDate)
                          : "Not scheduled",
                      ],
                      ["Frequency", `Monthly, day ${review.generationDay}`],
                      ["Currently matching flats", String(review.recipientCount)],
                      ["Each bill", money(review.amountPerBillPaise)],
                      ["Combined monthly amount", money(review.combinedAmountPaise)],
                      ["Payment window", `${review.paymentWindowDays} days`],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl bg-slate-50 p-4">
                        <dt className="text-sm text-slate-500">{label}</dt>
                        <dd className="mt-2 font-semibold">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <ul className="mt-5 divide-y divide-slate-100">
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

                  <p className="mt-4 text-sm leading-6 text-slate-600">
                    Dates use India Standard Time. Past billing months will not
                    be generated automatically. Matching flats are checked again
                    when each billing cycle runs.
                  </p>
                </>
              )}

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={confirm}
                  className="min-h-11 rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                >
                  {busy ? "Confirming…" : uncertain
                    ? "Retry safely"
                    : labels[review.action]}
                </button>
                {!uncertain && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setReview(null);
                      setError("");
                      savedRequest.current = null;
                    }}
                    className="min-h-11 rounded-xl border border-slate-300 px-5 py-3 font-semibold hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={loadReview}
              className="mt-4 min-h-11 rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
            >
              {busy ? "Preparing review…" : labels[action]}
            </button>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>
          )}
        </>
      )}

      <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        Schedule controls are available. Automatic bill generation is not
        connected yet.
      </p>
    </section>
  );
}
