"use client";

import { useEffect, useState } from "react";
import {
  correspondenceAddressSchema,
  type CorrespondenceAddress,
  type PrimaryAddressState,
} from "@/lib/contracts/primary-address";

const blank: CorrespondenceAddress = {
  line1: "", line2: "", city: "", state: "", pinCode: "",
};
const input = "lq-field";
const button = "lq-button lq-primary";

export default function PrimaryAddressEditor({
  societyId, unitId, onChange,
}: {
  societyId?: string;
  unitId?: string;
  onChange?: (value: PrimaryAddressState | null) => void;
}) {
  const query = societyId && unitId
    ? "?" + new URLSearchParams({ societyId, unitId }) : "";
  const url = "/api/resident/primary-address" + query;
  const [data, setData] = useState<PrimaryAddressState | null>(null);
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState("external");
  const [address, setAddress] = useState(blank);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "Unable to load your address.");
        if (!controller.signal.aborted) {
          setData(body);
          setEditing(!body.primary);
          setStale(false);
          setError("");
          onChange?.(body);
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Unable to load your address.");
        }
      });
    return () => controller.abort();
  }, [url, attempt, onChange]);

  function edit() {
    if (!data) return;
    const source = data.primary?.unitId;
    setSelection(source && data.options.some((item) => item.unitId === source)
      ? source : "external");
    setAddress(data.primary?.address ?? blank);
    setEditing(true);
    onChange?.(null);
  }

  async function save() {
    if (!data || busy || stale) return;
    const external = correspondenceAddressSchema.safeParse(address);
    if (selection === "external" && !external.success) {
      setError(external.error.issues[0]?.message ?? "Complete your address.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: data.revision,
          selection: selection === "external"
            ? { kind: "external", address }
            : { kind: "flat", unitId: selection },
        }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Saving was not confirmed.");
      setData(body);
      setEditing(false);
      onChange?.(body);
    } catch (caught) {
      setStale(true);
      onChange?.(null);
      setError(caught instanceof Error ? caught.message : "Saving was not confirmed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="lq-section"
    aria-label="Account correspondence address">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className="font-semibold text-slate-900">Primary correspondence address</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          One address for your account, shared across your flats.
        </p>
      </div>
      {data?.primary && !editing && <button type="button" onClick={edit}
        className="min-h-11 px-2 text-sm font-semibold text-emerald-800">
        Change<span className="sr-only"> correspondence address</span>
      </button>}
    </div>

    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {!data && !error && <p role="status" className="mt-3 text-sm">Loading address…</p>}
    {(!data || stale) && error && <button type="button" disabled={busy}
      className="mt-3 min-h-11 font-semibold text-emerald-800"
      onClick={() => {
        onChange?.(null);
        setData(null);
        setAttempt((value) => value + 1);
      }}>Reload account address</button>}

    {data?.primary && !editing && <address className="mt-4 text-sm not-italic leading-6 text-slate-800">
      {Object.values(data.primary.address).filter(Boolean).join(", ")}
    </address>}

    {data && editing && <fieldset disabled={busy || stale} className="mt-4 space-y-4">
      <label className="block text-sm font-medium">
        Send correspondence to
        <select className={input} value={selection}
          onChange={(event) => setSelection(event.target.value)}>
          <option value="external">Another address</option>
          {data.options.map((item) => <option key={item.unitId} value={item.unitId}>
            {item.label}
          </option>)}
        </select>
      </label>

      {selection === "external"
        ? <div className="grid gap-4 sm:grid-cols-2">
            {([
              ["line1", "Building, house number and street", "address-line1"],
              ["line2", "Area or landmark · optional", "address-line2"],
              ["city", "City", "address-level2"],
              ["state", "State / union territory", "address-level1"],
              ["pinCode", "PIN code", "postal-code"],
            ] as const).map(([key, label, autocomplete]) => <label key={key}
              className={`block text-sm font-medium ${key === "line1" || key === "line2" ? "sm:col-span-2" : ""}`}>
              {label}
              <input className={input} value={address[key]} autoComplete={autocomplete}
                inputMode={key === "pinCode" ? "numeric" : "text"}
                maxLength={key === "pinCode" ? 6 : key === "line1" || key === "line2" ? 1000 : 100}
                onChange={(event) => setAddress((value) => ({ ...value, [key]: event.target.value }))} />
            </label>)}
          </div>
        : <p className="rounded-lg bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
            {Object.values(data.options.find((item) => item.unitId === selection)?.address ?? {})
              .filter(Boolean).join(", ")}
          </p>}

      <p className="text-sm leading-6 text-slate-600">
        {data.primary ? "Confirming replaces your current account correspondence address. " : ""}
        Saved applications keep their original address. This does not change ownership or residency.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={button} onClick={save}>
          {busy ? "Saving…" : "Confirm primary address"}
        </button>
        {data.primary && <button type="button"
          className="min-h-11 px-3 text-sm font-semibold text-slate-700"
          onClick={() => {
            setEditing(false);
            setError("");
            onChange?.(data);
          }}>Cancel</button>}
      </div>
    </fieldset>}
  </section>;
}
