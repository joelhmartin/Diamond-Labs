import { test, vi } from "vitest";
import assert from "node:assert/strict";

const logged = [];
vi.mock("../services/audit.service.js", () => ({ logSafe: (e) => logged.push(e) }));

const { appExports, auditExportDownload } = await import("./index.js");

test("the app registry offers the invoice source as csv", () => {
  assert.deepEqual(appExports.list().map((s) => [s.key, s.formats]), [["invoices", [{ key: "csv", label: "CSV", extension: "csv" }]]]);
});

test("a download is audited with ids, counts and params only", () => {
  auditExportDownload({
    actorId: "admin-1", sourceKey: "invoices", formatKey: "csv",
    params: { dateField: "issued", from: "2026-01-01", to: "2026-01-31" }, rowCount: 12,
  });
  assert.deepEqual(logged, [{
    userId: "admin-1", action: "export.downloaded", targetType: "export", targetId: "invoices",
    metadata: { format: "csv", params: { dateField: "issued", from: "2026-01-01", to: "2026-01-31" }, rowCount: 12 },
  }]);
});
