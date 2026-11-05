import { asc, eq } from "drizzle-orm";
import { isTerminalLabStatus, LAB_STATUS_LABELS } from "@my-app/shared";
import { db } from "../../config/database.js";
import { labOrderLines } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { loadVariantsById } from "../pricing.service.js";
import { syncDraftLine } from "../billing/invoices.service.js";
import { mutate } from "./lab-orders.service.js";
import { LabOrderError } from "./lab-order-rules.js";
import { catalogLine, checkLineQty } from "./staff-order-rules.js";

/**
 * Editable lab order lines (piece 6 ruling): add, qty and remove on an order
 * that is not legacy, shipped or cancelled. Each edit bumps the order's
 * version, writes a `lines` event (product names only) and is mirrored onto
 * the order's draft invoice through labOrderLineId — all in ONE transaction,
 * so an issued invoice's refusal rolls the bench change back and the bench
 * and the bill never disagree.
 */

/**
 * One line edit → { patch, event, lineOp, sync }, or null when nothing changes.
 * Pure: `variant` (for an add) and `lineId` (the new line's id) are passed in.
 */
export function planLineChange(order, lines, edit, { variant = null, lineId, byUserId = null, now }) {
  if (order.source === "legacy") throw new LabOrderError("INVALID", "Seazona orders' lines can't be edited here.");
  if (isTerminalLabStatus(order.status)) {
    const status = (LAB_STATUS_LABELS[order.status] ?? order.status).toLowerCase();
    throw new LabOrderError("INVALID", `Order #${order.orderNumber} is ${status} — its lines can't change.`);
  }
  let lineOp;
  let sync;
  let note;
  if (edit.op === "add") {
    const position = lines.reduce((m, l) => Math.max(m, l.position), -1) + 1;
    const row = { id: lineId, labOrderId: order.id, position, ...catalogLine(edit, variant) };
    lineOp = { insert: row };
    sync = { op: "add", line: row };
    note = `Added ${row.qty}× ${row.name}`;
  } else {
    const line = lines.find((l) => l.id === edit.lineId);
    if (!line) throw new LabOrderError("NOT_FOUND", "That line isn't on this order.");
    if (edit.op === "update") {
      checkLineQty(edit.qty);
      if (edit.qty === line.qty) return null;
      lineOp = { update: { id: line.id, qty: edit.qty } };
      sync = { op: "qty", line: { ...line, qty: edit.qty } };
      note = `Qty ${line.name} ${line.qty}→${edit.qty}`;
    } else if (edit.op === "remove") {
      lineOp = { delete: line.id };
      sync = { op: "remove", line };
      note = `Removed ${line.name}`;
    } else {
      throw new LabOrderError("INVALID", `Unknown line edit: ${edit.op}`);
    }
  }
  return {
    patch: { version: order.version + 1, updatedAt: now },
    event: { labOrderId: order.id, type: "lines", from: null, to: null, byUserId, note, at: now },
    lineOp,
    sync,
  };
}

async function writeLineOp(tx, lineOp) {
  if (lineOp.insert) await tx.insert(labOrderLines).values(lineOp.insert);
  if (lineOp.update) await tx.update(labOrderLines).set({ qty: lineOp.update.qty }).where(eq(labOrderLines.id, lineOp.update.id));
  if (lineOp.delete) await tx.delete(labOrderLines).where(eq(labOrderLines.id, lineOp.delete));
}

/**
 * Apply one line edit through mutate (version check, conditional update,
 * event). The draft is synced FIRST in `after` — an issued invoice throws
 * before the bench line is written — and the throw rolls back the whole
 * transaction, the order bump and event included.
 */
export function changeLines(id, { edit, expectedVersion, byUserId = null }, database = db) {
  return mutate(id, expectedVersion, async (order, tx) => {
    const lines = await tx.select().from(labOrderLines).where(eq(labOrderLines.labOrderId, id)).orderBy(asc(labOrderLines.position));
    const variant = edit.op === "add" ? ((await loadVariantsById([edit.variantId], tx)).get(edit.variantId) ?? null) : null;
    const plan = planLineChange(order, lines, edit, { variant, lineId: createId(), byUserId, now: new Date() });
    if (!plan) return null;
    return {
      patch: plan.patch,
      event: plan.event,
      after: async (t, opened) => {
        await syncDraftLine(t, { labOrder: opened, op: plan.sync.op, line: plan.sync.line, byUserId });
        await writeLineOp(t, plan.lineOp);
      },
    };
  }, database);
}
