import assert from "node:assert/strict";
import test from "node:test";
import { csvRow } from "../lib/csv";

test("CSV exports neutralize spreadsheet formulas in untrusted string fields", () => {
  assert.equal(
    csvRow(["=HYPERLINK(\"bad\")", "+cmd", "@sum", -12]),
    "\"'=HYPERLINK(\"\"bad\"\")\",'+cmd,'@sum,-12\r\n"
  );
});
