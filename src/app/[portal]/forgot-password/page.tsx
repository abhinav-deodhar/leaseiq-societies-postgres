import Link from "next/link";
import { notFound } from "next/navigation";
import EmailAuthPanel from "@/components/auth/email-auth-panel";

export const metadata = {
  title: "Reset password | LeaseIQ",
};

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ portal: string }>;
}) {
  const { portal } = await params;
  if (portal !== "chairman" && portal !== "resident") notFound();

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f6f4] px-5 py-10 font-sans text-slate-900">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 md:grid-cols-2">
        <section className="flex flex-col justify-between bg-emerald-950 p-8 text-white md:p-12">
          <div>
            <Link href="/"
              className="rounded text-xl font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4">
              leaseIq<span className="text-emerald-300"> societies</span>
            </Link>
            <p className="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Account recovery
            </p>
            <h1 className="mt-4 text-3xl font-semibold leading-tight md:text-4xl">
              Get back to your community.
            </h1>
            <p className="mt-5 max-w-sm leading-7 text-emerald-100">
              Verify your registered email address, then choose a new password
              for your LeaseIQ account.
            </p>
          </div>
          <p className="mt-10 text-sm leading-6 text-emerald-200">
            Keep your code private. LeaseIQ will never ask you to share it by phone or message.
          </p>
        </section>

        <section className="p-8 md:p-12" aria-labelledby="recovery-heading">
          <p className="text-sm font-medium text-emerald-700">
            {portal === "chairman" ? "Chairman portal" : "Resident portal"}
          </p>
          <h2 id="recovery-heading" className="mt-2 text-2xl font-semibold">
            Forgot your password?
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            We’ll email you a code to continue. Your password stays unchanged
            until you save a new one.
          </p>
          <EmailAuthPanel portal={portal} purpose="reset_password" />
        </section>
      </div>
    </main>
  );
}
