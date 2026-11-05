import { isTerminalLabStatus, LAB_STATUS_LABELS, LAB_MERGE_MIN, LAB_MERGE_MAX } from "@my-app/shared";
import { LabOrderError, planStatusChange } from "./lab-order-rules.js";

/**
 * Pure rules for merging 2–5 open orders for one practice and patient into a
 * chosen primary (spec ruling "merge keeps a chosen primary"). No DB and no
 * clock: merge.service.js loads, passes `now`, and writes the plan. Every
 * refusal is product text only — order numbers, never a patient's name.
 */

/** A patient name as compared for a merge: trimmed, inner spaces collapsed, lowercased. */
export const normalizePatient = (name) => String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

const refuse = (message) => {
  throw new LabOrderError("INVALID", message);
};

const MERGEABLE_SOURCES = new Set(["rx_case", "staff"]);

/** One order's own refusals: source, status, shipping label, invoice. */
function assertMergeable(o, invoice) {
  if (!MERGEABLE_SOURCES.has(o.source)) refuse(`Order #${o.orderNumber} is a shop or Seazona order — only lab-made orders can be merged.`);
  if (isTerminalLabStatus(o.status)) refuse(`Order #${o.orderNumber} is ${LAB_STATUS_LABELS[o.status].toLowerCase()} — only open orders can be merged.`);
  // A shipping label (ruling R7), not a record-tags label: tags are unioned onto the primary.
  if (o.shipmentId) refuse(`Order #${o.orderNumber} has a shipping label — void the label before merging.`);
  if (invoice && invoice.status !== "draft") refuse(`Order #${o.orderNumber}'s invoice is no longer a draft — only orders with a draft invoice can be merged.`);
}

/** The whole set's refusals: count, the primary once, one practice, one patient, remakes only with remakes. */
function assertMergeSet(primary, others, patients, invoices) {
  const all = [primary, ...others];
  if (all.length < LAB_MERGE_MIN || all.length > LAB_MERGE_MAX) refuse(`A merge takes ${LAB_MERGE_MIN} to ${LAB_MERGE_MAX} orders.`);
  if (new Set(all.map((o) => o.id)).size !== all.length) refuse("Choose the primary once — it can't also be merged into itself, and each order counts once.");
  for (const o of all) assertMergeable(o, invoices.get(o.id));
  if (all.some((o) => !o.clientUserId || o.clientUserId !== primary.clientUserId)) refuse("These orders are for different practices — only one practice's orders can be merged.");
  const keys = all.map((o) => normalizePatient(patients.get(o.id)));
  const missing = all.find((_, i) => !keys[i]);
  if (missing) refuse(`Order #${missing.orderNumber} has no patient name — a merge needs the same patient on every order.`);
  if (keys.some((k) => k !== keys[0])) refuse("These orders are for different patients — only one patient's orders can be merged.");
  // A remake's lines are priced off; moving them onto a full-price order (or back) would change the bill.
  if (all.some((o) => Boolean(o.isRemake) !== Boolean(primary.isRemake))) refuse("A remake can only be merged with other remakes.");
}

const byPosition = (a, b) => a.position - b.position;

/**
 * The merge, as writes to make:
 * - `primaryPatch`: due → the earliest non-null due, rush → OR (the primary's
 *   tier wins, else the first rush order's), version bump.
 * - `appendLines`: every other order's lines, whole (same ids), re-pointed at
 *   the primary after its last position, in the order the others were given.
 * - `otherPatches`: `{ id, expectedVersion, patch }`, each cancelled through
 *   planStatusChange ("Merged into #P") with `mergedIntoOrderId` set.
 * - `events`: the primary's note (and due change), each other's cancel.
 *
 * @param {{ primary, others, patients: Map<string, string|null>, invoices: Map<string, {status}>, linesByOrder: Map<string, object[]>, now: Date, byUserId?: string|null }} p
 */
export function planMerge({ primary, others, patients, invoices, linesByOrder, now, byUserId = null }) {
  assertMergeSet(primary, others, patients, invoices);
  const all = [primary, ...others];

  const dues = all.map((o) => o.dueDate).filter(Boolean).sort();
  const dueDate = dues[0] ?? null;
  const rush = all.some((o) => o.rush);
  const rushTier = primary.rush ? (primary.rushTier ?? null) : (others.find((o) => o.rush)?.rushTier ?? null);
  const primaryPatch = { dueDate, rush, rushTier, version: primary.version + 1, updatedAt: now };

  let next = (linesByOrder.get(primary.id) ?? []).reduce((m, l) => Math.max(m, l.position), -1) + 1;
  const appendLines = others.flatMap((o) =>
    [...(linesByOrder.get(o.id) ?? [])].sort(byPosition).map((l) => ({ ...l, labOrderId: primary.id, position: next++ })));

  const reason = `Merged into #${primary.orderNumber}`;
  const otherPatches = [];
  const otherEvents = [];
  for (const o of others) {
    const { patch, event } = planStatusChange(o, "cancelled", { reason, byUserId, now });
    otherPatches.push({ id: o.id, expectedVersion: o.version, patch: { ...patch, mergedIntoOrderId: primary.id } });
    otherEvents.push(event);
  }

  const events = [
    { labOrderId: primary.id, type: "merge", from: null, to: null, byUserId, note: `Merged ${others.map((o) => `#${o.orderNumber}`).join(", ")} into this order`, at: now },
    ...((primary.dueDate ?? null) !== dueDate
      ? [{ labOrderId: primary.id, type: "due", from: primary.dueDate ?? null, to: dueDate, byUserId, note: null, at: now }]
      : []),
    ...otherEvents,
  ];
  return { primaryPatch, appendLines, otherPatches, events };
}
