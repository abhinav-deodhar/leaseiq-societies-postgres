import Link from "next/link";

const portals = [
  {
    href: "/resident/login",
    title: "Resident / Tenant",
    description: "For homeowners and tenants accessing their resident account.",
    label: "Resident sign in",
    icon: "home",
  },
  {
    href: "/chairman/login",
    title: "Chairman",
    description: "For chairmen managing their society and community records.",
    label: "Chairman sign in",
    icon: "building",
  },
] as const;

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col bg-[#f3f6f4] font-sans text-slate-900">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-6">
          <span
            aria-hidden="true"
            className="flex size-11 items-center justify-center rounded-2xl bg-emerald-900 text-lg font-bold text-white"
          >
            L
          </span>
          <div>
            <p className="text-xl font-bold tracking-tight text-emerald-950">
              LeaseIQ
            </p>
            <p className="text-xs font-medium tracking-wide text-slate-500">
              SOCIETIES
            </p>
          </div>
        </div>
      </header>

      <section
        aria-labelledby="welcome-heading"
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-12 sm:py-20"
      >
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-emerald-700">
            Welcome to LeaseIQ
          </p>
          <h1
            id="welcome-heading"
            className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
          >
            Your community.
            <br />
            A little more connected.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
            Choose your portal to sign in and continue.
          </p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {portals.map((portal) => (
            <Link
              key={portal.href}
              href={portal.href}
              className="group flex flex-col rounded-3xl border border-slate-200 bg-white p-7 shadow-sm transition-colors hover:border-emerald-600 hover:bg-emerald-50/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 active:bg-emerald-100/50 sm:p-9"
            >
              <span
                aria-hidden="true"
                className="flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-800"
              >
                <svg
                  width="25"
                  height="25"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {portal.icon === "home" ? (
                    <>
                      <path d="m3 10 9-7 9 7" />
                      <path d="M5 9v12h14V9M9 21v-8h6v8" />
                    </>
                  ) : (
                    <>
                      <path d="M5 21V3h14v18M3 21h18" />
                      <path d="M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-6h4v6" />
                    </>
                  )}
                </svg>
              </span>

              <h2 className="mt-6 text-2xl font-semibold tracking-tight">
                {portal.title}
              </h2>
              <p className="mt-3 max-w-sm flex-1 leading-7 text-slate-600">
                {portal.description}
              </p>
              <span className="mt-8 flex items-center justify-between gap-4 font-semibold text-emerald-800">
                {portal.label}
                <span aria-hidden="true" className="text-xl">→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <footer className="mx-auto w-full max-w-6xl px-6 pb-7 text-sm text-slate-500">
        Built for communities. Designed around people.
      </footer>
    </main>
  );
}
