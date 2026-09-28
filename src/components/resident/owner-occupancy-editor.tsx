"use client";
import { useEffect, useRef, useState } from "react";
import { awayOccupancySchema, occupancyDisplay } from "@/lib/contracts/occupancy";

export default function OwnerOccupancyEditor({ societyId, unitId }: { societyId: string; unitId: string }) {
  const [record, setRecord] = useState<{ badge: string; revision: number; occupancyLocked?: boolean; lockedUntil?: string | null } | null>(null);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/resident/occupancy?${new URLSearchParams({ societyId, unitId })}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "Unable to read occupancy.");
        if (!controller.signal.aborted) { setRecord(body); setChoice(awayOccupancySchema.safeParse(body.badge).success ? body.badge : ""); }
      }).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Unable to read occupancy."); });
    return () => controller.abort();
  }, [societyId, unitId, attempt]);
  async function save() {
    if (!record || record.occupancyLocked || lock.current || !awayOccupancySchema.safeParse(choice).success) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/resident/occupancy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ societyId, unitId, expectedRevision: record.revision, occupancy: choice }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Saving was not confirmed.");
      setRecord(body); setMessage("Occupancy saved. The chairman's register will show it after refresh.");
    } catch (caught) {
      setRecord(null);
      setError(caught instanceof Error ? caught.message : "Saving was not confirmed. Reload before retrying.");
    } finally { lock.current = false; setBusy(false); }
  }
  return <section className="my-5 rounded-xl border border-slate-200 bg-white p-5 text-slate-900">
    <h3 className="font-semibold">Report this flat’s occupancy</h3>
    <p className="mt-2 text-sm text-slate-600">This updates occupancy only. It does not approve a tenant or change your primary residence.</p>
    {error && <p role="alert" className="mt-3 text-red-800">{error}</p>}
    {message && <p role="status" className="mt-3 text-emerald-800">{message}</p>}
    {record && <p className="mt-3 text-sm">Current: {occupancyDisplay(record.badge, "unknown").label}</p>}
    {record?.occupancyLocked && <p role="status"
      className="mt-3 rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900">
      Occupancy is locked while the tenant’s agreement is active.
      {record.lockedUntil
        ? ` Locked through ${record.lockedUntil}, inclusive, in India time.`
        : " No agreement end date is recorded. The tenancy must be explicitly ended before occupancy can change."}
    </p>}
    {record?.badge !== "OO" && <label className="mt-3 block text-sm font-medium">Occupancy
      <select value={choice} onChange={(event) => setChoice(event.target.value)} disabled={busy || !record || record.occupancyLocked === true}
        className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-3">
        <option value="">Choose the current occupancy</option>
        {awayOccupancySchema.options.map((code) => <option key={code} value={code}>{code} — {occupancyDisplay(code, "unknown").label}</option>)}
      </select>
    </label>}
    {record?.badge === "OO" && <p className="mt-3 text-sm">A resident owner is recorded here. Their residence record must be updated before reporting a different occupancy.</p>}
    <div className="mt-4 flex gap-3">
      <button type="button" disabled={busy || !record || record.occupancyLocked === true || !choice || record.badge === "OO"} onClick={() => void save()}
        className="rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save occupancy"}</button>
      <button type="button" disabled={busy} onClick={() => { setRecord(null); setError(""); setAttempt((value) => value + 1); }}
        className="rounded-lg border border-slate-300 px-4 py-2">Reload occupancy</button>
    </div>
  </section>;
}
