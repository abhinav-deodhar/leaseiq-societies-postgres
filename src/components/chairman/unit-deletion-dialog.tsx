"use client";

import { useEffect, useRef, useState } from "react";
import type { UnitDeletionPreview, UnitDeletionTarget } from "@/lib/contracts/unit-deletion";

export default function UnitDeletionDialog({
  societyId, target, onClose, onDeleted,
}: {
  societyId: string;
  target: UnitDeletionTarget;
  onClose: () => void;
  onDeleted: (deleted: number, blocked: number) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [preview, setPreview] = useState<UnitDeletionPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const endpoint = `/api/chairman/societies/${societyId}/units/deletion`;

  useEffect(() => {
    let active = true;
    const element = dialog.current;
    element?.showModal();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    async function load() {
      try {
        const response = await fetch(endpoint, {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "preview", target }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "Unable to load deletion preview.");
        if (active && !controller.signal.aborted) setPreview(result as UnitDeletionPreview);
      } catch (caught) {
        if (active && !controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Unable to load deletion preview.");
        } else if (active) {
          setError("Preview timed out. Close this window and try again.");
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      active = false;
      element?.close();
      controller.abort();
      clearTimeout(timeout);
    };
  }, [endpoint, target]);

  const eligible = preview?.rows.filter((row) => row.reasons.length === 0).length ?? 0;
  const blocked = (preview?.rows.length ?? 0) - eligible;
  const expected = preview?.scope === "all" ? preview.societyName : "DELETE";

  async function confirm() {
    if (pending.current || !preview || !eligible || confirmation !== expected || finished) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "confirm", previewId: preview.previewId, confirmation }),
        signal: AbortSignal.timeout(60000),
      });
      const result = await response.json();
      if (!response.ok) {
        setFinished(true);
        throw new Error(result.message ?? "Deletion could not be confirmed. Refresh the register.");
      }
      setFinished(true);
      try {
        await onDeleted(result.deleted, result.blocked);
      } catch {
        setError(`${result.deleted} flats were deleted, but the register could not reload. Close this window and refresh the page.`);
      }
    } catch (caught) {
      setFinished(true);
      setError(caught instanceof Error && caught.name !== "TimeoutError"
        ? caught.message
        : "Deletion could not be confirmed. Close this window and refresh before retrying.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="unit-delete-title"
      onCancel={(event) => { event.preventDefault(); if (!pending.current) onClose(); }}
      className="m-auto max-h-[90vh] w-[min(95vw,48rem)] overflow-y-auto rounded-2xl bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-900/50">
      <h2 id="unit-delete-title" className="text-xl font-semibold">Review unit deletion</h2>
      <p className="mt-2 text-sm text-slate-600">
        {target.scope === "all" ? "This covers the entire society, across all pages and search results. " : "Only the selected flats are included. "}
        Linked flats are protected. Deleted flats and their audit history are retained in the deletion archive.
      </p>
      {!preview && !error && <p role="status" className="mt-4">Checking selected flats…</p>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      {preview && <>
        <p className="mt-4 font-semibold">{eligible} eligible · {blocked} protected</p>
        <ul className="mt-3 max-h-64 overflow-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
          {preview.rows.map((row) => <li key={row.id} className="p-3 text-sm">
            <span className="font-semibold">{row.wing ? `${row.wing} / ` : ""}Flat {row.flatNumber}</span>
            <span className={row.reasons.length ? "ml-2 text-amber-800" : "ml-2 text-red-700"}>
              {row.reasons.length ? `Protected: ${row.reasons.join(", ")}` : "Will be deleted"}
            </span>
          </li>)}
        </ul>
        {eligible > 0 && !finished && <div className="mt-4">
          <label htmlFor="unit-deletion-confirmation" className="block text-sm font-medium">
            Type <strong>{expected}</strong> to confirm deletion of {eligible} eligible flat{eligible === 1 ? "" : "s"}.
          </label>
          <input id="unit-deletion-confirmation" value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)} disabled={busy}
            autoComplete="off" spellCheck={false}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2" />
          <p className="mt-2 text-xs text-slate-500">This preview expires after 10 minutes. There is no automatic undo.</p>
        </div>}
      </>}
      <div className="mt-6 flex flex-wrap gap-3">
        {preview && eligible > 0 && !finished && <button type="button"
          disabled={busy || confirmation !== expected} onClick={() => void confirm()}
          className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {busy ? "Deleting…" : `Delete ${eligible} eligible flats`}
        </button>}
        <button type="button" autoFocus disabled={busy} onClick={onClose}
          className="rounded-lg border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50">
          {finished ? "Close" : "Cancel"}
        </button>
      </div>
    </dialog>
  );
}
