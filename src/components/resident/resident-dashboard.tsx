"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LogoutButton from "@/components/auth/logout-button";
import ApplicationInbox from "@/components/resident/application-inbox";
import PrimaryAddressEditor from "@/components/resident/primary-address";
import PersonalDetailsCard from "@/components/resident/personal-details";
import {
  homeLabel,
  type ResidentDashboardData,
  type ResidentHome,
} from "@/lib/contracts/resident-dashboard";
import styles from "./resident-dashboard.module.css";
import { occupancyDisplay } from "@/lib/contracts/occupancy";

const destinations = [
  ["home", "Home", "M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9"],
  ["homes", "My homes", "M4 21V3h11v18M15 9h5v12M8 7h3M8 11h3M8 15h3M8 19h3"],
  ["applications", "Applications", "M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"],
  ["account", "Account", "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2"],
] as const;

const labels: Record<string, string> = {
  draft: "Draft", pending: "Awaiting review", changes_requested: "Changes requested",
  approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn",
};

function leaseDate(value: string | null) {
  if (!value) return "Not provided";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "Not provided";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(date);
}

function OwnerFlatStatus({ home }: { home: ResidentHome }) {
  if (home.relationship !== "owner") return null;
  const occupancy = occupancyDisplay(home.occupancyBadge, "unknown");
  const tenants = home.approvedTenants ?? [];
  const reviews = home.pendingTenantReviews ?? [];
  const explanations: Record<string, string> = {
    OO: "An approved owner is recorded as living here.",
    VARR: "Reported vacant and ready to rent.",
    VNRR: "Reported vacant and not ready to rent.",
    UM: "Reported under maintenance.",
    FO: "Reported occupied by family.",
    V: "Reported vacant; rental readiness has not been provided.",
    UNK: "Occupancy has not been reported.",
  };

  return <section aria-label="Flat occupancy"
    className="my-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-900">
    <span className={`inline-flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 font-semibold ${occupancy.tone}`}>
      <span>{occupancy.code}</span>
      <span aria-hidden="true">·</span>
      <span>{occupancy.label}</span>
    </span>

    {explanations[occupancy.code] && (
      <p className="mt-3 leading-6">{explanations[occupancy.code]}</p>
    )}

    {occupancy.code === "CR" && !tenants.some(tenant => tenant.state === "active") && (
      <p className="mt-3 leading-6">
        Reported rented · No current approved tenant linked.
      </p>
    )}

    {tenants.length > 0 && <ul className="mt-4 grid list-none gap-4 p-0">
      {tenants.map(tenant => <li key={tenant.requestId}
        className="rounded-lg border border-slate-200 p-3">
        <p className="text-xs font-semibold text-slate-600">
          {tenant.state === "upcoming" ? "Approved upcoming tenant" : "Current approved tenant"}
        </p>
        <p className="mt-2 break-words font-semibold">{tenant.name}</p>
        <dl className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <dt className="text-xs text-slate-600">Lease start</dt>
            <dd className="mt-1 font-medium">{leaseDate(tenant.startDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Lease end</dt>
            <dd className="mt-1 font-medium">{leaseDate(tenant.endDate)}</dd>
          </div>
        </dl>
        <Link href={`/resident/applications?application=${tenant.requestId}`}
          className="mt-3 inline-flex min-h-11 items-center font-semibold text-emerald-800 underline underline-offset-4">
          View tenant application
        </Link>
      </li>)}
    </ul>}

    {reviews.length > 0 && <div className="mt-4 border-t border-slate-200 pt-4">
      <p className="font-semibold">
        {reviews.length} tenant application{reviews.length === 1 ? "" : "s"} awaiting your review
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-600">
        Pending applications do not change occupancy.
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        {reviews.map((review, index) => (
          <Link key={review.requestId}
            href={`/resident/applications?application=${review.requestId}`}
            className="inline-flex min-h-11 items-center font-semibold text-emerald-800 underline underline-offset-4">
            Review application{reviews.length > 1 ? ` ${index + 1}` : ""}
          </Link>
        ))}
      </div>
    </div>}
  </section>;
}

function HomeCard({ home, selected, onSelect }: {
  home: ResidentHome; selected: boolean; onSelect: () => void;
}) {
  return <article className={styles.card}>
    <span className={styles.badge}>
      {home.relationship === "owner" ? "Owner" : "Tenant"}{selected ? " · Selected" : ""}
    </span>
    {home.accessState === "upcoming" && <p className={styles.notice}>
      Approved · Upcoming tenancy · Starts {home.moveInDate}
    </p>}
    <h2 style={{ marginTop: 16 }}>{home.societyName}</h2>
    <p className={styles.muted}>{home.city}</p>
    <dl className={styles.facts}>
      <div><dt>Wing</dt><dd>{home.wing || "—"}</dd></div>
      <div><dt>Floor</dt><dd>{home.floor || "—"}</dd></div>
      <div><dt>Flat</dt><dd>{home.flatNumber}</dd></div>
    </dl>
    <OwnerFlatStatus home={home} />
    <div className={styles.actions}>
      <button type="button" className={styles.primary} onClick={onSelect}>
        {home.accessState === "upcoming" ? "View upcoming home" : "Open home"}
      </button>
      <Link className={styles.secondary}
        href={`/resident/applications?application=${home.sourceRequestId}`}>
        Application
      </Link>
    </div>
  </article>;
}

export default function ResidentDashboard({
  fullName, initialView, initialUnit,
}: {
  fullName: string; initialView: string; initialUnit: string;
}) {
  const router = useRouter();
  const view = destinations.some(([id]) => id === initialView) ? initialView : "home";
  const [data, setData] = useState<ResidentDashboardData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/resident/dashboard", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "Unable to load your dashboard.");
        if (!controller.signal.aborted) { setData(body); setError(""); }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(caught instanceof Error ? caught.message : "Unable to load your dashboard.");
        }
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, []);

  const selected = initialUnit
    ? data?.homes.find((home) => home.unitId === initialUnit)
    : data?.homes[0];

  function href(destination: string, unit = selected?.unitId) {
    const params = new URLSearchParams({ view: destination });
    if (unit) params.set("unit", unit);
    return `/resident?${params}`;
  }

  return <div className={styles.shell}>
    <a href="#resident-main" className={styles.skip}>Skip to content</a>
    <aside className={styles.sidebar}>
      <Link href="/resident" className={styles.logo}>LeaseIQ</Link>
      <p className={styles.subtitle}>Your home. Your community.</p>
      <nav className={styles.nav} aria-label="Resident navigation">
        {destinations.map(([id, label, path]) => <Link key={id} href={href(id)}
          aria-current={view === id ? "page" : undefined}>
          <svg className={styles.icon} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
          {label}
        </Link>)}
      </nav>
      <div className={styles.profile}>
        <p>{fullName}</p>
        <LogoutButton portal="resident" />
      </div>
    </aside>

    <div className={styles.content}>
      <header className={styles.header}>
        {data?.homes.length ? <label>
          Your selected home
          <select className={styles.select} value={selected?.unitId ?? ""}
            onChange={(event) => router.push(href(view, event.target.value))}>
            {!selected && <option value="" disabled>Choose a home</option>}
            {data.homes.map((home) => <option key={home.unitId} value={home.unitId}>
              {home.societyName} · {homeLabel(home)} · {home.relationship === "owner" ? "Owner" : "Tenant"}
            </option>)}
          </select>
        </label> : <p className={styles.muted}>Resident workspace</p>}
        <Link className={styles.secondary} href="/resident/onboarding">
          {data?.homes.length ? "+ Add another flat" : "Connect your flat"}
        </Link>
      </header>

      <main id="resident-main" className={styles.body}>
        <div className={styles.actions} style={{ marginBottom: 20 }}>
          <Link className={styles.secondary} href="/resident/owner-transfers">
            Ownership transfer requests
          </Link>
        </div>
        <div className={styles.heading}>
          <div>
            <h1>{view === "home" ? `Hello, ${data?.preferredName || fullName.split(" ")[0]}` :
              destinations.find(([id]) => id === view)?.[1]}</h1>
            <p className={styles.muted} style={{ marginTop: 8 }}>
              {view === "home" ? "Your homes and the things that need your attention." :
               view === "homes" ? "One account. Every home, clearly organised." :
               view === "applications" ? "Saved drafts, review decisions and next steps." :
               "Your personal account settings, shared across your homes."}
            </p>
          </div>
          <button type="button" className={styles.secondary}
            onClick={() => setAttempt((value) => value + 1)}>Refresh</button>
        </div>

        {error && <div role="alert" className={styles.error}>
          <p>{error}</p>
          <button className={styles.secondary} type="button"
            onClick={() => setAttempt((value) => value + 1)}>Retry</button>
        </div>}
        {!data && !error && <div role="status">
          <p className={styles.muted}>Loading your homes and applications…</p>
          <div className={styles.loading} />
        </div>}

        {data && <>
          {initialUnit && !selected && <p role="status" className={styles.notice}>
            This home is no longer available to this account. Choose another home above.
          </p>}

          {view === "home" && <>
            <div className={styles.stats}>
              {[
                [data.homes.length, "Connected homes"],
                [data.counts.pending, "Awaiting review"],
                [data.counts.changes_requested + data.counts.draft, "To complete"],
              ].map(([count, label]) => <div key={label} className={styles.stat}>
                <strong>{count}</strong><span className={styles.muted}>{label}</span>
              </div>)}
            </div>
            <div className={styles.grid}>
              <div>
                {selected ? <section className={`${styles.card} ${styles.hero}`}>
                  <div className={styles.leaseHeader}>
                    <div className={styles.leaseStatus}>
                      <span className={styles.badge}>
                        Approved {selected.relationship}
                      </span>
                      {selected.accessState === "upcoming" && (
                        <span className={styles.leaseUpcoming}>
                          Upcoming tenancy · access begins on the start date
                        </span>
                      )}
                    </div>
                    {selected.relationship === "tenant" && (
                      <dl className={styles.leaseDates} aria-label="Lease dates">
                        <div>
                          <dt>Lease start</dt>
                          <dd>{selected.moveInDate
                            ? <time dateTime={selected.moveInDate}>{selected.moveInDate}</time>
                            : "Not provided"}</dd>
                        </div>
                        <div>
                          <dt>Lease end</dt>
                          <dd>{selected.tenancyEndDate
                            ? <time dateTime={selected.tenancyEndDate}>{selected.tenancyEndDate}</time>
                            : "Not provided"}</dd>
                        </div>
                      </dl>
                    )}
                  </div>
                  <h2>{selected.societyName}</h2>
                  <p className={styles.muted}>{selected.city}</p>
                  <dl className={styles.facts}>
                    <div><dt>Wing</dt><dd>{selected.wing || "—"}</dd></div>
                    <div><dt>Floor</dt><dd>{selected.floor || "—"}</dd></div>
                    <div><dt>Flat</dt><dd>{selected.flatNumber}</dd></div>
                  </dl>
                  <OwnerFlatStatus home={selected} />
                  <Link className={styles.secondary} href={`/resident/flats/${selected.unitId}`}>
                    View home details →
                  </Link>
                </section> : <section className={styles.card}>
                  <h2>{data.counts.pending ? "Your application is being reviewed" : "Make your first connection"}</h2>
                  <p className={styles.muted}>
                    {data.counts.pending
                      ? "You can follow its progress below. An approved home will appear here when access is available."
                      : "Choose your society and flat to start. If you already saved an application, continue it from Applications."}
                  </p>
                  <div className={styles.actions}>
                    <Link className={styles.primary} href={data.counts.pending
                      ? href("applications") : "/resident/onboarding"}>
                      {data.counts.pending ? "Track applications" : "Connect your flat"}
                    </Link>
                  </div>
                </section>}

                <section className={styles.card} style={{ marginTop: 24 }}>
                  <h2>Your account, across every home</h2>
                  <p className={styles.muted}>
                    Your contact details and primary correspondence address belong to your account.
                    Ownership and tenancy are specific to each flat.
                  </p>
                  <Link className={styles.secondary} style={{ marginTop: 16 }} href={href("account")}>
                    Manage account
                  </Link>
                </section>
              </div>

              <section className={styles.card}>
                <h2>Application updates</h2>
                {!data.applications.length
                  ? <p className={styles.muted}>You have not started an application yet.</p>
                  : <div className={styles.rows}>
                    {data.applications.map((item) => <Link key={item.id}
                      href={`/resident/applications?application=${item.id}`} className={styles.row}>
                      <div className={styles.rowTop}>
                        <strong>{item.societyName}</strong>
                        <span className={styles.badge}>{labels[item.status] ?? item.status}</span>
                      </div>
                      <p className={styles.muted}>
                        {item.wing ? item.wing + " / " : ""}{item.flatNumber} · {item.relationship}
                      </p>
                      {item.status === "changes_requested" &&
                        <p className={styles.muted}>Review the feedback and update your application →</p>}
                    </Link>)}
                  </div>}
                <Link className={styles.secondary} style={{ marginTop: 14 }} href={href("applications")}>
                  All applications →
                </Link>
              </section>
            </div>
          </>}

          {view === "homes" && <div className={styles.homes}>
            {data.homes.map((home) => <HomeCard key={home.unitId} home={home}
              selected={home.unitId === selected?.unitId}
              onSelect={() => router.push(href("home", home.unitId))} />)}
            {!data.homes.length && <section className={styles.card}>
              <h2>No approved homes yet</h2>
              <p className={styles.muted}>Track an existing application or connect your first flat.</p>
              <div className={styles.actions}>
                <Link className={styles.primary} href={href("applications")}>My applications</Link>
                <Link className={styles.secondary} href="/resident/onboarding">Connect a flat</Link>
              </div>
            </section>}
          </div>}

          {view === "applications" && <ApplicationInbox key={attempt} />}

          {view === "account" && <div className={styles.grid}>
            <PersonalDetailsCard onSaved={() => setAttempt(value => value + 1)} />
            <PrimaryAddressEditor />
          </div>}
        </>}
      </main>
    </div>
  </div>;
}
