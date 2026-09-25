import "server-only";
import ExcelJS from "exceljs";
import {
  listUnits,
  listUnitTypes,
} from "@/lib/server/repositories/units.repository";
import { withChairmanUnitAccess } from "./units.service";

export async function createUnitWorkbook(
  userId: string,
  societyId: string,
  kind: "template" | "export",
): Promise<Uint8Array> {
  const snapshot = await withChairmanUnitAccess(
    userId,
    societyId,
    async (client) => ({
      types: await listUnitTypes(client, societyId),
      units: kind === "export"
        ? (await listUnits(
            client,
            societyId,
            { page: 1, search: "" },
            2147483647,
          )).units
        : [],
    }),
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LeaseIQ Societies";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Units", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Wing", key: "wing", width: 18 },
    { header: "Floor", key: "floor", width: 18 },
    { header: "Flat number", key: "flat", width: 22 },
    { header: "Unit type", key: "type", width: 28 },
  ];

  for (const column of sheet.columns) {
    column.numFmt = "@";
  }

  for (const unit of snapshot.units) {
    sheet.addRow({
      wing: unit.wing,
      floor: unit.floorLabel ?? "",
      flat: unit.flatNumber,
      type: unit.unitTypeName ?? "",
    });
  }

  // Preformat template cells as text, including leading-zero flat numbers.
  if (kind === "template") {
    for (let row = 2; row <= 501; row++) {
      for (let column = 1; column <= 4; column++) {
        sheet.getCell(row, column).numFmt = "@";
      }
    }
  }

  sheet.autoFilter = "A1:D1";
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF065F46" },
    };
    cell.alignment = { vertical: "middle" };
  });

  const types = workbook.addWorksheet("Unit types");
  types.columns = [{ header: "Available unit types", width: 35 }];
  for (const type of snapshot.types) {
    types.addRow([type.name]);
  }
  types.getRow(1).font = { bold: true };

  const instructions = workbook.addWorksheet("Instructions");
  instructions.getColumn(1).width = 110;
  for (const text of [
    "LeaseIQ Societies — unit register",
    "Enter flats on the Units sheet. Keep its four column headings unchanged.",
    "Each import supports up to 500 flats.",
    "Flat number is required. Preserve leading zeros, such as 001.",
    "Wing and Floor may be left blank.",
    "Copy the Unit type name from the Unit types sheet, or leave it blank if unknown.",
    "Do not enter formulas. Use plain text values.",
    "Imports add new flats only. Existing flats are not overwritten.",
    "Duplicate flats and approved unit-count limits are checked before saving.",
    "The export includes all registered flats, regardless of search or pagination.",
    "Ownership, occupancy, and resident approval are managed separately.",
  ]) {
    instructions.addRow([text]);
  }
  instructions.getRow(1).font = { bold: true, size: 14 };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
