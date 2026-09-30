"use client";
import { useEffect, useRef, useState } from "react";
import type { TenantReviewItem } from "@/lib/contracts/tenant-review";

const button = "rounded-lg bg-emerald-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50";
function ReviewCard({ item, chairman, busy, decide }: {
  item: TenantReviewItem; chairman: boolean; busy: boolean;
  decide: (item: TenantReviewItem, decision: string, note: string) => Promise<void>;
}) {
  const [decision, setDecision] = useState("");
  const [note, setNote] = useState("");
  return <details className="rounded-xl border border-slate-200 bg-white p-5">
    <summary className="cursor-pointer font-semibold">{item.fullName} · {item.societyName} · {item.wing} / {item.flatNumber}</summary>
    <p className="mt-3 text-sm">Move-in: {item.moveInDate} · Agreement end: {item.tenancyEndDate ?? "Not specified"}</p>
    <p className="mt-2 text-sm text-slate-600">{chairman
      ? "The owner has verified this tenant and an agreement version. Your approval grants resident access. Rental agreements remain private to authorised owners and tenants."
      : "Verify the tenant and the latest rental agreement. Your approval sends this application to the chairman; it does not grant resident access."}</p>
    <ul className="mt-4 space-y-2">{item.documents.map((doc) => <li key={doc.id}>
      <a className="break-all text-sm font-semibold text-emerald-800 underline"
        href={`/api/application-documents/${doc.id}${chairman ? "?portal=chairman" : ""}`}>
        {doc.kind === "rental_agreement" ? "Rental agreement" : "Identity document"}: {doc.name}
      </a>
    </li>)}</ul>
    <form className="mt-5 space-y-4" onSubmit={(event) => {
      event.preventDefault();
      if (decision && (decision === "approved" || note.trim())) void decide(item, decision, note);
    }}>
      <label className="block text-sm font-medium">Decision
        <select required value={decision} disabled={busy} onChange={(event) => setDecision(event.target.value)}
          className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-3">
          <option value="">Choose a decision</option>
          <option value="approved">{chairman ? "Approve tenant access" : "Verify and send to chairman"}</option>
          <option value="changes_requested">Request corrections</option>
          <option value="rejected">Reject application</option>
        </select>
      </label>
      <label className="block text-sm font-medium">{decision === "approved" ? "Note — optional" : "Reason or required corrections"}
        <textarea value={note} maxLength={1000} disabled={busy} required={!!decision && decision !== "approved"}
          onChange={(event) => setNote(event.target.value)} className="mt-2 block w-full rounded-lg border border-slate-300 p-3" />
      </label>
      <button className={button} disabled={busy || !decision || (decision !== "approved" && !note.trim())}>Confirm decision</button>
    </form>
  </details>;
}

export default function TenantReviewInbox({ societyId }: { societyId?: string }) {
  const endpoint = societyId ? `/api/chairman/societies/${societyId}/tenant-applications` : "/api/resident/tenant-reviews";
  const [data, setData] = useState<{ items: TenantReviewItem[]; hasMore: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${endpoint}?page=${page}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "Unable to load tenant reviews.");
        if (!controller.signal.aborted) setData(body);
      }).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Unable to load tenant reviews."); });
    return () => controller.abort();
  }, [endpoint, page, reload]);
  async function decide(item: TenantReviewItem, decision: string, note: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ societyId: item.societyId, requestId: item.id,
          review: { expectedRevision: item.revision, decision, reviewNote: note.trim() || null } }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Decision could not be confirmed.");
      setNotice(decision === "approved" ? societyId ? "Tenant approved." : "Owner verification saved. The application is now awaiting chairman review." : "Decision saved. The applicant can see your feedback.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Decision could not be confirmed. Refresh before retrying."); }
    finally { pending.current = false; setBusy(false); setData(null); setReload((value) => value + 1); }
  }
  return <section className="my-6 space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{societyId ? "Tenant applications — chairman review" : "Tenant applications for your flats — owner verification"}</h2>
      <button type="button" disabled={busy} className={button} onClick={() => { setError(""); setData(null); setReload((value) => value + 1); }}>Refresh tenant reviews</button>
    </div>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {notice && <p role="status" className="text-emerald-900">{notice}</p>}
    {!data && !error && <p role="status">Loading tenant reviews…</p>}
    {data && !data.items.length && <p className="text-sm text-slate-600">No tenant applications awaiting your review.</p>}
    {data?.items.map((item) => <ReviewCard key={`${item.id}:${item.revision}`} item={item} chairman={!!societyId} busy={busy} decide={decide} />)}
    <div className="flex items-center gap-4">
      <button type="button" disabled={busy || page === 1} onClick={() => { setData(null); setPage((value) => value - 1); }} className={button}>Previous</button>
      <span className="text-sm">Page {page}</span>
      <button type="button" disabled={busy || !data?.hasMore} onClick={() => { setData(null); setPage((value) => value + 1); }} className={button}>Next</button>
    </div>
  </section>;
}
