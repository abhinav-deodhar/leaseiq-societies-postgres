"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton({
  portal,
}: {
  portal: "chairman" | "admin" | "resident";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        window.location.reload();
      }
    }

    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  async function logout() {
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/auth/logout?portal=${portal}`, {
        method: "POST",
        credentials: "same-origin",
      });

      if (!response.ok) {
        setError("Sign out failed. Please try again.");
        return;
      }

      router.replace(`/${portal}/login`);
      router.refresh();
    } catch {
      setError("Unable to reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 disabled:opacity-60"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>

      {error && (
        <p role="alert" className="mt-2 max-w-xs text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}