"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  personalDetailsSchema, type PersonalDetails,
} from "@/lib/contracts/personal-details";
import { todayInIndia } from "@/lib/validation/auth";

const field = "mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:outline-2 focus:outline-offset-2 focus:outline-emerald-700";
const secondary = "inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-900 disabled:opacity-50";

function formValues(value: PersonalDetails) {
  return {
    fullName: value.fullName,
    preferredName: value.preferredName ?? "",
    dateOfBirth: value.dateOfBirth ?? "",
  };
}

function birthday(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "long", timeZone: "UTC",
      }).format(new Date(value + "T00:00:00Z"))
    : "Not provided";
}

export default function PersonalDetailsCard({ onSaved }: {
  onSaved: () => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<PersonalDetails | null>(null);
  const [draft, setDraft] = useState({
    fullName: "", preferredName: "", dateOfBirth: "",
  });
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reloadNeeded, setReloadNeeded] = useState(false);

  const lock = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/resident/personal-details", {
      cache: "no-store", signal: controller.signal,
    }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "Unable to load your details.");
      setSaved(body);
      setDraft(formValues(body));
      setReloadNeeded(false);
      setEditing(false);
      setLoading(false);
    }).catch(caught => {
      if (!controller.signal.aborted) {
        setError(caught.message);
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => { if (editing) nameInput.current?.focus(); }, [editing]);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);
  useEffect(() => { if (message) heading.current?.focus(); }, [message]);

  const sensitive = !!saved && (
    draft.fullName.trim() !== saved.fullName ||
    (draft.dateOfBirth || null) !== saved.dateOfBirth
  );
  const changed = !!saved && (
    sensitive || (draft.preferredName.trim() || null) !== saved.preferredName
  );

  function reload() {
    if (editing && changed &&
        !window.confirm("Reload saved details? Your unsaved edits will be replaced.")) return;
    setError("");
    setMessage("");
    setPassword("");
    setLoading(true);
    setAttempt(value => value + 1);
  }

  async function save() {
    if (!saved || lock.current || reloadNeeded) return;
    const input = {
      ...draft,
      dateOfBirth: draft.dateOfBirth || null,
      expectedRevision: saved.revision,
      currentPassword: password || undefined,
    };
    const parsed = personalDetailsSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your details.");
      return;
    }
    if (sensitive && !password) {
      setError("Enter your current password to confirm this correction.");
      return;
    }

    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/resident/personal-details", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409 || response.status >= 500) setReloadNeeded(true);
        throw new Error(body.message ?? "Saving was not confirmed.");
      }
      setSaved(body);
      setDraft(formValues(body));
      setEditing(false);
      setMessage("Your personal details are saved.");
      onSaved();
      router.refresh();
    } catch (caught) {
      const uncertain = !(caught instanceof Error) ||
        ["TimeoutError", "TypeError", "SyntaxError"].includes(caught.name);
      if (uncertain) setReloadNeeded(true);
      setError(uncertain
        ? "Saving was not confirmed. Reload saved details before trying again."
        : caught.message);
    } finally {
      setPassword("");
      lock.current = false;
      setBusy(false);
    }
  }

  const initials = (saved?.fullName ?? "").split(/\s+/).filter(Boolean)
    .slice(0, 2).map(part => Array.from(part)[0]).join("").toLocaleUpperCase();

  return <section aria-labelledby="personal-details-heading"
    className="self-start rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 id="personal-details-heading" ref={heading} tabIndex={-1}
          className="text-xl font-semibold text-emerald-950">Personal details</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Your identity across all your homes.
        </p>
      </div>
      {saved && !editing && !loading && <button type="button" className={secondary}
        onClick={() => { setError(""); setMessage(""); setEditing(true); }}>
        Edit<span className="sr-only"> personal details</span>
      </button>}
    </div>

    {error && <p ref={errorBox} tabIndex={-1} role="alert"
      className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {message && <p role="status"
      className="mt-5 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}

    {loading ? <p role="status" className="mt-6 text-sm text-slate-600">
      Loading your details…
    </p> : saved && !editing ? <>
      <div className="my-6 flex items-center gap-4">
        <span aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-lg font-semibold text-emerald-900">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="break-words text-lg font-semibold text-slate-900">{saved.fullName}</p>
          <p className="text-sm text-slate-500">Personal account</p>
        </div>
      </div>
      <dl className="divide-y divide-slate-100 text-sm">
        <div className="flex flex-wrap justify-between gap-2 py-4">
          <dt className="text-slate-500">Date of birth</dt>
          <dd className="font-medium text-slate-900">{birthday(saved.dateOfBirth)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2 py-4">
          <dt className="text-slate-500">Preferred name</dt>
          <dd className="break-words font-medium text-slate-900">
            {saved.preferredName ?? "Not set"}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs leading-5 text-slate-500">
        Preferred name is used for greetings. Submitted application details keep their original record.
      </p>
    </> : saved && editing ? <form className="mt-6 space-y-5"
      onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy || reloadNeeded} className="space-y-5">
        <label className="block text-sm font-medium text-slate-800">
          Full name
          <input ref={nameInput} autoComplete="name" required maxLength={120}
            value={draft.fullName} className={field}
            onChange={event => setDraft({ ...draft, fullName: event.target.value })} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Date of birth
          <input type="date" autoComplete="bday" min="0001-01-01" max={todayInIndia()}
            required={!!saved.dateOfBirth} value={draft.dateOfBirth} className={field}
            onChange={event => setDraft({ ...draft, dateOfBirth: event.target.value })} />
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Preferred name <span className="font-normal text-slate-500">· optional</span>
          <input autoComplete="nickname" maxLength={80} value={draft.preferredName}
            className={field} aria-describedby="preferred-name-hint"
            onChange={event => setDraft({ ...draft, preferredName: event.target.value })} />
          <span id="preferred-name-hint" className="mt-2 block text-xs font-normal text-slate-500">
            How you would like us to greet you. Your full name stays on new applications.
          </span>
        </label>

        {sensitive && <label
          className="block rounded-lg bg-slate-50 p-4 text-sm font-medium text-slate-800">
          Current password
          <input type="password" autoComplete="current-password" maxLength={128}
            required value={password} className={field}
            onChange={event => setPassword(event.target.value)} />
          <span className="mt-2 block text-xs font-normal leading-5 text-slate-600">
            Required to confirm a full-name or birth-date correction.
          </span>
        </label>}

        <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-5">
          <button type="submit" disabled={!changed || busy}
            className="min-h-11 rounded-lg bg-emerald-800 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50">
            {busy ? "Saving…" : "Save changes"}
          </button>
          <button type="button" className={secondary} onClick={() => {
            setDraft(formValues(saved));
            setPassword("");
            setError("");
            setEditing(false);
          }}>Cancel</button>
        </div>
      </fieldset>
    </form> : null}

    {!loading && (reloadNeeded || !saved) &&
      <button type="button" disabled={busy} className={secondary + " mt-4"}
        onClick={reload}>Reload saved details</button>}
  </section>;
}
