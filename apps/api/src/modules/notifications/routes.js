import {
  notificationListQuerySchema, notificationReadSchema, notificationPreferenceSchema,
  notificationRecipientCreateSchema, notificationRecipientUpdateSchema, notificationDeliveryQuerySchema,
} from "@my-app/shared";
import { normalizePhone as defaultNormalizePhone } from "@my-app/shared";
import { maskAddress } from "./data-guard.js";
import { NotificationInputError } from "./util.js";

/**
 * The notifications HTTP surface (register under the app's API prefix).
 * Every collaborator is injected, so another app wires its own:
 * - notifier: createNotifier(...)
 * - authenticate: preHandler that sets request.user ({ id, ... })
 * - requireAdmin: preHandler for the host's admins (recipients, deliveries, channels)
 * - kindOf(user) → audience kind ("staff", "client", ...)
 * - channelStatus() → whatever the admin channel card shows (provider state)
 * - normalizePhone(input) → E.164 | null (default: the sms module's)
 * - db: passed to every notifier method (null: the notifier's own)
 */
export async function notificationRoutes(fastify, opts) {
  const {
    notifier, authenticate, requireAdmin, kindOf,
    channelStatus = () => ({}), normalizePhone = defaultNormalizePhone, db = null,
  } = opts ?? {};
  if (!notifier || !authenticate || !requireAdmin || !kindOf) throw new Error("notificationRoutes needs notifier, authenticate, requireAdmin and kindOf");
  const h = createHandlers({ notifier, kindOf, channelStatus, normalizePhone, db });
  const user = { preHandler: [authenticate] };
  const admin = { preHandler: [authenticate, requireAdmin] };

  fastify.get("/notifications", user, h.list);
  fastify.get("/notifications/unread-count", user, h.unreadCount);
  fastify.post("/notifications/read", user, h.markRead);
  fastify.post("/notifications/:id/unread", user, h.markUnread);
  fastify.delete("/notifications/:id", user, h.dismiss);
  fastify.get("/notifications/preferences", user, h.getPreferences);
  fastify.put("/notifications/preferences", user, h.setPreference);

  fastify.get("/admin/notifications/recipients", admin, h.listRecipients);
  fastify.post("/admin/notifications/recipients", admin, h.addRecipient);
  fastify.patch("/admin/notifications/recipients/:id", admin, h.updateRecipient);
  fastify.delete("/admin/notifications/recipients/:id", admin, h.removeRecipient);
  fastify.post("/admin/notifications/recipients/:id/test", admin, h.testRecipient);
  fastify.get("/admin/notifications/deliveries", admin, h.listDeliveries);
  fastify.get("/admin/notifications/channels", admin, h.channels);
  fastify.get("/admin/notifications/events", admin, h.listEvents);
}

const fail = (reply, status, code, message, details) =>
  reply.code(status).send({ error: { code, status, message, ...(details ? { details } : {}) } });

/** Parse with a zod schema, or answer 422 (the app's validation status). */
function parsed(schema, value, reply) {
  const r = schema.safeParse(value ?? {});
  if (r.success) return { ok: true, data: r.data };
  fail(reply, 422, "VALIDATION_ERROR", "Invalid request.", r.error.flatten().fieldErrors);
  return { ok: false };
}

/** A notifier input error → 400, or 409 for a duplicate recipient. Anything else is rethrown. */
function inputError(reply, err) {
  if (!(err instanceof NotificationInputError)) throw err;
  return err.code === "duplicate"
    ? fail(reply, 409, "DUPLICATE", err.message)
    : fail(reply, 400, err.code.toUpperCase(), err.message);
}

const masked = (r) => (r ? { ...r, address: maskAddress(r.address) } : r);

function createHandlers({ notifier, kindOf, channelStatus, normalizePhone, db }) {
  const me = (request) => ({ id: request.user.id, kind: kindOf(request.user) });

  return {
    async list(request, reply) {
      const q = parsed(notificationListQuerySchema, request.query, reply);
      if (!q.ok) return reply;
      const userId = request.user.id;
      const [rows, total] = await Promise.all([notifier.listForUser(db, userId, q.data), notifier.countForUser(db, userId, q.data)]);
      return { data: { rows, total } };
    },
    async unreadCount(request) {
      return { data: { count: await notifier.unreadCount(db, request.user.id) } };
    },
    async markRead(request, reply) {
      const b = parsed(notificationReadSchema, request.body, reply);
      if (!b.ok) return reply;
      return { data: { updated: await notifier.markRead(db, request.user.id, b.data) } };
    },
    async markUnread(request, reply) {
      const ok = await notifier.markUnread(db, request.user.id, request.params.id);
      if (!ok) return fail(reply, 409, "CONFLICT", "Not found, or a newer unread alert for the same thing already exists.");
      return { data: { ok: true } };
    },
    async dismiss(request, reply) {
      if (!(await notifier.dismiss(db, request.user.id, request.params.id))) return fail(reply, 404, "NOT_FOUND", "Notification not found.");
      return { data: { ok: true } };
    },
    async getPreferences(request) {
      return { data: await notifier.getPreferences(db, me(request)) };
    },
    async setPreference(request, reply) {
      const b = parsed(notificationPreferenceSchema, request.body, reply);
      if (!b.ok) return reply;
      try {
        await notifier.setPreference(db, me(request), b.data);
      } catch (err) {
        return inputError(reply, err);
      }
      return { data: { ok: true } };
    },

    async listRecipients(request) {
      const event = typeof request.query?.event === "string" && request.query.event ? request.query.event : undefined;
      return { data: (await notifier.recipients.list(db, { event })).map(masked) };
    },
    async addRecipient(request, reply) {
      const b = parsed(notificationRecipientCreateSchema, request.body, reply);
      if (!b.ok) return reply;
      const { event, channel, label } = b.data;
      let address = b.data.address;
      if (channel === "sms") {
        address = normalizePhone(address);
        if (!address) return fail(reply, 400, "INVALID_ADDRESS", "Use a 10-digit US number or +country format.");
      }
      try {
        const saved = await notifier.recipients.add(db, { event, channel, address, label, createdByUserId: request.user.id });
        return reply.code(201).send({ data: masked(saved) });
      } catch (err) {
        return inputError(reply, err);
      }
    },
    async updateRecipient(request, reply) {
      const b = parsed(notificationRecipientUpdateSchema, request.body, reply);
      if (!b.ok) return reply;
      const saved = await notifier.recipients.setActive(db, request.params.id, b.data.active);
      if (!saved) return fail(reply, 404, "NOT_FOUND", "Recipient not found.");
      return { data: masked(saved) };
    },
    async removeRecipient(request, reply) {
      if (!(await notifier.recipients.remove(db, request.params.id))) return fail(reply, 404, "NOT_FOUND", "Recipient not found.");
      return { data: { ok: true } };
    },
    async testRecipient(request, reply) {
      const r = await notifier.recipients.sendTest(db, request.params.id);
      if (r.error === "not_found") return fail(reply, 404, "NOT_FOUND", "Recipient not found.");
      return { data: r };
    },
    async listDeliveries(request, reply) {
      const q = parsed(notificationDeliveryQuerySchema, request.query, reply);
      if (!q.ok) return reply;
      return { data: await notifier.deliveries.list(db, q.data) };
    },
    async listEvents() {
      return { data: notifier.events.list() };
    },
    async channels() {
      return { data: await channelStatus() };
    },
  };
}
