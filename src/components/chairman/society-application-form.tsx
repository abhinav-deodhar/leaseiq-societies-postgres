"use client";

import { useRef, useState, type FormEvent } from "react";
import { INDIAN_STATES_AND_UTS, societyDetailsSchema, calculatedSocietyApplicationSchema, type SocietyApplicationData } from "@/lib/validation/society";
import { STANDARD_UNIT_KEYS, type ResidentialLayoutData, type ResidentialLayoutInput } from "@/lib/validation/residential-layout";
import ResidentialLayoutSummary from "@/components/society/residential-layout-summary";
import ResidentialCalculator, { unitLabels } from "./residential-calculator";
import { detailFields } from "./society-form-fields";

type Props = { initialValues?: SocietyApplicationData; applicationId?: string; revision?: number };
function initialLayout(data?: SocietyApplicationData): ResidentialLayoutInput | undefined {
  if (!data) return undefined;
  if (data.residentialLayout) return data.residentialLayout;
  return { mode: "manual", wingCount: data.wingCount, units: {
    studioUnits: data.studioUnits, oneBhkUnits: data.oneBhkUnits,
    twoBhkUnits: data.twoBhkUnits, threeBhkUnits: data.threeBhkUnits,
    fourPlusBhkUnits: data.fourPlusBhkUnits,
    customUnits: data.otherResidentialUnits ? [{ name: data.otherResidentialDescription ?? "Other residential", count: data.otherResidentialUnits }] : [],
  } };
}

export default function SocietyApplicationForm({ initialValues, applicationId, revision }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  const [step, setStep] = useState(0);
  const [calculated, setCalculated] = useState<ResidentialLayoutData | null>(null);
  const [busy, setBusy] = useState(false);
  const [mustCheck, setMustCheck] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<SocietyApplicationData | null>(null);
  const steps = ["Society details", "Residential units", "Review and submit"];
  function move(next: number) { setStep(next); setMessage(""); requestAnimationFrame(() => headingRef.current?.focus()); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || mustCheck) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const details = Object.fromEntries(detailFields.map(field => [field.name, String(data.get(field.name) ?? "")]));
    setMessage(""); setErrors({});
    const checkedDetails = societyDetailsSchema.safeParse(details);
    if (!checkedDetails.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of checkedDetails.error.issues) nextErrors[String(issue.path[0])] ??= issue.message;
      setErrors(nextErrors); setStep(0); setMessage("Please correct the highlighted fields.");
      requestAnimationFrame(() => { const input = form.elements.namedItem(Object.keys(nextErrors)[0]); if (input instanceof HTMLElement) input.focus(); });
      return;
    }
    if (step === 0) { move(1); return; }
    if (!calculated) { setStep(1); setMessage("Click Calculate totals after entering or changing your unit details."); return; }
    // Strip client display totals. The server independently calculates its own.
    const { totals, ...residentialLayout } = calculated;
    void totals;
    const payload = { ...details, residentialLayout };
    const checked = calculatedSocietyApplicationSchema.safeParse(payload);
    if (!checked.success) { setStep(1); setMessage(checked.error.issues[0]?.message ?? "Please check your layout."); return; }
    if (step === 1) { setReview(checked.data); move(2); return; }
    submitting.current = true; setBusy(true);
    try {
      const response = await fetch(applicationId ? "/api/chairman/application/resubmit" : "/api/chairman/application", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applicationId ? { applicationId, expectedRevision: revision, society: payload } : payload),
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 401) { window.location.replace("/chairman/login"); return; }
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(typeof body === "object" && body !== null && "message" in body && typeof body.message === "string" ? body.message : "Unable to save your application.");
        if ([403, 404, 409].includes(response.status) || response.status >= 500) setMustCheck(true);
        return;
      }
      window.location.replace("/chairman/society");
    } catch { setMessage("We could not confirm whether the application was saved. Check its status before retrying."); setMustCheck(true); }
    finally { submitting.current = false; setBusy(false); }
  }
  const inputClass = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 focus:outline-2 focus:outline-emerald-700 focus:placeholder:text-transparent";
  const buttonClass = "rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50";
  return <form ref={formRef} onSubmit={submit} noValidate aria-busy={busy} className="mt-6">
    <nav aria-label="Application progress"><p className="text-sm text-slate-600">Step {step + 1} of 3</p>
      <ol className="mt-3 grid grid-cols-3 gap-2">{steps.map((label, i) => <li key={label} aria-current={step === i ? "step" : undefined}
        className={`rounded-xl border p-3 text-xs font-semibold sm:text-sm ${i <= step ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-500"}`}>{i < step ? "✓" : i + 1} {label}</li>)}</ol>
    </nav>
    <h2 ref={headingRef} tabIndex={-1} className="mt-8 text-xl font-semibold">{steps[step]}</h2>
    <p className="mt-2 text-sm text-slate-600">Back preserves your entries. Leaving or refreshing discards unsaved changes.</p>
    {message && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{message}</p>}
    <fieldset hidden={step !== 0} disabled={busy || mustCheck} className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
      <legend className="sr-only">Society details</legend><div className="grid gap-5 sm:grid-cols-2">
        {detailFields.map(field => <label key={field.name} className="text-sm font-semibold">{field.label}{field.optional ? " (optional)" : " *"}
          {field.name === "state" ? <select name={field.name} defaultValue={initialValues?.state ?? ""} aria-invalid={!!errors[field.name]} aria-describedby={`${field.name}-error`} className={inputClass}>
            <option value="">Select state / union territory</option>{INDIAN_STATES_AND_UTS.map(state => <option key={state}>{state}</option>)}
          </select> : <input name={field.name} type="text" defaultValue={String(initialValues?.[field.name] ?? "")} maxLength={field.maxLength}
            inputMode={field.name === "pinCode" ? "numeric" : undefined} required={!field.optional} aria-invalid={!!errors[field.name]} aria-describedby={`${field.name}-error`} className={inputClass} />}
          <span id={`${field.name}-error`} className="mt-1 block font-normal text-red-700">{errors[field.name]}</span>
        </label>)}
      </div>
    </fieldset>
    <fieldset hidden={step !== 1} disabled={busy || mustCheck} className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
      <legend className="sr-only">Residential units</legend>
      <ResidentialCalculator initial={initialLayout(initialValues)} onCalculated={value => { setCalculated(value); setMessage(""); }} />
    </fieldset>
    {step === 2 && review && calculated && <div className="mt-6 space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-6"><div className="flex justify-between"><h3 className="font-semibold">Society details</h3><button type="button" disabled={busy || mustCheck} onClick={() => move(0)} className="text-sm font-semibold text-emerald-800 underline">Edit details</button></div>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">{detailFields.map(field => <div key={field.name}><dt className="text-sm text-slate-500">{field.label}</dt><dd className="break-words">{String(review[field.name] ?? "Not provided")}</dd></div>)}</dl>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-6"><div className="flex justify-between"><h3 className="font-semibold">Calculated residential units</h3><button type="button" disabled={busy || mustCheck} onClick={() => move(1)} className="text-sm font-semibold text-emerald-800 underline">Edit units</button></div>
        <p className="mt-3 text-sm">{calculated.mode === "manual" ? "Manual counts" : "Building layout"} · {review.wingCount === 0 ? "Standalone building" : `${review.wingCount} wings`}</p>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">{STANDARD_UNIT_KEYS.map(key => <div key={key}><dt className="text-sm text-slate-500">{unitLabels[key]}</dt><dd className="font-semibold">{review[key]}</dd></div>)}
          {calculated.totals.customUnits.map(item => <div key={item.name}><dt className="text-sm text-slate-500">{item.name}</dt><dd className="font-semibold">{item.count}</dd></div>)}
        </dl><p className="mt-5 text-xl font-semibold">Total residential units: {review.totalUnits}</p>
      </section>
      <ResidentialLayoutSummary layout={review.residentialLayout} />
      <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">Submission sends these details to the administrator. Approval, payment and service activation are separate steps.</p>
    </div>}
    <div className="mt-6 flex flex-wrap gap-3">{mustCheck ? <button type="button" className={buttonClass} onClick={() => window.location.replace("/chairman/society")}>Check application status</button> : <>
      {step > 0 && <button type="button" disabled={busy} onClick={() => move(step - 1)} className={buttonClass}>Back</button>}
      <button type="submit" disabled={busy} className="rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50">{busy ? "Submitting…" : step === 2 ? applicationId ? "Resubmit for review" : "Submit for admin review" : "Continue"}</button>
      <button type="button" disabled={busy} onClick={() => window.location.replace("/chairman/society")} className={buttonClass}>Cancel without saving</button>
    </>}</div><p role="status" className="mt-3 text-sm">{busy ? "Saving your application…" : ""}</p>
  </form>;
}
