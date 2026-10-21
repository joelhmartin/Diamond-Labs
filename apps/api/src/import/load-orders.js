import { eq } from "drizzle-orm";
import { labOrders, labOrderLines } from "../db/schema/index.js";
import { sealOrder } from "../services/lab/lab-order-crypto.js";
import { variantIdsForCodes } from "../services/lab/lab-variants.js";
import { loadOwners } from "./owners.js";
import { planOrders } from "./map-orders.js";
import { insertMissing } from "./load-writer.js";
import { enforceSeeds } from "./seed-check.js";
import { reattachOwners, planAttach, stillUnowned } from "./reattach.js";
import { withLoadLock } from "./load-lock.js";
import { problem } from "./problems.js";
import { ImportRefusal } from "./import-errors.js";

const BATCH = 500;

/**
 * `import:load orders`: one `source: legacy` lab order per Seazona order,
 * lines from order detail (fetched for open orders). Legacy orders keep
 * Seazona's order numbers (no live allocator; seed-check.js guards the
 * sequence) and are never billed by this system. A live run refuses while any
 * Seazona state is unmapped (add it to import/seazona-records.js) and holds the
 * target's load lock. Owners come from owners.js; a client without a single
 * eligible owner loads unowned and is reported by CLIENT id. Every run
 * REATTACHES loaded legacy orders that have no owner once their client
 * resolves to exactly one (counts.reattached), through the same guarded
 * update as invoices (reattach.js). Each batch of orders and their lines is
 * one transaction; a re-run skips loaded orders by (source, source_id). No
 * events are written: the order page labels the whole order "Seazona history".
 */
export async function loadOrders({ raw, db, live, target, starts = {}, lock = null }) {
  return withLoadLock({ lock, live, step: "orders" }, (guard) => run({ raw, db, live, target, starts, guard }));
}

async function run({ raw, db, live, target, starts, guard }) {
  const summaries = await raw.records("order");
  const details = new Map((await raw.records("order_detail")).map((r) => [r.seazonaId, r.payload]));
  const seeds = await enforceSeeds({ raw, db, target, live, starts, orderSummaries: summaries });
  const owners = await loadOwners(db);
  const existing = await db
    .select({ sourceId: labOrders.sourceId, number: labOrders.orderNumber, clientUserId: labOrders.clientUserId })
    .from(labOrders)
    .where(eq(labOrders.source, "legacy"));
  const existingSourceIds = new Set(existing.map((r) => r.sourceId));
  const plan = planOrders({
    summaries, details, owners: owners.byClient, rejectedClients: owners.rejectedClients, ambiguousClients: owners.ambiguousClients,
    existingSourceIds, existingNumbers: new Set(existing.map((r) => r.number)),
  });
  const reattach = reattachPlan(existing, summaries, owners.byClient);
  plan.counts.reattached = [...reattach.values()].reduce((n, ids) => n + ids.length, 0); // planned; a live run overwrites with what changed
  const clientOf = clientIdByOrder(summaries);
  const waiting = stillUnowned(existing.map((r) => ({ clientUserId: r.clientUserId, clientId: clientOf.get(r.sourceId) ?? null })), owners.byClient);
  plan.counts.loadedStillUnowned = waiting.records;
  if (waiting.clients.length) plan.problems.push(problem("loaded_orders_still_unowned_client", waiting.clients));
  const report = { step: "orders", live, counts: plan.counts, seeds: seeds.summary, problems: plan.problems };
  if (!live) return report;
  if (plan.problems.some((p) => p.kind === "unknown_status")) {
    throw new ImportRefusal("Some Seazona order states are unmapped (see the dry run's unknown_status ids). Add them to import/seazona-records.js, then re-run.");
  }

  const variants = await variantIdsForCodes(db, plan.rows.flatMap((r) => r.lines.map((l) => l.code)));
  let written = 0;
  let conflicts = 0;
  const dropped = [];
  for (let i = 0; i < plan.rows.length; i += BATCH) {
    const chunk = plan.rows.slice(i, i + BATCH);
    guard();
    await db.transaction(async (tx) => {
      const r = await insertMissing(tx, labOrders, chunk.map((x) => sealOrder(x.order)), { keyOf: (o) => o.sourceId, existingKeys: existingSourceIds });
      const lines = chunk.filter((x) => r.insertedIds.has(x.order.id)).flatMap((x) => x.lines.map((l) => ({ ...l, variantId: variants.get(l.code) ?? null })));
      for (let j = 0; j < lines.length; j += BATCH) await tx.insert(labOrderLines).values(lines.slice(j, j + BATCH));
      written += r.insertedIds.size;
      conflicts += r.conflicts;
      dropped.push(...r.droppedKeys);
    });
  }
  report.written = { orders: written, conflicts };
  if (dropped.length) report.problems.push(problem("order_not_loaded_conflict", dropped));
  plan.counts.reattached = await reattachLegacyOrders(db, reattach, guard);
  return report;
}

/** Seazona order id → its client id (string), null when the order has none. One pass, then O(1) lookups. */
const clientIdByOrder = (summaries) => new Map(summaries.map((r) => [r.seazonaId, r.payload.clientId == null ? null : String(r.payload.clientId)]));

/** Loaded legacy orders with no owner whose Seazona client now has one: owner id → Seazona order ids. */
export function reattachPlan(existing, summaries, ownerByClient) {
  const clientOf = clientIdByOrder(summaries);
  const out = new Map();
  for (const r of existing) {
    if (r.clientUserId) continue;
    const owner = ownerByClient.get(clientOf.get(r.sourceId));
    if (owner) planAttach(out, owner, r.sourceId);
  }
  return out;
}

/** Guarded (reattach.js): only a legacy order that is still unowned changes. */
export function reattachLegacyOrders(db, plan, guard) {
  return reattachOwners(db, plan, {
    table: labOrders, ownerField: "clientUserId", ownerCol: labOrders.clientUserId, keyCol: labOrders.sourceId,
    versionCol: labOrders.version, scope: eq(labOrders.source, "legacy"),
    action: "import.legacy_orders_reattached", targetType: "lab_order", metadataKey: "legacyOrderIds", guard,
  });
}
