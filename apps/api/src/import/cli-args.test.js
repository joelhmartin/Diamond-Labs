import { test } from "vitest";
import assert from "node:assert/strict";
import { parseArgs, intFlag, listFlag } from "./cli-args.js";
import { ImportRefusal } from "./import-errors.js";

const opts = { allowed: ["live", "target", "approved", "ids", "columns"], booleans: ["live"] };

test("positionals, --flag value, --flag=value and booleans", () => {
  const { positional, flags } = parseArgs(["invoices", "--target", "rehearsal", "--approved=120", "--live", "--columns", "balance=Amount Due"], opts);
  assert.deepEqual(positional, ["invoices"]);
  assert.deepEqual(flags, { target: "rehearsal", approved: "120", live: true, columns: "balance=Amount Due" });
});

test("an unknown flag or a missing value is refused, never ignored", () => {
  assert.throws(() => parseArgs(["--lvie"], opts), ImportRefusal);
  assert.throws(() => parseArgs(["--target"], opts), /--target needs a value/);
  assert.throws(() => parseArgs(["--target", "--live"], opts), /--target needs a value/);
});

test("integer and list flags", () => {
  assert.equal(intFlag({ approved: "120" }, "approved"), 120);
  assert.equal(intFlag({}, "approved"), undefined);
  assert.throws(() => intFlag({ approved: "12.5" }, "approved"), /whole number/);
  assert.deepEqual(listFlag({ ids: "a, b,,c" }, "ids"), ["a", "b", "c"]);
});
