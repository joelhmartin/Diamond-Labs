import { and, eq, inArray, sql } from "drizzle-orm";
import { PRICE_COPY_MAX_TARGETS } from "@my-app/shared";
import { db } from "../config/database.js";
import { users, clientPrices } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { planCopy, stateAfterPlan, effectiveAfterPlan, diffEffective, previewHash } from "../lib/price-copy.js";
import * as auditService from "./audit.service.js";
import { setClientLists } from "./price-lists.service.js";
import { loadClientPriceStates } from "./pricing.service.js";

// Copy prices from one client to many (spec R3). previewCopy and applyCopy share one
// computation (computeCopy); effective prices come from lib/pricing.js resolveClientPrices
// via lib/price-copy.js, never a second resolver. Audit metadata is ids, counts and mode only.

export class PriceCopyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const STATUS = { NOT_FOUND: 404, STALE: 409, INVALID: 422 };

/** PriceCopyError → HTTP reply ({ status, body }); anything else is not ours (null). */
export function priceCopyErrorReply(err) {
  if (!(err instanceof PriceCopyError)) return null;
  const status = STATUS[err.code] ?? 422;
  return { status, body: { error: { code: err.code, status, message: err.message } } };
}

const NOT_A_CLIENT = "Not a client";
const INSERT_CHUNK = 1000;

function assertRequest({ fromClientUserId, toClientUserIds, mode }) {
  if (!["replace", "merge"].includes(mode)) throw new PriceCopyError("INVALID", "Mode must be replace or merge.");
  if (!Array.isArray(toClientUserIds) || toClientUserIds.length === 0) throw new PriceCopyError("INVALID", "Choose at least one client to copy to.");
  if (toClientUserIds.length > PRICE_COPY_MAX_TARGETS) throw new PriceCopyError("INVALID", `Copy to at most ${PRICE_COPY_MAX_TARGETS} clients at a time.`);
  if (toClientUserIds.includes(fromClientUserId)) throw new PriceCopyError("INVALID", "A client cannot be copied onto itself.");
}

const listView = (listIds, lists) => listIds.map((id) => ({ listId: id, name: lists.get(id).name, archived: lists.get(id).archived }));

/** The plans, diffs and hash for a request. Throws on a bad request or a non-client source. */
async function computeCopy(tx, req) {
  assertRequest(req);
  const { fromClientUserId, mode } = req;
  const toIds = [...new Set(req.toClientUserIds)];
  const ids = [fromClientUserId, ...toIds];
  const found = await tx.select({ id: users.id, role: users.role }).from(users).where(inArray(users.id, ids));
  const clients = new Set(found.filter((u) => u.role === "doctor").map((u) => u.id));
  if (!clients.has(fromClientUserId)) throw new PriceCopyError("INVALID", "The source is not a client.");
  const targets = toIds.filter((id) => clients.has(id));
  const failed = toIds.filter((id) => !clients.has(id)).map((id) => ({ id, message: NOT_A_CLIENT }));
  if (targets.length === 0) return { targets: [], failed, previewHash: previewHash([]) };

  const { states, lists } = await loadClientPriceStates(tx, [fromClientUserId, ...targets]);
  const source = states.get(fromClientUserId);
  const planned = targets.map((clientUserId) => {
    const before = states.get(clientUserId);
    const plan = planCopy({ source, target: before, mode, listsById: lists });
    const after = stateAfterPlan(before, plan);
    const changes = diffEffective(effectiveAfterPlan(before, lists), effectiveAfterPlan(after, lists));
    const listsChanged = plan.listIds.join() !== before.listIds.join();
    return {
      clientUserId, plan, changes, listsChanged,
      listsBefore: listView(before.listIds, lists),
      listsAfter: listView(plan.listIds, lists),
    };
  });
  return { targets: planned, failed, previewHash: previewHash(planned.map(({ clientUserId, plan, changes }) => ({ clientUserId, plan, changes }))) };
}

/** -> { targets: [{ clientUserId, changes, listsBefore, listsAfter }], failed, previewHash }. Writes nothing. */
export async function previewCopy(req, database = db) {
  const out = await database.transaction((tx) => computeCopy(tx, req));
  return {
    targets: out.targets.map(({ clientUserId, changes, listsBefore, listsAfter }) => ({ clientUserId, changes, listsBefore, listsAfter })),
    failed: out.failed,
    previewHash: out.previewHash,
  };
}

async function writeOverrides(tx, { clientUserId, plan, byUserId, now }) {
  const { upsert, remove } = plan.overrides;
  if (remove.length) {
    await tx.delete(clientPrices).where(and(eq(clientPrices.clientUserId, clientUserId), inArray(clientPrices.variantId, remove)));
  }
  for (let i = 0; i < upsert.length; i += INSERT_CHUNK) {
    await tx.insert(clientPrices).values(upsert.slice(i, i + INSERT_CHUNK).map((u) => ({
      id: createId(), clientUserId, variantId: u.variantId, priceCents: u.cents, source: "copied",
      reviewedAt: now, reviewedBy: byUserId ?? null, note: null, updatedAt: now,
    }))).onConflictDoUpdate({
      target: [clientPrices.clientUserId, clientPrices.variantId],
      set: { priceCents: sql`excluded.price_cents`, source: "copied", reviewedAt: now, reviewedBy: byUserId ?? null, note: null, updatedAt: now },
    });
  }
}

/**
 * Recomputes the plans inside one transaction (serialized by an advisory lock) and applies them
 * only if their hash still equals the previewed one; otherwise STALE (409). -> { ok, failed }
 */
export async function applyCopy({ previewHash: expected, byUserId, ...req }, database = db) {
  assertRequest(req);
  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('price-copy'))`);
    const out = await computeCopy(tx, req);
    if (!expected || out.previewHash !== expected) {
      throw new PriceCopyError("STALE", "Prices changed since the preview. Preview the copy again.");
    }
    const now = new Date();
    for (const t of out.targets) {
      await writeOverrides(tx, { clientUserId: t.clientUserId, plan: t.plan, byUserId, now });
      if (t.listsChanged) await setClientLists(t.clientUserId, t.plan.listIds, byUserId, tx);
      await auditService.log({
        userId: byUserId, action: "client_price.copied", targetType: "user", targetId: t.clientUserId,
        metadata: { fromClientUserId: req.fromClientUserId, toClientUserId: t.clientUserId, mode: req.mode, changeCount: t.changes.length },
      }, tx);
    }
    return { ok: out.targets.length, failed: out.failed };
  });
}
