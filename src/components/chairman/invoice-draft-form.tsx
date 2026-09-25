"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { invoiceScheduleSchema } from "@/lib/contracts/invoice-schedules";
import { invoiceDraftSchema, rupeeAmountSchema } from "@/lib/contracts/invoices";
import type {
  UnitListResponse,
  UnitTypeSummary,
} from "@/lib/contracts/units";

type Register = UnitListResponse & { unitTypes: UnitTypeSummary[] };

const inputClass =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100";

export default function InvoiceDraftForm({
  societyId,
  initialRegister,
}: {
  societyId: string;
  initialRegister: Register;
}) {
  const router = useRouter();
  const [register, setRegister] = useState(initialRegister);
  const [title, setTitle] = useState("");
  const [billingMonth, setBillingMonth] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [generationDay, setGenerationDay] = useState("1");
  const [paymentWindowDays, setPaymentWindowDays] = useState("10");
  const [finalBillingMonth, setFinalBillingMonth] = useState("");
  const [kind, setKind] = useState<"unit" | "unit_type">("unit_type");
  const [targetId, setTargetId] = useState("");
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [lines, setLines] = useState([{ description: "", amount: "" }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef(false);
  const savedRequest = useRef<string | null>(null);
  const savedIntent = useRef<"draft" | "review">("draft");

  const draft = {
    title,
    billingMonth,
    dueDate,
    target: kind === "unit"
      ? { kind, unitId: targetId }
      : { kind, unitTypeId: targetId },
    lines,
  };
  const parsedAmounts = lines.map((line) =>
    rupeeAmountSchema.safeParse(line.amount),
  );
  const amountsValid = parsedAmounts.every((amount) => amount.success);
  const enteredTotalPaise = parsedAmounts.reduce(
    (sum, amount) => sum + (amount.success ? amount.data : 0),
    0,
  );
  const money = (paise: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
    }).format(paise / 100);

  async function errorMessage(response: Response) {
    if (response.status === 401) {
      router.replace("/chairman/login");
      return "Please sign in again.";
    }
    try {
      const body = await response.json();
      if (typeof body.message === "string") return body.message;
    } catch {
      // Keep the fallback for a non-JSON response.
    }
    return "Unable to complete this request.";
  }

  async function findFlats(page: number, term: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({ page: String(page), search: term });
      const response = await fetch(
        `/api/chairman/societies/${societyId}/units?${query}`,
        { cache: "no-store", signal: AbortSignal.timeout(15000) },
      );
      if (!response.ok) throw new Error(await errorMessage(response));
      setRegister(await response.json() as Register);
      setActiveSearch(term);
      setTargetId("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to search flats.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;

    if (!uncertain) {
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      savedIntent.current =
        submitter instanceof HTMLButtonElement && submitter.value === "review"
          ? "review"
          : "draft";

      const schedule = {
        title,
        frequency: "monthly" as const,
        target: draft.target,
        firstBillingMonth: billingMonth,
        finalBillingMonth: finalBillingMonth || null,
        generationDay: Number(generationDay),
        paymentWindowDays: Number(paymentWindowDays),
        lines,
      };
      const checked = recurring
        ? invoiceScheduleSchema.safeParse(schedule)
        : invoiceDraftSchema.safeParse(draft);
      if (!checked.success) {
        setError(checked.error.issues.map((issue) => issue.message).join(" "));
        return;
      }

      // Send rupee strings; the server performs the paise conversion.
      savedRequest.current = JSON.stringify({
        requestKey: crypto.randomUUID(),
        ...(recurring ? { schedule } : { draft }),
      });
    }

    if (!savedRequest.current) return;
    pending.current = true;
    setBusy(true);
    setError("");

    try {
      const response = await fetch(
        `/api/chairman/societies/${societyId}/invoices/${recurring ? "schedules" : "drafts"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: savedRequest.current,
          signal: AbortSignal.timeout(30000),
        },
      );

      if (!response.ok) {
        const message = await errorMessage(response);
        if (response.status >= 500) {
          setUncertain(true);
          setError(`${message} Use Retry save below; it reuses the same request.`);
        } else {
          setUncertain(false);
          savedRequest.current = null;
          setError(message);
        }
        return;
      }

      const result = await response.json();
      const id = recurring ? result.scheduleId : result.draftId;
      if (typeof id !== "string") {
        throw new Error("Unexpected response.");
      }
      const destination = recurring
        ? `/chairman/invoices/schedules/${id}`
        : `/chairman/invoices/${id}`;

      router.push(
        savedIntent.current === "review"
          ? `${destination}?review=1#${recurring ? "schedule-review" : "issue-review"}`
          : destination,
      );
    } catch {
      setUncertain(true);
      setError(
        "The save result could not be confirmed. Retry below without changing the form; the same request key prevents a duplicate draft.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-7 space-y-6">
      {error && (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          {error}
        </p>
      )}

      <fieldset disabled={busy || uncertain} className="space-y-6 disabled:opacity-70">
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Invoice details</h2>
          <label className="mt-5 block text-sm font-medium">
            Bill heading
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)}
              maxLength={120} placeholder="Enter bill heading" required />
          </label>
          <fieldset className="mt-5">
            <legend className="text-sm font-medium">Billing frequency</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {[
                { value: false, label: "One-time", detail: "Prepare a bill for one billing period." },
                { value: true, label: "Monthly recurring", detail: "Prepare a schedule for monthly bills." },
              ].map((option) => (
                <label
                  key={option.label}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-4 focus-within:ring-2 focus-within:ring-emerald-700 ${
                    recurring === option.value
                      ? "border-emerald-700 bg-emerald-50"
                      : "border-slate-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="billing-frequency"
                    checked={recurring === option.value}
                    onChange={() => setRecurring(option.value)}
                    className="mt-1 accent-emerald-800"
                  />
                  <span>
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className="mt-1 block text-xs text-slate-600">{option.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <label className="text-sm font-medium">
              {recurring ? "Starting month" : "Billing month"}
              <input type="month" className={inputClass} value={billingMonth}
                onChange={(e) => setBillingMonth(e.target.value)} required />
            </label>
            {!recurring ? (
              <label className="text-sm font-medium">
                Due date
                <input type="date" className={inputClass} value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)} required />
              </label>
            ) : (
              <>
                <label className="text-sm font-medium">
                  Generation day
                  <input type="number" min={1} max={28} step={1}
                    className={inputClass} value={generationDay}
                    onChange={(e) => setGenerationDay(e.target.value)} required />
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Day 1–28 of each month · India time
                  </span>
                </label>
                <label className="text-sm font-medium">
                  Days allowed for payment
                  <input type="number" min={1} max={90} step={1}
                    className={inputClass} value={paymentWindowDays}
                    onChange={(e) => setPaymentWindowDays(e.target.value)} required />
                </label>
                <label className="text-sm font-medium">
                  Ending month (optional)
                  <input type="month" min={billingMonth || undefined}
                    className={inputClass} value={finalBillingMonth}
                    onChange={(e) => setFinalBillingMonth(e.target.value)} />
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Leave blank to continue until paused.
                  </span>
                </label>
              </>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Who is this for?</h2>
          <fieldset className="mt-5">
            <legend className="text-sm font-medium">Choose recipients</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {([
                ["unit_type", "By unit type", "The same charges for every matching flat."],
                ["unit", "Individual flat", "Maintenance, a fine, or an additional charge for one flat."],
              ] as const).map(([value, label, description]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition focus-within:ring-2 focus-within:ring-emerald-700 ${
                    kind === value
                      ? "border-emerald-700 bg-emerald-50"
                      : "border-slate-200 bg-white hover:border-emerald-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="invoice-target-kind"
                    value={value}
                    checked={kind === value}
                    onChange={() => {
                      setKind(value);
                      setTargetId("");
                    }}
                    className="mt-1 accent-emerald-800"
                  />
                  <span>
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-600">
                      {description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {kind === "unit" && (
            <div className="mt-5">
              <label htmlFor="invoice-flat-search" className="text-sm font-medium">
                Find a flat
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <input id="invoice-flat-search" className={`${inputClass} min-w-0 flex-1`}
                  value={search} maxLength={80} placeholder="Wing or flat number"
                  onChange={(e) => setSearch(e.target.value)} />
                <button type="button" onClick={() => void findFlats(1, search.trim())}
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold">
                  Search
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                <span className="text-slate-500">{register.total} matching flats</span>
                <button type="button" disabled={register.page <= 1}
                  onClick={() => void findFlats(register.page - 1, activeSearch)}
                  className="font-semibold text-emerald-800 disabled:opacity-40">Previous</button>
                <button type="button" disabled={register.page * register.pageSize >= register.total}
                  onClick={() => void findFlats(register.page + 1, activeSearch)}
                  className="font-semibold text-emerald-800 disabled:opacity-40">Next</button>
              </div>
            </div>
          )}

          <label className="mt-5 block text-sm font-medium">
            {kind === "unit" ? "Flat" : "Unit type"}
            <select className={inputClass} value={targetId}
              onChange={(e) => setTargetId(e.target.value)} required>
              <option value="">Choose…</option>
              {kind === "unit_type"
                ? initialRegister.unitTypes.map((type) => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))
                : register.units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.wing ? `Wing ${unit.wing} · ` : ""}Flat {unit.flatNumber}
                    </option>
                  ))}
            </select>
          </label>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Bill items</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Add the items being billed, each with its own description and amount.
          </p>
          <div className="mt-5 space-y-5">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-3 border-b border-slate-100 pb-5 sm:grid-cols-[1fr_160px_auto]">
                <label className="text-sm font-medium">
                  Item description
                  <input className={inputClass} value={line.description}
                    placeholder="Enter item description" maxLength={200} required
                    onChange={(e) => setLines(lines.map((item, i) =>
                      i === index ? { ...item, description: e.target.value } : item))} />
                </label>
                <label className="text-sm font-medium">
                  Amount (₹)
                  <input className={inputClass} value={line.amount} inputMode="decimal"
                    placeholder="0.00" required
                    onChange={(e) => setLines(lines.map((item, i) =>
                      i === index ? { ...item, amount: e.target.value } : item))} />
                </label>
                <button type="button" disabled={lines.length === 1}
                  aria-label={`Remove charge ${index + 1}`}
                  onClick={() => setLines(lines.filter((_, i) => i !== index))}
                  className="self-end rounded-lg px-3 py-3 text-sm text-red-700 disabled:opacity-40">
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button type="button" disabled={lines.length >= 20}
            onClick={() => setLines([...lines, { description: "", amount: "" }])}
            className="mt-4 rounded-lg px-2 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-40">
            + Add item
          </button>
          <div className="mt-5 flex justify-between gap-4 border-t border-slate-200 pt-5 font-semibold">
            <span>{kind === "unit" ? "Bill total" : "Bill total for each recipient"}</span>
            <span aria-live="polite">{money(enteredTotalPaise)}</span>
          </div>
          {!amountsValid && (
            <p className="mt-2 text-xs text-amber-800">
              The total includes valid amounts only. Complete every charge
              with a positive amount before saving.
            </p>
          )}
        </section>
      </fieldset>

      <p className="text-sm leading-6 text-slate-500">
        Save for later, or continue directly to final review.
        Nothing is issued or activated until you confirm.
      </p>
      <div className="flex flex-wrap gap-3">
        {uncertain ? (
          <button type="submit" disabled={busy}
            className="min-h-11 rounded-xl bg-emerald-800 px-6 py-3 font-semibold text-white hover:bg-emerald-900 disabled:opacity-50">
            {busy ? "Checking save…" : "Retry save safely"}
          </button>
        ) : (
          <>
            <button type="submit" name="intent" value="draft" disabled={busy}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 disabled:opacity-50">
              {recurring ? "Save schedule draft" : "Save draft"}
            </button>
            <button type="submit" name="intent" value="review" disabled={busy}
              className="min-h-11 rounded-xl bg-emerald-800 px-6 py-3 font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">
              {busy ? "Saving…" : recurring ? "Review and activate" : "Review and issue"}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
