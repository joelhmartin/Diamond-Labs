/**
 * Synthetic data for the reports bench (scripts/reports-bench.js).
 *
 * seedPlan() is pure: from a fixed PRNG seed and a "now" it builds every row
 * the bench inserts, spread over about three years so date-range reports have
 * data. Nothing in it is real: clients are "Client 001".."Client 480", staff
 * are "Technician 01", and no patient, note or free-text column is ever set
 * (rx_cases.patient_first/last are NOT NULL, so they hold a fixed placeholder).
 *
 * seedDatabase(db, plan) bulk-inserts the plan in batches.
 */
import { isoDateIn, LAB_TIMEZONE, LEGACY_LINE_DESCRIPTION, OPENING_BALANCE_PREFIX, addDays } from "@my-app/shared";
import * as schema from "../src/db/schema/index.js";
import { addPieceRows, enableBenchCapacity, PIECE_TABLES } from "./reports-bench-seed-pieces.js";

/** The sizes the bench promises (spec "Performance"). */
export const SEED_PLAN = Object.freeze({
  clients: 480, orders: 21000, invoices: 20000, invoiceLines: 30000,
  orderEvents: 60000, payments: 15000, shipments: 9000,
});

const DAY_MS = 86400000;
const SPAN_DAYS = 3 * 365;
const OPENING_INVOICES = 50;
const REFUND_ROWS = 400;
const TECHNICIANS = 12;
const DEPARTMENTS = ["Model Room", "Design", "Printing", "Acrylic", "Finishing", "Quality"];
const FAMILIES = [
  ["Night Guard", "Night guards"], ["Hard Splint", "Night guards"], ["Sleep Appliance", "Sleep"],
  ["Snore Guard", "Sleep"], ["Retainer", "Ortho"], ["Expander", "Ortho"], ["Aligner Set", "Ortho"],
  ["Bleaching Tray", "Cosmetic"], ["Sports Guard", "Sports"], ["TMJ Orthotic", "TMJ"],
  ["Repair", "Services"], ["Model", "Services"],
];
const RECORDS_METHODS = ["iTero", "3Shape", "Medit", "Impressions", null];
const PAYMENT_SOURCES = [
  ["doctor_card", 40], ["autopay", 20], ["admin_card", 8], ["admin_check", 10], ["admin_ach", 6],
  ["admin_cash", 2], ["credit", 3], ["shop_card", 6], ["legacy_settlement", 5],
];
const MANUAL_SOURCES = new Set(["admin_check", "admin_ach", "admin_cash", "admin_other"]);
const pad = (n, w) => String(n).padStart(w, "0");

/** mulberry32: a small deterministic PRNG. */
export function prng(seed = 20261105) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    weighted(pairs) {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of pairs) if ((r -= w) < 0) return v;
      return pairs[pairs.length - 1][0];
    },
  };
}

const at = (base, days) => new Date(base.getTime() + days * DAY_MS);
const minDate = (a, b) => (a < b ? a : b);
const labDay = (d) => isoDateIn(LAB_TIMEZONE, d);

function people(now) {
  const created = at(now, -SPAN_DAYS - 30);
  const admin = { id: "bench-admin", email: "bench-admin@bench.invalid", name: "Bench Admin", role: "admin", createdAt: created };
  const staff = Array.from({ length: TECHNICIANS }, (_, i) => ({
    id: `bench-tech-${pad(i + 1, 2)}`, email: `bench-tech-${pad(i + 1, 2)}@bench.invalid`,
    name: `Technician ${pad(i + 1, 2)}`, role: "lab", createdAt: created,
  }));
  const clients = Array.from({ length: SEED_PLAN.clients }, (_, i) => ({
    id: `bench-client-${pad(i + 1, 3)}`, email: `client-${pad(i + 1, 3)}@bench.invalid`, name: `Client ${pad(i + 1, 3)}`,
    role: "doctor", approvalStatus: "approved", status: i % 97 === 0 ? "suspended" : "active",
    createdAt: at(created, i), seazonaAccountNumber: `ACC${pad(i + 1, 4)}`,
  }));
  const doctorProfiles = clients.map((c, i) => ({
    id: `bench-profile-${pad(i + 1, 3)}`, userId: c.id, npiNumber: pad(i + 1, 10), companyName: c.name,
    address1: `${i + 1} Bench Street`, city: "Benchville", state: "TX", zip: "75001",
  }));
  const accounts = Array.from({ length: 120 }, (_, i) => ({
    id: `bench-account-${pad(i + 1, 3)}`, name: `Group ${pad(i + 1, 3)}`, slug: `bench-group-${pad(i + 1, 3)}`,
    ownerId: clients[i * 4].id,
  }));
  const memberships = clients.map((c, i) => ({
    id: `bench-member-${pad(i + 1, 3)}`, userId: c.id, accountId: accounts[Math.floor(i / 4)].id,
    role: i % 4 === 0 ? "owner" : "member",
  }));
  return { users: [admin, ...staff, ...clients], staff, clients, doctorProfiles, accounts, memberships };
}

function catalog() {
  const productFamilies = FAMILIES.map(([name, category], i) => ({
    id: `bench-family-${pad(i + 1, 2)}`, slug: `bench-${name.toLowerCase().replace(/ /g, "-")}`, name, category,
    channel: i % 3 === 0 ? "both" : "rx",
  }));
  const productVariants = Array.from({ length: 40 }, (_, i) => ({
    id: `bench-variant-${pad(i + 1, 2)}`, familyId: productFamilies[i % productFamilies.length].id,
    code: `B${100 + i}`, name: `Variant ${pad(i + 1, 2)}`, basePriceCents: 4000 + (i % 10) * 2500,
  }));
  const labDepartments = DEPARTMENTS.map((name, i) => ({ id: `bench-dept-${i + 1}`, name, position: i }));
  return { productFamilies, productVariants, labDepartments };
}

/** A lab order received at `receivedAt`, and how far through the bench it got by `now`. */
function orderStatus(r, receivedAt, now) {
  const ageDays = (now - receivedAt) / DAY_MS;
  if (ageDays > 21) return r.chance(0.03) ? "cancelled" : "shipped";
  return r.weighted([["received", 3], ["in_production", 4], ["quality_check", 2], ["ready_to_ship", 2], ["on_hold", 1], ["shipped", 4]]);
}

function buildOrders(r, now, { clients, staff, labDepartments, productVariants }) {
  const start = at(now, -SPAN_DAYS);
  const legacyBefore = at(now, -SPAN_DAYS * 0.45);
  const orders = [];
  const orderLines = [];
  const rxCases = [];
  const rxCaseFiles = [];
  for (let i = 0; i < SEED_PLAN.orders; i += 1) {
    const receivedAt = minDate(at(start, (i / SEED_PLAN.orders) * SPAN_DAYS + r.next() * 0.5), at(now, -0.01));
    const legacy = receivedAt < legacyBefore && r.chance(0.85);
    // A remake re-runs an earlier order of ours: same source, same client.
    const prev = !legacy && i > 100 ? orders[i - r.int(20, 100)] : null;
    const remakeOf = prev && prev.source !== "legacy" && prev.clientUserId && r.chance(0.03) ? prev : null;
    const isRemake = Boolean(remakeOf);
    const source = remakeOf?.source ?? (legacy ? "legacy" : r.chance(0.12) ? "shop_order" : "rx_case");
    const client = remakeOf ? { id: remakeOf.clientUserId }
      : source === "shop_order" && r.chance(0.3) ? null : clients[Math.floor(clients.length * r.next() ** 2)];
    const status = orderStatus(r, receivedAt, now);
    const shippedAt = status === "shipped" ? minDate(at(receivedAt, r.int(3, 12) + r.next()), at(now, -0.001)) : null;
    const id = `bench-order-${pad(i + 1, 5)}`;
    const sourceId = remakeOf?.sourceId ?? `bench-src-${pad(i + 1, 5)}`;
    orders.push({
      id, orderNumber: 100000 + i, source, sourceId, clientUserId: client?.id ?? null, status,
      heldFrom: status === "on_hold" ? "in_production" : null,
      departmentId: !legacy && r.chance(0.8) ? r.pick(labDepartments).id : null,
      assigneeUserId: !legacy && r.chance(0.6) ? r.pick(staff).id : null,
      dueDate: addDays(labDay(receivedAt), r.int(6, 12)), rush: r.chance(0.08),
      isRemake, remakeOfOrderId: remakeOf?.id ?? null,
      receivedAt, startedAt: status === "received" ? null : at(receivedAt, 0.4), shippedAt,
      cancelledAt: status === "cancelled" ? at(receivedAt, 2) : null, createdAt: receivedAt, updatedAt: shippedAt ?? receivedAt,
    });
    const variant = r.pick(productVariants);
    orderLines.push({
      id: `bench-oline-${pad(i + 1, 5)}`, labOrderId: id, variantId: legacy ? null : variant.id, code: variant.code,
      name: variant.name, qty: r.chance(0.2) ? 2 : 1, createdAt: receivedAt,
    });
    if (source === "rx_case" && !isRemake) {
      const method = r.pick(RECORDS_METHODS);
      rxCases.push({
        id: sourceId, caseNumber: `RX-${pad(i + 1, 6)}`, userId: client.id, patientFirst: "Bench", patientLast: "Case",
        recordsMethod: method, status: "released", createdAt: at(receivedAt, -0.1), updatedAt: receivedAt,
      });
      if (!method && r.chance(0.5)) {
        rxCaseFiles.push({ id: `bench-file-${pad(i + 1, 5)}`, caseId: sourceId, kind: "scan", gcsUrl: `gs://bench/${sourceId}.stl`, createdAt: receivedAt });
      }
    }
  }
  return { orders, orderLines, rxCases, rxCaseFiles };
}

/** The status walk of one order, oldest first: the candidates buildEvents draws from. */
function eventsOf(r, order, staff, labDepartments) {
  if (order.source === "legacy") return [];
  const by = () => (r.chance(0.9) ? r.pick(staff).id : null);
  const out = [];
  const add = (type, from, to, t) => out.push({ labOrderId: order.id, type, from, to, byUserId: by(), at: t });
  const steps = ["in_production", "quality_check", "ready_to_ship", "shipped"];
  const end = order.shippedAt ?? order.cancelledAt ?? order.updatedAt;
  const span = Math.max(end - order.receivedAt, DAY_MS / 4);
  if (order.departmentId) add("department", r.pick(labDepartments).id, order.departmentId, at(order.receivedAt, 0.2));
  if (order.assigneeUserId) add("assign", null, order.assigneeUserId, at(order.receivedAt, 0.25));
  const reached = order.status === "shipped" ? 4 : Math.max(0, steps.indexOf(order.status) + 1);
  let prev = "received";
  for (let s = 0; s < reached; s += 1) {
    const t = new Date(order.receivedAt.getTime() + span * ((s + 1) / (reached + 1)));
    if (s === 1 && r.chance(0.06)) {
      add("hold", prev, "on_hold", at(t, -0.1));
      add("status", "on_hold", prev, at(t, -0.05));
    }
    add("status", prev, steps[s], t);
    prev = steps[s];
  }
  if (order.status === "on_hold") add("hold", "in_production", "on_hold", at(order.receivedAt, 0.5));
  if (order.status === "cancelled") add("status", "received", "cancelled", order.cancelledAt);
  if (order.shipmentId) add("shipment", null, order.shipmentId, order.shippedAt);
  return out;
}

/** Newest orders first until there are exactly SEED_PLAN.orderEvents events. */
function buildEvents(r, orders, staff, labDepartments) {
  const events = [];
  for (let i = orders.length - 1; i >= 0 && events.length < SEED_PLAN.orderEvents; i -= 1) {
    for (const e of eventsOf(r, orders[i], staff, labDepartments)) {
      if (events.length === SEED_PLAN.orderEvents) break;
      events.push({ id: `bench-event-${pad(events.length + 1, 5)}`, ...e });
    }
  }
  if (events.length !== SEED_PLAN.orderEvents) throw new Error(`seed: only ${events.length} events`);
  return events;
}

/** The newest shipped orders get a shipment each (labels exist only since piece 4). */
function buildShipments(r, orders, clientsById, now) {
  const shipped = orders.filter((o) => o.status === "shipped" && o.source !== "legacy");
  if (shipped.length < SEED_PLAN.shipments) throw new Error(`seed: only ${shipped.length} shipped orders`);
  return shipped.slice(-SEED_PLAN.shipments).map((o, i) => {
    const carrier = r.weighted([["ups", 55], ["fedex", 35], ["manual", 10]]);
    const voided = r.chance(0.01);
    const recent = now - o.shippedAt < 3 * DAY_MS;
    const id = `bench-ship-${pad(i + 1, 4)}`;
    if (!voided) o.shipmentId = id;
    const client = clientsById.get(o.clientUserId);
    return {
      id, carrier, serviceName: carrier === "manual" ? "Courier" : `${carrier.toUpperCase()} Ground`,
      trackingNumber: carrier === "manual" ? null : `1ZBENCH${pad(i + 1, 8)}`,
      status: voided ? "voided" : recent ? "in_transit" : r.chance(0.01) ? "exception" : "delivered",
      chargeCents: carrier === "manual" ? null : r.int(900, 4500),
      parcel: { preset: "box", weightOz: r.int(4, 40) },
      shipTo: { name: client?.name ?? "Guest", address1: "1 Bench Street", city: "Benchville", state: "TX", postalCode: "75001" },
      purchasedAt: at(o.shippedAt, -0.1), shippedAt: o.shippedAt,
      deliveredAt: voided || recent ? null : at(o.shippedAt, r.int(1, 4)),
      voidedAt: voided ? at(o.shippedAt, 0.05) : null, createdAt: at(o.shippedAt, -0.1), updatedAt: o.shippedAt,
    };
  });
}

function invoiceFor(r, o, n) {
  const kind = o.source === "legacy" ? "legacy" : o.source === "shop_order" ? "shop" : "order";
  const open = o.status !== "shipped";
  const issuedAt = open ? null : at(o.shippedAt, r.next() * 0.2);
  const status = open ? "draft" : r.chance(0.02) ? "void" : "issued";
  return {
    id: `bench-inv-${pad(n + 1, 5)}`, invoiceNumber: 500000 + n, kind, clientUserId: o.clientUserId, labOrderId: o.id,
    legacySeazonaInvoiceId: kind === "legacy" ? `bench-sz-${pad(n + 1, 5)}` : null, status,
    issuedAt: status === "draft" ? null : issuedAt, dueDate: issuedAt ? addDays(labDay(issuedAt), 30) : null,
    voidedAt: status === "void" ? at(issuedAt, 3) : null, createdAt: at(o.receivedAt, 0.1), updatedAt: issuedAt ?? o.receivedAt,
  };
}

function line(inv, n, fields) {
  return { id: `bench-iline-${pad(n, 5)}`, invoiceId: inv.id, taxable: false, createdAt: inv.createdAt, ...fields };
}

/** One item line per invoice, then the remaining lines as second items, discounts and shipping. */
function buildLines(r, invoices, productVariants) {
  const lines = invoices.map((inv, i) => {
    const v = r.pick(productVariants);
    const legacy = inv.kind === "legacy";
    const qty = r.chance(0.15) ? 2 : 1;
    return line(inv, i + 1, {
      position: 0, kind: "item", variantId: legacy ? null : v.id, code: v.code,
      description: legacy ? LEGACY_LINE_DESCRIPTION : v.name, qty, unitCents: v.basePriceCents,
      lineCents: v.basePriceCents * qty, priceSource: legacy ? "legacy" : r.pick(["client", "base"]),
      // The bench line it bills (buildOrders numbers an order's line like the order).
      labOrderLineId: legacy || !inv.labOrderId ? null : inv.labOrderId.replace("bench-order-", "bench-oline-"),
    });
  });
  while (lines.length < SEED_PLAN.invoiceLines) {
    const inv = invoices[r.int(0, invoices.length - 1)];
    const kind = r.weighted([["item", 70], ["adjustment", 15], ["shipping", 15]]);
    const v = r.pick(productVariants);
    const cents = kind === "item" ? v.basePriceCents : kind === "adjustment" ? -r.int(500, 3000) : r.int(900, 2500);
    lines.push(line(inv, lines.length + 1, {
      position: 1, kind, variantId: kind === "item" && inv.kind !== "legacy" ? v.id : null, code: kind === "item" ? v.code : null,
      description: kind === "item" ? v.name : kind === "adjustment" ? "Discount" : "Shipping", qty: 1, unitCents: cents,
      lineCents: cents, priceSource: inv.kind === "legacy" ? "legacy" : kind === "shipping" ? "shipment" : kind === "adjustment" ? "manual" : "base",
    }));
  }
  const byInvoice = new Map();
  for (const l of lines) {
    if (!byInvoice.has(l.invoiceId)) byInvoice.set(l.invoiceId, []);
    byInvoice.get(l.invoiceId).push(l);
  }
  for (const inv of invoices) {
    const ls = byInvoice.get(inv.id) || [];
    inv.subtotalCents = Math.max(0, ls.filter((l) => l.kind !== "shipping").reduce((s, l) => s + l.lineCents, 0));
    inv.shippingCents = ls.filter((l) => l.kind === "shipping").reduce((s, l) => s + l.lineCents, 0);
    inv.taxCents = inv.kind === "shop" ? Math.round(inv.subtotalCents * 0.0825) : 0;
    inv.totalCents = inv.subtotalCents + inv.taxCents + inv.shippingCents;
  }
  return lines;
}

function buildInvoices(r, orders, clients, now) {
  const fromOrders = SEED_PLAN.invoices - OPENING_INVOICES;
  const eligible = orders.filter((o) => o.status !== "cancelled");
  if (eligible.length < fromOrders) throw new Error(`seed: only ${eligible.length} invoiceable orders`);
  const invoices = eligible.slice(-fromOrders).map((o, n) => invoiceFor(r, o, n));
  const cutover = at(now, -SPAN_DAYS * 0.45);
  for (let k = 0; k < OPENING_INVOICES; k += 1) {
    const c = clients[k * 7];
    invoices.push({
      id: `bench-inv-open-${pad(k + 1, 2)}`, invoiceNumber: 400000 + k, kind: "legacy", clientUserId: c.id, labOrderId: null,
      legacySeazonaInvoiceId: `${OPENING_BALANCE_PREFIX}${c.seazonaAccountNumber}`, status: "issued", issuedAt: cutover,
      dueDate: addDays(labDay(cutover), 30), createdAt: cutover, updatedAt: cutover,
    });
  }
  return invoices;
}

function payment(n, inv, fields) {
  return {
    id: `bench-pay-${pad(n, 5)}`, userId: inv.clientUserId, invoiceId: inv.id, invoiceNumber: String(inv.invoiceNumber),
    transactionId: `BENCH-${pad(n, 6)}`, ...fields,
  };
}

/** Payments against issued invoices, then refund / void reversals (negative rows). */
function buildPayments(r, invoices, now) {
  const payable = invoices.filter((i) => i.status === "issued" && i.totalCents > 0);
  const positives = SEED_PLAN.payments - REFUND_ROWS;
  if (payable.length < positives) throw new Error(`seed: only ${payable.length} payable invoices`);
  const step = payable.length / positives;
  const payments = [];
  for (let k = 0; k < positives; k += 1) {
    const inv = payable[Math.floor(k * step)];
    const source = inv.kind === "shop" ? "shop_card" : r.weighted(PAYMENT_SOURCES);
    const createdAt = minDate(at(inv.issuedAt, r.int(0, 45) + r.next()), at(now, -0.001));
    const partial = r.chance(0.1);
    payments.push(payment(k + 1, inv, {
      appliedCents: partial ? Math.round(inv.totalCents / 2) : inv.totalCents, source, createdAt,
      paidOn: MANUAL_SOURCES.has(source) ? labDay(at(createdAt, -r.int(0, 2))) : null,
      reference: MANUAL_SOURCES.has(source) ? `CHK${pad(k + 1, 6)}` : null,
    }));
  }
  const refundable = payments.filter((p) => ["doctor_card", "autopay", "admin_card"].includes(p.source));
  for (let k = 0; k < REFUND_ROWS; k += 1) {
    const orig = refundable[Math.floor((k * refundable.length) / REFUND_ROWS)];
    const inv = { id: orig.invoiceId, clientUserId: orig.userId, invoiceNumber: orig.invoiceNumber };
    payments.push(payment(positives + k + 1, inv, {
      appliedCents: -orig.appliedCents, source: "refund", refundsTransactionId: orig.transactionId,
      createdAt: minDate(at(orig.createdAt, r.int(1, 10)), at(now, -0.001)), paidOn: null,
    }));
  }
  return payments;
}

/** Every row the bench inserts, keyed by table. Deterministic for a given `now` and `seed`. */
export function seedPlan({ now = new Date(), seed = 20261105 } = {}) {
  const r = prng(seed);
  const who = people(now);
  const cat = catalog();
  const built = buildOrders(r, now, { ...who, ...cat });
  const clientsById = new Map(who.clients.map((c) => [c.id, c]));
  const shipments = buildShipments(r, built.orders, clientsById, now);
  const orderEvents = buildEvents(r, built.orders, who.staff, cat.labDepartments);
  const invoices = buildInvoices(r, built.orders, who.clients, now);
  const invoiceLines = buildLines(r, invoices, cat.productVariants);
  const payments = buildPayments(r, invoices, now);
  const base = { ...who, ...cat, ...built, shipments, orderEvents, invoices, invoiceLines, payments };
  return { ...base, ...addPieceRows(r, base, now) };
}

/** Plan key → drizzle table, in insert order (doctor_profiles, accounts and memberships reference users). */
const TABLES = [
  ["users", schema.users], ["doctorProfiles", schema.doctorProfiles], ["accounts", schema.accounts],
  ["memberships", schema.memberships], ["productFamilies", schema.productFamilies],
  ["productVariants", schema.productVariants], ["labDepartments", schema.labDepartments],
  ["rxCases", schema.rxCases], ["rxCaseFiles", schema.rxCaseFiles], ["orders", schema.labOrders],
  ["orderLines", schema.labOrderLines], ["orderEvents", schema.labOrderEvents], ["shipments", schema.shipments],
  ["invoices", schema.invoices], ["invoiceLines", schema.invoiceLines], ["payments", schema.invoicePayments],
  ...PIECE_TABLES,
];
const BATCH = 1000;

/** Bulk-insert the plan, BATCH rows per statement. Returns { table: rows }. */
export async function seedDatabase(db, plan) {
  const counts = {};
  for (const [key, table] of TABLES) {
    const rows = plan[key] || [];
    for (let i = 0; i < rows.length; i += BATCH) await db.insert(table).values(rows.slice(i, i + BATCH));
    counts[key] = rows.length;
  }
  await enableBenchCapacity(db);
  return counts;
}
