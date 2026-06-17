import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Force the local-disk fallback regardless of the caller's environment.
// storage.service.js reads process.env.RX_GCS_BUCKET at call time (not at
// import time), so clearing it here before the first test is sufficient.
// Without this, tests flap when RX_GCS_BUCKET is set in the shell env.
delete process.env.RX_GCS_BUCKET;

import { uploadCaseFile } from "./storage.service.js";

// Resolve paths relative to this test file, not process.cwd(), so cleanup
// works regardless of where `node --test` is invoked from.
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_FILES_BASE = join(__dirname, "..", "..", ".localfiles");

test("dev fallback writes the buffer locally and returns a file URL + size", async () => {
  const buf = Buffer.from("hello scan");
  const res = await uploadCaseFile({ caseId: "case-test", kind: "scan", buffer: buf, originalName: "u p/loaded.stl", contentType: "model/stl" });
  assert.equal(res.size, buf.length);
  assert.ok(res.gcsUrl.startsWith("file://"));
  const path = res.gcsUrl.replace("file://", "");
  assert.equal(readFileSync(path).toString(), "hello scan");
  rmSync(join(LOCAL_FILES_BASE, "rx-cases", "case-test"), { recursive: true, force: true });
});

test("rejects a non-buffer", async () => {
  await assert.rejects(() => uploadCaseFile({ caseId: "c", kind: "scan", buffer: "nope", originalName: "x" }));
});

// Approach taken: sanitizer *neutralizes* `..` (replaces with `__`) rather than
// rejecting outright, so the upload succeeds but the written path is guaranteed
// to stay under .localfiles.  The defense-in-depth startsWith check catches any
// sanitizer gap and would throw if triggered.
test("neutralizes path-traversal in caseId — written path stays under .localfiles", async () => {
  const res = await uploadCaseFile({ caseId: "../../etc", kind: "scan", buffer: Buffer.from("x"), originalName: "a.stl" });
  assert.ok(res.gcsUrl.startsWith("file://"));
  const writtenPath = res.gcsUrl.replace("file://", "");
  assert.ok(
    writtenPath.startsWith(LOCAL_FILES_BASE),
    `path must stay under .localfiles — got: ${writtenPath}`
  );
  // Cleanup: sanitized caseId "../../etc" → "____etc"
  rmSync(join(LOCAL_FILES_BASE, "rx-cases", "____etc"), { recursive: true, force: true });
});
