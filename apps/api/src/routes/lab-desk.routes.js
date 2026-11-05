import {
  labOrderCreateSchema, labLineEditSchema, labPricePreviewSchema, labOrderMergeSchema,
  adjustmentReasonCreateSchema, adjustmentReasonUpdateSchema, adjustmentReasonListQuerySchema, labMaterialsPutSchema, materialSuggestionsQuerySchema,
} from "@my-app/shared";
import { db } from "../config/database.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validate, validateQuery } from "../middleware/validate.js";
import { barcodeLookupRoutes } from "../modules/barcode-lookup/index.js";
import { recordFileRoutes } from "../modules/record-files/index.js";
import { recordTagRoutes, tagErrorReply } from "../modules/record-tags/index.js";
import { intakeRoutes } from "../modules/upload-intake/index.js";
import { workflowErrorReply } from "../modules/workflows/routes.js";
import { labLookups } from "../services/lab/lab-lookups.js";
import {
  CLIENT_REP_RECORD_TYPE, LAB_ORDER_RECORD_TYPE, clientIdsThatExist, labOrderIdsThatExist, onLabOrderTagsChanged,
} from "../services/lab/lab-tags.js";
import { INTAKE_RECORD_TYPE, intakeIdsThatExistForFiles, notifyIntakesCreated, withDroppedBy } from "../services/lab/lab-intake.js";
import { listFamilies } from "../services/catalog.service.js";
import * as staffOrders from "../services/lab/staff-orders.service.js";
import { changeLines } from "../services/lab/lab-order-lines.service.js";
import { mergeOrders } from "../services/lab/merge.service.js";
import { replaceLineMaterials, materialSuggestions } from "../services/lab/materials.service.js";
import { listReasons, createReason, updateReason } from "../services/billing/adjustment-reasons.service.js";
import { invoiceErrorReply } from "../services/billing/invoice-errors.js";
import { STAFF } from "./lab.routes.js";
import { run, audit, labRouteErrorReply } from "./lab-route-helpers.js";

/**
 * The lab's production-desk glue: where the generic modules (scan lookup,
 * tags, files, ...) meet lab records, plus staff order entry and line edits.
 * Lab staff and admins only (same guard as every lab route).
 */

/**
 * Staff entry and line edits touch the order, its schedule (due date + stage plan), its draft
 * invoice and its labels: each refusal maps to its reply. The due-date dry run for the New order
 * page is piece 7's GET /lab/schedule/preview (lab-scheduling.routes.js), not a route here.
 */
const deskErrorReply = (err) => labRouteErrorReply(err) ?? workflowErrorReply(err) ?? invoiceErrorReply(err) ?? tagErrorReply(err);

const ADMIN = [authenticate, requireAdmin];

export default async function labDeskRoutes(fastify) {
  await fastify.register(barcodeLookupRoutes, { registry: labLookups, path: "/lab/lookup", guard: STAFF });

  // /files/lab_order/:id[/...]: issuing a signed link is audit-logged (ids only).
  await fastify.register(recordFileRoutes, {
    recordTypes: {
      [LAB_ORDER_RECORD_TYPE]: { exists: (ids) => labOrderIdsThatExist(ids) },
      [INTAKE_RECORD_TYPE]: { exists: (ids) => intakeIdsThatExistForFiles(ids) }, // a dropped scan, until it becomes an order
    },
    staffGuard: STAFF,
    onRead: (request, file) => {
      const isIntake = file.recordType === INTAKE_RECORD_TYPE;
      audit(request, isIntake ? "intake.file_url_issued" : "lab_order.file_url_issued", file.recordId, { fileId: file.id }, isIntake ? "intake" : "lab_order");
    },
  });

  // /lab/intake (under /lab with the other desk routes, like the scan lookup): scanner-export drops waiting to become orders.
  await fastify.register(intakeRoutes, {
    path: "/lab/intake",
    staffGuard: STAFF,
    enrich: (rows) => withDroppedBy(rows),
    onCreated: async (request, intakes) => {
      await notifyIntakesCreated(intakes);
      for (const i of intakes) audit(request, "intake.created", i.id, { fileCount: i.files.length, channel: i.channel }, "intake");
    },
    onDiscarded: (request, id) => audit(request, "intake.discarded", id, {}, "intake"),
  });

  // /tags/lab_order/... (staff) and /admin/tags/lab_order/... (admin). Labels never bump the order's version.
  // /tags/client_rep/...: a client's sales rep (Sales By Rep); admins define the reps.
  await fastify.register(recordTagRoutes, {
    recordTypes: { [LAB_ORDER_RECORD_TYPE]: { exists: (ids) => labOrderIdsThatExist(ids), onChange: onLabOrderTagsChanged },
      [CLIENT_REP_RECORD_TYPE]: { exists: (ids) => clientIdsThatExist(ids) } },
    staffGuard: STAFF,
    adminGuard: [authenticate, requireAdmin],
    audit: (request, action, targetId, metadata) => audit(request, action, targetId, metadata, "tag_definition"),
  });

  fastify.post("/lab/orders", { preHandler: [...STAFF, validate(labOrderCreateSchema)] }, (request, reply) =>
    run(reply, async () => {
      const out = await staffOrders.createStaffOrder({ input: request.body, byUserId: request.user.id });
      audit(request, "lab_order.created_by_staff", out.labOrder.id, {
        orderNumber: out.labOrder.orderNumber, invoiceId: out.invoice.id, lineCount: request.body.lines.length,
        tagCount: request.body.tagIds.length, intakeId: request.body.intakeId ?? null,
      });
      return out;
    }, 201, deskErrorReply));

  // Order-entry lookups, readable by lab staff (the admin lists they replace are admin-only).
  fastify.get("/lab/practices", { preHandler: STAFF }, async (request) => ({
    data: { practices: await staffOrders.searchPractices({ q: request.query?.q }) },
  }));

  // Every active family with its active variants (rx-channel and unpriced ones included: the lab keys what is on the bench).
  fastify.get("/lab/catalog/families", { preHandler: STAFF }, async () => {
    const families = await listFamilies();
    return {
      data: {
        families: families.filter((f) => f.active !== false).map((f) => ({
          id: f.id, name: f.name,
          variants: f.variants.filter((v) => v.active !== false).map((v) => ({ id: v.id, code: v.code, name: v.name })),
        })),
      },
    };
  });

  fastify.post("/lab/orders/price-preview", { preHandler: [...STAFF, validate(labPricePreviewSchema)] }, (request, reply) =>
    run(reply, async () => ({ lines: await staffOrders.previewPrices(request.body) }), 200, deskErrorReply));

  // The remake/discount pick-list. Lab staff read the active ones; admins manage the list.
  fastify.get("/lab/adjustment-reasons", { preHandler: [...STAFF, validateQuery(adjustmentReasonListQuerySchema)] }, async (request) => ({
    data: { reasons: await listReasons({ appliesTo: request.query.appliesTo }) },
  }));
  fastify.get("/admin/lab/adjustment-reasons", { preHandler: ADMIN }, async () => ({
    data: { reasons: await listReasons({ includeInactive: true }) },
  }));
  fastify.post("/admin/lab/adjustment-reasons", { preHandler: [...ADMIN, validate(adjustmentReasonCreateSchema)] }, (request, reply) =>
    run(reply, async () => {
      const reason = await createReason(request.body);
      audit(request, "adjustment_reason.created", reason.id, { appliesTo: reason.appliesTo }, "adjustment_reason");
      return { reason };
    }, 201, deskErrorReply));
  fastify.patch("/admin/lab/adjustment-reasons/:id", { preHandler: [...ADMIN, validate(adjustmentReasonUpdateSchema)] }, (request, reply) =>
    run(reply, async () => {
      const reason = await updateReason(request.params.id, request.body);
      audit(request, "adjustment_reason.updated", reason.id, { fields: Object.keys(request.body) }, "adjustment_reason");
      return { reason };
    }, 200, deskErrorReply));

  // Materials and lots per bench line (names of products, not people; fine on a shipped order).
  fastify.put("/lab/orders/:id/lines/:lineId/materials", { preHandler: [...STAFF, validate(labMaterialsPutSchema)] }, (request, reply) =>
    run(reply, async () => {
      const materials = await replaceLineMaterials(request.params.id, request.params.lineId, { materials: request.body.materials, byUserId: request.user.id });
      audit(request, "lab_order.materials_changed", request.params.id, { lineId: request.params.lineId, count: materials.length });
      return { materials };
    }, 200, deskErrorReply));
  fastify.get("/lab/materials/suggestions", { preHandler: [...STAFF, validateQuery(materialSuggestionsQuerySchema)] }, async (request) => ({
    data: { suggestions: await materialSuggestions(request.query.q) },
  }));

  // Merge 2–5 open orders for one practice and patient into a chosen primary (merge.service.js).
  fastify.post("/lab/orders/merge", { preHandler: [...STAFF, validate(labOrderMergeSchema)] }, (request, reply) =>
    run(reply, async () => {
      const out = await mergeOrders({ ...request.body, byUserId: request.user.id });
      audit(request, "lab_order.merged", out.primary.id, { primaryId: out.primary.id, mergedIds: out.merged.map((o) => o.id) });
      return out;
    }, 200, deskErrorReply));

  fastify.post("/lab/orders/:id/lines", { preHandler: [...STAFF, validate(labLineEditSchema)] }, (request, reply) =>
    run(reply, async () => {
      const { expectedVersion, ...edit } = request.body;
      const { order, changed } = await changeLines(request.params.id, { edit, expectedVersion, byUserId: request.user.id });
      if (changed) {
        audit(request, "lab_order.lines_changed", order.id, { op: edit.op, lineId: edit.lineId ?? null, qty: edit.qty ?? null, version: order.version });
      }
      return { id: order.id, version: order.version };
    }, 200, deskErrorReply));
}
