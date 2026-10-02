"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ResidentDashboardData } from "@/lib/contracts/resident-dashboard";
import { occupancyDisplay } from "@/lib/contracts/occupancy";
import OwnerOccupancyEditor from "./owner-occupancy-editor";
import ApplicationAttachments from "./application-attachments";

const modules = [
  ["overview", "Overview"],
  ["people", "People & tenancy"],
  ["bills", "Bills & payments"],
  ["documents", "Documents"],
  ["requests", "Requests"],
  ["activity", "Activity"],
] as const;

const button = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-emerald-900";
const panel = "rounded-2xl border border-slate-200 bg-white p-5 sm:p-6";

function dateLabel(value: string | null) {
  if (!value) return "Not provided";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "Not provided" :
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    }).format(date);
}

export default function FlatWorkspace({ unitId }: { unitId: string }) {
  const router = useRouter();
  const query = useSearchParams();
  const requested = query.get("tab");
  const tab = modules.find(([id]) => id === requested)?.[0] ?? "overview";
  const [data, setData] = useState<ResidentDashboardData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/resident/dashboard", {
      cache: "no-store", signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error("Unable to load this flat. Please refresh.");
      const result = await response.json() as ResidentDashboardData;
      if (!controller.signal.aborted) {
        setData(result);
        setError("");
      }
    }).catch(caught => {
      if (!controller.signal.aborted) {
        setData(null);
        setError(caught instanceof Error ? caught.message : "Unable to load this flat.");
      }
    });
    return () => controller.abort();
  }, [unitId, attempt]);

  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const flat = data?.homes.find(home => home.unitId === unitId);
  const refresh = () => {
    setData(null);
    setAttempt(value => value + 1);
    router.refresh();
  };

  if (error) return <section className={panel}>
    <p role="alert">{error}</p>
    <button type="button" className={`${button} mt-4`} onClick={refresh}>Retry</button>
  </section>;

  if (!data) return <p role="status">Loading flat details…</p>;

  if (!flat) return <section className={panel}>
    <h1 className="text-xl font-semibold">This flat is no longer available to your account.</h1>
    <Link className={`${button} mt-4`} href="/resident?view=homes">Back to My homes</Link>
  </section>;

  const owner = flat.relationship === "owner";
  const occupancy = occupancyDisplay(flat.occupancyBadge, "unknown");
  const tenants = flat.approvedTenants ?? [];
  const reviews = flat.pendingTenantReviews ?? [];
  const applicationUrl = `/resident/applications?application=${flat.sourceRequestId}`;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <Link className={button} href="/resident?view=homes">← My homes</Link>
      <button type="button" className={button} onClick={refresh}>Refresh flat</button>
    </div>

    <header className={panel}>
      <p className="text-sm text-slate-600">{flat.societyName} · {flat.city}</p>
      <h1 className="mt-2 text-3xl font-semibold">
        {flat.wing ? `Wing ${flat.wing} · ` : ""}Flat {flat.flatNumber}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold capitalize">
          {flat.relationship}
        </span>
        <span className={`rounded-lg border px-3 py-2 text-sm font-semibold ${occupancy.tone}`}>
          {occupancy.code} · {occupancy.label}
        </span>
      </div>
    </header>

    <nav aria-label="Flat modules"
      className="flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">
      {modules.map(([id, label]) => (
        <Link key={id} href={`/resident/flats/${unitId}?tab=${id}`}
          scroll={false} aria-current={tab === id ? "page" : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-4 py-3 text-sm font-semibold ${
            tab === id ? "bg-emerald-800 text-white" : "text-slate-700 hover:bg-slate-100"
          }`}>
          {label}
        </Link>
      ))}
    </nav>

    <section aria-label={modules.find(([id]) => id === tab)?.[1]}>
      {tab === "overview" && <div className="space-y-6">
        <section className={panel}>
          <h2 className="text-xl font-semibold">Flat overview</h2>
          <dl className="mt-5 grid grid-cols-2 gap-6 sm:grid-cols-3">
            {[
              ["Society", flat.societyName],
              ["Wing", flat.wing || "No wing"],
              ["Floor", flat.floor || "Not provided"],
              ["Flat", flat.flatNumber],
              ["Your role", owner ? "Owner" : "Tenant"],
              ["Occupancy", occupancy.label],
            ].map(([label, value]) => <div key={label}>
              <dt className="text-sm text-slate-500">{label}</dt>
              <dd className="mt-2 break-words font-semibold">{value}</dd>
            </div>)}
          </dl>
          {!owner && <p className="mt-6 rounded-xl bg-emerald-50 p-4 leading-7">
            {flat.accessState === "upcoming" ? "Upcoming tenancy" : "Active tenancy"}
            {" · "}{dateLabel(flat.moveInDate)} — {dateLabel(flat.tenancyEndDate)}
          </p>}
          {owner && <div className="mt-6 flex flex-wrap gap-3">
            <Link className={button} href={`/resident/flats/${unitId}?tab=people`}>
              People & tenancy · {tenants.length} approved
            </Link>
            {reviews.length > 0 && <Link className={button}
              href={`/resident/flats/${unitId}?tab=people`}>
              {reviews.length} awaiting your review
            </Link>}
          </div>}
        </section>
        {owner && <OwnerOccupancyEditor key={`${unitId}:${attempt}`}
          societyId={flat.societyId} unitId={unitId} />}
      </div>}

      {tab === "people" && <section className={panel}>
        <h2 className="text-xl font-semibold">People & tenancy</h2>
        {!owner ? <div className="mt-5 space-y-4">
          <p>Your approved tenancy: {dateLabel(flat.moveInDate)} — {dateLabel(flat.tenancyEndDate)}.</p>
          <Link className={button} href={applicationUrl}>View your application and household details</Link>
        </div> : <>
          {occupancy.code === "OO" && <p className="mt-4">An approved owner is recorded as living here.</p>}
          {!tenants.length && <p className="mt-4 text-slate-600">
            {occupancy.code === "CR"
              ? "Reported rented. No current or upcoming approved tenant is linked."
              : "No current or upcoming approved tenancy is linked."}
          </p>}
          <div className="mt-5 grid gap-4">
            {tenants.map(tenant => <article key={tenant.requestId}
              className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm text-slate-600">
                {tenant.state === "upcoming" ? "Approved upcoming tenant" : "Current approved tenant"}
              </p>
              <h3 className="mt-2 font-semibold">{tenant.name}</h3>
              <p className="mt-3">Lease: {dateLabel(tenant.startDate)} — {dateLabel(tenant.endDate)}</p>
              <Link className={`${button} mt-4`}
                href={`/resident/applications?application=${tenant.requestId}`}>
                View tenant application
              </Link>
            </article>)}
            {reviews.map((review, index) => <article key={review.requestId}
              className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="font-semibold">Tenant application awaiting your verification</h3>
              <Link className={`${button} mt-4`}
                href={`/resident/applications?application=${review.requestId}`}>
                Review application {reviews.length > 1 ? index + 1 : ""}
              </Link>
            </article>)}
          </div>
          <Link className={`${button} mt-5`} href={applicationUrl}>
            View your ownership application and household details
          </Link>
        </>}
      </section>}

      {tab === "documents" && <section className={panel}>
        <h2 className="text-xl font-semibold">Documents for this flat</h2>
        <ApplicationAttachments key={flat.sourceRequestId}
          requestId={flat.sourceRequestId} relationship={flat.relationship} editable={false} />
        {owner && tenants.length > 0 && <div className="mt-6 border-t border-slate-200 pt-5">
          <h3 className="font-semibold">Tenant documents</h3>
          <p className="mt-2 text-sm text-slate-600">
            Open the relevant tenant application to view documents you are authorised to access.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {tenants.map(tenant => <Link key={tenant.requestId} className={button}
              href={`/resident/applications?application=${tenant.requestId}`}>
              {tenant.name} · Documents
            </Link>)}
          </div>
        </div>}
      </section>}

      {tab === "bills" && <section className={panel}>
        <h2 className="text-xl font-semibold">Bills & payments</h2>
        <p className="mt-4 leading-7 text-slate-600">
          Flat-specific society invoices, balances and receipts are not available in this workspace yet.
          This does not mean there are no dues.
        </p>
      </section>}

      {tab === "requests" && <section className={panel}>
        <h2 className="text-xl font-semibold">Requests</h2>
        <p className="mt-4 leading-7 text-slate-600">
          Repair and society-service requests for this flat are not available here yet.
          Tenant verification is available under People & tenancy.
        </p>
      </section>}

      {tab === "activity" && <section className={panel}>
        <h2 className="text-xl font-semibold">Activity</h2>
        <p className="mt-4 leading-7 text-slate-600">
          A combined flat activity timeline is not available yet.
          Existing application decisions remain available in Applications.
        </p>
        <Link className={`${button} mt-4`} href={applicationUrl}>View your application history</Link>
      </section>}
    </section>
  </div>;
}
