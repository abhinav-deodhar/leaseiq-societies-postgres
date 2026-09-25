"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABELS,
  type ApplicationListQuery,
  type ApplicationListResponse,
} from "@/lib/contracts/application-list";

const filters = [
  { value: "all", label: "All" },
  ...APPLICATION_STATUSES.map((value) => ({
    value,
    label: APPLICATION_STATUS_LABELS[value],
  })),
] as const;

const statusStyles = {
  pending_review: "bg-amber-50 text-amber-800",
  changes_requested: "bg-blue-50 text-blue-800",
  approved: "bg-emerald-50 text-emerald-800",
  rejected: "bg-red-50 text-red-800",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export default function ApplicationsList() {
  const [status, setStatus] =
    useState<ApplicationListQuery["status"]>("all");
  const [page, setPage] = useState(1);
  const [refreshCount, setRefreshCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<ApplicationListResponse>({
    applications: [],
    hasMore: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const timeout = window.setTimeout(() => controller.abort(), 15000);

    async function load() {
      try {
        const query = new URLSearchParams({
          status,
          page: String(page),
        });

        const response = await fetch(`/api/admin/applications?${query}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });

        if (response.status === 401) {
          window.location.replace("/admin/login");
          return;
        }

        if (!response.ok) {
          throw new Error("Application list failed");
        }

        const result: ApplicationListResponse = await response.json();

        if (active) setData(result);
      } catch {
        if (active) {
          setError("Unable to load applications. Please try again.");
        }
      } finally {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [status, page, refreshCount]);

  function refresh() {
    setError("");
    setLoading(true);
    setRefreshCount((value) => value + 1);
  }

  function selectFilter(value: ApplicationListQuery["status"]) {
    if (value === status) return;

    setError("");
    setLoading(true);
    setPage(1);
    setStatus(value);
  }

  function changePage(value: number) {
    setError("");
    setLoading(true);
    setPage(value);
  }

  return (
    <section aria-labelledby="applications-title" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-emerald-700">
            Society onboarding
          </p>
          <h1
            id="applications-title"
            className="mt-2 text-3xl font-semibold tracking-tight"
          >
            Society applications
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Track submitted applications through review and approval.
          </p>
        </div>

        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div
        role="group"
        aria-label="Filter applications by status"
        className="mt-7 flex flex-wrap gap-2"
      >
        {filters.map((filter) => (
          <button
            key={filter.value}
            type="button"
            aria-pressed={status === filter.value}
            onClick={() => selectFilter(filter.value)}
            className={`rounded-full border px-4 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 ${
              status === filter.value
                ? "border-emerald-800 bg-emerald-800 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p role="status" className="mt-8 rounded-2xl bg-white p-8">
          Loading applications…
        </p>
      ) : error ? (
        <div
          role="alert"
          className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={refresh}
            className="mt-3 font-semibold underline"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {data.applications.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-10 text-center">
              <h2 className="text-lg font-semibold">
                No applications in this view
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Choose All to see applications across every review status.
              </p>
            </div>
          ) : (
            <div className="mt-8 grid gap-4">
              {data.applications.map((application) => (
                <article
                  key={application.id}
                  className="rounded-2xl border border-slate-200 bg-white p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold">
                        {application.societyName}
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        {application.city}, {application.state}
                        {" · "}{application.totalUnits} residential units
                      </p>
                    </div>

                    <span
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${statusStyles[application.status]}`}
                    >
                      {APPLICATION_STATUS_LABELS[application.status]}
                    </span>
                  </div>

                  <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-slate-500">Chairman</dt>
                      <dd className="mt-1 font-medium">
                        {application.chairmanName}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Contact</dt>
                      <dd className="mt-1">{application.chairmanPhone}</dd>
                      <dd className="mt-1 break-all text-slate-600">
                        {application.chairmanEmail}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Submitted</dt>
                      <dd className="mt-1">
                        {formatDate(application.submittedAt)}
                      </dd>
                    </div>
                  </dl>

                  <Link
                    href={`/admin/applications/${application.id}`}
                    className="mt-5 inline-flex min-h-11 items-center font-semibold text-emerald-800 underline underline-offset-4"
                  >
                    View application
                    <span className="sr-only">
                      {" "}for {application.societyName}
                    </span>
                  </Link>
                </article>
              ))}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-4">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => changePage(page - 1)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm disabled:opacity-40"
            >
              Previous
            </button>

            <p className="text-sm text-slate-600">Page {page}</p>

            <button
              type="button"
              disabled={!data.hasMore || page >= 10000}
              onClick={() => changePage(page + 1)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}