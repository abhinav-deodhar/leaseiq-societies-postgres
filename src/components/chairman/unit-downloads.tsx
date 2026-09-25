"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function UnitDownloads({
  societyId,
}: {
  societyId: string;
}) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState<"template" | "export" | null>(null);
  const [error, setError] = useState("");

  async function download(kind: "template" | "export") {
    if (pending.current) return;
    pending.current = true;
    setBusy(kind);
    setError("");

    try {
      const response = await fetch(
        `/api/chairman/societies/${societyId}/units/download?kind=${kind}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(60000),
        },
      );

      if (response.status === 401) {
        router.replace("/chairman/login");
        return;
      }

      if (!response.ok) {
        let message = "Unable to download the workbook.";
        try {
          const body = await response.json();
          if (typeof body.message === "string") message = body.message;
        } catch {
          // Keep the fallback if the server did not return JSON.
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `leaseiq-units-${kind}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      setError(
        error instanceof Error && error.name !== "TimeoutError"
          ? error.message
          : "The download timed out. Please try again.",
      );
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  return (
    <div className="mb-5">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void download("template")}
          className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === "template" ? "Preparing template…" : "Download template"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void download("export")}
          className="rounded-xl border border-emerald-800 bg-white px-4 py-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
        >
          {busy === "export" ? "Preparing export…" : "Export register"}
        </button>
      </div>
      <p role="status" className="sr-only">
        {busy ? "Preparing your Excel download." : ""}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
