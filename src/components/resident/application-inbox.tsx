"use client";

import DeleteDraft from "./delete-draft";
import Link from "next/link";
import ApplicationAttachments from "./application-attachments";
import { occupancyDisplay } from "@/lib/contracts/occupancy";
import { useEffect, useRef, useState } from "react";
import {
  applicationStatusLabels,
  type ApplicationStatus,
  type InboxApplication,
} from "@/lib/contracts/application-inbox";

const button = "inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50";

function date(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium", timeStyle: "short",
  }).format(new Date(value));
}

function ApplicationCard({
  item, chairman, busy, onAction, initiallyOpen, onDeleted,
}: {
  item: InboxApplication;
  chairman: boolean;
  busy: boolean;
  initiallyOpen: boolean;
  onDeleted:()=>void;
  onAction: (
    item: InboxApplication, decision?: "approved" | "rejected" | "changes_requested", note?: string,
  ) => Promise<void>;
}) {
  const [decision, setDecision] = useState<"" | "approved" | "rejected" | "changes_requested">("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const owners = item.currentOwners ?? [];
  const incoming = !chairman && !item.isOwn && item.relationship === "tenant";
  const tenantReview = item.relationship === "tenant" && (chairman || incoming);
  const canReview = !item.isOwn && item.status === "pending" &&
    (chairman ? item.relationship === "owner" || item.ownerReviewStatus === "approved"
      : incoming && item.ownerReviewStatus === "pending");
  const typeLabel = incoming ? "Tenant verification request"
    : item.relationship === "owner" ? "Owner application" : "Tenant application";
  const typeTone = incoming ? "bg-purple-50 text-purple-900" : item.relationship === "owner"
    ? "bg-teal-50 text-teal-900" : "bg-blue-50 text-blue-900";
  const ownershipConflict = chairman && item.relationship === "owner" &&
    item.status === "pending" && owners.length > 0;
  const associationLabel = item.associationStatus === "active"
    ? "Association active"
    : item.associationStatus === "ended"
      ? "Association ended"
      : item.associationStatus === "scheduled"
        ? "Association starts later"
        : "Association not recorded";
  const profile = item.applicantProfile;
  const name = profile
    ? `${profile.firstName} ${profile.lastName}`.trim() : item.fullName;
  const address = profile?.correspondenceAddress;
  const tone = item.status === "approved"
    ? "bg-emerald-50 text-emerald-800"
    : item.status === "rejected" ? "bg-red-50 text-red-800"
    : item.status === "changes_requested" ? "bg-blue-50 text-blue-900"
    : item.status === "pending" ? "bg-amber-50 text-amber-900"
    : "bg-slate-100 text-slate-700";

  return <details open={initiallyOpen || undefined}
    className="lq-form w-full max-w-none rounded-xl border border-slate-200 bg-white shadow-sm">
    <summary className="cursor-pointer rounded-xl p-5 focus-visible:outline-2 focus-visible:outline-emerald-700">
      <span className="ml-2 inline-flex flex-wrap items-center gap-3">
        <span className="font-semibold">{chairman || incoming ? name : item.societyName}</span>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${typeTone}`}>{typeLabel}</span>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>
          {chairman && item.status === "pending"
            ? "Pending review" : item.relationship === "tenant" && item.status === "pending"
              ? item.ownerReviewStatus === "approved" ? "Awaiting chairman review" : "Awaiting owner verification"
              : applicationStatusLabels[item.status]}
        </span>
      </span>
      <span className="mt-2 block pl-6 text-sm text-slate-600">
        {item.wing ? `Wing ${item.wing} · ` : ""}
        {item.floor ? `Floor ${item.floor} · ` : ""}
        Flat {item.flatNumber} · {item.relationship === "owner" ? "Owner" : "Tenant"}
      </span>
      {item.status === "approved" && <span
        className={`ml-6 mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
          item.associationStatus === "active"
            ? "bg-emerald-50 text-emerald-900"
            : "bg-slate-100 text-slate-700"
        }`}>
        {associationLabel}
      </span>}
      {ownershipConflict && <span
        className="ml-6 mt-2 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
        Existing owner · approval blocked
      </span>}
      {item.submittedAt && <span className="mt-2 block pl-6 text-xs text-slate-500">
        Submitted: {date(item.submittedAt)}
        {item.resubmissionCount > 0 ? ` · Resubmitted ${item.resubmissionCount} time(s)` : ""}
      </span>}
    </summary>

    <div className="space-y-6 border-t border-slate-100 p-5 sm:p-6">
      <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["Applicant", name],
          ["Society", item.societyName],
          ["Email", item.email],
          ["Mobile", item.phone],
          ...(item.ownerReviewedAt ? [["Owner reviewed",date(item.ownerReviewedAt)]] : []),
          ...(item.reviewedAt ? [["Latest decision",date(item.reviewedAt)]] : []),
          ...(item.relationship === "tenant" ? [["Agreement end",item.tenancyEndDate ?? "Not provided"]] : []),
          ["Lives in this flat", profile ? (profile.residesInFlat ? "Yes" : "No") : "Not provided"],
          ["Move-in date", item.moveInDate ?? "Not provided"],
          ...(item.relationship === "owner" && profile && !profile.residesInFlat
            ? [["Reported occupancy", occupancyDisplay(profile.occupancyWhenAway, "unknown").label]] : []),
        ].map(([label, value]) => <div key={label}>
          <dt className="text-slate-500">{label}</dt>
          <dd className="mt-1 break-words font-medium">{value}</dd>
        </div>)}
      </dl>

      {profile && <div className="text-sm">
        <h3 className="font-semibold">Correspondence address</h3>
        <p className="mt-1 text-slate-600">
          {profile.correspondenceSameAsFlat
            ? `${item.societyName}, ${item.wing ? `Wing ${item.wing}, ` : ""}Flat ${item.flatNumber}`
            : [address?.line1, address?.line2, address?.city, address?.state,
               address?.pinCode].filter(Boolean).join(", ")}
        </p>
      </div>}

      {!!profile?.familyMembers.length && <section>
        <h3 className="text-sm font-semibold">Family members</h3>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {profile.familyMembers.map((member, index) => <li key={index}
            className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium">{member.firstName} {member.lastName}</p>
            <p className="text-slate-600">{member.relationshipToOwner}</p>
            {member.phone && <p>{member.phone}</p>}
            {member.email && <p className="break-all">{member.email}</p>}
          </li>)}
        </ul>
      </section>}

      {incoming && <section className="space-y-4 border-t border-slate-200 pt-6">
        <h3 className="font-semibold">Supporting documents</h3>
        <p className="text-sm text-slate-600">Checked files have passed upload checks. Review their contents before deciding.</p>
        {item.reviewDocuments?.length ? <ul className="divide-y divide-slate-200">
          {item.reviewDocuments.map(doc=><li key={doc.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="min-w-0"><p className="break-all font-medium">{doc.name}</p>
              <p className="mt-1 text-sm text-slate-600">{doc.kind === "identity" ? "Identity document" : `Rental agreement · Version ${doc.version}`} · {(doc.size/1048576).toFixed(1)} MB · Checked</p></div>
            <a className="lq-button lq-secondary" href={`/api/application-documents/${doc.id}`}>Download<span className="sr-only"> {doc.name}</span></a>
          </li>)}
        </ul> : <p className="text-sm text-slate-600">Documents are not available for this review stage.</p>}
      </section>}
      {!incoming && (!chairman || ["pending", "approved"].includes(item.status)) &&
        <ApplicationAttachments requestId={item.id} relationship={item.relationship}
          chairman={chairman}
          editable={!chairman && item.isOwn &&
            ["draft", "changes_requested"].includes(item.status)} />}
      {ownershipConflict && !item.isOwn &&
        <Link className={button}
          href={`/chairman/owner-transfers?application=${item.id}`}>
          Review ownership transfer
        </Link>}
      {item.applicantNote && <section className="text-sm">
        <h3 className="font-semibold">Applicant’s note</h3>
        <p className="mt-1 whitespace-pre-wrap text-slate-600">{item.applicantNote}</p>
      </section>}

      {item.ownerReviewNote && <section className="rounded-lg bg-slate-50 p-4 text-sm">
        <h3 className="font-semibold">Owner feedback</h3><p className="mt-2 whitespace-pre-wrap">{item.ownerReviewNote}</p>
      </section>}
      {item.reviewNote && <section className="rounded-lg border border-slate-200 p-4 text-sm">
        <h3 className="font-semibold">
          {item.status === "changes_requested" ? "Corrections requested"
            : item.status === "rejected" ? "Reason for rejection" : "Chairman’s note"}
        </h3>
        <p className="mt-2 whitespace-pre-wrap">{item.reviewNote}</p>
      </section>}

      {!chairman && item.isOwn && item.status === "pending" && <p role="status"
        className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
        {item.relationship === "tenant" && item.ownerReviewStatus !== "approved"
          ? "Your application has been submitted to the registered owner for verification. Chairman review follows owner approval."
          : "Your application has been submitted. Your society’s chairman will review it."}
      </p>}
      {item.status === "approved" && <section
        className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
        <h3 className="font-semibold">Application approved · {associationLabel}</h3>
        <p className="mt-2 text-slate-600">
          {item.associationStatus === "active"
            ? "The association created by this application is currently active."
            : item.associationStatus === "ended"
              ? "This association has ended. The approved application remains as a historical record."
              : item.associationStatus === "scheduled"
                ? "The application is approved, but the tenancy start date has not arrived."
                : "No association is recorded for this approved application. Ask the society to review this record."}
        </p>
      </section>}

      {chairman && item.relationship === "owner" && <section
        className={`rounded-lg border p-4 text-sm ${
          ownershipConflict || owners.length > 1
            ? "border-amber-200 bg-amber-50 text-amber-950"
            : "border-slate-200 bg-white text-slate-700"
        }`}>
        <h3 className="font-semibold">Current registered owners</h3>
        {owners.length ? <ul className="mt-2 space-y-1">
          {owners.map((owner) => <li key={owner.membershipId}>
            {owner.fullName}
          </li>)}
        </ul> : <p className="mt-2">No active registered owner is recorded.</p>}
        {ownershipConflict && <p className="mt-3 leading-6">
          Ordinary approval is blocked because this flat already has an active owner.
          A co-owner or ownership transfer needs a separate review.
          Those workflows are not available yet. You can request clarification or reject an incorrect claim.
        </p>}
        {owners.length > 1 && <p className="mt-3 leading-6">
          Multiple active owner records already exist. Verify whether they represent
          co-ownership or an incorrect approval. No existing record has been changed.
        </p>}
      </section>}
      {!chairman && item.isOwn && ["draft", "changes_requested"].includes(item.status) && <section
        className="space-y-4 rounded-lg bg-slate-50 p-4">
        <p className="text-sm text-slate-600">
          {item.status === "changes_requested"
            ? "Read the feedback, edit your application and save your corrections before resubmitting."
            : "This is a saved draft. It is not visible in the chairman’s review inbox."}
        </p>
        {profile && <>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={confirmed} disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-emerald-800" />
            I have checked these details and want to submit this {item.relationship} application for {item.relationship === "tenant" ? "owner verification" : "chairman review"}.
          </label>
          <button className={button} disabled={busy || !confirmed}
            onClick={() => void onAction(item)}>
            {item.status === "changes_requested" ? "Resubmit for review" : item.relationship === "tenant" ? "Submit for owner verification" : "Submit for chairman review"}
          </button>
        </>}
        {!profile && <p className="text-sm">Complete your personal details before submitting.</p>}
        {item.relationship === "tenant" && <p className="text-sm">
          A saved move-in date, checked identity document, rental agreement and registered owner are required.
          Owner verification comes first; chairman approval grants resident access.
        </p>}
        <Link href={`/resident/applications/${item.id}/edit`} className="ml-0 block text-sm font-semibold text-emerald-800 underline">
          {item.status === "changes_requested" ? "Edit application" : "Edit draft"}
        </Link>
        {item.status === "draft" && <DeleteDraft societyId={item.societyId} requestId={item.id} revision={item.revision} onDeleted={onDeleted} />}
      </section>}

      {(canReview || (chairman && item.isOwn && item.status === "pending")) && (
        item.isOwn ? <p className="rounded-lg bg-amber-50 p-4 text-sm">
          You cannot approve or reject your own application.
        </p> : <form className="space-y-6 border-t border-slate-200 pt-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (decision && !(decision === "approved" && ownershipConflict)) {
              void onAction(item, decision, note);
            }
          }}>
          <p className="text-sm text-slate-600">
            {tenantReview ? chairman
              ? "The owner has verified this application. Approval confirms the tenancy; access follows its dates."
              : "Review the tenant details and latest rental agreement. Verification sends the application to the chairman."
              : "Verify ownership against society records before approving. Approval links this applicant to the flat."}
          </p>
          <label className="block text-sm font-medium">
            Decision
            <select value={decision} required disabled={busy}
              onChange={(event) => setDecision(event.target.value as typeof decision)}
              className="mt-2 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 sm:max-w-sm">
              <option value="">Choose a decision</option>
              <option value="approved" disabled={ownershipConflict}>
                {ownershipConflict ? "Approval blocked — existing owner" : tenantReview ? chairman ? "Approve tenant application" : "Verify and send to chairman" : "Approve owner application"}
              </option>
              <option value="changes_requested">Request changes</option>
              <option value="rejected">Reject application</option>
            </select>
          </label>
          <label className="block text-sm font-medium">
            {decision === "changes_requested" ? "What should the resident correct? — required"
              : decision === "rejected" ? "Reason for rejection — required" : "Note to applicant — optional"}
            <textarea value={note} maxLength={1000} disabled={busy}
              required={decision === "rejected" || decision === "changes_requested"}
              onChange={(event) => setNote(event.target.value)}
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-3"
              rows={3} />
          </label>
          <button className={button}
            disabled={busy || !decision ||
              (decision === "approved" && ownershipConflict) ||
              (decision !== "approved" && !note.trim())}>
            {busy ? "Saving…" : "Confirm decision"}
          </button>
        </form>
      )}
      {!!item.history?.length && <section className="border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold">Application history</h3>
        <ol className="mt-3 space-y-3">
          {item.history.map((entry, index) => <li key={`${entry.revision}:${entry.action}:${index}`}
            className="border-l-2 border-emerald-100 pl-3 text-sm">
            <p className="font-medium capitalize">{entry.action.replace(/_/g, " ")}</p>
            <p className="mt-1 text-xs text-slate-500">
              {date(entry.at)} · Revision {entry.revision}
            </p>
            {entry.note && <p className="mt-1 whitespace-pre-wrap text-slate-700">{entry.note}</p>}
          </li>)}
        </ol>
      </section>}
      <p className="break-all text-xs text-slate-500">Application reference: {item.id}</p>
    </div>
  </details>;
}

export default function ApplicationInbox({
  societyId, initialApplication = "",
}: {
  societyId?: string;
  initialApplication?: string;
}) {
  const chairman = !!societyId;
  const endpoint = chairman
    ? `/api/chairman/societies/${societyId}/resident-applications`
    : "/api/resident/applications";
  const [application, setApplication] = useState(initialApplication);
  const [status, setStatus] = useState(chairman && !initialApplication ? "pending" : "all");
  const [page, setPage] = useState(1);
  const [scope,setScope]=useState("all");
  const [stage,setStage]=useState("all");
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<{ items: InboxApplication[]; hasMore: boolean; counts: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ status, scope, stage, page: String(page) });
    if (application) query.set("application", application);
    fetch(`${endpoint}?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "Unable to load applications.");
        if (!controller.signal.aborted) {
          setData(body);
          setLoading(false);
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(caught instanceof Error ? caught.message : "Unable to load applications.");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [endpoint, application, status, scope, stage, page, reload]);

  function refresh() {
    setLoading(true);
    setError("");
    setReload((value) => value + 1);
  }

  async function action(
    item: InboxApplication, decision?: "approved" | "rejected" | "changes_requested", note?: string,
  ) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const tenantReview = !!decision && item.relationship === "tenant" && !item.isOwn;
      const actionEndpoint = tenantReview ? chairman
        ? `/api/chairman/societies/${item.societyId}/tenant-applications`
        : "/api/resident/tenant-reviews" : endpoint;
      const response = await fetch(actionEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tenantReview ? {
          societyId:item.societyId,requestId:item.id,
          review:{expectedRevision:item.revision,decision,reviewNote:note?.trim() || null},
        } : chairman ? {
          requestId: item.id,
          review: {
            expectedRevision: item.revision, decision, reviewNote: note?.trim() || null,
          },
        } : {
          societyId: item.societyId, requestId: item.id, expectedRevision: item.revision,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The action could not be confirmed.");
      setNotice(tenantReview
        ? decision === "approved" ? chairman ? "Tenant application approved." : "Verified. Awaiting chairman review."
          : decision === "changes_requested" ? "Corrections requested." : "Application rejected."
        : chairman
        ? (decision === "changes_requested"
            ? "Changes requested. The resident can now correct and resubmit this application."
            : `Application ${decision === "approved" ? "approved" : "rejected"}. The resident can see the decision.`)
        : item.relationship === "tenant"
          ? "Application submitted to the owner. Track owner verification and chairman review here."
          : "Application submitted. You can track the chairman’s decision here.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The action could not be confirmed.");
    } finally {
      submitting.current = false;
      setBusy(false);
      setLoading(true);
      setReload((value) => value + 1);
      feedback.current?.focus();
      feedback.current?.scrollIntoView({ block: "start" });
    }
  }

  const statuses: ("all" | ApplicationStatus)[] = chairman
    ? ["pending", "changes_requested", "approved", "rejected", "all"]
    : ["all", "draft", "pending", "changes_requested", "approved", "rejected", "withdrawn"];

  return <section className="mt-7 space-y-5">
    {!chairman && <div aria-label="Application scope" className="flex flex-wrap gap-3">
      {[["all","All applications"],["mine","My applications"],["review","Needs my review"]].map(([value,label]) =>
        <button key={value} type="button" disabled={busy} aria-pressed={scope===value}
          className={`lq-button ${scope===value?"lq-primary":"lq-secondary"}`}
          onClick={()=>{setScope(value);setStatus("all");setStage("all");setPage(1);setApplication("");setLoading(true);setError("");}}>{label}</button>)}
    </div>}
    {!chairman && <label className="block max-w-sm text-sm font-medium">Review stage
      <select className="lq-field" value={stage} disabled={busy} onChange={event=>{
        setStage(event.target.value);setStatus("all");setApplication("");setPage(1);setLoading(true);setError("");
      }}><option value="all">All stages</option><option value="owner">Awaiting owner verification</option>
        <option value="chairman">Awaiting chairman review</option></select>
    </label>}
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div aria-label="Filter applications by status"
        className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
        {statuses.map((value) => <button key={value} type="button"
          aria-pressed={status === value} disabled={busy}
          onClick={() => {
            setStatus(value); setPage(1); setApplication("");
            setLoading(true); setError(""); setNotice("");
          }}
          className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
            status === value ? "bg-emerald-800 text-white"
              : "text-slate-600 hover:bg-slate-50"
          }`}>
          {value === "all" ? "All" : value === "pending" ? "Pending review" : applicationStatusLabels[value]}
          <span className={`rounded-full px-2 py-0.5 text-xs ${
            status === value ? "bg-white/20" : "bg-slate-100"
          }`}>{data?.counts?.[value] ?? "—"}</span>
        </button>)}
      </div>
      <button className={secondary} disabled={busy || loading} onClick={refresh}>Refresh status</button>
    </div>

    {application && <button className="text-sm font-semibold text-emerald-800 underline"
      disabled={busy} onClick={() => {
        setApplication(""); setPage(1); setLoading(true); setError("");
      }}>← Show all my applications</button>}

    <div ref={feedback} tabIndex={-1} className="scroll-mt-5 outline-none">
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-4 text-emerald-900">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
    </div>

    {loading ? <p role="status" className="py-8 text-slate-600">Loading applications…</p>
      : data && <>
        {!data.items.length && <div className="rounded-xl border border-slate-200 bg-white p-8">
          <h2 className="text-lg font-semibold">No applications here yet</h2>
          <p className="mt-2 text-sm text-slate-600">
            {chairman ? "Applications ready for your society’s review will appear here."
              : "Save your application, then submit it for review. Try All applications to find an existing record."}
          </p>
        </div>}
        {data.items.map((item) => <ApplicationCard onDeleted={()=>{setData(null);setReload(value=>value+1);}}
          key={`${item.id}:${item.revision}`}
          item={item} chairman={chairman} busy={busy}
          initiallyOpen={application === item.id}
          onAction={action} />)}
        <div className="flex items-center justify-between gap-3">
          <button className={secondary} disabled={busy || page === 1}
            onClick={() => { setPage(page - 1); setLoading(true); setError(""); }}>
            Previous
          </button>
          <span className="text-sm text-slate-500">Page {page}</span>
          <button className={secondary} disabled={busy || !data.hasMore}
            onClick={() => { setPage(page + 1); setLoading(true); setError(""); }}>
            Next
          </button>
        </div>
      </>}
  </section>;
}
