import { eq, and, ne, asc, desc, sql } from "drizzle-orm";
import { db } from "../config/database.js";
import { users, accounts, memberships, products } from "../db/schema/index.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import * as authService from "../services/auth.service.js";
import * as emailService from "../services/email.service.js";
import * as seazonaService from "../services/seazona.service.js";
import { syncSeazonaProducts, EmptyRemoteError } from "../db/sync-seazona-products.js";
import { env } from "../config/env.js";
import { ERROR_CODES } from "@my-app/shared";

export default async function adminRoutes(fastify) {
  // ──────────────────────────────────────────────────────────────
  // USERS
  // ──────────────────────────────────────────────────────────────

  // List every user in the system with their primary account + linkage flags.
  fastify.get("/admin/users", {
    preHandler: [authenticate, requireAdmin],
  }, async () => {
    // Fetch all users
    const userRows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        approvalStatus: users.approvalStatus,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        seazonaClientId: users.seazonaClientId,
        seazonaAccountNumber: users.seazonaAccountNumber,
        hasPassword: sql`(${users.passwordHash} IS NOT NULL)`,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    // Fetch each user's primary (first) account
    const primary = new Map();
    const memberRows = await db
      .select({
        userId: memberships.userId,
        accountId: memberships.accountId,
        role: memberships.role,
        accountName: accounts.name,
        accountSlug: accounts.slug,
      })
      .from(memberships)
      .innerJoin(accounts, eq(memberships.accountId, accounts.id))
      .where(eq(memberships.status, "active"));

    for (const m of memberRows) {
      if (!primary.has(m.userId)) {
        primary.set(m.userId, {
          accountId: m.accountId,
          name: m.accountName,
          slug: m.accountSlug,
          role: m.role,
        });
      }
    }

    const enriched = userRows.map((u) => ({
      ...u,
      account: primary.get(u.id) || null,
    }));

    return {
      data: {
        users: enriched,
        summary: {
          total: enriched.length,
          admins:  enriched.filter((u) => u.role === "admin").length,
          doctors: enriched.filter((u) => u.role === "doctor").length,
          users:   enriched.filter((u) => u.role === "user").length,
          seazonaLinked: enriched.filter((u) => u.seazonaClientId).length,
          neverLoggedIn: enriched.filter((u) => !u.lastLoginAt).length,
          passwordlessCount: enriched.filter((u) => !u.hasPassword).length,
        },
      },
    };
  });

  // Trigger a password reset email for a specific user.
  fastify.post("/admin/users/:id/send-password-reset", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, request.params.id))
      .limit(1);
    if (!user) return reply.code(404).send({ error: ERROR_CODES.USER_NOT_FOUND });

    const { token } = await authService.forgotPassword(user.email);
    if (token) {
      const resetUrl = `${env.APP_URL}/auth/reset-password?token=${token}`;
      await emailService.sendPasswordReset({ email: user.email, resetUrl });
      fastify.log.info({ userId: user.id }, "admin sent password reset");
    }
    return { data: { sent: true } };
  });

  // Trigger a portal-activation invitation for a user (same token mechanism).
  fastify.post("/admin/users/:id/send-invitation", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, request.params.id))
      .limit(1);
    if (!user) return reply.code(404).send({ error: ERROR_CODES.USER_NOT_FOUND });

    const { token } = await authService.forgotPassword(user.email);
    if (token) {
      const activateUrl = `${env.APP_URL}/auth/reset-password?token=${token}`;
      await emailService.sendPortalInvitation({
        email: user.email,
        name: user.name,
        activateUrl,
      });
      fastify.log.info({ userId: user.id }, "admin sent portal invitation");
    }
    return { data: { sent: true } };
  });

  // Bulk action: send invitation or password reset to many users at once.
  fastify.post("/admin/users/bulk-email", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const { userIds, kind } = request.body || {};
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "userIds[] required." } });
    }
    if (!["invitation", "password-reset"].includes(kind)) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "kind must be 'invitation' or 'password-reset'." } });
    }

    const rows = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(
        sql`${users.id} IN (${sql.join(userIds.map((id) => sql`${id}`), sql`,`)})`
      );

    let sent = 0;
    for (const user of rows) {
      const { token } = await authService.forgotPassword(user.email);
      if (!token) continue;
      const url = `${env.APP_URL}/auth/reset-password?token=${token}`;
      if (kind === "invitation") {
        await emailService.sendPortalInvitation({ email: user.email, name: user.name, activateUrl: url });
      } else {
        await emailService.sendPasswordReset({ email: user.email, resetUrl: url });
      }
      sent++;
    }

    fastify.log.info({ kind, requested: userIds.length, sent }, "admin bulk email");
    return { data: { sent, requested: userIds.length } };
  });

  // ──────────────────────────────────────────────────────────────
  // ORDERS
  // ──────────────────────────────────────────────────────────────

  // All orders (Seazona workflow records, with status/department/assignedTo).
  fastify.get("/admin/orders", {
    preHandler: [authenticate, requireAdmin],
  }, async (request) => {
    const [orders, clientList] = await Promise.all([
      seazonaService.getOrders(request.query.ordered),
      seazonaService.listClients(),
    ]);
    const clients = {};
    for (const c of clientList) {
      if (c.id) clients[c.id] = c;
    }

    // Status counts for filter chips
    const statusCounts = {};
    const deptCounts = {};
    for (const o of orders) {
      const s = o.status || "Unknown";
      statusCounts[s] = (statusCounts[s] || 0) + 1;
      const d = o.department || "—";
      deptCounts[d] = (deptCounts[d] || 0) + 1;
    }

    return {
      data: {
        orders,
        clients,
        summary: {
          count: orders.length,
          statuses: statusCounts,
          departments: deptCounts,
        },
      },
    };
  });

  // Single order detail — includes products, files, settings, notes.
  fastify.get("/admin/orders/:id", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const order = await seazonaService.getOrder(request.params.id);
    if (!order) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });

    // Best-effort client enrichment
    let client = null;
    if (order.clientId) {
      client = await seazonaService.getClient(order.clientId).catch(() => null);
    }

    return { data: { order, client } };
  });

  // ──────────────────────────────────────────────────────────────
  // PRODUCTS (local Seazona mirror — see db/schema/products.js)
  // ──────────────────────────────────────────────────────────────

  // All rows from the products mirror — Seazona-authoritative + shop-local.
  fastify.get("/admin/products", {
    preHandler: [authenticate, requireAdmin],
  }, async () => {
    const rows = await db.select().from(products).orderBy(asc(products.name));

    const summary = {
      total: rows.length,
      purchasable: rows.filter((p) => p.purchasable).length,
      mapped: rows.filter((p) => p.catalogId).length,
      // Products an admin still needs to act on: shoppable but unlinked, OR
      // linked but not yet flagged shoppable.
      needsLinking: rows.filter(
        (p) => (p.purchasable && !p.catalogId) || (!p.purchasable && p.catalogId),
      ).length,
      lastSyncedAt: rows.reduce((max, p) => {
        if (!p.lastSyncedAt) return max;
        const t = new Date(p.lastSyncedAt).getTime();
        return t > max ? t : max;
      }, 0) || null,
    };

    return { data: { products: rows, summary } };
  });

  // Edit shop-local fields only. Seazona-authoritative fields (code/name/taxable/
  // price) are NEVER editable here — they come only from sync.
  fastify.patch("/admin/products/:seazonaProductId", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const { seazonaProductId } = request.params;
    const body = request.body || {};

    // Whitelist + type-validate. Any non-whitelisted key is silently ignored.
    const update = {};

    if ("purchasable" in body) {
      if (typeof body.purchasable !== "boolean") {
        return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "purchasable must be a boolean." } });
      }
      update.purchasable = body.purchasable;
    }

    if ("catalogId" in body) {
      if (body.catalogId !== null && typeof body.catalogId !== "string") {
        return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "catalogId must be a string or null." } });
      }
      const trimmed = typeof body.catalogId === "string" ? body.catalogId.trim() : body.catalogId;
      update.catalogId = trimmed ? trimmed : null;
    }

    for (const key of ["imageUrl", "description", "category"]) {
      if (key in body) {
        if (body[key] !== null && typeof body[key] !== "string") {
          return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: `${key} must be a string or null.` } });
        }
        const trimmed = typeof body[key] === "string" ? body[key].trim() : body[key];
        update[key] = trimmed ? trimmed : null;
      }
    }

    if (Object.keys(update).length === 0) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "No editable fields supplied." } });
    }

    // Enforce one product per catalogId at the app level. If another product is
    // already mapped to this catalogId, reject rather than silently stealing it.
    if (update.catalogId) {
      const [conflict] = await db
        .select({ seazonaProductId: products.seazonaProductId, name: products.name })
        .from(products)
        .where(and(eq(products.catalogId, update.catalogId), ne(products.seazonaProductId, seazonaProductId)))
        .limit(1);
      if (conflict) {
        return reply.code(409).send({
          error: {
            code: "CATALOG_ID_TAKEN",
            status: 409,
            message: `Catalog SKU "${update.catalogId}" is already mapped to "${conflict.name || conflict.seazonaProductId}". Unmap it there first.`,
          },
        });
      }
    }

    update.updatedAt = new Date();

    const [updated] = await db
      .update(products)
      .set(update)
      .where(eq(products.seazonaProductId, seazonaProductId))
      .returning();

    if (!updated) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });

    return { data: { product: updated } };
  });

  // Trigger a read-only Seazona→local sync. May take a few seconds (~391 upserts).
  fastify.post("/admin/products/sync", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    try {
      const { inserted, updated, total, skippedNoId, errors } =
        await syncSeazonaProducts(db, { dryRun: false });
      fastify.log.info({ inserted, updated, total, skippedNoId, errors: errors.length }, "admin product sync");
      return { data: { inserted, updated, total, skippedNoId, errors: errors.length } };
    } catch (err) {
      if (err instanceof EmptyRemoteError) {
        fastify.log.error({ err }, "admin product sync: empty remote guard tripped");
        return reply.code(502).send({
          error: { code: "SEAZONA_EMPTY_REMOTE", status: 502, message: err.message },
        });
      }
      throw err;
    }
  });
}
