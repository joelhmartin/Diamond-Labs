import { and, asc, eq, inArray } from "drizzle-orm";
import { caseSummary } from "@my-app/shared";
import { db } from "../../config/database.js";
import { labOrders, labOrderLines, labOrderLineMaterials, labOrderEvents, invoices, rxCases } from "../../db/schema/index.js";
import { applyTags, tagsFor } from "../../modules/record-tags/index.js";
import { relinkFiles } from "../../modules/record-files/index.js";
import { decryptRxPhi } from "../rx/phi-crypto.js";
import { syncDraftLine, voidForCancelledLabOrder } from "../billing/invoices.service.js";
import { InvoiceError } from "../billing/invoice-rules.js";
import { sealOrder, openOrder, sealEvent } from "./lab-order-crypto.js";
import { LabOrderError, assertFresh } from "./lab-order-rules.js";
import { planMerge } from "./merge-rules.js";
import { LAB_ORDER_RECORD_TYPE, onLabOrderTagsChanged } from "./lab-tags.js";

/**
 * Merge 2–5 open orders for one practice and patient into a chosen primary,
 * in ONE transaction: rules in merge-rules.js; this file loads, checks
 * freshness, plans and writes. The primary's schedule plan is left as it is:
 * a due-date edit never replans (lab-orders.service changeField), and the
 * merge's due change is the same kind of edit.
 */

/** Every order, row-locked in id order (two merges over the same orders can't deadlock), opened. */
async function lockOrders(tx, ids) {
  const rows = await tx.select().from(labOrders).where(inArray(labOrders.id, ids)).orderBy(asc(labOrders.id)).for("update");
  const byId = new Map(rows.map((r) => [r.id, openOrder(r)]));
  if (ids.some((id) => !byId.has(id))) throw new LabOrderError("NOT_FOUND", "One of these orders no longer exists — reload.");
  return byId;
}

async function linesByOrder(tx, ids) {
  const rows = await tx.select().from(labOrderLines).where(inArray(labOrderLines.labOrderId, ids)).orderBy(asc(labOrderLines.position));
  const out = new Map(ids.map((id) => [id, []]));
  for (const l of rows) out.get(l.labOrderId)?.push(l);
  return out;
}

/**
 * labOrderId → { status }; an order with a non-draft invoice keeps that one (it must refuse).
 * The invoices are row-locked (after the orders, in id order, like every lock here) so an
 * admin can't issue one between this read and the merge voiding it.
 */
async function invoicesByOrder(tx, ids) {
  const rows = await tx
    .select({ labOrderId: invoices.labOrderId, status: invoices.status })
    .from(invoices)
    .where(inArray(invoices.labOrderId, ids))
    .orderBy(asc(invoices.id))
    .for("update");
  const out = new Map();
  for (const r of rows) if (!out.has(r.labOrderId) || r.status !== "draft") out.set(r.labOrderId, { status: r.status });
  return out;
}

/**
 * id → the patient's name, decrypted server-side and never returned or
 * logged: an Rx order's from its case, a staff order's from the order itself.
 * Shop and legacy orders get null (the rules refuse them by source anyway).
 */
async function patientsOf(tx, orders) {
  const caseIds = orders.filter((o) => o.source === "rx_case").map((o) => o.sourceId);
  const cases = new Map();
  if (caseIds.length) {
    const rows = await tx.select().from(rxCases).where(inArray(rxCases.id, caseIds));
    for (const raw of rows) cases.set(raw.id, caseSummary(decryptRxPhi(raw)).patientName ?? null);
  }
  return new Map(orders.map((o) => [
    o.id,
    o.source === "rx_case" ? (cases.get(o.sourceId) ?? null) : o.source === "staff" ? (o.patientName ?? null) : null,
  ]));
}

/** A conditional (version-checked) update → the opened row; STALE when someone else got there first. */
async function commit(tx, id, expectedVersion, patch) {
  const [updated] = await tx
    .update(labOrders)
    .set(sealOrder(patch))
    .where(and(eq(labOrders.id, id), eq(labOrders.version, expectedVersion)))
    .returning();
  if (!updated) throw new LabOrderError("STALE", "This order changed — reload.");
  return openOrder(updated);
}

/** The others' labels the primary doesn't carry yet (inactive ones can't be added, so they stay on the merged order only). */
async function unionTags(tx, primaryId, otherIds, byUserId) {
  const tags = await tagsFor(LAB_ORDER_RECORD_TYPE, [primaryId, ...otherIds], tx);
  const have = new Set((tags.get(primaryId) ?? []).map((t) => t.id));
  const add = [...new Set(otherIds.flatMap((id) => tags.get(id) ?? []).filter((t) => t.active !== false && !have.has(t.id)).map((t) => t.id))];
  if (!add.length) return;
  await applyTags({
    recordType: LAB_ORDER_RECORD_TYPE, ids: [primaryId], add, remove: [], byUserId,
    exists: async (ids) => new Set(ids.filter((i) => i === primaryId)), // locked above
    onChange: onLabOrderTagsChanged,
  }, tx);
}

/**
 * Void each merged-away order's draft BEFORE anything else is written, with no
 * savepoint: unlike a plain cancel (which must never block the bench), a merge
 * re-bills these lines on the primary, so a draft that can't be voided must
 * refuse the whole merge (409 STALE) or the same lines would be billed twice.
 */
async function voidMergedDrafts(tx, others, invoiceStates, byUserId) {
  for (const o of others) {
    if (invoiceStates.get(o.id)?.status !== "draft") continue;
    const { voided } = await voidForCancelledLabOrder(tx, { labOrderId: o.id, byUserId });
    if (!voided) throw new InvoiceError("STALE", `Order #${o.orderNumber}'s invoice changed — reload.`);
  }
}

/**
 * @param {{ primaryId: string, otherIds: string[], versions: Record<string, number>, byUserId?: string|null }} input
 * @returns {{ primary: { id, orderNumber, version }, merged: Array<{ id, orderNumber }> }}
 */
export function mergeOrders({ primaryId, otherIds, versions = {}, byUserId = null }, database = db) {
  return database.transaction(async (tx) => {
    const ids = [primaryId, ...otherIds];
    const orders = await lockOrders(tx, [...new Set(ids)]);
    // Every order the client saw must still be the one stored — before anything is planned or written.
    for (const id of new Set(ids)) assertFresh(orders.get(id), versions[id]);
    const primary = orders.get(primaryId);
    const others = otherIds.map((id) => orders.get(id));
    const invoiceStates = await invoicesByOrder(tx, ids);
    const plan = planMerge({
      primary, others,
      patients: await patientsOf(tx, [...orders.values()]),
      invoices: invoiceStates,
      linesByOrder: await linesByOrder(tx, ids),
      now: new Date(), byUserId,
    });
    await voidMergedDrafts(tx, others, invoiceStates, byUserId);

    const openedPrimary = await commit(tx, primary.id, primary.version, plan.primaryPatch);
    const cancelled = [];
    for (const o of plan.otherPatches) cancelled.push(await commit(tx, o.id, o.expectedVersion, o.patch));
    const base = Date.now();
    await tx.insert(labOrderEvents).values(plan.events.map((e, i) => sealEvent({ ...e, at: new Date(base + i) })));

    // The lines move whole (ids kept) with their materials and lots, then join the primary's draft.
    for (const l of plan.appendLines) {
      await tx.update(labOrderLines).set({ labOrderId: l.labOrderId, position: l.position }).where(eq(labOrderLines.id, l.id));
    }
    if (plan.appendLines.length) {
      await tx.update(labOrderLineMaterials).set({ labOrderId: primary.id })
        .where(inArray(labOrderLineMaterials.labOrderLineId, plan.appendLines.map((l) => l.id)));
    }
    for (const line of plan.appendLines) await syncDraftLine(tx, { labOrder: openedPrimary, op: "add", line, byUserId });

    await unionTags(tx, primary.id, otherIds, byUserId);
    for (const id of otherIds) {
      await relinkFiles(tx, { fromType: LAB_ORDER_RECORD_TYPE, fromId: id, toType: LAB_ORDER_RECORD_TYPE, toId: primary.id });
    }
    return {
      primary: { id: openedPrimary.id, orderNumber: openedPrimary.orderNumber, version: openedPrimary.version },
      merged: cancelled.map((o) => ({ id: o.id, orderNumber: o.orderNumber })),
    };
  });
}
