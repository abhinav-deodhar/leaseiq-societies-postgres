"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteInvoiceDraft({ societyId, draftId, schedule = false }: { societyId: string; draftId: string; schedule?: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/chairman/societies/${societyId}/invoices/${schedule ? "schedules" : "drafts"}/${draftId}`, { method: "DELETE", signal: AbortSignal.timeout(30000) });
      if (response.status === 401) { router.replace("/chairman/login"); return; }
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.message || "Unable to delete this draft.");
      }
      router.replace(schedule ? "/chairman/invoices/schedules" : "/chairman/invoices"); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to delete the draft. Please retry."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Delete draft" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
    {confirming ? <div>
      <h2 className="font-semibold">Delete this draft?</h2>
      <p className="mt-2 text-sm text-slate-600">It will leave your draft list. No issued bills or payments will be removed. An audit record is retained.</p>
      <div className="mt-4 flex gap-3">
        <button type="button" disabled={busy} onClick={remove} className="rounded-xl bg-red-700 px-4 py-3 font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">{busy ? "Deleting…" : "Delete draft"}</button>
        <button type="button" disabled={busy} onClick={() => { setConfirming(false); setError(""); }} className="rounded-xl border border-slate-300 px-4 py-3 font-semibold">Keep draft</button>
      </div>
    </div> : <button type="button" onClick={() => setConfirming(true)} className="rounded-lg px-3 py-2 font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-2">Delete draft</button>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>;
}
