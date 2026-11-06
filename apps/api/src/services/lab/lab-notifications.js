import { and, eq, inArray, or } from "drizzle-orm";
import { MAX_ORDERS_PER_SHIPMENT, STAFF_ROLES, carrierName, isStaffRole, trackingUrl } from "@my-app/shared";
import { env } from "../../config/env.js";
import { users } from "../../db/schema/index.js";
import { defineNotificationEvent, getEvent } from "../../modules/notifications/index.js";
import { sendShippedNotice } from "../email.service.js";
import { activeClientAccounts } from "../client-scope.js";
import { organizationsService } from "../organizations.service.js";
import { parsePartyKey } from "../practice.js";
import { practiceMembersQuery } from "../practice-of.js";

/**
 * Lab glue for the generic notifications module: the lab's events, its two
 * audience kinds ("staff" = admin + lab, "client" = everyone else, in practice
 * doctors, practice staff and group admins) and the audience resolver. App code emits through
 * services/notify-seam.js; boot (services/app-modules.js) registers these.
 *
 * Another piece adds an event here: append one definition to labEventDefs().
 * Titles, links and emails are built ONLY from `data` (numbers, dates, ids):
 * never a patient name or free text.
 */

export const labKindOf = (user) => (isStaffRole(user?.role) ? "staff" : "client");

const STAFF_ONLY = { staff: { in_app: true, email: false } };
const CLIENT_ONLY = { client: { in_app: true, email: true } };
const BOTH = { ...STAFF_ONLY, ...CLIENT_ONLY };

const enc = encodeURIComponent;
const numbered = (n) => (n == null || n === "" ? "" : ` #${n}`);
const withQuery = (path, key, id) => (id ? `${path}?${key}=${enc(id)}` : path);

function shippedTitle(d) {
  const nums = [].concat(d.orderNumbers ?? []).filter((n) => n != null && n !== "");
  if (!nums.length) return "Order shipped";
  const more = Number(d.moreOrders) > 0 ? ` and ${d.moreOrders} more` : "";
  return `${nums.length === 1 && !more ? "Order" : "Orders"} ${nums.map((n) => `#${n}`).join(", ")}${more} shipped`;
}

const clipped = (v, n) => (v == null ? null : String(v).slice(0, n));

/**
 * lab.order_shipped's `data` for a shipment. Every value is bounded so the
 * notifier's data guard (200 chars a string, 2 KB in all) can never drop the
 * shipped email: the order list stops at MAX_ORDERS_PER_SHIPMENT (a box can't
 * hold more) with the rest counted, and the tracking link is not carried at
 * all; the email derives it from carrierCode + trackingNumber.
 */
export function shippedNoticeData({ shipment, orderNumbers, shopOrderNumber = null }) {
  const nums = [].concat(orderNumbers ?? []);
  return {
    orderNumbers: nums.slice(0, MAX_ORDERS_PER_SHIPMENT),
    moreOrders: Math.max(0, nums.length - MAX_ORDERS_PER_SHIPMENT),
    shopOrderNumber: clipped(shopOrderNumber || null, 60),
    carrier: clipped(carrierName(shipment), 100),
    carrierCode: clipped(shipment?.carrier, 20),
    trackingNumber: clipped(shipment?.trackingNumber, 60),
  };
}

function pickupLink(d, kind) {
  return withQuery(kind === "staff" ? "/lab/pickups" : "/doctor/pickups", "pickup", d.pickupId);
}

/** The lab's events, in registration order (the spec's "Event-name registry"). */
export function labEventDefs({
  sendShipped = sendShippedNotice, shippedEmailEnabled = () => env.SHIPPED_EMAIL_ENABLED, trackingUrlFor = trackingUrl,
} = {}) {
  return [
    {
      key: "message.received", label: "New message", kinds: ["staff", "client"], defaults: BOTH, sms: true,
      title: (d) => (d.recordLabel ? `New message about ${d.recordLabel}` : d.senderOrg ? `New message from ${d.senderOrg}` : "New message"),
      link: (d, kind) => (d.threadId ? `${kind === "staff" ? "/lab" : "/doctor"}/messages/${enc(d.threadId)}` : null),
    },
    {
      key: "lab.order_received", label: "New case or shop order", kinds: ["staff"], defaults: STAFF_ONLY, sms: true,
      title: (d) => (d.caseNumber != null && d.caseNumber !== ""
        ? `New case ${d.caseNumber}`
        : d.orderNumber != null ? `New shop order #${d.orderNumber}` : "New order"),
      link: (d) => (d.caseId ? `/admin/rx-cases/${enc(d.caseId)}` : d.labOrderId ? `/lab/orders/${enc(d.labOrderId)}` : "/lab"),
    },
    {
      key: "lab.pickup_requested", label: "Pickup requested", kinds: ["staff"], defaults: STAFF_ONLY, sms: true,
      title: (d) => `Pickup${numbered(d.pickupNumber)} requested`,
      link: pickupLink,
    },
    {
      key: "lab.pickup_scheduled", label: "Pickup scheduled", kinds: ["client"], defaults: CLIENT_ONLY, sms: false,
      title: (d) => `Pickup${numbered(d.pickupNumber)} scheduled${d.date ? ` for ${d.date}` : ""}`,
      link: pickupLink,
    },
    {
      key: "lab.pickup_cancelled", label: "Pickup cancelled", kinds: ["staff", "client"], defaults: BOTH, sms: false,
      title: (d) => `Pickup${numbered(d.pickupNumber)} cancelled`,
      link: pickupLink,
    },
    {
      // Production desk (piece 6): a scanner-export drop. lab-intake.js sends
      // `data: {}` and the link gets no record id, so title and link are static.
      key: "intake.created", label: "Scanner files dropped", kinds: ["staff"], defaults: STAFF_ONLY, sms: false,
      title: () => "New scanner files in intake",
      link: () => "/lab/intake",
    },
    {
      key: "lab.order_shipped", label: "Order shipped", kinds: ["client"], defaults: CLIENT_ONLY, sms: false,
      title: shippedTitle,
      link: () => "/doctor/cases",
      // The existing shipped email, unchanged; SHIPPED_EMAIL_ENABLED=false records a skipped delivery.
      email: {
        send: async (recipient, d) => {
          if (!shippedEmailEnabled()) return { ok: false, reason: "unconfigured" };
          return sendShipped({
            to: recipient.email, orderNumbers: [].concat(d.orderNumbers ?? []), carrier: d.carrier,
            trackingNumber: d.trackingNumber, trackingUrl: trackingUrlFor(d.carrierCode, d.trackingNumber) ?? null,
            ...(d.shopOrderNumber ? { shopOrderNumber: d.shopOrderNumber } : {}),
          }, { detailed: true });
        },
      },
    },
  ];
}

export const LAB_EVENT_KEYS = labEventDefs().map((e) => e.key);

/** Register the lab's events. Idempotent: a key already registered is left alone. */
export function registerLabNotificationEvents(deps) {
  for (const def of labEventDefs(deps)) {
    if (!getEvent(def.key)) defineNotificationEvent(def);
  }
}

const isApprovedDoctor = (u) => u.role === "doctor" && u.approvalStatus === "approved";
const activeIn = (rows, accountId) => new Set((rows ?? []).filter((r) => r.status === "active" && r.accountId === accountId).map((r) => r.userId));

/**
 * Who an audience means, applied to candidate user rows. The authoritative
 * rule (the SQL in resolveLabAudience only narrows the candidates):
 * - `kinds: ["staff"]`: active admin and lab users;
 * - `party: "practice:X"`: the ACTIVE members (any role) of practice X
 *   (`accountMembers`) and the ACTIVE admins of X's active group (`orgAdmins`),
 *   deduped. A sibling practice's members are never in it, and a removed or
 *   suspended membership or grant gives nothing;
 *   `party: "user:Y"`: Y, when an active, approved doctor;
 * - `userIds`: those users when active, each with its own kind.
 * Other kinds (e.g. every client) are not a lab audience and match nobody.
 * Every user row must itself be active.
 *
 * @param {{ accountMembers?: { userId, accountId, status }[], orgAdmins?: { userId, accountId, status }[] }} practice
 */
export function audienceMembers(rows, audience = {}, { accountMembers = [], orgAdmins = [] } = {}) {
  const active = (rows ?? []).filter((u) => u.status === "active");
  const out = [];
  if (audience.kinds?.includes("staff")) out.push(...active.filter((u) => isStaffRole(u.role)));
  const party = parsePartyKey(audience.party);
  if (party?.practice != null) {
    const ids = new Set([...activeIn(accountMembers, party.practice), ...activeIn(orgAdmins, party.practice)]);
    out.push(...active.filter((u) => ids.has(u.id)));
  } else if (party?.userId != null) {
    out.push(...active.filter((u) => u.id === party.userId && isApprovedDoctor(u)));
  }
  const ids = new Set(audience.userIds ?? []);
  if (ids.size) out.push(...active.filter((u) => ids.has(u.id)));
  const seen = new Set();
  return out
    .filter((u) => !seen.has(u.id) && seen.add(u.id))
    .map((u) => ({ id: u.id, email: u.email, kind: labKindOf(u) }));
}

/**
 * practice:X's people, read live: nobody unless X is an active client account
 * (it is then in nobody's scope, so nobody could open the alert), else its
 * active members and the active admins of its active group. Rows in
 * audienceMembers' `{ userId, accountId, status }` shape.
 */
async function practiceAudience(db, accountId) {
  const none = { accountMembers: [], orgAdmins: [] };
  if (!(await activeClientAccounts([accountId], db)).includes(accountId)) return none;
  const members = await practiceMembersQuery(db, accountId);
  const group = (await organizationsService.organizationOf([accountId], db)).get(accountId);
  const admins = group ? await organizationsService.activeAdminIds(group.id, db) : [];
  const row = (userId) => ({ userId, accountId, status: "active" });
  return { accountMembers: members.map((m) => row(m.userId)), orgAdmins: admins.map(row) };
}

/** The notifier's resolveAudience for the lab: the practice's people (when a practice party), one user query, then audienceMembers. */
export async function resolveLabAudience(db, audience = {}) {
  const conds = [];
  if (audience.kinds?.includes("staff")) conds.push(inArray(users.role, [...STAFF_ROLES]));
  const party = parsePartyKey(audience.party);
  let practice = { accountMembers: [], orgAdmins: [] };
  if (party?.practice != null) {
    practice = await practiceAudience(db, party.practice);
    const ids = [...new Set([...practice.accountMembers, ...practice.orgAdmins].map((r) => r.userId))];
    if (ids.length) conds.push(inArray(users.id, ids));
  } else if (party?.userId != null) {
    conds.push(and(eq(users.role, "doctor"), eq(users.approvalStatus, "approved"), eq(users.id, party.userId)));
  }
  const ids = [...new Set(audience.userIds ?? [])].filter(Boolean);
  if (ids.length) conds.push(inArray(users.id, ids));
  if (!conds.length) return [];
  const rows = await db
    .select({ id: users.id, email: users.email, role: users.role, status: users.status, approvalStatus: users.approvalStatus })
    .from(users)
    .where(and(eq(users.status, "active"), or(...conds)));
  return audienceMembers(rows, audience, practice);
}
