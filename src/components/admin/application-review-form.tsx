"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applicationReviewSchema,
  type ApplicationReviewData,
} from "@/lib/validation/application-review";

type Decision = ApplicationReviewData["decision"];

type Props = {
  applicationId: string;
  societyName: string;
  revision: number;
  status: "pending_review" | "changes_requested";
};

const decisions: {
  value: Decision;
  label: string;
  explanation: string;
  colour: string;
}[] = [
  {
    value: "approved",
    label: "Approve application",
    explanation:
      "Approve these society details. Payment and service activation remain separate steps.",
    colour: "bg-emerald-800 text-white hover:bg-emerald-900",
  },
  {
    value: "changes_requested",
    label: "Request changes",
    explanation:
      "Return the application to the chairman for corrections.",
    colour: "bg-blue-700 text-white hover:bg-blue-800",
  },
  {
    value: "rejected",
    label: "Reject application",
    explanation:
      "Close this application. The chairman cannot resubmit a rejected application.",
    colour: "bg-red-700 text-white hover:bg-red-800",
  },
];

export default function ApplicationReviewForm({
  applicationId,
  societyName,
  revision,
  status,
}: Props) {
  const router = useRouter();
  const submitting = useRef(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [mustReload, setMustReload] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const [pendingReview, setPendingReview] =
    useState<ApplicationReviewData | null>(null);

  const selectedDecision = decisions.find(
    (item) => item.value === pendingReview?.decision,
  );

  useEffect(() => {
    if (!pendingReview) return;

    const dialog = dialogRef.current;

    if (!dialog) return;

    const previousOverflow = document.body.style.overflow;

    dialog.showModal();
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();

    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [pendingReview]);

  function closeConfirmation() {
    if (submitting.current) return;
    setPendingReview(null);
  }
    function submitDecision(decision: Decision) {
    if (
      submitting.current ||
      success ||
      mustReload ||
      pendingReview
    ) {
      return;
    }

    setError("");
    setNoteError("");

    const validation = applicationReviewSchema.safeParse({
      decision,
      expectedStatus: status,
      expectedRevision: revision,
      note,
    });

    if (!validation.success) {
      const issue = validation.error.issues[0];

      if (issue?.path[0] === "note") {
        setNoteError(issue.message);
        noteRef.current?.focus();
      } else {
        setError(issue?.message ?? "Please check your decision.");
      }

      return;
    }

    setPendingReview(validation.data);
  }

  async function confirmDecision() {
    if (
      !pendingReview ||
      submitting.current ||
      success ||
      mustReload
    ) {
      return;
    }

    // Submit the exact values displayed in the confirmation.
    const review = pendingReview;

    submitting.current = true;
    setBusy(review.decision);
    setError("");

    try {
      const response = await fetch(
        `/api/admin/applications/${encodeURIComponent(applicationId)}/review`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(review),
          signal: AbortSignal.timeout(15000),
        },
      );

      if (response.status === 401) {
        window.location.replace("/admin/login");
        return;
      }

      const body: unknown = await response.json();

      const message =
        typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof body.message === "string"
          ? body.message
          : "Unable to save your decision.";

      if (!response.ok) {
        setError(message);

        if (
          response.status === 403 ||
          response.status === 404 ||
          response.status === 409 ||
          response.status >= 500
        ) {
          setMustReload(true);
        }

        return;
      }

      setSuccess(
        review.decision === "approved"
          ? "Application approved. Payment and service activation are still pending."
          : review.decision === "changes_requested"
            ? "Changes requested. The chairman can see your correction note."
            : "Application rejected. The chairman can see your reason.",
      );

      setPendingReview(null);
      router.refresh();
    } catch {
      setError(
        "We could not confirm whether the decision was saved. " +
          "Reload the application to check its current status before trying again.",
      );
      setMustReload(true);
    } finally {
      submitting.current = false;
      setBusy(null);
    }
  }
  return (
    <section
      aria-labelledby="review-heading"
      aria-busy={busy !== null}
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-6"
    >
      <h2 id="review-heading" className="text-lg font-semibold">
        Review application
      </h2>

      <p className="mt-2 text-sm leading-6 text-slate-600">
        Review revision {revision} before making a decision.
        Your note will be visible to the chairman.
      </p>

      {success ? (
        <p
          role="status"
          className="mt-5 rounded-xl bg-emerald-50 p-4 text-emerald-900"
        >
          {success}
        </p>
      ) : (
        <>
          <label
            htmlFor="review-note"
            className="mt-5 block text-sm font-semibold"
          >
            Review note
          </label>

          <p id="review-note-help" className="mt-1 text-sm text-slate-600">
            Required for changes or rejection: 5–2,000 characters.
            Optional for approval.
          </p>

          <textarea
            ref={noteRef}
            id="review-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setNoteError("");
            }}
            rows={4}
            maxLength={2000}
            disabled={busy !== null || mustReload}
            aria-invalid={Boolean(noteError)}
            aria-describedby={
              noteError
                ? "review-note-help review-note-error"
                : "review-note-help"
            }
            className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100"
            placeholder="Explain the corrections needed or the reason for your decision."
          />

          <p className="mt-1 text-right text-xs text-slate-500">
            {note.length}/2,000
          </p>

          {noteError && (
            <p
              id="review-note-error"
              role="alert"
              className="mt-2 text-sm text-red-700"
            >
              {noteError}
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          {mustReload ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold hover:bg-slate-50"
            >
              Reload application
            </button>
          ) : (
            <div className="mt-5 flex flex-wrap gap-3">
                           {decisions
                .filter(
                  (item) =>
                    status === "pending_review" ||
                    item.value === "rejected",
                )
                .map((item) => (
                <button
                  key={item.value}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void submitDecision(item.value)}
                  className={`rounded-xl px-5 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50 ${item.colour}`}
                >
                  {busy === item.value ? "Saving…" : item.label}
                </button>
              ))}
            </div>
          )}

          <p className="mt-4 text-sm leading-6 text-slate-500">
            Approval accepts the society application. It does not
            activate its paid services.
          </p>
        </>
      )}
            <dialog
        ref={dialogRef}
        aria-labelledby="review-confirm-title"
        aria-describedby="review-confirm-description"
        onCancel={(event) => {
          event.preventDefault();
          closeConfirmation();
        }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-sm"
      >
        {pendingReview && selectedDecision && (
          <div className="p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
              Confirm review decision
            </p>

            <h2
              id="review-confirm-title"
              className="mt-3 text-2xl font-semibold tracking-tight"
            >
              {selectedDecision.label}?
            </h2>

            <p
              id="review-confirm-description"
              className="mt-3 text-sm leading-6 text-slate-600"
            >
              {selectedDecision.explanation}
            </p>

            <dl className="mt-6 space-y-4 rounded-xl bg-slate-50 p-4">
              <div>
                <dt className="text-xs font-medium text-slate-500">
                  Society
                </dt>
                <dd className="mt-1 break-words font-semibold">
                  {societyName}
                </dd>
              </div>

              <div>
                <dt className="text-xs font-medium text-slate-500">
                  Application revision
                </dt>
                <dd className="mt-1 text-sm">
                  {pendingReview.expectedRevision}
                </dd>
              </div>

              <div>
                <dt className="text-xs font-medium text-slate-500">
                  Note visible to the chairman
                </dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
                  {pendingReview.note || "No review note provided."}
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-xs leading-5 text-slate-500">
              Your decision and review note will be recorded in the
              application’s audit history.
            </p>

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-red-50 p-4 text-sm leading-6 text-red-800"
              >
                {error}
              </p>
            )}

            <p role="status" className="mt-4 text-sm text-slate-600">
              {busy !== null
                ? "Saving your decision. Please wait…"
                : ""}
            </p>

            <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                ref={cancelRef}
                type="button"
                disabled={busy !== null}
                onClick={closeConfirmation}
                className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mustReload ? "Close" : "Cancel"}
              </button>

              {mustReload ? (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  Reload application
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void confirmDecision()}
                  className={`rounded-xl px-5 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50 ${selectedDecision.colour}`}
                >
                  {busy !== null
                    ? "Saving…"
                    : pendingReview.decision === "approved"
                      ? "Confirm approval"
                      : pendingReview.decision === "rejected"
                        ? "Confirm rejection"
                        : "Confirm change request"}
                </button>
              )}
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}