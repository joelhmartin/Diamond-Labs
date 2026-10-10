import { and, asc, desc, eq, gte, ilike, inArray, lte, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { isoDateIn, isOverdue, LAB_TIMEZONE, STAFF_ROLES, caseSummary } from "@my-app/shared";
import { db } from "../../config/database.js";
import { env } from "../../config/env.js";
import {
  labOrders, labOrderLines, labOrderEvents, labDepartments, rxCases, rxCaseFiles, orders, users, productVariants,
} from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { encryptField, decryptField } from "../../lib/crypto.js";
import { decryptRxPhi } from "../rx/phi-crypto.js";
import { devicesForCase } from "../rx/case-devices.js";
import { compileNotesMulti } from "../rx/build-order-payload.js";
import {
  LabOrderError, nextLabOrderNumber, planRxRelease, planShopLabOrder, planRemake,
  assertFresh, planStatusChange, planFieldChange, presentBoardCard, rushFromCase,
} from "./lab-order-rules.js";

// Serialises order-number allocation: held until the transaction ends, so two
// concurrent releases/checkouts can never read the same max.
const ORDER_NUMBER_LOCK = sql.raw("select pg_advisory_xact_lock(7300421)");

const SHIPPED_VISIBLE_DAYS = 14;

const client = alias(users, "client");
const assignee = alias(users, "assignee");
const actor = alias(users, "actor");

// Free text staff type can name a patient, so it is encrypted at rest like
// rx_cases' free-text fields (B4 / phi-crypto.js).
const SECRET_ORDER_FIELDS = ["holdReason", "labNotes"];

function sealOrder(values) {
  const out = { ...values };
  for (const f of SECRET_ORDER_FIELDS) if (f in out && out[f] != null) out[f] = encryptField(out[f]);
  return out;
}
function openOrder(row) {
  const out = { ...row };
  for (const f of SECRET_ORDER_FIELDS) out[f] = row[f] == null ? null : decryptField(row[f]);
  return out;
}
function sealEvent(e) {
  return { ...e, id: createId(), note: e.note == null ? null : encryptField(e.note) };
}
function openEvent(e) {
  return { ...e, note: e.note == null ? null : decryptField(e.note) };
}

export async function allocateOrderNumber(tx) {
  await tx.execute(ORDER_NUMBER_LOCK);
  const [row] = await tx.select({ max: sql`max(${labOrders.orderNumber})` }).from(labOrders);
  return nextLabOrderNumber(row?.max == null ? null : Number(row.max), env.LAB_ORDER_NUMBER_START);
}

async function variantIdsForCodes(tx, codes) {
  const unique = [...new Set(codes.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: productVariants.id, code: productVariants.code })
    .from(productVariants)
    .where(inArray(productVariants.code, unique));
  return new Map(rows.map((r) => [r.code, r.id]));
}

async function insertPlan(tx, { labOrder, lines, events }) {
  await tx.insert(labOrders).values(sealOrder(labOrder));
  if (lines.length) await tx.insert(labOrderLines).values(lines.map((l) => ({ ...l, id: createId() })));
  if (events.length) await tx.insert(labOrderEvents).values(events.map((e, i) => sealEvent({ ...e, at: new Date(new Date(e.at).getTime() + i) })));
}

/**
 * Release a reviewed Rx case to the bench, inside the caller's transaction.
 * Claims the case FIRST with a conditional status update: a second
 * concurrent release blocks on the row lock, then finds nothing to claim.
 * A planner refusal after the claim throws, and the caller's transaction
 * rolls the claim back.
 *
 * @param {object} caseRow DECRYPTED rx_cases row (id, userId, status, dueDate, formData, rush, rushTier)
 * @param {Array}  lines   the case's stored rx_case_lines, position order
 */
export async function releaseRxCase(tx, { caseRow, lines, byUserId = null }) {
  const claimed = await tx
    .update(rxCases)
    .set({ status: "released", updatedAt: new Date() })
    .where(and(eq(rxCases.id, caseRow.id), notInArray(rxCases.status, ["released", "pushed", "cancelled"])))
    .returning({ id: rxCases.id });
  if (claimed.length === 0) {
    throw new LabOrderError("ALREADY_RELEASED", "This case was already released, pushed, or cancelled.");
  }
  const variantIdByCode = await variantIdsForCodes(tx, lines.map((l) => l.seazonaCode));
  const orderNumber = await allocateOrderNumber(tx);
  const plan = planRxRelease({ caseRow, lines, variantIdByCode, orderNumber, labOrderId: createId(), byUserId, now: new Date() });
  await insertPlan(tx, { labOrder: plan.labOrder, lines: plan.lines, events: [plan.event] });
  return { labOrder: { id: plan.labOrder.id, orderNumber }, unknownCodes: plan.unknownCodes };
}

/**
 * The lab order for a just-paid shop order. Runs in its own transaction right
 * after the paid order commits (never inside it), so a failure can't roll back
 * a charged order.
 */
export async function createShopLabOrder(tx, { orderId, clientUserId = null, quoteLines }) {
  const orderNumber = await allocateOrderNumber(tx);
  const plan = planShopLabOrder({ orderId, clientUserId, quoteLines, orderNumber, labOrderId: createId(), now: new Date() });
  await insertPlan(tx, { labOrder: plan.labOrder, lines: plan.lines, events: [plan.event] });
  return { id: plan.labOrder.id, orderNumber };
}

function boardWhere(f, now) {
  const conds = [];
  if (f.status) {
    conds.push(eq(labOrders.status, f.status));
  } else if (!f.includeClosed) {
    const since = new Date(now.getTime() - SHIPPED_VISIBLE_DAYS * 86_400_000);
    conds.push(or(
      notInArray(labOrders.status, ["shipped", "cancelled"]),
      and(eq(labOrders.status, "shipped"), gte(labOrders.shippedAt, since)),
    ));
  }
  if (f.source) conds.push(eq(labOrders.source, f.source));
  if (f.departmentId) conds.push(eq(labOrders.departmentId, f.departmentId));
  if (f.assigneeUserId) conds.push(eq(labOrders.assigneeUserId, f.assigneeUserId));
  if (f.rush) conds.push(eq(labOrders.rush, true));
  if (f.dueBefore) conds.push(lte(labOrders.dueDate, f.dueBefore));
  if (f.q) {
    // Order number, case number, practice, client and shop order number.
    // Patient names are encrypted and deliberately not searchable here.
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(
      sql`${labOrders.orderNumber}::text like ${like}`,
      ilike(rxCases.caseNumber, like),
      ilike(rxCases.practiceName, like),
      ilike(client.name, like),
      ilike(orders.orderNumber, like),
    ));
  }
  return conds.length ? and(...conds) : undefined;
}

/** Board / Admin › Orders list. Cards never include hold reasons or lab notes. */
export async function listLabOrders(filters = {}, now = new Date()) {
  const rows = await db
    .select({
      order: labOrders,
      caseNumber: rxCases.caseNumber,
      practiceName: rxCases.practiceName,
      shopOrderNumber: orders.orderNumber,
      shipping: orders.shipping,
      clientName: client.name,
      assigneeName: assignee.name,
    })
    .from(labOrders)
    .leftJoin(rxCases, and(eq(labOrders.source, "rx_case"), eq(rxCases.id, labOrders.sourceId)))
    .leftJoin(orders, and(eq(labOrders.source, "shop_order"), eq(orders.id, labOrders.sourceId)))
    .leftJoin(client, eq(client.id, labOrders.clientUserId))
    .leftJoin(assignee, eq(assignee.id, labOrders.assigneeUserId))
    .where(boardWhere(filters, now))
    .orderBy(desc(labOrders.rush), asc(labOrders.dueDate), asc(labOrders.orderNumber))
    .limit(1000);

  const ids = rows.map((r) => r.order.id);
  const lineRows = ids.length
    ? await db
        .select({ labOrderId: labOrderLines.labOrderId, name: labOrderLines.name, qty: labOrderLines.qty, noteOnly: labOrderLines.noteOnly })
        .from(labOrderLines)
        .where(inArray(labOrderLines.labOrderId, ids))
        .orderBy(asc(labOrderLines.position))
    : [];
  const byOrder = new Map();
  for (const l of lineRows) {
    if (!byOrder.has(l.labOrderId)) byOrder.set(l.labOrderId, []);
    byOrder.get(l.labOrderId).push(l);
  }
  const today = isoDateIn(LAB_TIMEZONE, now);
  return rows.map((r) => presentBoardCard(r, byOrder.get(r.order.id) ?? [], today));
}

/**
 * Everything the order detail page and the work ticket need. Decrypts the
 * case's PHI (patient name, form answers) — callers must never log the
 * result. Throws on a decrypt failure; routes turn that into a generic 500.
 */
export async function getLabOrderDetail(id, now = new Date()) {
  const [row] = await db
    .select({
      order: labOrders,
      departmentName: labDepartments.name,
      assigneeName: assignee.name,
      clientName: client.name,
    })
    .from(labOrders)
    .leftJoin(labDepartments, eq(labDepartments.id, labOrders.departmentId))
    .leftJoin(assignee, eq(assignee.id, labOrders.assigneeUserId))
    .leftJoin(client, eq(client.id, labOrders.clientUserId))
    .where(eq(labOrders.id, id));
  if (!row) return null;

  const order = openOrder(row.order);
  const [lines, eventRows, remakeOf] = await Promise.all([
    db.select().from(labOrderLines).where(eq(labOrderLines.labOrderId, id)).orderBy(asc(labOrderLines.position)),
    db
      .select({ event: labOrderEvents, byName: actor.name })
      .from(labOrderEvents)
      .leftJoin(actor, eq(actor.id, labOrderEvents.byUserId))
      .where(eq(labOrderEvents.labOrderId, id))
      .orderBy(asc(labOrderEvents.at), asc(labOrderEvents.id)),
    order.remakeOfOrderId
      ? db.select({ orderNumber: labOrders.orderNumber }).from(labOrders).where(eq(labOrders.id, order.remakeOfOrderId))
      : Promise.resolve([]),
  ]);

  let rxCase = null;
  let files = [];
  let shopOrder = null;
  if (order.source === "rx_case") {
    const [raw] = await db.select().from(rxCases).where(eq(rxCases.id, order.sourceId));
    if (raw) {
      const c = decryptRxPhi(raw);
      rxCase = {
        id: c.id,
        caseNumber: c.caseNumber,
        status: c.status,
        practiceName: c.practiceName ?? null,
        patientName: caseSummary(c).patientName,
        formType: c.formType,
        formData: c.formData ?? {},
        generalComments: c.generalComments ?? null,
        buildNotes: compileNotesMulti({ ...c, ...rushFromCase(c) }, devicesForCase(c)) || null,
        submittedAt: c.createdAt,
      };
      files = await db
        .select({ id: rxCaseFiles.id, kind: rxCaseFiles.kind, originalName: rxCaseFiles.originalName, contentType: rxCaseFiles.contentType, size: rxCaseFiles.size })
        .from(rxCaseFiles)
        .where(eq(rxCaseFiles.caseId, c.id));
    }
  } else {
    const [s] = await db
      .select({ id: orders.id, orderNumber: orders.orderNumber, email: orders.email, phone: orders.phone, shipping: orders.shipping, createdAt: orders.createdAt })
      .from(orders)
      .where(eq(orders.id, order.sourceId));
    shopOrder = s ?? null;
  }

  return {
    order: {
      ...order,
      departmentName: row.departmentName ?? null,
      assigneeName: row.assigneeName ?? null,
      clientName: row.clientName ?? null,
      remakeOfOrderNumber: remakeOf[0]?.orderNumber ?? null,
      overdue: isOverdue(order.dueDate, order.status, isoDateIn(LAB_TIMEZONE, now)),
    },
    lines,
    events: eventRows.map(({ event, byName }) => ({ ...openEvent(event), byName: byName ?? null })),
    rxCase,
    files,
    shopOrder,
  };
}

/** The lab orders behind each case — allow-listed columns only (doctor view, Rx case detail). */
export async function labOrdersForCases(caseIds) {
  const out = new Map();
  if (caseIds.length === 0) return out;
  const rows = await db
    .select({
      id: labOrders.id, sourceId: labOrders.sourceId, status: labOrders.status, orderNumber: labOrders.orderNumber,
      dueDate: labOrders.dueDate, isRemake: labOrders.isRemake, createdAt: labOrders.createdAt,
    })
    .from(labOrders)
    .where(and(eq(labOrders.source, "rx_case"), inArray(labOrders.sourceId, caseIds)));
  for (const { sourceId, ...lo } of rows) {
    if (!out.has(sourceId)) out.set(sourceId, []);
    out.get(sourceId).push(lo);
  }
  return out;
}

/**
 * Load → freshness check → plan → conditional update → event, in one
 * transaction. The UPDATE is conditional on the version read, so two
 * technicians racing past assertFresh still can't both win.
 */
// `database` is injectable so the version/seal behaviour can be tested with a fake.
export async function mutate(id, expectedVersion, plan, database = db) {
  return database.transaction(async (tx) => {
    const [row] = await tx.select().from(labOrders).where(eq(labOrders.id, id));
    if (!row) throw new LabOrderError("NOT_FOUND", "Lab order not found.");
    const order = openOrder(row);
    assertFresh(order, expectedVersion);
    const planned = await plan(order, tx);
    if (!planned) return { order, changed: false };
    const [updated] = await tx
      .update(labOrders)
      .set(sealOrder(planned.patch))
      .where(and(eq(labOrders.id, id), eq(labOrders.version, order.version)))
      .returning();
    if (!updated) throw new LabOrderError("STALE", "This order changed — reload.");
    await tx.insert(labOrderEvents).values(sealEvent(planned.event));
    return { order: openOrder(updated), changed: true };
  });
}

async function assertAssignable(tx, userId) {
  const [u] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), inArray(users.role, STAFF_ROLES), eq(users.status, "active")));
  if (!u) throw new LabOrderError("INVALID", "Orders can only be assigned to lab staff.");
}

async function assertActiveDepartment(tx, departmentId) {
  const [d] = await tx
    .select({ id: labDepartments.id })
    .from(labDepartments)
    .where(and(eq(labDepartments.id, departmentId), eq(labDepartments.active, true)));
  if (!d) throw new LabOrderError("INVALID", "That department doesn't exist or is inactive.");
}

export function changeStatus(id, { to, reason, expectedVersion, byUserId = null }) {
  return mutate(id, expectedVersion, (order) => planStatusChange(order, to, { reason, byUserId, now: new Date() }));
}

export function changeField(id, { field, value, expectedVersion, byUserId = null }) {
  return mutate(id, expectedVersion, async (order, tx) => {
    if (field === "assign" && value) await assertAssignable(tx, value);
    if (field === "department" && value) await assertActiveDepartment(tx, value);
    return planFieldChange(order, field, value, { byUserId, now: new Date() });
  });
}

export function remakeOrder(id, { reason, expectedVersion, byUserId = null }) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(labOrders).where(eq(labOrders.id, id));
    if (!row) throw new LabOrderError("NOT_FOUND", "Lab order not found.");
    const original = openOrder(row);
    assertFresh(original, expectedVersion);
    const originalLines = await tx
      .select()
      .from(labOrderLines)
      .where(eq(labOrderLines.labOrderId, id))
      .orderBy(asc(labOrderLines.position));
    const orderNumber = await allocateOrderNumber(tx);
    const plan = planRemake({ original, originalLines, reason, orderNumber, labOrderId: createId(), byUserId, now: new Date() });
    // Bump the original's version so a stale tab can't act on it as if nothing happened.
    const [bumped] = await tx
      .update(labOrders)
      .set({ version: original.version + 1, updatedAt: new Date() })
      .where(and(eq(labOrders.id, id), eq(labOrders.version, original.version)))
      .returning({ id: labOrders.id });
    if (!bumped) throw new LabOrderError("STALE", "This order changed — reload.");
    await insertPlan(tx, plan);
    return { labOrder: { id: plan.labOrder.id, orderNumber } };
  });
}

/** People an order can be assigned to: active admins and lab staff. */
export function listAssignableStaff() {
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(inArray(users.role, STAFF_ROLES), eq(users.status, "active")))
    .orderBy(asc(users.name));
}
