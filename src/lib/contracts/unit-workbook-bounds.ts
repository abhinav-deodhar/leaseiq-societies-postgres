import type { CellValue, Worksheet } from "exceljs";

function isBlank(value: CellValue): boolean {
  return value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "");
}

export function validateUnitWorkbookBounds(sheet: Worksheet): void {
  let populatedRows = 0;

  sheet.eachRow((row, rowNumber) => {
    let hasData = false;

    row.eachCell((cell, columnNumber) => {
      if (isBlank(cell.value)) return;

      if (columnNumber > 4) {
        throw new Error(
          `Cell ${cell.address}: use only columns A–D. Remove the extra value.`,
        );
      }

      hasData = true;
    });

    if (rowNumber > 1 && hasData) {
      populatedRows += 1;

      if (populatedRows > 500) {
        throw new Error(
          "Import up to 500 populated rows at a time. Split this workbook into smaller batches.",
        );
      }
    }
  });
}
