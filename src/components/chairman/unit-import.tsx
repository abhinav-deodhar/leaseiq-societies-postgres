"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUnitSchema,
  type CreateUnitData,
  type UnitTypeSummary,
} from "@/lib/contracts/units";
import type { UnitImportResult } from "@/lib/contracts/unit-import";
import { validateUnitWorkbookBounds } from "@/lib/contracts/unit-workbook-bounds";

type PreviewRow = {
  sheetRow: number;
  data: CreateUnitData;
  typeName: string;
};

type ImportResponse = UnitImportResult & { message?: string };

export default function UnitImport({
  societyId,
  unitTypes,
  disabled,
  onImported,
}: {
  societyId: string;
  unitTypes: UnitTypeSummary[];
  disabled: boolean;
  onImported: () => Promise<void>;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  async function loadFile(file: File) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setRows([]);
    setReady(false);
    setMessages([]);
    setNotice("");
    setFileName(file.name);

    try {
      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        throw new Error("Choose an .xlsx workbook using the downloaded template.");
      }

      if (file.size > 2 * 1024 * 1024) {
        throw new Error("Choose a workbook smaller than 2 MB.");
      }

      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());

      const sheet = workbook.getWorksheet("Units");
      if (!sheet) {
        throw new Error('The workbook must contain a sheet named "Units".');
      }

      const headings = ["Wing", "Floor", "Flat number", "Unit type"];
      headings.forEach((heading, index) => {
        if (sheet.getRow(1).getCell(index + 1).value !== heading) {
          throw new Error(
            "The column headings must be Wing, Floor, Flat number, Unit type.",
          );
        }
      });

      validateUnitWorkbookBounds(sheet);

      const parsed: PreviewRow[] = [];
      const errors: string[] = [];

      sheet.eachRow((row, number) => {
        if (number === 1) return;

        const cells = [1, 2, 3, 4].map((column) => row.getCell(column));
        const isBlank = cells.every(
          (cell) =>
            cell.value === null ||
            cell.value === undefined ||
            (typeof cell.value === "string" && cell.value.trim() === ""),
        );
        if (isBlank) return;

        // Reject formulas, dates, links, and other structured cell values.
        if (
          cells.some(
            (cell) =>
              cell.value !== null &&
              cell.value !== undefined &&
              typeof cell.value !== "string" &&
              typeof cell.value !== "number",
          )
        ) {
          errors.push(`Row ${number}: use plain text, without formulas or dates.`);
          return;
        }

        if (typeof cells[2].value !== "string") {
          errors.push(
            `Row ${number}: Flat number must be text. In Excel, enter '001 for flat 001.`,
          );
          return;
        }

        const values = cells.map((cell) => String(cell.value ?? "").trim());
        const [wing, floorLabel, flatNumber, typeName] = values;
        const matchingType = unitTypes.find(
          (type) => type.name.toLowerCase() === typeName.toLowerCase(),
        );

        if (typeName && !matchingType) {
          errors.push(
            `Row ${number}: "${typeName}" is not an available unit type. Copy its name from the Unit types sheet.`,
          );
          return;
        }

        const validation = createUnitSchema.safeParse({
          wing,
          floorLabel,
          flatNumber,
          unitTypeId: matchingType?.id ?? null,
        });

        if (!validation.success) {
          errors.push(
            `Row ${number}: ${validation.error.issues.map((issue) => issue.message).join(" ")}`,
          );
          return;
        }

        parsed.push({
          sheetRow: number,
          data: validation.data,
          typeName: matchingType?.name ?? "Unassigned",
        });
      });

      if (errors.length > 0) {
        setMessages(errors);
        return;
      }

      if (parsed.length === 0) {
        throw new Error("The Units sheet contains no flats to import.");
      }

      setRows(parsed);
      setNotice("Workbook loaded. Check the preview, then validate the rows.");
    } catch (error) {
      setMessages([
        error instanceof Error
          ? error.message
          : "Unable to read this workbook. Try a fresh template.",
      ]);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function submit(mode: "preview" | "import") {
    if (pending.current || rows.length === 0 || disabled) return;
    if (mode === "import" && !ready) return;

    pending.current = true;
    setBusy(true);
    setReady(false);
    setMessages([]);
    setNotice("");

    try {
      const response = await fetch(
        `/api/chairman/societies/${societyId}/units/import`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            rows: rows.map((row) => row.data),
          }),
          signal: AbortSignal.timeout(120000),
        },
      );

      if (response.status === 401) {
        router.replace("/chairman/login");
        return;
      }

      const result = await response.json() as ImportResponse;

      if (!response.ok || !result.valid) {
        const issues = Array.isArray(result.issues) ? result.issues : [];
        setMessages(
          issues.length > 0
            ? issues.map((issue) => {
                const originalRow = rows[issue.row - 2]?.sheetRow ?? issue.row;
                return `Row ${originalRow}: ${issue.message}`;
              })
            : [result.message ?? "Unable to validate the import."],
        );
        return;
      }

      if (mode === "preview") {
        setReady(true);
        setNotice(
          `${rows.length} flats passed validation. Confirm below to add them.`,
        );
        return;
      }

      setRows([]);
      setFileName("");
      if (fileInput.current) fileInput.current.value = "";
      setNotice(`${result.imported} flats imported successfully.`);

      try {
        await onImported();
      } catch {
        setMessages([
          "The import succeeded, but the register could not reload. Refresh the page.",
        ]);
      }
    } catch {
      setMessages([
        mode === "import"
          ? "We could not confirm the import result. Refresh the register before trying again. Validate the workbook again to check for existing flats."
          : "Validation could not finish. Please try again.",
      ]);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function clear() {
    setRows([]);
    setReady(false);
    setFileName("");
    setMessages([]);
    setNotice("");
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <section
      aria-label="Import flats from Excel"
      aria-busy={busy}
      className="mb-5 rounded-2xl border border-slate-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Import flats</h2>
          <p className="mt-1 text-sm text-slate-500">
            Use the Excel template. Up to 500 flats per import.
          </p>
        </div>
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => fileInput.current?.click()}
          className="rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
        >
          {busy ? "Processing…" : "Import Excel"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx"
          className="hidden"
          aria-label="Choose unit workbook"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadFile(file);
            event.target.value = "";
          }}
        />
      </div>

      {fileName && (
        <p className="mt-3 break-all text-sm text-slate-600">{fileName}</p>
      )}

      {notice && (
        <p role="status" className="mt-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {messages.length > 0 && (
        <div role="alert" className="mt-3 rounded-xl bg-red-50 p-4 text-sm text-red-800">
          <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5">
            {messages.map((message, index) => (
              <li key={`${index}-${message}`}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="mt-4 max-h-80 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Flats to import</caption>
              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                <tr>
                  {["Row", "Wing", "Floor", "Flat", "Unit type"].map((label) => (
                    <th key={label} scope="col" className="whitespace-nowrap px-3 py-3">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.sheetRow}>
                    <td className="px-3 py-2">{row.sheetRow}</td>
                    <td className="px-3 py-2">{row.data.wing || "—"}</td>
                    <td className="px-3 py-2">{row.data.floorLabel || "—"}</td>
                    <td className="px-3 py-2 font-medium">{row.data.flatNumber}</td>
                    <td className="px-3 py-2">{row.typeName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || disabled}
              onClick={() => void submit(ready ? "import" : "preview")}
              className="rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50"
            >
              {busy
                ? "Processing…"
                : ready
                  ? `Confirm import of ${rows.length} flats`
                  : "Validate rows"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={clear}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}
