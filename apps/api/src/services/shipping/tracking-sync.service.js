import { and, gte, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { TERMINAL_SHIPMENT_STATUSES } from "@my-app/shared";
import { db } from "../../config/database.js";
import { shipments } from "../../db/schema/index.js";
import { afterCommit as runAfterCommit } from "./after-commit.js";
import { carrierRegistry } from "./carrier-registry.js";
import { errTag } from "./shipping-errors.js";
import { planTrackingUpdate } from "./shipment-rules.js";
import { applyTrackingPlan } from "./shipments.service.js";

export const TRACKING_WINDOW_DAYS = 30;
/**
 * Most shipments one run polls (oldest lastTrackedAt first). UPS tracks one
 * number per call, serially, so an unbounded run against a slow carrier would
 * never finish; the rest are picked up by the next run and reported as `capped`.
 */
export const SYNC_LIMIT = 150;

function candidatesWhere({ shipmentIds, trackers, now }) {
  const conds = [notInArray(shipments.status, TERMINAL_SHIPMENT_STATUSES), isNotNull(shipments.trackingNumber), inArray(shipments.carrier, trackers)];
  if (shipmentIds) conds.push(inArray(shipments.id, shipmentIds));
  else conds.push(gte(shipments.purchasedAt, new Date(now.getTime() - TRACKING_WINDOW_DAYS * 86_400_000)));
  return and(...conds);
}

function tally(summary, plan, result, shipment, log) {
  if (plan.event) summary.updated += 1;
  if (plan.patch?.status === "delivered") summary.delivered += 1;
  if (!result || result.error) summary.errors += 1;
  if (plan.unknownCode) {
    summary.unknownCodes += 1;
    log.warn?.(`[SHIP][UNKNOWN_STATUS] carrier=${shipment.carrier} code=${plan.unknownCode} shipment=${shipment.id}`);
  }
}

/**
 * Write one shipment's plan in its own transaction, conditional on the status
 * read. When it shows first movement, `onMoved(tx, id)` runs in the SAME
 * transaction (the lab glue ships the box), so if that fails the status change
 * rolls back and the next run sees the movement again. `onMoved` may return a
 * function to run after the commit (the shipped email).
 * Returns "committed", "skipped" (lost a race to a void or a concurrent sync)
 * or "failed" (rolled back, retried next run).
 */
async function writeOne({ database, shipment, plan, onMoved, summary, log, afterCommit }) {
  let after = null;
  let applied = false;
  try {
    await database.transaction(async (tx) => {
      applied = await applyTrackingPlan(tx, shipment, plan);
      if (applied && plan.moved) after = (await onMoved(tx, shipment.id)) ?? null;
    });
  } catch (err) {
    summary.errors += 1;
    const tag = plan.moved ? "MARK_SHIPPED_FAILED" : "TRACK_WRITE_FAILED";
    log.error?.(`[SHIP][${tag}] shipment=${shipment.id} error=${errTag(err)}`);
    return "failed";
  }
  if (!applied) return "skipped";
  if (plan.moved) summary.moved += 1;
  if (typeof after === "function") afterCommit.push([shipment.id, after]);
  return "committed";
}

/**
 * Poll the carriers for every open shipment (not delivered, returned or
 * voided; with a tracking number; on a carrier that tracks; bought in the last
 * 30 days, or exactly `shipmentIds` for a manual refresh), at most SYNC_LIMIT
 * per run. Calls are batched per carrier (the adapters chunk: FedEx 30 per
 * request, UPS one).
 *
 * Each answer goes through planTrackingUpdate and is written by writeOne.
 * Idempotent; a dry run only counts. Generic: lab behaviour arrives only
 * through `onMoved`. `log` defaults to console so the alert lines reach Cloud
 * Logging when a CLI run passes none.
 */
export async function syncTracking({
  shipmentIds = null, dryRun = false, now = new Date(), registry = carrierRegistry(), database = db, onMoved = async () => {}, log = console,
} = {}) {
  const summary = { checked: 0, updated: 0, moved: 0, delivered: 0, errors: 0, unknownCodes: 0, capped: false, dryRun };
  const trackers = registry.enabled().filter((a) => a.tracks).map((a) => a.id);
  if (trackers.length === 0) return summary;
  const found = await database
    .select({ id: shipments.id, carrier: shipments.carrier, trackingNumber: shipments.trackingNumber, status: shipments.status, shippedAt: shipments.shippedAt })
    .from(shipments)
    .where(candidatesWhere({ shipmentIds, trackers, now }))
    .orderBy(sql`${shipments.lastTrackedAt} asc nulls first`)
    .limit(SYNC_LIMIT + 1);
  summary.capped = found.length > SYNC_LIMIT;
  const rows = found.slice(0, SYNC_LIMIT);
  summary.checked = rows.length;
  if (dryRun) return summary;

  const afterCommit = [];
  for (const carrier of trackers) {
    const batch = rows.filter((r) => r.carrier === carrier);
    if (batch.length === 0) continue;
    let results = [];
    try {
      results = await registry.get(carrier).track(batch.map((r) => r.trackingNumber));
    } catch (err) {
      log.error?.(`[SHIP][TRACK_FAILED] carrier=${carrier} error=${errTag(err)}`);
    }
    const byNumber = new Map(results.map((r) => [r.trackingNumber, r]));
    for (const shipment of batch) {
      const result = byNumber.get(shipment.trackingNumber);
      const plan = planTrackingUpdate(shipment, result, now);
      if (!plan.patch) continue;
      // Count only a write that committed (a skipped or rolled-back one is not an update).
      const outcome = await writeOne({ database, shipment, plan, onMoved, summary, log, afterCommit });
      if (outcome === "committed") tally(summary, plan, result, shipment, log);
    }
  }

  for (const [id, after] of afterCommit) {
    await runAfterCommit(after, (err) => log.error?.(`[SHIP][AFTER_SHIPPED_FAILED] shipment=${id} error=${errTag(err)}`));
  }
  return summary;
}
