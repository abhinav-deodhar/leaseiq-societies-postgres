"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  emailAuthRequestSchema,
  type EmailAuthPortal,
  type EmailAuthPurpose,
} from "@/lib/contracts/email-auth";
import { passwordSchema } from "@/lib/validation/auth";

type Step = "email" | "code" | "password" | "done" | "uncertain" | "signed-in";
type Field = "email" | "code" | "newPassword" | "confirmPassword";
type Operation = "request" | "verify" | "reset";

const inputClass = "mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 focus:outline-2 focus:outline-offset-2 focus:outline-emerald-700 disabled:opacity-60";
const primaryClass = "min-h-11 w-full rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryClass = "inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold text-emerald-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50";

class RequestFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter: number = 0,
  ) {
    super(message);
  }
}

async function post(path: string, data: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/email/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new RequestFailure(0, "Unable to confirm the result. Check your connection.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RequestFailure(503, "The server response could not be confirmed.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestFailure(503, "The server response could not be confirmed.");
  }
  const result = body as Record<string, unknown>;
  if (!response.ok) {
    const retry = Number(response.headers.get("Retry-After") ?? 0);
    throw new RequestFailure(
      response.status,
      typeof result.message === "string" ? result.message : "Please try again.",
      Number.isFinite(retry) && retry > 0 ? retry : 0,
    );
  }
  return result;
}

function secondsUntil(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

function duration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function EmailAuthPanel({
  portal, purpose, onBack,
}: {
  portal: EmailAuthPortal;
  purpose: EmailAuthPurpose;
  onBack?: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [fields, setFields] = useState<Partial<Record<Field, string>>>({});
  const [sendAfter, setSendAfter] = useState(0);
  const [verifyAfter, setVerifyAfter] = useState(0);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [uncertainLogin, setUncertainLogin] = useState(false);
  const lock = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (step === "email") emailInput.current?.focus();
    if (step === "code") codeInput.current?.focus();
    if (step === "password") passwordInput.current?.focus();
    if (["done", "uncertain", "signed-in"].includes(step)) {
      resultHeading.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (error) alert.current?.focus();
  }, [error]);

  const resendWait = secondsUntil(sendAfter, now);
  const verifyWait = secondsUntil(verifyAfter, now);
  const codeRemaining = secondsUntil(expiresAt, now);
  const recovery = purpose === "reset_password";

  function validation(errors: Partial<Record<Field, string>>) {
    setFields(errors);
    setError("Please check the highlighted fields.");
  }

  async function perform(operation: Operation, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setFields({});
    try {
      await action();
    } catch (caught) {
      const failure = caught instanceof RequestFailure
        ? caught
        : new RequestFailure(0, "The operation could not be confirmed.");
      if (failure.retryAfter) {
        const deadline = Date.now() + failure.retryAfter * 1000;
        if (operation === "request") setSendAfter(deadline);
        else setVerifyAfter(deadline);
      }

      const uncertain = failure.status === 0 || failure.status >= 500;
      if (uncertain && operation === "reset") {
        setNewPassword("");
        setConfirmPassword("");
        setStep("uncertain");
        setInfo("");
      } else if (uncertain && operation === "verify") {
        setUncertainLogin(!recovery);
        setError(recovery
          ? "Verification was not confirmed. Request a new code before continuing."
          : "Sign-in was not confirmed. Try opening your portal, or request a new code.");
      } else {
        setError(failure.message);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function requestCode() {
    if (Date.now() < sendAfter) return;
    await perform("request", async () => {
      const parsed = emailAuthRequestSchema.safeParse({ email, portal, purpose });
      if (!parsed.success) {
        validation({ email: parsed.error.issues[0]?.message ?? "Enter a valid email." });
        return;
      }
      const body = await post("request", parsed.data);
      if (
        typeof body.challengeId !== "string" ||
        typeof body.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(body.expiresAt)) ||
        typeof body.retryAfterSeconds !== "number" ||
        !Number.isFinite(body.retryAfterSeconds) ||
        body.retryAfterSeconds < 0
      ) throw new RequestFailure(503, "The code request could not be confirmed.");

      setEmail(parsed.data.email);
      setChallengeId(body.challengeId);
      setExpiresAt(Date.parse(body.expiresAt));
      setSendAfter(Date.now() + body.retryAfterSeconds * 1000);
      setCode("");
      setUncertainLogin(false);
      setInfo("If this email belongs to an eligible account, a code will arrive shortly. Check your inbox and spam folder.");
      setStep("code");
      codeInput.current?.focus();
    });
  }

  async function verifyCode() {
    if (Date.now() < verifyAfter) return;
    await perform("verify", async () => {
      if (!/^[0-9]{6}$/.test(code)) {
        validation({ code: "Enter the six-digit code from your email." });
        return;
      }
      const body = await post("verify", { challengeId, portal, purpose, code });
      if (purpose === "login" && body.kind === "login") {
        setCode("");
        setStep("signed-in");
        setInfo("");
        router.replace(`/${portal}`);
        router.refresh();
      } else if (recovery && body.kind === "reset_password") {
        setCode("");
        setInfo("Email verified. Choose a new password for your account.");
        setStep("password");
      } else {
        throw new RequestFailure(503, "Verification could not be confirmed.");
      }
    });
  }

  async function resetPassword() {
    await perform("reset", async () => {
      const errors: Partial<Record<Field, string>> = {};
      const checked = passwordSchema.safeParse(newPassword);
      if (!checked.success) {
        errors.newPassword = checked.error.issues[0]?.message ?? "Check your password.";
      }
      if (newPassword !== confirmPassword) {
        errors.confirmPassword = "Passwords do not match.";
      }
      if (Object.keys(errors).length) {
        validation(errors);
        return;
      }
      await post("reset", { portal, newPassword, confirmPassword });
      setNewPassword("");
      setConfirmPassword("");
      setInfo("");
      setStep("done");
    });
  }

  function restart() {
    setStep("email");
    setChallengeId("");
    setCode("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setInfo("");
    setFields({});
    setUncertainLogin(false);
  }

  function fieldError(field: Field) {
    return fields[field] ? (
      <p id={`${id}-${field}-error`} className="mt-2 text-sm text-red-800">
        {fields[field]}
      </p>
    ) : null;
  }

  const back = onBack ? (
    <button type="button" disabled={busy} onClick={onBack} className={secondaryClass}>
      Back to password sign-in
    </button>
  ) : (
    <Link href={`/${portal}/login`} className={secondaryClass}
      onClick={event => { if (busy) event.preventDefault(); }}
      aria-disabled={busy || undefined}>
      Back to sign-in
    </Link>
  );

  if (step === "done" || step === "uncertain" || step === "signed-in") {
    return <div className="mt-8 space-y-5">
      <h3 ref={resultHeading} tabIndex={-1}
        className="text-xl font-semibold text-emerald-950">
        {step === "done" ? "Password reset complete" :
          step === "signed-in" ? "You are signed in" : "Check your sign-in"}
      </h3>
      <p role="status" className="text-sm leading-6 text-slate-600">
        {step === "done"
          ? "Your new password is saved. Existing web and Android sessions have been signed out."
          : step === "signed-in"
            ? "Opening your portal…"
            : "The connection ended before the reset result was confirmed. Try signing in with your new password. If it does not work, request a new reset code."}
      </p>
      <Link href={step === "signed-in" ? `/${portal}` : `/${portal}/login`}
        className={primaryClass + " inline-flex items-center justify-center"}>
        {step === "signed-in" ? "Open portal" : "Go to sign-in"}
      </Link>
      {step === "uncertain" && <button type="button" onClick={restart}
        className={secondaryClass}>Start password recovery again</button>}
    </div>;
  }

  return <div className="mt-8">
    {error && <div ref={alert} tabIndex={-1} role="alert"
      className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
      {error}
    </div>}
    {info && <p role="status"
      className="mb-5 rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
      {info}
    </p>}

    <form noValidate aria-busy={busy} onSubmit={event => {
      event.preventDefault();
      if (step === "email") void requestCode();
      else if (step === "code") void verifyCode();
      else if (step === "password") void resetPassword();
    }}>
      <fieldset disabled={busy} className="space-y-5">
        <legend className="sr-only">
          {recovery ? "Recover your account" : "Sign in with email"}
        </legend>

        {step === "email" && <>
          <div>
            <label htmlFor={`${id}-email`} className="text-sm font-medium">
              Registered email address
            </label>
            <input id={`${id}-email`} ref={emailInput} type="email"
              autoComplete="email" autoCapitalize="none" spellCheck={false}
              maxLength={254} required value={email}
              aria-invalid={!!fields.email}
              aria-describedby={`${id}-email-help${fields.email ? ` ${id}-email-error` : ""}`}
              className={inputClass}
              onChange={event => setEmail(event.target.value)} />
            <p id={`${id}-email-help`} className="mt-2 text-xs leading-5 text-slate-600">
              Use the verified email address linked to your LeaseIQ account.
            </p>
            {fieldError("email")}
          </div>
          <button type="submit" disabled={busy || resendWait > 0} className={primaryClass}>
            {busy ? "Requesting code…" : resendWait > 0
              ? `Try again in ${duration(resendWait)}`
              : recovery ? "Send password reset code" : "Send sign-in code"}
          </button>
        </>}

        {step === "code" && <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 break-all text-sm font-medium text-slate-800">{email}</p>
            <button type="button" onClick={restart} className={secondaryClass}>
              Change email
            </button>
          </div>
          <div>
            <label htmlFor={`${id}-code`} className="text-sm font-medium">
              Six-digit email code
            </label>
            <input id={`${id}-code`} ref={codeInput}
              type="text" inputMode="numeric" autoComplete="one-time-code"
              pattern="[0-9]{6}" maxLength={6} required value={code}
              aria-invalid={!!fields.code}
              aria-describedby={`${id}-code-help${fields.code ? ` ${id}-code-error` : ""}`}
              className={inputClass + " font-mono text-xl tracking-[0.3em]"}
              onChange={event => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))} />
            <p id={`${id}-code-help`} className="mt-2 text-xs leading-5 text-slate-600">
              Use the newest code. {codeRemaining > 0
                ? `Expires in ${duration(codeRemaining)}.`
                : "This code has expired. Request a new one."}
            </p>
            {fieldError("code")}
          </div>
          <button type="submit"
            disabled={busy || codeRemaining === 0 || verifyWait > 0}
            className={primaryClass}>
            {busy ? "Checking code…" : verifyWait > 0
              ? `Try again in ${duration(verifyWait)}`
              : recovery ? "Verify email" : "Verify and sign in"}
          </button>
          <button type="button" onClick={() => void requestCode()}
            disabled={busy || resendWait > 0} className={secondaryClass}>
            {resendWait > 0 ? `Resend in ${duration(resendWait)}` : "Resend code"}
          </button>
          {uncertainLogin && <Link href={`/${portal}`} className={secondaryClass}>
            Try opening your portal
          </Link>}
        </>}

        {step === "password" && <>
          <div>
            <label htmlFor={`${id}-newPassword`} className="text-sm font-medium">
              New password
            </label>
            <input id={`${id}-newPassword`} ref={passwordInput}
              type={showPasswords ? "text" : "password"} autoComplete="new-password"
              minLength={15} maxLength={128} required value={newPassword}
              aria-invalid={!!fields.newPassword}
              aria-describedby={`${id}-password-help${fields.newPassword ? ` ${id}-newPassword-error` : ""}`}
              className={inputClass}
              onChange={event => setNewPassword(event.target.value)} />
            <p id={`${id}-password-help`} className="mt-2 text-xs leading-5 text-slate-600">
              Use 15–128 characters. A long, unique passphrase works well.
            </p>
            {fieldError("newPassword")}
          </div>
          <div>
            <label htmlFor={`${id}-confirmPassword`} className="text-sm font-medium">
              Confirm new password
            </label>
            <input id={`${id}-confirmPassword`}
              type={showPasswords ? "text" : "password"} autoComplete="new-password"
              maxLength={128} required value={confirmPassword}
              aria-invalid={!!fields.confirmPassword}
              aria-describedby={fields.confirmPassword ? `${id}-confirmPassword-error` : undefined}
              className={inputClass}
              onChange={event => setConfirmPassword(event.target.value)} />
            {fieldError("confirmPassword")}
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-slate-700">
            <input type="checkbox" checked={showPasswords}
              className="h-4 w-4 accent-emerald-800"
              onChange={event => setShowPasswords(event.target.checked)} />
            Show passwords
          </label>
          <p className="text-sm leading-6 text-slate-600">
            Resetting your password signs out existing sessions across your homes,
            portals, and Android app.
          </p>
          <button type="submit" disabled={busy} className={primaryClass}>
            {busy ? "Resetting password…" : "Reset password"}
          </button>
          <button type="button" onClick={restart} className={secondaryClass}>
            Request a new reset code
          </button>
        </>}
      </fieldset>
    </form>

    <div className="mt-5 border-t border-slate-100 pt-4">{back}</div>
  </div>;
}
