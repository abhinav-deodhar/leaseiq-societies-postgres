"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import {
  registrationSchema,
  todayInIndia,
} from "@/lib/validation/auth";

const challengeSchema = z.object({
  challengeId: z.uuid(),
  expiresAt: z.string(),
});

const registrationResponseSchema = z.object({
  delivery: z.object({
    email: z.enum(["accepted", "development_console", "unconfirmed"]),
  }).optional(),
  verification: z.object({
    email: challengeSchema,
    phone: challengeSchema.optional(),
  }),
});

const resendResponseSchema = z.object({
  verification: z.object({ email: challengeSchema }),
  delivery: z.object({
    email: z.enum(["accepted", "development_console", "unconfirmed"]),
  }),
  retryAfterSeconds: z.number().int().min(1).max(3600),
});

const verificationResponseSchema = z.object({
  status: z.string(),
  emailVerified: z.boolean(),
  phoneVerified: z.boolean(),
});

type Challenges = z.infer<
  typeof registrationResponseSchema
>["verification"];

type Channel = "email" | "phone";

const fields = [
  {
    name: "fullName",
    label: "Full name",
    type: "text",
    autoComplete: "name",
    maxLength: 120,
  },
  {
    name: "dateOfBirth",
    label: "Date of birth",
    type: "date",
    autoComplete: "bday",
  },
  {
    name: "phone",
    label: "Mobile number",
    type: "tel",
    autoComplete: "tel-national",
    maxLength: 10,
    help: "Enter your 10-digit Indian mobile number without +91.",
  },
  {
    name: "email",
    label: "Email address",
    type: "email",
    autoComplete: "email",
    maxLength: 254,
  },
  {
    name: "password",
    label: "Password",
    type: "password",
    autoComplete: "new-password",
    maxLength: 128,
    help: "Use 15–128 characters. A memorable passphrase works well.",
  },
  {
    name: "confirmPassword",
    label: "Confirm password",
    type: "password",
    autoComplete: "new-password",
    maxLength: 128,
  },
] as const;

function responseMessage(body: unknown, fallback: string): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
  ) {
    return body.message;
  }

  return fallback;
}

export default function ChairmanRegistration() {
  const requestInProgress = useRef(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] =
    useState<Record<string, string>>({});
  const [challenges, setChallenges] = useState<Challenges | null>(null);
  const [verified, setVerified] = useState({
    email: false,
    phone: false,
  });
  const [notice, setNotice] = useState("");
  const [emailResendSeconds, setEmailResendSeconds] = useState(0);
  const emailCodeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (emailResendSeconds <= 0) return;
    const timer = window.setTimeout(() => {
      setEmailResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [emailResendSeconds]);

  const steps = ["Your details", "Verify email", "Account ready"];

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInProgress.current) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const input = Object.fromEntries(
      fields.map((field) => [
        field.name,
        String(formData.get(field.name) ?? ""),
      ]),
    );

    setError("");
    setFieldErrors({});

    const validation = registrationSchema.safeParse(input);

    if (!validation.success) {
      const errors: Record<string, string> = {};

      for (const issue of validation.error.issues) {
        const field = String(issue.path[0] ?? "form");
        errors[field] ??= issue.message;
      }

      setFieldErrors(errors);
      setError("Please correct the highlighted fields.");

      const first = form.elements.namedItem(Object.keys(errors)[0]);
      if (first instanceof HTMLElement) first.focus();

      return;
    }

    requestInProgress.current = true;
    setBusy(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Send original input; the server performs normalization.
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(45000),
      });

      const body: unknown = await response.json();

      if (!response.ok) {
        setError(responseMessage(body, "Unable to create your account."));
        return;
      }

      const result = registrationResponseSchema.safeParse(body);

      if (!result.success) {
        setError(
          "The account may have been created, but we could not read its verification requests. Keep this page open and report this error.",
        );
        return;
      }

      setChallenges(result.data.verification);
      form.reset();
      const message = responseMessage(
        body, "Account created. Verify your email address.",
      );
      if (result.data.delivery?.email === "unconfirmed") {
        setError(message + " You can request a new email code after the countdown.");
        setNotice("");
      } else {
        setNotice(message);
      }
      setEmailResendSeconds(60);
      setStep(1);
    } catch {
      setError(
        "We could not confirm whether registration completed. Keep this page open and check your connection.",
      );
    } finally {
      requestInProgress.current = false;
      setBusy(false);
    }
  }

  async function resendEmail() {
    if (requestInProgress.current || !challenges || verified.email || emailResendSeconds > 0) return;

    requestInProgress.current = true;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/auth/verify/resend-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: challenges.email.challengeId }),
        signal: AbortSignal.timeout(45000),
      });
      const body: unknown = await response.json();

      if (!response.ok) {
        const retry = Number(response.headers.get("Retry-After"));
        setEmailResendSeconds(Number.isFinite(retry) && retry > 0
          ? Math.min(3600, Math.ceil(retry)) : 60);
        setError(responseMessage(body, "Email code resend could not be confirmed."));
        return;
      }

      const result = resendResponseSchema.safeParse(body);
      if (!result.success) throw new Error("Unexpected resend response");

      setChallenges((current) => current
        ? { ...current, email: result.data.verification.email } : current);
      setEmailResendSeconds(result.data.retryAfterSeconds);
      if (emailCodeInput.current) emailCodeInput.current.value = "";

      const message = responseMessage(body, "Use the newest email code.");
      if (result.data.delivery.email === "unconfirmed") {
        setError(message);
      } else {
        setNotice(message);
      }
    } catch {
      setEmailResendSeconds(60);
      setError("We could not confirm the resend. Keep this page open and request another code after the countdown.");
    } finally {
      requestInProgress.current = false;
      setBusy(false);
    }
  }

  async function verify(
    event: FormEvent<HTMLFormElement>,
    channel: Channel,
  ) {
    event.preventDefault();

    if (
      requestInProgress.current ||
      !challenges ||
      verified[channel]
    ) {
      return;
    }

    const challenge = challenges[channel];
    if (!challenge) return;

    const form = event.currentTarget;
    const code = String(new FormData(form).get("code") ?? "").trim();

    setError("");
    setNotice("");

    if (!/^[0-9]{6}$/.test(code)) {
      setError("Enter the six-digit verification code.");
      return;
    }

    requestInProgress.current = true;
    setBusy(true);

    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          code,
        }),
        signal: AbortSignal.timeout(15000),
      });

      const body: unknown = await response.json();

      if (!response.ok) {
        setError(responseMessage(body, "Verification failed."));
        return;
      }

      const result = verificationResponseSchema.safeParse(body);

      if (!result.success) {
        setError(
          "Verification returned an unexpected response. Keep this page open and report this error.",
        );
        return;
      }

      const account = result.data;

      setVerified({
        email: account.emailVerified,
        phone: account.phoneVerified,
      });

      form.reset();

      if (
        account.status === "active" &&
        account.emailVerified
      ) {
        setStep(2);
      } else {
        setNotice(
          channel === "email"
            ? "Email verified. Your account is awaiting activation."
            : "Mobile verified. Complete email verification next.",
        );
      }
    } catch {
      setError(
        "We could not confirm the verification result. Check your connection before retrying.",
      );
    } finally {
      requestInProgress.current = false;
      setBusy(false);
    }
  }

  const inputClass =
    "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 " +
    "text-slate-900 outline-none focus:border-emerald-700 " +
    "focus:ring-2 focus:ring-emerald-100 disabled:opacity-60";

  return (
    <main className="min-h-screen bg-[#f3f6f4] px-5 py-10 font-sans text-slate-900">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/chairman/login"
          className="text-xl font-semibold text-emerald-900"
        >
          leaseIq societies
        </Link>

        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
          <p className="text-sm font-semibold text-emerald-800">
            Chairman registration
          </p>

          <h1 className="mt-2 text-3xl font-semibold">
            {steps[step]}
          </h1>

          <nav aria-label="Registration progress" className="mt-6">
            <p className="text-sm text-slate-600">
              Step {step + 1} of {steps.length}
            </p>

            <ol className="mt-3 grid grid-cols-3 gap-2">
              {steps.map((label, index) => (
                <li
                  key={label}
                  aria-current={step === index ? "step" : undefined}
                  className={`rounded-xl border px-3 py-3 text-xs font-semibold sm:text-sm ${
                    index <= step
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                      : "border-slate-200 text-slate-500"
                  }`}
                >
                  {index < step ? "✓" : index + 1} {label}
                </li>
              ))}
            </ol>
          </nav>

          {error && (
            <p
              role="alert"
              className="mt-5 rounded-xl bg-red-50 p-4 text-sm leading-6 text-red-800"
            >
              {error}
            </p>
          )}

          {notice && (
            <p
              role="status"
              className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900"
            >
              {notice}
            </p>
          )}

          {step === 0 && (
            <form onSubmit={register} noValidate className="mt-6">
              <p className="mb-5 text-sm leading-6 text-slate-600">
                All fields are required. Verify your email to activate
                your account. Your mobile number is saved as unverified.
                Society details come after account verification.
              </p>

              <fieldset disabled={busy} className="space-y-5">
                <legend className="sr-only">Chairman details</legend>

                {fields.map((field) => (
                  <div key={field.name}>
                    <label
                      htmlFor={field.name}
                      className="text-sm font-semibold"
                    >
                      {field.label}
                    </label>

                    <input
                      id={field.name}
                      name={field.name}
                      type={field.type}
                      autoComplete={field.autoComplete}
                      maxLength={
                        "maxLength" in field
                          ? field.maxLength
                          : undefined
                      }
                      max={
                        field.name === "dateOfBirth"
                          ? todayInIndia()
                          : undefined
                      }
                      inputMode={
                        field.name === "phone" ? "numeric" : undefined
                      }
                      required
                      aria-invalid={Boolean(fieldErrors[field.name])}
                      aria-describedby={`${field.name}-help ${field.name}-error`}
                      className={inputClass}
                    />

                    <p
                      id={`${field.name}-help`}
                      className="mt-1 text-xs leading-5 text-slate-500"
                    >
                      {"help" in field ? field.help : ""}
                    </p>

                    <p
                      id={`${field.name}-error`}
                      className="mt-1 text-sm text-red-700"
                    >
                      {fieldErrors[field.name]}
                    </p>
                  </div>
                ))}

                <button
                  type="submit"
                  className="w-full rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
                >
                  {busy ? "Creating account…" : "Continue to verification"}
                </button>
              </fieldset>
            </form>
          )}

          {step === 1 && challenges && (
            <div className="mt-6 space-y-5">
              <p className="text-sm leading-6 text-slate-600">
                Enter the six-digit code sent to your email.
                Check your spam folder if it has not arrived.
              </p>

              {(["email"] as Channel[]).map((channel) => (
                <form
                  key={channel}
                  onSubmit={(event) => void verify(event, channel)}
                  className="rounded-2xl border border-slate-200 p-5"
                >
                  <h2 className="font-semibold">
                    {channel === "phone" ? "Mobile number" : "Email address"}
                  </h2>

                  {verified[channel] ? (
                    <p className="mt-3 font-medium text-emerald-800">
                      ✓ Verified
                    </p>
                  ) : (
                    <fieldset disabled={busy} className="mt-3">
                      <legend className="sr-only">
                        {channel} verification
                      </legend>

                      <label
                        htmlFor={`${channel}-code`}
                        className="text-sm text-slate-700"
                      >
                        Six-digit code
                      </label>

                      <input
                        id={`${channel}-code`}
                        ref={channel === "email" ? emailCodeInput : undefined}
                        name="code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        className={inputClass}
                      />

                      <button
                        type="submit"
                        className="mt-3 rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-900"
                      >
                        {busy
                          ? "Please wait…"
                          : `Verify ${channel === "phone" ? "mobile" : "email"}`}
                      </button>

                      {channel === "email" && (
                        <div className="mt-4 border-t border-slate-100 pt-4">
                          <button
                            type="button"
                            disabled={busy || emailResendSeconds > 0}
                            onClick={() => void resendEmail()}
                            className="rounded-lg px-2 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {emailResendSeconds > 0
                              ? `Resend email code in ${emailResendSeconds}s`
                              : "Resend email code"}
                          </button>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            Check your spam folder. Requesting a new code replaces the previous one.
                          </p>
                        </div>
                      )}
                    </fieldset>
                  )}
                </form>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="mt-6">
              <div
                role="status"
                className="rounded-2xl bg-emerald-50 p-5 text-emerald-900"
              >
                <h2 className="text-lg font-semibold">
                  Your chairman account is ready
                </h2>
                <p className="mt-2 text-sm leading-6">
                  Your email is verified. Your mobile number remains
                  unverified. You can now sign in. Society approval and
                  subscription activation are separate steps.
                </p>
              </div>

              <Link
                href="/chairman/login"
                className="mt-5 inline-flex rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white hover:bg-emerald-900"
              >
                Continue to sign in
              </Link>
            </div>
          )}

          {step === 0 && (
            <p className="mt-6 text-sm text-slate-600">
              Already registered?{" "}
              <Link
                href="/chairman/login"
                className="font-semibold text-emerald-800 underline"
              >
                Sign in
              </Link>
            </p>
          )}
        </section>
      </div>
    </main>
  );
}