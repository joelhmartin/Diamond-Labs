import { labOrderCreateSchema, labLineEditSchema, labPricePreviewSchema } from "@my-app/shared";
import { db } from "../config/database.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import { barcodeLookupRoutes } from "../modules/barcode-lookup/index.js";
import { recordFileRoutes } from "../modules/record-files/index.js";
import { recordTagRoutes, tagErrorReply } from "../modules/record-tags/index.js";
import { labLookups } from "../services/lab/lab-lookups.js";
import { LAB_ORDER_RECORD_TYPE, labOrderIdsThatExist, onLabOrderTagsChanged } from "../services/lab/lab-tags.js";
import { defaultDueAt } from "../services/lab/lab-scheduling.js";
import { listFamilies } from "../services/catalog.service.js";
import * as staffOrders from "../services/lab/staff-orders.service.js";
import { changeLines } from "../services/lab/lab-order-lines.service.js";
import { invoiceErrorReply } from "../services/billing/invoice-errors.js";
import { STAFF } from "./lab.routes.js";
import { run, audit, labRouteErrorReply } from "./lab-route-helpers.js";

/**
 * The lab's production-desk glue: where the generic modules (scan lookup,
 * tags, files, ...) meet lab records, plus staff order entry and line edits.
 * Lab staff and admins only (same guard as every lab route).
 */

/** Staff entry and line edits touch the order, its draft invoice and its labels: each refusal maps to its reply. */
const deskErrorReply = (err) => labRouteErrorReply(err) ?? invoiceErrorReply(err) ?? tagErrorReply(err);

export default async function labDeskRoutes(fastify) {
  await fastify.register(barcodeLookupRoutes, { registry: labLookups, path: "/lab/lookup", guard: STAFF });

  // /files/lab_order/:id[/...]: issuing a signed link is audit-logged (ids only).
  await fastify.register(recordFileRoutes, {
    recordTypes: { [LAB_ORDER_RECORD_TYPE]: { exists: (ids) => labOrderIdsThatExist(ids) } },
    staffGuard: STAFF,
    onRead: (request, file) => audit(request, "lab_order.file_url_issued", file.recordId, { fileId: file.id }),
  });

  // /tags/lab_order/... (staff) and /admin/tags/lab_order/... (admin). Labels never bump the order's version.
  await fastify.register(recordTagRoutes, {
    recordTypes: { [LAB_ORDER_RECORD_TYPE]: { exists: (ids) => labOrderIdsThatExist(ids), onChange: onLabOrderTagsChanged } },
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

  fastify.get("/lab/orders/default-due", { preHandler: STAFF }, async () => {
    const { dueDate } = await defaultDueAt(db, {});
    return { data: { dueDate } };
  });

  fastify.post("/lab/orders/price-preview", { preHandler: [...STAFF, validate(labPricePreviewSchema)] }, (request, reply) =>
    run(reply, async () => ({ lines: await staffOrders.previewPrices(request.body) }), 200, deskErrorReply));

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
