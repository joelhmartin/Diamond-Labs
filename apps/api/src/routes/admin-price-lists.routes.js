import {
  priceListCreateSchema, priceListUpdateSchema, priceListItemSchema, priceListItemsBulkSchema,
  clientPriceListsSchema, priceListAssignSchema, priceCopyPreviewSchema, priceCopySchema,
} from "@my-app/shared";
import { validate } from "../middleware/validate.js";
import { ADMIN } from "./admin-invoice.routes.js";
import * as priceLists from "../services/price-lists.service.js";
import * as priceCopy from "../services/price-copy.service.js";

/** Price lists (piece 10). Admin-only: the lab role sees no money. Writes are audited in the service. */
export default async function adminPriceListsRoutes(fastify) {
  const withBody = (schema) => ({ preHandler: [...ADMIN, validate(schema)] });

  async function run(reply, fn, status = 200) {
    try {
      return reply.code(status).send({ data: await fn() });
    } catch (err) {
      const r = priceLists.priceListErrorReply(err) ?? priceCopy.priceCopyErrorReply(err);
      if (r) return reply.code(r.status).send(r.body);
      throw err;
    }
  }

  fastify.get("/admin/price-lists", { preHandler: ADMIN }, (req, reply) => run(reply, () =>
    priceLists.listPriceLists({ includeArchived: ["1", "true"].includes(req.query?.includeArchived) })));

  fastify.post("/admin/price-lists", withBody(priceListCreateSchema), (req, reply) => run(reply, () =>
    priceLists.createPriceList({ ...req.body, byUserId: req.user.id }), 201));

  fastify.patch("/admin/price-lists/:id", withBody(priceListUpdateSchema), (req, reply) => run(reply, () =>
    priceLists.updatePriceList(req.params.id, req.body, req.user.id)));

  fastify.get("/admin/price-lists/:id/items", { preHandler: ADMIN }, (req, reply) => run(reply, () =>
    priceLists.listItems(req.params.id)));

  fastify.get("/admin/price-lists/:id/clients", { preHandler: ADMIN }, (req, reply) => run(reply, () =>
    priceLists.listClients(req.params.id)));

  fastify.put("/admin/price-lists/:id/items/:variantId", withBody(priceListItemSchema), (req, reply) => run(reply, async () => {
    await priceLists.setItem(req.params.id, req.params.variantId, req.body.priceCents, req.user.id);
    return { variantId: req.params.variantId, priceCents: req.body.priceCents };
  }));

  fastify.delete("/admin/price-lists/:id/items/:variantId", { preHandler: ADMIN }, (req, reply) => run(reply, async () => {
    await priceLists.removeItem(req.params.id, req.params.variantId, req.user.id);
    return { variantId: req.params.variantId, removed: true };
  }));

  fastify.post("/admin/price-lists/:id/items/bulk", withBody(priceListItemsBulkSchema), (req, reply) => run(reply, () =>
    priceLists.setItems(req.params.id, req.body.items, req.user.id)));

  fastify.get("/admin/clients/:userId/price-lists", { preHandler: ADMIN }, (req, reply) => run(reply, () =>
    priceLists.clientLists(req.params.userId)));

  fastify.put("/admin/clients/:userId/price-lists", withBody(clientPriceListsSchema), (req, reply) => run(reply, async () => {
    await priceLists.setClientLists(req.params.userId, req.body.listIds, req.user.id);
    return priceLists.clientLists(req.params.userId);
  }));

  // The Users-table bulk action: { ok, failed } (non-clients land in failed).
  fastify.post("/admin/price-lists/assign", withBody(priceListAssignSchema), (req, reply) => run(reply, () =>
    priceLists.assignListToClients({ ...req.body, byUserId: req.user.id })));

  // Copy prices client -> clients. Preview writes nothing; apply recomputes and 409s on a stale previewHash.
  fastify.post("/admin/prices/copy/preview", withBody(priceCopyPreviewSchema), (req, reply) => run(reply, () =>
    priceCopy.previewCopy(req.body)));

  fastify.post("/admin/prices/copy", withBody(priceCopySchema), (req, reply) => run(reply, () =>
    priceCopy.applyCopy({ ...req.body, byUserId: req.user.id })));
}
