import { and, asc, eq, ilike, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "../../config/database.js";
import { labOrders, users } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { containsPattern } from "../../lib/list-query.js";
import { applyTags } from "../../modules/record-tags/index.js";
import { loadVariantsById, priceLabOrderLines } from "../pricing.service.js";
import { createDraftForLabOrder } from "../billing/invoices.service.js";
import { allocateOrderNumber, insertPlan } from "./lab-orders.service.js";
import { LabOrderError } from "./lab-order-rules.js";
import { planStaffOrder, catalogLines } from "./staff-order-rules.js";
import { defaultDueAt, saveSchedule } from "./lab-scheduling.js";
import { promoteIntakeIn } from "./lab-intake.js";
import { LAB_ORDER_RECORD_TYPE, onLabOrderTagsChanged } from "./lab-tags.js";

/**
 * Orders lab staff type in, full or quick (piece 6, source "staff"). Rules
 * live in staff-order-rules.js; this file loads, plans and writes.
 */

/** The practice must be an existing, active doctor: pricing, invoices and statements key off it. */
async function assertActiveDoctor(tx, clientUserId) {
  const [u] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, clientUserId), eq(users.role, "doctor"), eq(users.status, "active")));
  if (!u) throw new LabOrderError("INVALID", "Pick a practice.");
}

/** Another OPEN order holding the same pan (pans are reused trays: warn, never block). */
async function openPanHolder(tx, panNumber, labOrderId) {
  const [hit] = await tx
    .select({ orderNumber: labOrders.orderNumber })
    .from(labOrders)
    .where(and(
      sql`lower(${labOrders.panNumber}) = lower(${panNumber})`,
      notInArray(labOrders.status, ["shipped", "cancelled"]),
      ne(labOrders.id, labOrderId),
    ))
    .orderBy(asc(labOrders.orderNumber))
    .limit(1);
  return hit ? { orderNumber: hit.orderNumber } : null;
}

const uniqueVariantIds = (lines = []) => [...new Set(lines.map((l) => l.variantId))];

/**
 * One transaction: the client check, the due default, number allocation, the
 * order with its lines and release event, the draft invoice, the labels and
 * the intake promotion. Any refusal rolls the whole entry back.
 *
 * @returns {{ labOrder: { id, orderNumber }, invoice: { id, invoiceNumber }, panWarning: { orderNumber } | null }}
 */
export function createStaffOrder({ input, byUserId = null }, database = db) {
  return database.transaction(async (tx) => {
    await assertActiveDoctor(tx, input.clientUserId);
    const variantIds = uniqueVariantIds(input.lines);
    const variantsById = await loadVariantsById(variantIds, tx);
    const now = new Date();
    const { dueDate, plan: schedule } = await defaultDueAt(tx, { variantIds, requestedDueDate: input.dueDate, rush: Boolean(input.rush), startAt: now });
    const orderNumber = await allocateOrderNumber(tx);
    const labOrderId = createId();
    const plan = planStaffOrder({ input, variantsById, orderNumber, labOrderId, byUserId, now, dueDate });
    const lines = await insertPlan(tx, { labOrder: plan.labOrder, lines: plan.lines, events: [plan.event] });
    await saveSchedule(tx, labOrderId, schedule);
    const invoice = await createDraftForLabOrder(tx, { labOrder: plan.labOrder, lines, byUserId });
    if (input.tagIds?.length) {
      await applyTags({
        recordType: LAB_ORDER_RECORD_TYPE, ids: [labOrderId], add: input.tagIds, remove: [], byUserId,
        exists: async (ids) => new Set(ids.filter((i) => i === labOrderId)), // created in this transaction
        onChange: onLabOrderTagsChanged,
      }, tx);
    }
    if (input.intakeId) await promoteIntakeIn(tx, input.intakeId, { labOrderId, byUserId });
    const panWarning = plan.labOrder.panNumber ? await openPanHolder(tx, plan.labOrder.panNumber, labOrderId) : null;
    return { labOrder: { id: labOrderId, orderNumber }, invoice, panWarning };
  });
}

/** Catalog lines priced for the client, as the draft invoice would price them. No write. */
export async function previewPrices({ clientUserId, lines }, database = db) {
  const variantsById = await loadVariantsById(uniqueVariantIds(lines), database);
  return priceLabOrderLines(catalogLines(lines, variantsById), clientUserId, database);
}

const PRACTICE_LIMIT = 25;

/** Active doctor users for the order-entry picker: id, name and email only, searched and capped here. */
export async function searchPractices({ q = "" } = {}, database = db) {
  const term = String(q).trim().slice(0, 100);
  const like = term ? containsPattern(term) : null;
  const conds = [eq(users.role, "doctor"), eq(users.status, "active")];
  if (like) conds.push(or(ilike(users.name, like), ilike(users.email, like)));
  return database
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(...conds))
    .orderBy(asc(users.name), asc(users.id))
    .limit(PRACTICE_LIMIT);
}
