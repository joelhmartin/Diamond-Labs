import { test, expect } from "vitest";
import { csvField, csvRow, CSV_EOL } from "./csv.js";

test("csv neutralizes formula-leading text but not negative numbers", () => {
  expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
  expect(csvField("@cmd")).toBe("'@cmd");
  expect(csvField("+1 call")).toBe("'+1 call");
  expect(csvField("-12.50")).toBe("-12.50");
  expect(csvField(-5)).toBe("-5");
});

test("quotes comma, quote and newline", () => {
  expect(csvField('a,"b"\n')).toBe('"a,""b""\n"');
});

test("null and undefined are empty, booleans stringify", () => {
  expect(csvField(null)).toBe("");
  expect(csvField(undefined)).toBe("");
  expect(csvField(true)).toBe("true");
});

test("csvRow joins fields with commas and no line ending", () => {
  expect(csvRow(["a", "b,c", 3])).toBe('a,"b,c",3');
  expect(CSV_EOL).toBe("\r\n");
});
