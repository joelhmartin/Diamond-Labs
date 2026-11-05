import { createId } from "@paralleldrive/cuid2";
import { PREFERENCE_CHANNELS, RECIPIENT_CHANNELS } from "@my-app/shared";
import * as registry from "./registry.js";
import { assertSafeData, maskAddress } from "./data-guard.js";
import { effectivePreference, isOffered } from "./preferences.js";
import { createDrizzleStore } from "./store.js";

/** Bad input to a notifier method a route exposes (unknown event, invalid address, duplicate). */
export class NotificationInputError extends Error {
  constructor(message, code = "invalid") {
    super(message);
    this.name = "NotificationInputError";
    this.code = code;
  }
}

const SMS_MAX = 160;
const PRUNE_DAYS = 90;
const PRUNE_ODDS = 0.01;
const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const zero = () => ({ inApp: 0, sent: 0, skipped: 0, failed: 0 });
const clip = (s, n) => {
  const v = String(s ?? "");
  return v.length > n ? v.slice(0, n) : v;
};
const uniq = (xs) => [...new Set((xs ?? []).filter(Boolean))];
const clampInt = (v, min, max, dflt) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/** `"staff"` is shorthand for `{ kinds: ["staff"] }`. */
function normalizeAudience(audience) {
  if (typeof audience === "string") return { kinds: [audience] };
  return audience && typeof audience === "object" ? audience : {};
}

/**
 * An error message as it may appear in a log line or the deliveries table:
 * the target and anything shaped like an address or phone number masked.
 */
function safeReason(err, target) {
  let msg = String(err?.message ?? err ?? "error");
  if (target) msg = msg.split(String(target)).join(maskAddress(target));
  msg = msg.replace(/[^\s@<>"']+@[^\s@<>"']+/g, (m) => maskAddress(m)).replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => maskAddress(m));
  return clip(msg.replace(/\s+/g, " "), 200);
}

/**
 * Build a notifier. Collaborators (all injected, so another app wires its own):
 * - resolveAudience(db, audience) → [{ id, email, kind }]
 * - channels.email.send({ to, subject, heading, line, actionUrl, actionLabel }) → boolean
 * - channels.sms.send({ to, body }) → { ok, error? }
 * - store: data access (default: drizzle, store.js; tests pass fake-store.js)
 * - events: { getEvent, listEvents } (default: the module registry)
 * Every method takes the db to run on; `db` here is the fallback.
 *
 * Length opt-out: this is a factory wrapping a service. Its body is a set of
 * small closures over the injected collaborators, each well under the limit.
 */
export function createNotifier({
  db: rootDb = null,
  store = createDrizzleStore(),
  events = registry,
  resolveAudience = async () => [],
  channels = {},
  appUrl = "",
  orgName = "",
  log = console,
  random = Math.random,
  newId = createId,
} = {}) {
  const use = (db) => db ?? rootDb;
  const linkFor = (event, data, kind) => (event.link ? event.link(data, kind) ?? null : null);
  const absolute = (path) => (path ? `${appUrl}${path}` : null);
  // Static recipients belong to the host side: they get the link of the event's first kind.
  const staticKind = (event) => event.kinds[0];

  async function logDelivery(ctx, { channel, userId = null, target = null, status, reason = null }) {
    try {
      await store.insertDelivery(ctx.db, {
        id: newId(), event: ctx.event.key, channel, userId, targetMasked: target ? maskAddress(target) : null,
        status, reason: reason ? clip(reason, 200) : null, recordType: ctx.recordType, recordId: ctx.recordId,
      });
      ctx.wroteDelivery = true;
    } catch (err) {
      log.error(`[NOTIFY][LOG_FAILED] event=${ctx.event.key} channel=${channel} reason=${safeReason(err, target)}`);
    }
  }

  async function settle(ctx, channel, recipient, target, ok, reason) {
    if (ok) {
      ctx.counts.sent += 1;
      await logDelivery(ctx, { channel, userId: recipient?.id ?? null, target, status: "sent" });
      return;
    }
    ctx.counts.failed += 1;
    log.error(`[NOTIFY][SEND_FAILED] event=${ctx.event.key} channel=${channel} reason=${reason} target=${maskAddress(target)}`);
    await logDelivery(ctx, { channel, userId: recipient?.id ?? null, target, status: "failed", reason });
  }

  async function skip(ctx, channel, recipient, target, reason) {
    ctx.counts.skipped += 1;
    await logDelivery(ctx, { channel, userId: recipient?.id ?? null, target, status: "skipped", reason });
  }

  // recipient: { id|null, email, kind|null }
  async function emailOne(ctx, recipient) {
    const { event, data } = ctx;
    const to = recipient.email;
    if (!to) return skip(ctx, "email", recipient, null, "no_address");
    if (!event.email?.send && !channels.email?.send) return skip(ctx, "email", recipient, to, "no_email_channel");
    let ok = false;
    let reason = null;
    try {
      if (event.email?.send) {
        ok = (await event.email.send({ id: recipient.id, email: to, kind: recipient.kind }, data)) === true;
      } else {
        ok = (await channels.email.send({
          to,
          subject: clip(event.email?.subject ? event.email.subject(data) : ctx.title, 200),
          heading: ctx.title,
          line: orgName ? `You have a new notification from ${orgName}.` : "You have a new notification.",
          actionUrl: absolute(linkFor(event, data, recipient.kind)),
          actionLabel: "Open",
        })) === true;
      }
      if (!ok) reason = "not_accepted";
    } catch (err) {
      reason = safeReason(err, to);
    }
    await settle(ctx, "email", recipient, to, ok, reason);
  }

  async function smsOne(ctx, to, body) {
    if (!channels.sms?.send) return skip(ctx, "sms", null, to, "no_sms_channel");
    let ok = false;
    let reason = null;
    try {
      const r = await channels.sms.send({ to, body: clip(body, SMS_MAX) });
      ok = r?.ok === true;
      if (!ok) reason = safeReason(r?.error ?? "not_accepted", to);
    } catch (err) {
      reason = safeReason(err, to);
    }
    await settle(ctx, "sms", null, to, ok, reason);
  }

  function smsBody(ctx) {
    const { event, data } = ctx;
    if (event.smsText) return String(event.smsText(data) ?? "");
    const url = absolute(linkFor(event, data, staticKind(event)));
    return [orgName ? `${orgName}: ${ctx.title}` : ctx.title, url].filter(Boolean).join(" ");
  }

  async function toUsers(ctx, users) {
    const { db, event } = ctx;
    const prefs = await store.preferencesFor(db, users.map((u) => u.id), event.key);
    for (const user of users) {
      try {
        const rows = prefs.filter((p) => p.userId === user.id);
        let collapsed = false;
        if (effectivePreference(rows, event, user.kind, "in_app")) {
          const r = await store.upsertInApp(db, {
            id: newId(), userId: user.id, event: event.key, recordType: ctx.recordType, recordId: ctx.recordId,
            title: ctx.title, link: clip(linkFor(event, ctx.data, user.kind) ?? "", 300) || null, collapseKey: ctx.collapseKey,
          });
          ctx.counts.inApp += 1;
          collapsed = !r.inserted;
        }
        if (!effectivePreference(rows, event, user.kind, "email")) continue;
        // One email per unread burst: the in-app count carries the rest.
        if (collapsed) await skip(ctx, "email", user, user.email, "collapsed");
        else await emailOne(ctx, user);
      } catch (err) {
        log.error(`[NOTIFY][FAILED] event=${event.key} user=${user.id} reason=${safeReason(err, user.email)}`);
      }
    }
  }

  async function toStatic(ctx) {
    const list = await store.activeRecipients(ctx.db, ctx.event.key);
    for (const r of list) {
      if (r.channel === "email") await emailOne(ctx, { id: null, email: r.address, kind: staticKind(ctx.event) });
      else if (r.channel === "sms" && ctx.event.sms) await smsOne(ctx, r.address, smsBody(ctx));
    }
  }

  async function resolveUsers(db, audience) {
    const wantsUsers = audience.userIds?.length || audience.kinds?.length || audience.party;
    const raw = wantsUsers ? await resolveAudience(db, audience) : [];
    const exclude = new Set(audience.excludeUserIds ?? []);
    const seen = new Set();
    return (raw ?? []).filter((u) => u?.id && !exclude.has(u.id) && !seen.has(u.id) && seen.add(u.id));
  }

  /**
   * Emit an event. Call it after the transaction commits, with the root db.
   * Resolves to delivery counts and never throws.
   */
  async function notify(db, args = {}) {
    const counts = zero();
    const event = events.getEvent(args.event);
    if (!event) {
      log.warn(`[NOTIFY][UNKNOWN_EVENT] event=${clip(String(args.event ?? "").replace(/\s+/g, "_"), 80)}`);
      return counts;
    }
    try {
      let data;
      try {
        data = assertSafeData(args.data ?? {});
      } catch (err) {
        log.warn(`[NOTIFY][BAD_DATA] event=${event.key} reason=${clip(err.message, 200)}`);
        return counts;
      }
      const recordType = args.recordType ?? null;
      const recordId = args.recordId ?? null;
      const ctx = {
        db: use(db), event, data, recordType, recordId, counts, wroteDelivery: false,
        title: clip(event.title(data), 160),
        collapseKey: clip(`${event.key}:${recordType ?? ""}:${recordId ?? ""}`, 200),
      };
      const audience = normalizeAudience(args.audience);
      await toUsers(ctx, await resolveUsers(ctx.db, audience));
      for (const to of uniq(audience.addresses?.email)) await emailOne(ctx, { id: null, email: to, kind: null });
      await toStatic(ctx);
      if (ctx.wroteDelivery && random() < PRUNE_ODDS) await store.pruneDeliveries(ctx.db, PRUNE_DAYS);
    } catch (err) {
      log.error(`[NOTIFY][FAILED] event=${event.key} reason=${safeReason(err)}`);
    }
    return counts;
  }

  async function getPreferences(db, user) {
    const rows = await store.preferencesForUser(use(db), user.id);
    return events.listEvents({ kind: user.kind }).map((e) => ({
      event: e.key,
      label: e.label,
      channels: Object.fromEntries(PREFERENCE_CHANNELS.filter((c) => isOffered(e, user.kind, c))
        .map((c) => [c, effectivePreference(rows, e, user.kind, c)])),
    }));
  }

  async function setPreference(db, user, { event: key, channel, enabled } = {}) {
    const event = events.getEvent(key);
    if (!event) throw new NotificationInputError(`unknown event ${key}`, "unknown_event");
    if (!PREFERENCE_CHANNELS.includes(channel)) throw new NotificationInputError(`channel ${channel} has no preference`, "invalid_channel");
    if (!isOffered(event, user.kind, channel)) throw new NotificationInputError(`event ${key} is not offered on ${channel} to kind ${user.kind}`, "not_offered");
    await store.upsertPreference(use(db), { userId: user.id, event: key, channel, enabled: Boolean(enabled) });
  }

  function cleanAddress(channel, address) {
    const a = String(address ?? "").trim();
    if (channel === "sms" && E164.test(a)) return a;
    if (channel === "email" && a.length <= 320 && EMAIL.test(a)) return a.toLowerCase();
    throw new NotificationInputError(channel === "sms" ? "address must be an E.164 number (+15125551234)" : "address must be an email", "invalid_address");
  }

  const recipients = {
    list: (db, { event } = {}) => store.listRecipients(use(db), { event }),
    async add(db, { event: key, channel, address, label = null, createdByUserId = null } = {}) {
      const event = events.getEvent(key);
      if (!event) throw new NotificationInputError(`unknown event ${key}`, "unknown_event");
      if (!RECIPIENT_CHANNELS.includes(channel)) throw new NotificationInputError(`channel ${channel} has no recipient list`, "invalid_channel");
      if (channel === "sms" && !event.sms) throw new NotificationInputError(`event ${key} does not send sms (channel)`, "invalid_channel");
      const row = {
        id: newId(), event: key, channel, address: cleanAddress(channel, address),
        label: clip(String(label ?? "").trim(), 80) || null, active: true, createdByUserId,
      };
      const saved = await store.insertRecipient(use(db), row);
      if (!saved) throw new NotificationInputError("that address is already on the list", "duplicate");
      return saved;
    },
    setActive: (db, id, active) => store.updateRecipient(use(db), id, { active: Boolean(active) }),
    remove: (db, id) => store.deleteRecipient(use(db), id),
    async sendTest(db, id) {
      const r = await store.getRecipient(use(db), id);
      if (!r) return { ok: false, error: "not_found" };
      const event = events.getEvent(r.event) ?? { key: r.event, label: r.event, kinds: [null] };
      const ctx = { db: use(db), event, data: {}, recordType: null, recordId: null, counts: zero(), wroteDelivery: false };
      const what = `test notification for "${event.label}"`;
      if (r.channel === "sms") await smsOne(ctx, r.address, orgName ? `${orgName}: ${what}` : what);
      else {
        let ok = false;
        let reason = null;
        try {
          ok = (await channels.email?.send?.({
            to: r.address, subject: `Test: ${event.label}`, heading: "Test notification",
            line: `This address receives "${event.label}" notifications.`, actionUrl: null,
          })) === true;
          if (!ok) reason = "not_accepted";
        } catch (err) {
          reason = safeReason(err, r.address);
        }
        await settle(ctx, "email", null, r.address, ok, reason);
      }
      return ctx.counts.sent ? { ok: true } : { ok: false, error: "not_sent" };
    },
  };

  return {
    notify,
    listForUser: (db, userId, q = {}) => store.listInApp(use(db), userId, {
      unreadOnly: q.unread === true || q.unread === "true",
      limit: clampInt(q.limit, 1, 100, 50),
      offset: clampInt(q.offset, 0, 1e6, 0),
    }),
    unreadCount: (db, userId) => store.unreadCount(use(db), userId),
    markRead: (db, userId, { ids, all } = {}) => store.markRead(use(db), userId, all ? null : uniq(ids)),
    markUnread: (db, userId, id) => store.markUnread(use(db), userId, id),
    dismiss: (db, userId, id) => store.dismiss(use(db), userId, id),
    getPreferences,
    setPreference,
    recipients,
    deliveries: {
      list: (db, q = {}) => store.listDeliveries(use(db), {
        event: q.event || undefined, limit: clampInt(q.limit, 1, 500, 100), offset: clampInt(q.offset, 0, 1e6, 0),
      }),
    },
  };
}
