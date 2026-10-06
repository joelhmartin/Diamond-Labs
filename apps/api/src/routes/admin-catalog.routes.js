import { eq } from "drizzle-orm";
import {
  ERROR_CODES, familyCreateSchema, familyUpdateSchema, optionCreateSchema, optionValueCreateSchema,
  optionRenameSchema, optionValueRenameSchema, variantUpdateSchema, familyMergeSchema, clientPriceUpsertSchema, clientPriceReviewSchema,
} from "@my-app/shared";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import { db } from "../config/database.js";
import { users, productVariants } from "../db/schema/index.js";
import * as catalog from "../services/catalog.service.js";
import * as clientPricesService from "../services/client-prices.service.js";
import * as auditService from "../services/audit.service.js";

const STATUS = { NOT_FOUND: 404, CONFLICT: 409, INVALID: 422 };

export function catalogErrorReply(err) {
  if (!(err instanceof catalog.CatalogError)) return null;
  const status = STATUS[err.code] ?? 422;
  const base = status === 404 ? ERROR_CODES.NOT_FOUND : ERROR_CODES.VALIDATION_ERROR;
  return { status, body: { error: { ...base, message: err.message } } };
}

export default async function adminCatalogRoutes(fastify) {
  const admin = { preHandler: [authenticate, requireAdmin] };
  const withBody = (schema) => ({ preHandler: [authenticate, requireAdmin, validate(schema)] });

  // Run a catalog operation; map CatalogError to a reply, rethrow the rest.
  async function run(reply, fn, status = 200) {
    try {
      const family = await fn();
      return reply.code(status).send({ data: { family } });
    } catch (err) {
      const r = catalogErrorReply(err);
      if (r) return reply.code(r.status).send(r.body);
      throw err;
    }
  }

  fastify.get("/admin/catalog/families", admin, async () => ({
    data: { families: await catalog.listFamilies() },
  }));
  fastify.get("/admin/catalog/families/:id", admin, (req, reply) =>
    run(reply, () => catalog.getFamily(req.params.id)));
  fastify.post("/admin/catalog/families", withBody(familyCreateSchema), (req, reply) =>
    run(reply, () => catalog.createFamily(req.body), 201));
  fastify.patch("/admin/catalog/families/:id", withBody(familyUpdateSchema), (req, reply) =>
    run(reply, () => catalog.updateFamily(req.params.id, req.body)));
  fastify.post("/admin/catalog/families/:id/options", withBody(optionCreateSchema), (req, reply) =>
    run(reply, () => catalog.addOption(req.params.id, req.body)));
  fastify.post("/admin/catalog/options/:id/values", withBody(optionValueCreateSchema), (req, reply) =>
    run(reply, () => catalog.addOptionValue(req.params.id, req.body.value)));
  fastify.patch("/admin/catalog/options/:id", withBody(optionRenameSchema), (req, reply) =>
    run(reply, () => catalog.renameOption(req.params.id, req.body.name)));
  fastify.patch("/admin/catalog/option-values/:id", withBody(optionValueRenameSchema), (req, reply) =>
    run(reply, () => catalog.renameOptionValue(req.params.id, req.body.value)));
  fastify.delete("/admin/catalog/option-values/:id", admin, (req, reply) =>
    run(reply, () => catalog.deleteOptionValue(req.params.id)));
  fastify.patch("/admin/catalog/variants/:id", withBody(variantUpdateSchema), (req, reply) =>
    run(reply, () => catalog.updateVariant(req.params.id, req.body)));
  fastify.delete("/admin/catalog/variants/:id", admin, (req, reply) =>
    run(reply, () => catalog.deleteVariant(req.params.id)));
  fastify.post("/admin/catalog/families/:id/merge", withBody(familyMergeSchema), (req, reply) =>
    run(reply, () => catalog.mergeSingleVariantFamily({ targetFamilyId: req.params.id, ...req.body })));

  async function requireClient(userId, reply) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!u) {
      reply.code(404).send({ error: ERROR_CODES.USER_NOT_FOUND });
      return false;
    }
    return true;
  }

  fastify.get("/admin/clients/:userId/prices", admin, async (req, reply) => {
    if (!(await requireClient(req.params.userId, reply))) return reply;
    return { data: { prices: await clientPricesService.listForClient(req.params.userId) } };
  });

  fastify.put("/admin/clients/:userId/prices/:variantId", withBody(clientPriceUpsertSchema), async (req, reply) => {
    const { userId, variantId } = req.params;
    if (!(await requireClient(userId, reply))) return reply;
    const [v] = await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.id, variantId));
    if (!v) return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Variant not found." } });
    await clientPricesService.upsertManual({
      clientUserId: userId, variantId, priceCents: req.body.priceCents, note: req.body.note ?? null, adminId: req.user.id,
    });
    auditService.logSafe({
      userId: req.user.id, action: "client_price.set", targetType: "user", targetId: userId,
      metadata: { variantId, priceCents: req.body.priceCents },
    });
    return { data: { prices: await clientPricesService.listForClient(userId) } };
  });

  fastify.delete("/admin/clients/:userId/prices/:variantId", admin, async (req, reply) => {
    const { userId, variantId } = req.params;
    const removed = await clientPricesService.removePrice(userId, variantId);
    if (!removed) return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "No price to remove." } });
    auditService.logSafe({
      userId: req.user.id, action: "client_price.remove", targetType: "user", targetId: userId, metadata: { variantId },
    });
    return { data: { prices: await clientPricesService.listForClient(userId) } };
  });

  fastify.post("/admin/clients/:userId/prices/review", withBody(clientPriceReviewSchema), async (req) => {
    const reviewed = await clientPricesService.markReviewed({
      clientUserId: req.params.userId, variantIds: req.body.variantIds, adminId: req.user.id,
    });
    auditService.logSafe({
      userId: req.user.id, action: "client_price.review", targetType: "user", targetId: req.params.userId,
      metadata: { variantIds: req.body.variantIds, reviewed },
    });
    return { data: { reviewed } };
  });
}
