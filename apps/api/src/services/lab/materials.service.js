import { and, asc, desc, eq, gte, ilike, sql } from "drizzle-orm";
import { LAB_MATERIALS_MAX, LAB_MATERIAL_NAME_MAX, LAB_MATERIAL_LOT_MAX } from "@my-app/shared";
import { db } from "../../config/database.js";
import { labOrders, labOrderLines, labOrderEvents, labOrderLineMaterials } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { containsPattern } from "../../lib/list-query.js";
import { openOrder, sealEvent } from "./lab-order-crypto.js";
import { LabOrderError } from "./lab-order-rules.js";

/**
 * Materials and lot numbers recorded per bench line (spec ruling: plain text
 * naming products, not people; allowed on a shipped order because traceability
 * is often recorded late, refused on a cancelled one). Each save REPLACES the
 * line's list. It does not bump the order's version (it is a record about the
 * line, not a change to the job) but it writes a `materials` event (names only
 * of the line, never the materials themselves in the audit log).
 */

const MATERIALS_MAX = LAB_MATERIALS_MAX;
const MATERIAL_NAME_MAX = LAB_MATERIAL_NAME_MAX;
const MATERIAL_LOT_MAX = LAB_MATERIAL_LOT_MAX;
const SUGGESTION_DAYS = 365;
const SUGGESTION_LIMIT = 20;

/**
 * Pure: the rows to write and the timeline event for one line's new list.
 * `materials` is [{ material, lot? }]; blank materials are dropped.
 */
export function planMaterials(order, line, materials, { byUserId = null, now = new Date() } = {}) {
  if (order.status === "cancelled") {
    throw new LabOrderError("INVALID", `Order #${order.orderNumber} is cancelled — its materials can't change.`);
  }
  const kept = (Array.isArray(materials) ? materials : [])
    .map((m) => ({ material: String(m?.material ?? "").trim(), lot: String(m?.lot ?? "").trim() }))
    .filter((m) => m.material);
  if (kept.length > MATERIALS_MAX) throw new LabOrderError("INVALID", `A line can list at most ${MATERIALS_MAX} materials.`);
  for (const m of kept) {
    if (m.material.length > MATERIAL_NAME_MAX) throw new LabOrderError("INVALID", `A material name can be at most ${MATERIAL_NAME_MAX} characters.`);
    if (m.lot.length > MATERIAL_LOT_MAX) throw new LabOrderError("INVALID", `A lot number can be at most ${MATERIAL_LOT_MAX} characters.`);
  }
  const rows = kept.map((m, position) => ({
    labOrderId: order.id, labOrderLineId: line.id, position, material: m.material, lotNumber: m.lot || null, createdBy: byUserId,
  }));
  const note = rows.length ? `Materials on ${line.name}: ${rows.length} recorded` : `Materials cleared on ${line.name}`;
  return { rows, event: { labOrderId: order.id, type: "materials", from: null, to: null, byUserId, note, at: now } };
}

/** Replace one line's materials. Returns the saved rows. */
export function replaceLineMaterials(orderId, lineId, { materials, byUserId = null }, database = db) {
  return database.transaction(async (tx) => {
    const [row] = await tx.select().from(labOrders).where(eq(labOrders.id, orderId));
    if (!row) throw new LabOrderError("NOT_FOUND", "Lab order not found.");
    const [line] = await tx.select().from(labOrderLines).where(and(eq(labOrderLines.id, lineId), eq(labOrderLines.labOrderId, orderId)));
    if (!line) throw new LabOrderError("NOT_FOUND", "That line isn't on this order.");
    const plan = planMaterials(openOrder(row), line, materials, { byUserId, now: new Date() });
    await tx.delete(labOrderLineMaterials).where(eq(labOrderLineMaterials.labOrderLineId, lineId));
    const saved = plan.rows.length
      ? await tx.insert(labOrderLineMaterials).values(plan.rows.map((r) => ({ ...r, id: createId() }))).returning()
      : [];
    await tx.insert(labOrderEvents).values(sealEvent(plan.event));
    return saved;
  });
}

/** Distinct materials used in the last year that contain `q` (20, most recent first). */
export async function materialSuggestions(q = "", database = db) {
  const since = new Date(Date.now() - SUGGESTION_DAYS * 86_400_000);
  const term = String(q).trim().slice(0, MATERIAL_NAME_MAX);
  const rows = await database
    .select({ material: labOrderLineMaterials.material, last: sql`max(${labOrderLineMaterials.createdAt})` })
    .from(labOrderLineMaterials)
    .where(and(gte(labOrderLineMaterials.createdAt, since), term ? ilike(labOrderLineMaterials.material, containsPattern(term)) : undefined))
    .groupBy(labOrderLineMaterials.material)
    .orderBy(desc(sql`max(${labOrderLineMaterials.createdAt})`))
    .limit(SUGGESTION_LIMIT);
  return rows.map((r) => r.material);
}

/** Map<lineId, [{ id, material, lotNumber, position }]> for the order's detail and the slip. */
export async function materialsFor(orderId, database = db) {
  const rows = await database
    .select()
    .from(labOrderLineMaterials)
    .where(eq(labOrderLineMaterials.labOrderId, orderId))
    .orderBy(asc(labOrderLineMaterials.labOrderLineId), asc(labOrderLineMaterials.position));
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.labOrderLineId)) out.set(r.labOrderLineId, []);
    out.get(r.labOrderLineId).push({ id: r.id, position: r.position, material: r.material, lotNumber: r.lotNumber });
  }
  return out;
}
