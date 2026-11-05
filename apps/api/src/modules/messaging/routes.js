import {
  messageThreadListQuerySchema, messageThreadCreateSchema, messagePostSchema, messagePartyQuerySchema,
} from "@my-app/shared";
import { MessagingError } from "./rules.js";

const STATUS = { NOT_FOUND: 404, FORBIDDEN: 403, INVALID: 400 };

/**
 * The messaging HTTP surface (register under the app's API prefix). Every
 * collaborator is injected:
 * - messaging: createMessaging(...)
 * - authenticate: preHandler that sets request.user ({ id, ... })
 * - guard: optional preHandler (or list) run after authenticate on every route
 * - listParties(db, q) → [{ key, label }]: optional; registers GET /messages/parties (host only)
 * - db: passed to listParties (default: the service's db)
 */
export async function messagingRoutes(fastify, opts) {
  const { messaging, authenticate, guard = null, listParties = null, db = null } = opts ?? {};
  if (!messaging || !authenticate) throw new Error("messagingRoutes needs messaging and authenticate");
  const pre = { preHandler: [authenticate, ...(guard ? [].concat(guard) : [])] };
  const h = createHandlers({ messaging, listParties, db: db ?? messaging.db });

  fastify.get("/messages/threads", pre, h.list);
  fastify.get("/messages/unread-count", pre, h.unreadCount);
  fastify.post("/messages/threads", pre, h.create);
  fastify.get("/messages/threads/:id", pre, h.open);
  fastify.post("/messages/threads/:id/messages", pre, h.post);
  fastify.post("/messages/threads/:id/read", pre, h.flag((m, u, id) => m.setRead(u, id, true)));
  fastify.post("/messages/threads/:id/unread", pre, h.flag((m, u, id) => m.setRead(u, id, false)));
  fastify.post("/messages/threads/:id/complete", pre, h.flag((m, u, id) => m.complete(u, id)));
  fastify.post("/messages/threads/:id/reopen", pre, h.flag((m, u, id) => m.reopen(u, id)));
  fastify.post("/messages/threads/:id/archive", pre, h.flag((m, u, id) => m.archive(u, id, true)));
  fastify.post("/messages/threads/:id/unarchive", pre, h.flag((m, u, id) => m.archive(u, id, false)));
  if (listParties) fastify.get("/messages/parties", pre, h.parties);
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

/** Run a service call; a MessagingError becomes 404/403/400, anything else is rethrown. */
async function run(reply, fn) {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof MessagingError)) throw err;
    fail(reply, STATUS[err.code] ?? 400, err.code, err.message);
    return reply;
  }
}

function createHandlers({ messaging, listParties, db }) {
  return {
    async list(request, reply) {
      const q = parsed(messageThreadListQuerySchema, request.query, reply);
      if (!q.ok) return reply;
      return run(reply, async () => ({ data: await messaging.listThreads(request.user, q.data) }));
    },
    async unreadCount(request) {
      return { data: { count: await messaging.unreadCount(request.user) } };
    },
    async create(request, reply) {
      const b = parsed(messageThreadCreateSchema, request.body, reply);
      if (!b.ok) return reply;
      return run(reply, async () => reply.code(201).send({ data: await messaging.createThread(request.user, b.data) }));
    },
    async open(request, reply) {
      return run(reply, async () => ({ data: await messaging.getThread(request.user, request.params.id) }));
    },
    async post(request, reply) {
      const b = parsed(messagePostSchema, request.body, reply);
      if (!b.ok) return reply;
      return run(reply, async () => reply.code(201).send({ data: await messaging.post(request.user, request.params.id, b.data) }));
    },
    flag(fn) {
      return async (request, reply) => run(reply, async () => {
        await fn(messaging, request.user, request.params.id);
        return { data: { ok: true } };
      });
    },
    async parties(request, reply) {
      if (!messaging.isHost(request.user)) return fail(reply, 403, "FORBIDDEN", "Only the host picks a party.");
      const q = parsed(messagePartyQuerySchema, request.query, reply);
      if (!q.ok) return reply;
      return { data: await listParties(db, q.data.q ?? "") };
    },
  };
}
