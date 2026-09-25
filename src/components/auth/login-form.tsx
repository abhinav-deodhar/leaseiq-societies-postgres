"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Props = {
  portal: "chairman" | "admin" | "resident";
};

export default function LoginForm({ portal }: Props) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isAdmin = portal === "admin";
  const isResident = portal === "resident";
  const title = isAdmin
    ? "Admin sign in"
    : isResident
      ? "Resident sign in"
      : "Chairman sign in";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (busy) return;

    setError("");

    const data = new FormData(event.currentTarget);
    const phone = String(data.get("phone") ?? "").trim();
    const password = String(data.get("password") ?? "");

    if (!/^[0-9]{10}$/.test(phone)) {
      setError("Enter your 10-digit mobile number.");
      return;
    }

    if (!password || password.length > 128) {
      setError("Enter your password, using no more than 128 characters.");
      return;
    }

    setBusy(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          phone,
          password,
          portal,
          client: "web",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.message ?? "Unable to sign in. Please try again.");
        return;
      }

      router.replace(`/${portal}`);
      router.refresh();
    } catch {
      setError("Unable to reach the server. Check your connection and retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f6f4] px-5 py-10 font-sans text-slate-900">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 md:grid-cols-2">
        <section className="flex flex-col justify-between bg-emerald-950 p-8 text-white md:p-12">
          <div>
            <Link
              href={`/${portal}/login`}
              className="text-xl font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              leaseIq<span className="text-emerald-300"> societies</span>
            </Link>

            <p className="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              {isAdmin ? "Platform administration" : "Your society, connected"}
            </p>

            <h1 className="mt-4 text-3xl font-semibold leading-tight md:text-4xl">
              {isAdmin
                ? "A clear view of every society."
                : isResident
                  ? "Your home. Your community. Connected."
                  : "A better place to manage your community."}
            </h1>

            <p className="mt-5 max-w-sm leading-7 text-emerald-100">
              {isAdmin
                ? "Sign in to your authorised platform administrator account."
                : isResident
                  ? "For owners and tenants. Sign in to your resident account."
                  : "Sign in to continue your society’s onboarding and manage your account."}
            </p>
          </div>

          <p className="mt-10 text-sm text-emerald-200">
            Built for communities. Designed around people.
          </p>
        </section>

        <section className="p-8 md:p-12">
          <p className="text-sm font-medium text-emerald-700">Welcome back</p>
          <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Use your verified mobile number and password.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-8 space-y-5"
            aria-busy={busy}
          >
            <div>
              <label htmlFor="phone" className="text-sm font-medium">
                Mobile number
              </label>

              <div className="mt-2 flex overflow-hidden rounded-xl border border-slate-300 focus-within:ring-2 focus-within:ring-emerald-600">
                <span className="flex items-center border-r border-slate-200 bg-slate-50 px-4 text-sm text-slate-600">
                  +91
                </span>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="username"
                  placeholder="10-digit mobile number"
                  pattern="[0-9]{10}"
                  maxLength={10}
                  required
                  disabled={busy}
                  aria-describedby="phone-help"
                  className="min-w-0 flex-1 bg-white px-4 py-3 text-base outline-none disabled:opacity-60"
                />
              </div>

              <p id="phone-help" className="mt-2 text-xs text-slate-500">
                Enter the number without +91.
              </p>
            </div>

            <div>
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>

              <div className="mt-2 flex overflow-hidden rounded-xl border border-slate-300 focus-within:ring-2 focus-within:ring-emerald-600">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  disabled={busy}
                  className="min-w-0 flex-1 bg-white px-4 py-3 text-base outline-none disabled:opacity-60"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="px-4 text-sm font-medium text-emerald-800 focus-visible:outline-2 focus-visible:outline-emerald-600"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white transition hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

                    {portal === "chairman" && (
            <div className="mt-6 rounded-xl bg-emerald-50 p-4">
              <p className="text-sm text-slate-700">
                New to LeaseIQ Societies?
              </p>

              <Link
                href="/chairman/register"
                className="mt-3 inline-flex font-semibold text-emerald-800 underline underline-offset-4"
              >
                Register your society
              </Link>
            </div>
          )}

          <nav
            aria-label="Other sign-in portals"
            className="mt-8 border-t border-slate-100 pt-6"
          >
            <p className="text-sm text-slate-500">Looking for another portal?</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">
              {([
                { value: "resident", label: "Resident" },
                { value: "chairman", label: "Chairman" },
                { value: "admin", label: "Admin" },
              ] as const)
                .filter((item) => item.value !== portal)
                .map((item) => (
                  <Link
                    key={item.value}
                    href={`/${item.value}/login`}
                    className="rounded text-sm font-semibold text-emerald-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
                  >
                    {item.label} sign in
                  </Link>
                ))}
            </div>
          </nav>
        </section>
      </div>
    </main>
  );
}