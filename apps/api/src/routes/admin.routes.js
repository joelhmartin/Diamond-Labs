import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../config/database.js";
import { users, accounts, memberships } from "../db/schema/index.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import * as authService from "../services/auth.service.js";
import * as emailService from "../services/email.service.js";
import * as seazonaService from "../services/seazona.service.js";
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
}
