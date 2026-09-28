import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { validateUnitWorkbookBounds } from "../src/lib/contracts/unit-workbook-bounds";

function fixture() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Units");
  sheet.addRow(["Wing", "Floor", "Flat number", "Unit type"]);
  return { workbook, sheet };
}

test("xlsx round trip ignores trailing formatting and blank cells", async () => {
  const { workbook, sheet } = fixture();
  sheet.addRow(["A", "1", "001", "1BHK"]);
  sheet.getCell("Z1000").numFmt = "@";
  sheet.getCell("E2").value = "   ";
  sheet.getCell("A900").value = " ";

  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  const restored = loaded.getWorksheet("Units");
  assert.ok(restored);
  assert.doesNotThrow(() => validateUnitWorkbookBounds(restored));
  assert.equal(restored.getCell("C2").value, "001");
});

test("allows 500 populated rows separated by blank rows", () => {
  const { sheet } = fixture();
  for (let index = 0; index < 500; index++) {
    sheet.getCell(2 + index * 2, 3).value = String(index + 1);
  }
  assert.doesNotThrow(() => validateUnitWorkbookBounds(sheet));
});

test("rejects the 501st populated row", () => {
  const { sheet } = fixture();
  for (let index = 0; index < 501; index++) {
    sheet.addRow(["A", "1", String(index + 1), "1BHK"]);
  }
  assert.throws(() => validateUnitWorkbookBounds(sheet), /500 populated rows/);
});

test("rejects extra headings and data even on otherwise blank rows", () => {
  for (const address of ["E1", "E2", "Z900"]) {
    const { sheet } = fixture();
    sheet.getCell(address).value = "Unexpected data";
    assert.throws(
      () => validateUnitWorkbookBounds(sheet),
      new RegExp(`Cell ${address}:`),
    );
  }
});

test("does not treat zero, false, or a blank-result formula as empty", () => {
  const values: ExcelJS.CellValue[] = [
    0,
    false,
    { formula: 'IF(1=1,"","x")', result: "" },
  ];
  for (const value of values) {
    const { sheet } = fixture();
    sheet.getCell("E2").value = value;
    assert.throws(() => validateUnitWorkbookBounds(sheet), /Cell E2:/);
  }
});
