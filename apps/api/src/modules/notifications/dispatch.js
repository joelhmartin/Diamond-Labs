import { assertSafeData } from "./data-guard.js";
import { effectivePreference } from "./preferences.js";
import { clip, safeReason, uniq, zero } from "./util.js";

const PRUNE_DAYS = 90;
const PRUNE_ODDS = 0.01;

/** `"staff"` is shorthand for `{ kinds: ["staff"] }`. */
export function normalizeAudience(audience) {
  if (typeof audience === "string") return { kinds: [audience] };
  return audience && typeof audience === "object" ? audience : {};
}

/**
 * notify(): event lookup, data guard, audience, in-app collapse, email, the
 * static list, and the prune roll. Resolves to counts and never throws.
 */
export function createDispatch({ store, events, resolveAudience, sender, log, random, newId, use }) {
  async function resolveUsers(db, audience) {
    const wantsUsers = audience.userIds?.length || audience.kinds?.length || audience.party;
    const raw = wantsUsers ? await resolveAudience(db, audience) : [];
    const exclude = new Set(audience.excludeUserIds ?? []);
    const seen = new Set();
    return (raw ?? []).filter((u) => u?.id && !exclude.has(u.id) && !seen.has(u.id) && seen.add(u.id));
  }

  async function toUser(ctx, user, rows) {
    const { db, event } = ctx;
    let collapsed = false;
    if (effectivePreference(rows, event, user.kind, "in_app")) {
      const r = await store.upsertInApp(db, {
        id: newId(), userId: user.id, event: event.key, recordType: ctx.recordType, recordId: ctx.recordId,
        title: ctx.title, link: clip(sender.linkFor(event, ctx.data, user.kind) ?? "", 300) || null, collapseKey: ctx.collapseKey,
      });
      ctx.counts.inApp += 1;
      collapsed = !r.inserted;
    }
    if (!effectivePreference(rows, event, user.kind, "email")) return;
    // One email per unread burst: the in-app count carries the rest.
    if (collapsed) await sender.skip(ctx, "email", user.id, user.email, "collapsed");
    else await sender.emailOne(ctx, user);
  }

  async function toUsers(ctx, users) {
    const prefs = await store.preferencesFor(ctx.db, users.map((u) => u.id), ctx.event.key);
    for (const user of users) {
      try {
        await toUser(ctx, user, prefs.filter((p) => p.userId === user.id));
      } catch (err) {
        log.error(`[NOTIFY][FAILED] event=${ctx.event.key} user=${user.id} reason=${safeReason(err, user.email)}`);
      }
    }
  }

  async function toStatic(ctx) {
    const list = await store.activeRecipients(ctx.db, ctx.event.key);
    for (const r of list) {
      if (r.channel === "email") await sender.emailOne(ctx, { id: null, email: r.address, kind: sender.staticKind(ctx.event) });
      else if (r.channel === "sms" && ctx.event.sms) await sender.smsOne(ctx, r.address, sender.smsBody(ctx));
    }
  }

  /** Call it after the transaction commits, with the root db. */
  return async function notify(db, args) {
    const counts = zero();
    let event = null;
    try {
      const a = args && typeof args === "object" ? args : {};
      event = events.getEvent(a.event);
      if (!event) {
        log.warn(`[NOTIFY][UNKNOWN_EVENT] event=${clip(String(a.event ?? "").replace(/\s+/g, "_"), 80)}`);
        return counts;
      }
      let data;
      try {
        data = assertSafeData(a.data ?? {});
      } catch (err) {
        log.warn(`[NOTIFY][BAD_DATA] event=${event.key} reason=${clip(err.message, 200)}`);
        return counts;
      }
      const recordType = a.recordType ?? null;
      const recordId = a.recordId ?? null;
      const ctx = {
        db: use(db), event, data, recordType, recordId, counts, wroteDelivery: false,
        title: clip(event.title(data), 160),
        collapseKey: clip(`${event.key}:${recordType ?? ""}:${recordId ?? ""}`, 200),
      };
      const audience = normalizeAudience(a.audience);
      await toUsers(ctx, await resolveUsers(ctx.db, audience));
      for (const to of uniq(audience.addresses?.email)) await sender.emailOne(ctx, { id: null, email: to, kind: null });
      await toStatic(ctx);
      if (ctx.wroteDelivery && random() < PRUNE_ODDS) await store.pruneDeliveries(ctx.db, PRUNE_DAYS);
    } catch (err) {
      log.error(`[NOTIFY][FAILED] event=${event?.key ?? "unknown"} reason=${safeReason(err)}`);
    }
    return counts;
  };
}
