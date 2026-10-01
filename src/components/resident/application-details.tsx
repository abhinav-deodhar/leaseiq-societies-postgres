"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PrimaryAddressEditor from "@/components/resident/primary-address";
import type { PrimaryAddressState } from "@/lib/contracts/primary-address";
import Link from "next/link";
import DeleteDraft from "./delete-draft";
import OnboardingForm from "./onboarding-form";
import PersonalDetailsCard from "./personal-details";
import ApplicationAttachments from "./application-attachments";
import OwnerOccupancyEditor from "./owner-occupancy-editor";
import { awayOccupancySchema, occupancyDisplay } from "@/lib/contracts/occupancy";
import { useRouter } from "next/navigation";
import {
  residentApplicationProfileSchema,
  type ResidentProfile,
  type ResidentFamilyMember,
} from "@/lib/contracts/resident-profile";
import { residentRequestSchema } from "@/lib/contracts/resident-associations";

const familyRelationships = [
  "Spouse", "Partner", "Son", "Daughter", "Child",
  "Father", "Mother", "Parent", "Brother", "Sister", "Sibling",
  "Grandfather", "Grandmother", "Grandchild",
  "Father-in-law", "Mother-in-law", "Son-in-law", "Daughter-in-law",
  "Other relative",
];

type Account = {
  fullName: string;
  email: string;
  phone: string;
  emailVerified: boolean;
  phoneVerified: boolean;
};
type Draft = {
  id: string;
  revision: number;
  status: string;
  relationship: "owner" | "tenant";
  moveInDate: string | null;
  tenancyEndDate: string | null;
  applicantNote: string | null;
  applicantProfile: ResidentProfile | null;
};
type Loaded = {
  account: Account;
  draft: Draft | null;
  membership: {
    relationship: "owner" | "tenant";
    sourceRequestId: string;
  } | null;
};

const field = "lq-field";
const primary = "lq-button lq-primary";
const secondary = "lq-button lq-secondary";

async function getJson(url: string, signal: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "Unable to load your application.");
  return body;
}

function TextField({
  label, value, onChange, maxLength = 100, type = "text", required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  type?: string;
  required?: boolean;
}) {
  return <label className="block">
    <span className="font-medium">{label}</span>
    <input className={field} value={value} type={type}
      required={required} maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)} />
  </label>;
}

function emptyProfile(account: Account): ResidentProfile {
  const names = account.fullName.trim().split(/\s+/);
  return {
    firstName: names[0] ?? "",
    lastName: names.slice(1).join(" "),
    residesInFlat: true,
    correspondenceSameAsFlat: true,
    correspondenceAddress: { line1: "", line2: "", city: "", state: "", pinCode: "" },
    familyMembers: [],
  };
}

export default function ApplicationDetails({
  societyId, unitId, onBusy, onChooseFlat, requestId,
}: {
  societyId: string;
  unitId: string;
  onBusy: (busy: boolean) => void;
  onChooseFlat?: () => void;
  requestId?: string;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ kind: "draft", societyId, unitId });
    if (requestId) params.set("requestId",requestId);
    Promise.all([
      getJson("/api/resident/onboarding?kind=account", controller.signal),
      getJson(`/api/resident/onboarding?${params}`, controller.signal),
    ]).then(([account, draft]) => {
      if (!controller.signal.aborted) {
        if (!Object.prototype.hasOwnProperty.call(draft, "membership")) {
          throw new Error("Unable to check your flat membership. Refresh and try again.");
        }
        setLoaded({
          account: account.account,
          draft: draft.request,
          membership: draft.membership,
        });
      }
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "Unable to load your application.");
      }
    });
    return () => controller.abort();
  }, [societyId, unitId, attempt, requestId]);

  function reload() {
    setLoaded(null);
    setError("");
    setAttempt((value) => value + 1);
  }

  if (!loaded) return <div className="space-y-3" role="status">
    <p>{error || "Checking your flat membership…"}</p>
    {error && <button type="button" className={secondary} onClick={reload}>Retry</button>}
  </div>;

  if (loaded.membership) {
    const role = loaded.membership.relationship;
    return <section className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5 sm:p-6">
      <div role="status">
        <h3 className="text-lg font-semibold text-emerald-950">
          You are already registered as {role === "owner" ? "an owner" : "a tenant"} of this flat
        </h3>
        <p className="mt-2 text-sm leading-6 text-emerald-900">
          {role === "owner"
            ? "You cannot also apply as a tenant of the same flat."
            : "You already have an active tenant association. An ownership change needs a separate review."}
          {" "}You can still connect another flat.
        </p>
      </div>
      {role === "owner" && <OwnerOccupancyEditor societyId={societyId} unitId={unitId} />}
      <div className="mt-5 flex flex-wrap gap-3">
        <Link href={`/resident/flats/${unitId}`}
          className="inline-flex min-h-11 items-center rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900">
          View my flat
        </Link>
        {onChooseFlat
          ? <button type="button" onClick={onChooseFlat}
              className="min-h-11 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-900">
              Choose another flat
            </button>
          : <Link href="/resident/onboarding"
              className="inline-flex min-h-11 items-center rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-900">
              Choose another flat
            </Link>}
      </div>
    </section>;
  }

  if (loaded.draft && !["draft", "changes_requested"].includes(loaded.draft.status)) {
    return <p role="status">Your application is already {loaded.draft.status}.
      It cannot be edited here.</p>;
  }

  return <DetailsEditor key={attempt} loaded={loaded}
    societyId={societyId} unitId={unitId} onBusy={onBusy} reload={reload} />;
}

function DetailsEditor({
  loaded, societyId, unitId, onBusy, reload,
}: {
  loaded: Loaded;
  societyId: string;
  unitId: string;
  onBusy: (busy: boolean) => void;
  reload: () => void;
}) {
  const [draft, setDraft] = useState(loaded.draft);
  const [home,setHome]=useState({societyId,unitId,label:"Current selected flat"});
  const [choosingHome,setChoosingHome]=useState(false);
  const [editingAccount,setEditingAccount]=useState(false);
  const [profile, setProfile] = useState<ResidentProfile>(() => {
    const saved = loaded.draft?.applicantProfile ?? emptyProfile(loaded.account);
    return {
      ...saved,
      correspondenceSameAsFlat: false,
      correspondenceAccountRevision: undefined,
    };
  });
  const [relationship, setRelationship] = useState<"owner" | "tenant">(
    loaded.draft?.relationship ?? "owner",
  );
  const [moveInDate, setMoveInDate] = useState(loaded.draft?.moveInDate ?? "");
  const [endDate, setEndDate] = useState(loaded.draft?.tenancyEndDate ?? "");
  const [note, setNote] = useState(loaded.draft?.applicantNote ?? "");
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const saving = useRef(false);
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (saved) {
      confirmationHeading.current?.focus({ preventScroll: true });
      confirmationHeading.current?.scrollIntoView({ block: "start" });
    }
  }, [saved]);
  const household = relationship === "owner" && profile.residesInFlat;
  const steps = household ? ["Your details", "Family members", "Review details"] : ["Your details", "Review details"];
  const review = step === steps.length - 1;

  function updateProfile(patch: Partial<ResidentProfile>) {
    setProfile((current) => ({ ...current, ...patch }));
    setMessage("");
  }

  function changeRelationship(value: "owner" | "tenant") {
    if (value === relationship) return;
    if (profile.familyMembers.length &&
        !window.confirm("Changing to tenant removes the owner’s family entries from this draft. Continue?")) return;
    setRelationship(value);
    updateProfile({
      familyMembers: [],
      ...(value === "tenant"
        ? { residesInFlat: true, occupancyWhenAway: undefined } : {}),
    });
    if (value === "owner") setEndDate("");
    setError("");
  }

  function changeResidence(value: boolean) {
    if (!value && profile.familyMembers.length &&
        !window.confirm("Selecting No removes the family entries from this draft. Continue?")) return;
    updateProfile({
      residesInFlat: value,
      ...(value ? {} : { familyMembers: [] }),
    });
  }

  function details() {
    return {
      unitId:home.unitId, relationship,
      moveInDate: profile.residesInFlat ? moveInDate : "",
      tenancyEndDate: relationship === "tenant" ? endDate : "",
      applicantNote: note,
    };
  }

  function validate(includeFamily: boolean) {
    if (relationship === "owner" && !profile.residesInFlat && !profile.occupancyWhenAway) {
      setError("Choose the flat's occupancy when you do not live there.");
      return false;
    }
    if (profile.correspondenceAccountRevision === undefined) {
      setError("Confirm your account correspondence address before continuing.");
      return false;
    }
    const parsed = residentApplicationProfileSchema.safeParse({
      relationship,
      profile: {
        ...profile,
        familyMembers: includeFamily && household ? profile.familyMembers : [],
      },
    });
    const request = residentRequestSchema.safeParse(details());
    if (!parsed.success || !request.success) {
      setError(!parsed.success
        ? parsed.error.issues[0].message
        : !request.success ? request.error.issues[0].message : "Check your details.");
      return false;
    }
    setError("");
    return true;
  }

  function memberChange(index: number, patch: Partial<ResidentFamilyMember>) {
    updateProfile({
      familyMembers: profile.familyMembers.map((member, position) =>
        position === index ? { ...member, ...patch } : member),
    });
  }

  async function save() {
    if (saving.current || needsReload || !validate(true)) return;
    const replacing=!!draft && (home.societyId!==societyId || home.unitId!==unitId || relationship!==draft.relationship);
    if(replacing && !window.confirm("Changing flat or role replaces this draft. Its documents will be removed and must be uploaded again. Continue?")) return;
    const parsed = residentApplicationProfileSchema.parse({ relationship, profile });
    saving.current = true;
    setBusy(true);
    onBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/resident/onboarding", {
        method: draft ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          societyId,
          ...(replacing ? {replaceDraft:true,targetSocietyId:home.societyId} : {}),
          details: details(),
          profile: parsed.profile,
          ...(draft ? { requestId: draft.id, expectedRevision: draft.revision } : {}),
        }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status !== 400) setNeedsReload(true);
        throw new Error(body.message ?? "Saving was not confirmed.");
      }
      if (!body.request?.id || !Number.isInteger(body.request.revision)) {
        throw new Error("Saving was not confirmed. Reload the saved version.");
      }
      if(replacing) { router.replace(`/resident/applications/${body.request.id}/edit`); router.refresh(); return; }
      setDraft(body.request);
      setProfile(parsed.profile);
      setMessage("");
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Saving was not confirmed.");
      // Reload after an uncertain outcome instead of issuing another update
      // with a potentially stale revision.
      if (!(caught instanceof Error) ||
          caught.name === "TimeoutError" || caught.name === "TypeError" ||
          caught.message.includes("not confirmed")) setNeedsReload(true);
    } finally {
      saving.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  const account = loaded.account;
  const addressChanged = useCallback((value: PrimaryAddressState | null) => {
    setProfile((current) => ({
      ...current,
      correspondenceSameAsFlat: false,
      correspondenceAccountRevision: value?.primary ? value.revision : undefined,
      ...(value?.primary ? { correspondenceAddress: value.primary.address } : {}),
    }));
  }, []);

  if (saved && draft) {
    return <section data-details className="lq-form space-y-6 pt-6">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <span aria-hidden="true"
          className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-800 text-xl text-white">
          ✓
        </span>
        <h2 ref={confirmationHeading} tabIndex={-1}
          className="scroll-mt-6 text-2xl font-semibold text-emerald-950">
          Your application details are saved
        </h2>
        <p className="mt-2 leading-6 text-emerald-900">
          Your personal details and household information have been saved.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">
          Application status: {draft.status === "changes_requested" ? "Changes requested" : "Draft"}
        </h3>
        <p className="text-sm leading-6 text-slate-600">
          {draft.status === "changes_requested"
            ? "Your corrections are saved. Open the application below and resubmit it for review."
            : "Your draft is saved. Open the application below to submit it for review."}
        </p>
        <p className="break-all text-xs text-slate-500">
          Draft reference: {draft.id}
        </p>
      </div>

      <ApplicationAttachments requestId={draft.id} relationship={relationship} editable />
      {draft.status === "draft" && <DeleteDraft societyId={societyId} requestId={draft.id} revision={draft.revision} />}
      <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-5">
        <Link href="/resident"
          className="inline-flex min-h-11 items-center rounded-lg bg-emerald-800 px-5 py-3 text-sm font-semibold text-white">
          Back to dashboard
        </Link>
        <Link href={`/resident/applications?application=${draft.id}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-emerald-800 px-5 py-3 text-sm font-semibold text-emerald-800">
          Review saved application and submit
        </Link>
        <button type="button" className={secondary}
          onClick={() => {
            setSaved(false);
            setStep(0);
            setError("");
            setMessage("");
          }}>
          Edit draft
        </button>
      </div>
    </section>;
  }

  return <section data-details className="lq-form space-y-6 pt-6">
    <div>
      <ol className="mb-5 grid grid-flow-col auto-cols-fr gap-2" aria-label="Application progress">
        {steps.map((title, index) => <li key={title}
          aria-current={index === step ? "step" : undefined}
          className={`rounded-lg border px-3 py-2 text-sm ${
            index === step ? "border-emerald-600 bg-emerald-50 text-emerald-950"
            : "border-slate-200 text-slate-500"}`}>
          <span className="mr-2 font-semibold">{index < step ? "✓" : index + 1}</span>
          {title}
        </li>)}
      </ol>
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Step {step + 1} of {steps.length}</p>
      <h2 className="mt-2 text-2xl font-semibold">{steps[step]}</h2>
      <p className="mt-2 text-sm text-slate-600">Complete your details, then review and save. Saving a draft does not submit it.</p>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900">{message}</p>}

    {draft?.status === "draft" && <section className="lq-home-summary">
      <p className="font-semibold">{home.label}</p>
      <p className="mt-2 text-sm text-slate-600">Changing society, flat or role requires uploading documents again after saving.</p>
      <button type="button" disabled={busy} className={secondary} onClick={()=>setChoosingHome(!choosingHome)}>{choosingHome?"Cancel home selection":"Change home"}</button>
      {choosingHome && <OnboardingForm onSelect={value=>{setHome(value);setChoosingHome(false);}} />}
    </section>}
    <fieldset disabled={busy || needsReload} className="space-y-5">
      {step === 0 && <>
        <label className="block">
          <span className="font-medium">Your relationship to the flat</span>
          <select className={field} value={relationship}
            disabled={draft?.status === "changes_requested"}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "owner" || value === "tenant") changeRelationship(value);
            }}>
            <option value="owner">Owner</option>
            <option value="tenant">Tenant</option>
          </select>
        </label>
        <div className="rounded-lg bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Account name</p>
          <p className="mt-1 font-medium">{account.fullName}</p>
          <p className="mt-1 text-sm text-slate-600">The same account identity is used for every flat. Email and phone are verified account contacts.</p>
          <button type="button" className={secondary} onClick={()=>setEditingAccount(!editingAccount)}>Edit account details</button>
          {editingAccount && <PersonalDetailsCard onSaved={reload} />}
        </div>
        <div className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
          <label>Email address
            <input className={field} readOnly value={account.email} />
            <span className="mt-2 block text-sm">{account.emailVerified ? "Verified" : "Not verified"}</span>
          </label>
          <label>Mobile number
            <input className={field} readOnly value={account.phone} />
            <span className="mt-2 block text-sm">{account.phoneVerified ? "Verified" : "Not verified"}</span>
          </label>
        </div>
        {relationship === "owner" ? <fieldset>
          <legend className="font-medium">Do you live in this flat?</legend>
          <div className="mt-3 flex gap-6">
            {[true, false].map((value) => <label key={String(value)}>
              <input type="radio" name="resides" checked={profile.residesInFlat === value}
                onChange={() => changeResidence(value)} className="mr-2" />
              {value ? "Yes" : "No"}
            </label>)}
          </div>
        </fieldset> : <p>You are applying to live here as a tenant.</p>}
        {relationship === "owner" && !profile.residesInFlat && <label className="block font-medium">
          How is this flat currently used?
          <select className={field} required value={profile.occupancyWhenAway ?? ""}
            onChange={(event) => {
              const value = awayOccupancySchema.safeParse(event.target.value);
              updateProfile({ occupancyWhenAway: value.success ? value.data : undefined });
            }}>
            <option value="">Choose occupancy</option>
            {awayOccupancySchema.options.map((code) => <option key={code} value={code}>{code} — {occupancyDisplay(code, "unknown").label}</option>)}
          </select>
          <span className="mt-2 block text-sm font-normal text-slate-500">Currently rented does not require the tenant to have an account yet. Tenant verification remains separate.</span>
        </label>}
        {profile.residesInFlat && <TextField label="Move-in date · optional" type="date"
          value={moveInDate} onChange={setMoveInDate} />}
        {relationship === "tenant" && <TextField label="Agreement end date · optional" type="date"
          value={endDate} onChange={setEndDate} />}
        <label className="block">Additional details · optional
          <textarea className={field} rows={3} maxLength={1000}
            value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </>}

      <div hidden={step !== 0}>
        <PrimaryAddressEditor societyId={societyId} unitId={unitId}
          onChange={addressChanged} />
      </div>

      {household && step === 1 && <>
        <p>Add family members who live with you. Email and phone are optional for members without their own contact details. Adding someone does not create their login account.</p>
        {profile.familyMembers.map((member, index) => <fieldset key={index}
          className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
          <legend className="px-2 font-semibold">Family member {index + 1}</legend>
          <TextField label="First name" required maxLength={80} value={member.firstName}
            onChange={(firstName) => memberChange(index, { firstName })} />
          <TextField label="Last name · if applicable" maxLength={80} value={member.lastName}
            onChange={(lastName) => memberChange(index, { lastName })} />
          <label className="block">
            <span className="font-medium">Relationship to the owner</span>
            <select className={field} required value={member.relationshipToOwner}
              onChange={(event) => memberChange(index, {
                relationshipToOwner: event.target.value,
              })}>
              <option value="" disabled>Select relationship</option>
              {member.relationshipToOwner &&
                !familyRelationships.includes(member.relationshipToOwner) &&
                <option value={member.relationshipToOwner}>
                  {member.relationshipToOwner}
                </option>}
              {familyRelationships.map((value) =>
                <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <TextField label="Mobile number · optional" type="tel" maxLength={13} value={member.phone}
            onChange={(phone) => memberChange(index, { phone })} />
          <TextField label="Email address · optional" type="email" maxLength={254} value={member.email}
            onChange={(email) => memberChange(index, { email })} />
          <button type="button" className="font-semibold text-red-800"
            onClick={() => updateProfile({
              familyMembers: profile.familyMembers.filter((_, position) => position !== index),
            })}>Remove member</button>
        </fieldset>)}
        <button type="button" className={secondary} disabled={profile.familyMembers.length >= 20}
          onClick={() => updateProfile({ familyMembers: [...profile.familyMembers, {
            firstName: "", lastName: "", relationshipToOwner: "", phone: "", email: "",
          }] })}>Add family member</button>
        {!profile.familyMembers.length && <p className="text-sm text-slate-600">You can continue without adding members.</p>}
      </>}

      {review && <div className="space-y-4 rounded-xl bg-slate-50 p-5">
        <h3 className="font-semibold">Check your application details</h3>
        <p>{account.fullName} · <span className="capitalize">{relationship}</span></p>
        <p>Email: {account.email}<br />Mobile: {account.phone}</p>
        <p>{profile.residesInFlat ? "Lives in this flat" : "Owner living elsewhere"}</p>
        <p>Correspondence address: {profile.correspondenceSameAsFlat ? "Selected flat" :
          Object.values(profile.correspondenceAddress).filter(Boolean).join(", ")}</p>
        {profile.residesInFlat && <p>Move-in date: {moveInDate || "Not provided"}</p>}
        {relationship === "tenant" && <p>Agreement end date: {endDate || "Not provided"}</p>}
        {note && <p className="whitespace-pre-wrap">Additional details: {note}</p>}
        {household && <>
          <h4 className="font-semibold">Family members ({profile.familyMembers.length})</h4>
          {profile.familyMembers.map((member, index) => <p key={index}>
            {member.firstName} {member.lastName} · {member.relationshipToOwner}
            <br />{member.phone || "No phone"} · {member.email || "No email"}
          </p>)}
        </>}
      </div>}

      {review && draft && <>
        <p className="text-sm text-slate-600">
          Manage documents for your saved draft below. If you changed the home
          or relationship, save first; you will need to upload documents again.
        </p>
        <ApplicationAttachments
          key={`${draft.id}:${draft.relationship}`}
          requestId={draft.id}
          relationship={draft.relationship}
          editable={!busy && !needsReload &&
            home.societyId === societyId && home.unitId === unitId &&
            relationship === draft.relationship}
        />
      </>}
      {review && !draft && <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-950">
        Save these details to create your draft. You can then upload documents
        and review the application before submitting.
      </p>}
      <div className="lq-form-actions flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-5">
        {step > 0 && <button type="button" className={secondary}
          onClick={() => { setStep(step - 1); setError(""); }}>Back</button>}
        {!review ? <button type="button" className={primary}
          onClick={() => { if (validate(step > 0)) setStep(step + 1); }}>Continue</button>
          : <button type="button" className={primary} onClick={save}>
            {busy ? "Saving…" : draft?.status === "changes_requested" ? "Save corrections" : "Save application draft"}
          </button>}
      </div>
    </fieldset>

    {draft?.status === "draft" && <DeleteDraft societyId={societyId} requestId={draft.id} revision={draft.revision} />}
    {needsReload && <button type="button" className={secondary} disabled={busy}
      onClick={() => {
        if (window.confirm("Reload the saved version? Unsaved edits on this screen will be replaced.")) reload();
      }}>Reload saved version</button>}
  </section>;
}
