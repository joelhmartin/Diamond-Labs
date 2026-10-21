import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runCli, runIfMain, failureText } from "./report.js";
import { ImportRefusal } from "./import-errors.js";

const argv1 = process.argv[1];
afterEach(() => { process.argv[1] = argv1; vi.restoreAllMocks(); process.exitCode = 0; });

test("a database error prints its name and code, never the driver's message", () => {
  const err = Object.assign(new Error('duplicate key value violates unique constraint; Key (x)=(Jane Doe)'), { name: "PostgresError", code: "23505" });
  assert.match(failureText(err), /database error 23505/);
  assert.doesNotMatch(failureText(err), /Jane|duplicate/);
  assert.match(failureText(Object.assign(new Error("boom"), { code: "ECONNREFUSED" })), /ECONNREFUSED boom/);
});

test("runCli: a refusal exits 2, a failure exits 1", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await runCli(async () => { throw new ImportRefusal("no"); });
  assert.equal(process.exitCode, 2);
  await runCli(async () => { throw new Error("x"); });
  assert.equal(process.exitCode, 1);
});

test("runIfMain runs when started through a symlink, and not when argv[1] is another file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rim-"));
  const real = join(dir, "cli.js");
  writeFileSync(real, "");
  const link = join(dir, "link.js");
  symlinkSync(real, link);
  const main = vi.fn(async () => 0);
  process.argv[1] = link;
  await runIfMain(pathToFileURL(real).href, main);
  assert.equal(main.mock.calls.length, 1);
  process.argv[1] = join(dir, "other.js");
  await runIfMain(pathToFileURL(real).href, main);
  assert.equal(main.mock.calls.length, 1);
});
