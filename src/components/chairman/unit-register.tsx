"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import UnitDownloads from "./unit-downloads";
import UnitImport from "./unit-import";
import { displayFloor } from "@/lib/formatters/floor-label";
import {
  createUnitSchema,
  type UnitListResponse,
  type UnitTypeSummary,
} from "@/lib/contracts/units";

type RegisterData = UnitListResponse & {
  unitTypes: UnitTypeSummary[];
};

type FormValues = {
  wing: string;
  floorLabel: string;
  flatNumber: string;
  unitTypeId: string;
};

const emptyForm: FormValues = {
  wing: "",
  floorLabel: "",
  flatNumber: "",
  unitTypeId: "",
};

const inputClass =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50";

const occupancyLabels = {
  unknown: "Unknown",
  vacant: "Vacant",
  owner_occupied: "Owner occupied",
  rented: "Rented",
};

export default function UnitRegister({
  societyId,
  initialData,
}: {
  societyId: string;
  initialData: RegisterData;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [editingUnit, setEditingUnit] =
    useState<RegisterData["units"][number] | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [busy, setBusy] = useState<"load" | "save" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestPending = useRef(false);
  const flatInput = useRef<HTMLInputElement>(null);

  const endpoint = `/api/chairman/societies/${societyId}/units`;
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));

  async function responseMessage(response: Response): Promise<string> {
    if (response.status === 401) {
      router.replace("/chairman/login");
      return "Your session has expired. Please sign in.";
    }

    try {
      const body = await response.json();
      if (typeof body.message === "string") return body.message;
    } catch {
      // Show a safe fallback when an error response is not JSON.
    }

    return "Unable to complete the request. Please try again.";
  }

  async function fetchPage(page: number, term: string) {
    const query = new URLSearchParams({
      page: String(page),
      search: term,
    });

    const response = await fetch(`${endpoint}?${query}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(await responseMessage(response));
    }

    const result = await response.json() as RegisterData;
    setData(result);
    setActiveSearch(term);
  }

  async function refresh(page: number, term: string) {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy("load");
    setError("");
    setNotice("");

    try {
      await fetchPage(page, term);
    } catch (error) {
      setError(
        error instanceof Error && error.name !== "TimeoutError"
          ? error.message
          : "The request timed out. Please try again.",
      );
    } finally {
      requestPending.current = false;
      setBusy(null);
    }
  }

  function updateField(name: keyof FormValues, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: "" }));
  }

  function startEditing(unit: RegisterData["units"][number]) {
    if (requestPending.current) return;

    setEditingUnit(unit);
    setForm({
      wing: unit.wing,
      floorLabel: unit.floorLabel ?? "",
      flatNumber: unit.flatNumber,
      unitTypeId: unit.unitTypeId ?? "",
    });
    setFieldErrors({});
    setError("");
    setNotice("");

    flatInput.current?.focus();
    flatInput.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  function cancelEditing() {
    if (requestPending.current) return;

    setEditingUnit(null);
    setForm(emptyForm);
    setFieldErrors({});
    setError("");
    setNotice("");
  }

  async function saveUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestPending.current) return;

    const validation = createUnitSchema.safeParse({
      ...form,
      unitTypeId: form.unitTypeId || null,
    });

    if (!validation.success) {
      const errors: Record<string, string> = {};
      for (const issue of validation.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string") errors[field] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    requestPending.current = true;
    setBusy("save");
    setError("");
    setNotice("");
    setFieldErrors({});

    try {
      let response: Response;

      try {
        response = await fetch(
          editingUnit ? `${endpoint}/${editingUnit.id}` : endpoint,
          {
          method: editingUnit ? "PATCH" : "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editingUnit
              ? {
                  ...validation.data,
                  expectedRevision: editingUnit.revision,
                }
              : validation.data,
          ),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        setError(
          "We could not confirm whether the flat was saved. Refresh the register before submitting again.",
        );
        return;
      }

      if (!response.ok) {
        const message = await responseMessage(response);
        setError(
          editingUnit && response.status === 409
            ? `${message} If this flat changed elsewhere, cancel editing, refresh the register, and select Edit again.`
            : message,
        );
        return;
      }

      const wasEditing = editingUnit !== null;
      setEditingUnit(null);
      setForm(emptyForm);
      setSearch("");
      setNotice(
        `Flat ${validation.data.flatNumber} was ${wasEditing ? "updated" : "added"} successfully.`,
      );

      try {
        await fetchPage(1, "");
      } catch {
        setError(
          "The flat was saved, but the register could not reload. Use Refresh register.",
        );
      }

      flatInput.current?.focus();
    } finally {
      requestPending.current = false;
      setBusy(null);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void refresh(1, search.trim());
  }

  return (
    <div className="mt-8">
      <UnitDownloads societyId={societyId} />
      <UnitImport
        societyId={societyId}
        unitTypes={data.unitTypes}
        disabled={busy !== null || editingUnit !== null}
        onImported={async () => {
          setSearch("");
          await refresh(1, "");
        }}
      />
      <div aria-live="polite" className="space-y-3">
        {notice && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </p>
        )}
      </div>

      <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section
          aria-labelledby="register-title"
          aria-busy={busy === "load"}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="border-b border-slate-100 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="register-title" className="text-lg font-semibold">
                  Unit register
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {data.total} {activeSearch ? "matching" : "registered"} flat{data.total === 1 ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void refresh(data.page, activeSearch)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
              >
                {busy === "load" ? "Loading…" : "Refresh register"}
              </button>
            </div>

            <form onSubmit={submitSearch} className="mt-5 flex flex-wrap gap-2">
              <label htmlFor="unit-search" className="sr-only">
                Search by wing, floor, or flat number
              </label>
              <input
                id="unit-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                maxLength={80}
                placeholder="Search wing, floor, or flat…"
                disabled={busy !== null}
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
              />
              <button
                disabled={busy !== null}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Search
              </button>
              {activeSearch && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    setSearch("");
                    void refresh(1, "");
                  }}
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </form>
          </div>

          {data.units.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <h3 className="font-semibold">
                {activeSearch ? "No matching flats" : "Start with your first flat"}
              </h3>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                {activeSearch
                  ? "Try another wing or flat number."
                  : "Add the physical flats in your society. Ownership and resident associations are recorded separately."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <caption className="sr-only">Society physical unit register</caption>
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-6 py-3">Flat</th>
                    <th scope="col" className="px-4 py-3">Floor</th>
                    <th scope="col" className="px-4 py-3">Unit type</th>
                    <th scope="col" className="px-4 py-3">Occupancy</th>
                    <th scope="col" className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.units.map((unit) => (
                    <tr
                      key={unit.id}
                      className={
                        editingUnit?.id === unit.id
                          ? "bg-emerald-50"
                          : "hover:bg-slate-50/70"
                      }
                    >
                      <td className="px-6 py-4">
                        <p className="font-semibold">{unit.flatNumber}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {unit.wing ? `Wing ${unit.wing}` : "No wing"}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {displayFloor(unit.wing, unit.floorLabel, !unit.wing.trim())}
                      </td>
                      <td className="px-4 py-4">
                        {unit.unitTypeName ?? (
                          <span className="text-amber-800">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                          {occupancyLabels[unit.occupancyStatus]}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button
                          type="button"
                          disabled={busy !== null || editingUnit !== null}
                          onClick={() => startEditing(unit)}
                          aria-label={`Edit flat ${unit.flatNumber}${unit.wing ? ` in wing ${unit.wing}` : ""}`}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-50"
                        >
                          {editingUnit?.id === unit.id ? "Editing" : "Edit"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
            <p className="text-xs text-slate-500">
              Page {data.page} of {pageCount}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy !== null || data.page <= 1}
                onClick={() => void refresh(data.page - 1, activeSearch)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={busy !== null || data.page >= pageCount}
                onClick={() => void refresh(data.page + 1, activeSearch)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">
            Society setup
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            {editingUnit ? `Edit flat ${editingUnit.flatNumber}` : "Add a flat"}
          </h2>
          {editingUnit && (
            <p className="mt-2 text-sm text-emerald-800">
              Update the details below, then save your changes.
            </p>
          )}
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Enter the flat number exactly as displayed, including leading zeros.
          </p>

          <form onSubmit={saveUnit} noValidate className="mt-6 space-y-5">
            {([
              ["flatNumber", "Flat number", "e.g. 001", true],
              ["wing", "Wing", "e.g. A", false],
              ["floorLabel", "Floor label", "e.g. G or 1", false],
            ] as const).map(([name, label, placeholder, required]) => (
              <div key={name}>
                <label htmlFor={`unit-${name}`} className="text-sm font-medium">
                  {label}
                  {!required && <span className="ml-1 font-normal text-slate-400">(optional)</span>}
                </label>
                <input
                  ref={name === "flatNumber" ? flatInput : undefined}
                  id={`unit-${name}`}
                  value={form[name]}
                  onChange={(event) => updateField(name, event.target.value)}
                  placeholder={placeholder}
                  maxLength={50}
                  required={required}
                  disabled={busy !== null}
                  aria-invalid={Boolean(fieldErrors[name])}
                  aria-describedby={fieldErrors[name] ? `${name}-error` : undefined}
                  className={inputClass}
                />
                {fieldErrors[name] && (
                  <p id={`${name}-error`} className="mt-1 text-sm text-red-700">
                    {fieldErrors[name]}
                  </p>
                )}
              </div>
            ))}

            <div>
              <label htmlFor="unit-type" className="text-sm font-medium">
                Unit type
              </label>
              <select
                id="unit-type"
                value={form.unitTypeId}
                onChange={(event) => updateField("unitTypeId", event.target.value)}
                disabled={busy !== null}
                className={inputClass}
                aria-invalid={Boolean(fieldErrors.unitTypeId)}
              >
                <option value="">Unassigned</option>
                {data.unitTypes.map((type) => (
                  <option key={type.id} value={type.id}>{type.name}</option>
                ))}
              </select>
              {fieldErrors.unitTypeId && (
                <p className="mt-1 text-sm text-red-700">{fieldErrors.unitTypeId}</p>
              )}
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Unit type is used for maintenance charges. Leave it unassigned only if it is not yet known.
              </p>
            </div>

            <button
              disabled={busy !== null}
              className="w-full rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 disabled:opacity-50"
            >
              {busy === "save"
                ? "Saving flat…"
                : editingUnit
                  ? "Save changes"
                  : "Add flat"}
            </button>
            {editingUnit && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={cancelEditing}
                className="w-full rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel editing
              </button>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}
