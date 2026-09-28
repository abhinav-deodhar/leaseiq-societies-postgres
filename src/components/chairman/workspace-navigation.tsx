"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import LogoutButton from "@/components/auth/logout-button";

export default function WorkspaceNavigation({
  fullName,
}: {
  fullName: string;
}) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);

  const destinations = [
    { href: "/chairman", label: "Dashboard" },
    { href: "/chairman/society", label: "Society details" },
    { href: "/chairman/units", label: "Unit register" },
    { href: "/chairman/resident-applications", label: "Resident applications" },
    { href: "/chairman/owner-transfers", label: "Ownership transfers" },
    { href: "/chairman/invoices", label: "Invoices" },
  ];

  function links() {
    return destinations.map(({ href, label }) => {
      const selected = href === "/chairman"
        ? pathname === href
        : pathname === href || pathname.startsWith(`${href}/`);

      return (
        <Link
          key={href}
          href={href}
          aria-current={selected ? "page" : undefined}
          onClick={() => dialog.current?.close()}
          className={`block rounded-xl px-4 py-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
            selected
              ? "bg-emerald-50 text-emerald-900"
              : "text-slate-600 hover:bg-slate-100 active:bg-slate-200"
          }`}
        >
          {label}
        </Link>
      );
    });
  }

  return (
    <>
      <a
        href="#workspace-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white p-6 lg:flex">
        <Link href="/chairman" className="text-2xl font-bold tracking-tight text-emerald-800">
          LeaseIQ
        </Link>
        <p className="mt-1 text-xs uppercase tracking-widest text-slate-500">
          Chairman workspace
        </p>
        <nav aria-label="Chairman navigation" className="mt-10 space-y-2">
          {links()}
        </nav>
        <div className="mt-auto border-t border-slate-200 pt-5">
          <p className="mb-4 break-words text-sm font-medium text-slate-700">
            {fullName}
          </p>
          <LogoutButton portal="chairman" />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 lg:hidden">
        <Link href="/chairman" className="text-xl font-bold text-emerald-800">
          LeaseIQ
        </Link>
        <button
          type="button"
          aria-label="Open chairman navigation"
          aria-haspopup="dialog"
          onClick={() => dialog.current?.showModal()}
          className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold active:bg-slate-100"
        >
          Menu
        </button>
      </header>

      <dialog
        ref={dialog}
        aria-labelledby="navigation-title"
        className="fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-none w-80 max-w-[90vw] border-0 bg-white p-6 text-slate-900 backdrop:bg-slate-950/50"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            ) {
              dialog.current?.close();
            }
          }
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3">
            <h2 id="navigation-title" className="text-xl font-bold text-emerald-800">
              Chairman workspace
            </h2>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="min-h-11 rounded-lg px-3 text-sm hover:bg-slate-100"
            >
              Close
            </button>
          </div>
          <nav aria-label="Mobile chairman navigation" className="mt-8 space-y-2">
            {links()}
          </nav>
          <div className="mt-auto border-t border-slate-200 pt-5">
            <p className="mb-4 break-words text-sm">{fullName}</p>
            <LogoutButton portal="chairman" />
          </div>
        </div>
      </dialog>
    </>
  );
}
