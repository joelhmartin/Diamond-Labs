import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "fs";
import { uploadCaseFile } from "./storage.service.js";

test("dev fallback writes the buffer locally and returns a file URL + size", async () => {
  const buf = Buffer.from("hello scan");
  const res = await uploadCaseFile({ caseId: "case-test", kind: "scan", buffer: buf, originalName: "u p/loaded.stl", contentType: "model/stl" });
  assert.equal(res.size, buf.length);
  assert.ok(res.gcsUrl.startsWith("file://"));
  const path = res.gcsUrl.replace("file://", "");
  assert.equal(readFileSync(path).toString(), "hello scan");
  rmSync("apps/api/.localfiles/rx-cases/case-test", { recursive: true, force: true });
});
test("rejects a non-buffer", async () => {
  await assert.rejects(() => uploadCaseFile({ caseId: "c", kind: "scan", buffer: "nope", originalName: "x" }));
});
