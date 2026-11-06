import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handlerSource } from "./_source.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const desk = read("../lab-desk.routes.js");

const NEW_ROUTES = [
  'fastify.post("/lab/orders",',
  'fastify.post("/lab/orders/price-preview",',
  'fastify.post("/lab/orders/:id/lines",',
  'fastify.post("/lab/orders/merge",',
  'fastify.get("/lab/practices",',
  'fastify.get("/lab/catalog/families",',
];

test("every new route is STAFF", () => {
  for (const marker of NEW_ROUTES) assert.match(handlerSource(desk, marker), /preHandler: (\[\.\.\.)?STAFF/, marker);
  assert.match(desk, /import \{ STAFF \} from "\.\/lab\.routes\.js"/);
});

test("writes validate their body with the shared schemas and are audited with ids and counts only", () => {
  const create = handlerSource(desk, 'fastify.post("/lab/orders",');
  assert.match(create, /validate\(labOrderCreateSchema\)/);
  assert.match(create, /audit\(request, "lab_order\.created_by_staff"/);
  assert.doesNotMatch(create, /patientName[^)]*\}\s*\)/, "the patient never reaches audit metadata");
  const lines = handlerSource(desk, 'fastify.post("/lab/orders/:id/lines",');
  assert.match(lines, /validate\(labLineEditSchema\)/);
  assert.match(lines, /audit\(request, "lab_order\.lines_changed"/);
  assert.match(handlerSource(desk, 'fastify.post("/lab/orders/price-preview",'), /validate\(labPricePreviewSchema\)/);
});

test("merge validates with the shared schema and audits lab_order.merged with ids only", () => {
  const merge = handlerSource(desk, 'fastify.post("/lab/orders/merge",');
  assert.match(merge, /validate\(labOrderMergeSchema\)/);
  assert.match(merge, /audit\(request, "lab_order\.merged", out\.primary\.id, \{ primaryId: out\.primary\.id, mergedIds: out\.merged\.map\(\(o\) => o\.id\) \}\)/);
  assert.match(merge, /deskErrorReply/);
});

test("one due-date read path: the New order page uses piece 7's preview, the desk has no default-due route", () => {
  assert.doesNotMatch(desk, /default-due/);
});

test("a scheduling refusal during staff entry is a reply, never a 500", () => {
  assert.match(desk, /deskErrorReply = \(err\) => labRouteErrorReply\(err\) \?\? workflowErrorReply\(err\)/);
});

test("invoice and tag refusals map to replies (an issued draft is a 422, never a 500)", () => {
  assert.match(desk, /invoiceErrorReply/);
  assert.match(desk, /tagErrorReply/);
});

test("files and tags are mounted for lab orders behind the lab guards", () => {
  assert.match(desk, /fastify\.register\(recordFileRoutes, \{\s*recordTypes: \{\s*\[LAB_ORDER_RECORD_TYPE\]/);
  assert.match(desk, /fastify\.register\(recordTagRoutes, \{\s*recordTypes: \{ \[LAB_ORDER_RECORD_TYPE\]/);
  assert.match(read("../../services/lab/lab-tags.js"), /export const LAB_ORDER_RECORD_TYPE = "lab_order";/);
  assert.match(desk, /staffGuard: STAFF/);
  assert.match(desk, /adminGuard: \[authenticate, requireAdmin\]/);
  // Sales reps drive an admin money report: only admins assign them (staff still read them).
  assert.match(desk, /\[CLIENT_REP_RECORD_TYPE\]: \{ exists: \(ids\) => clientIdsThatExist\(ids\), applyGuard: requireAdmin \}/);
  assert.match(desk, /onRead: /);
  assert.match(desk, /lab_order\.file_url_issued/);
});

test("scanner intakes are mounted under /lab/intake behind the lab guards, and their files are a record type", () => {
  assert.match(desk, /fastify\.register\(intakeRoutes, \{\s*path: "\/lab\/intake",\s*staffGuard: STAFF/);
  assert.match(desk, /\[INTAKE_RECORD_TYPE\]: \{ exists:/);
  assert.match(desk, /notifyIntakesCreated/);
  assert.match(read("../../services/lab/lab-intake.js"), /event: "intake\.created", recordType: INTAKE_RECORD_TYPE, recordId: i\.id, audience: "staff", data: \{\}/);
});

test("the practice lookup returns id, name and email only", () => {
  const svc = read("../../services/lab/staff-orders.service.js");
  const fn = svc.slice(svc.indexOf("export async function searchPractices"));
  assert.match(fn, /select\(\{ id: users\.id, name: users\.name, email: users\.email \}\)/);
  assert.match(fn, /\.limit\(/);
});
