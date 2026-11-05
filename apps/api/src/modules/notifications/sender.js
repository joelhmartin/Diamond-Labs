import { maskAddress } from "./data-guard.js";
import { clip, safeReason } from "./util.js";

const SMS_MAX = 160;

// A channel reason that is not a failure: nothing went wrong, nothing was sent.
// "suppressed" is the staging rule; the others mean there was nothing to do.
const QUIET = { suppressed: "suppressed", unconfigured: "skipped", undeliverable: "skipped" };

/**
 * What a channel's send result means. A channel may answer a boolean (true =
 * sent), `{ ok, reason }` (the email sender) or `{ ok, error }` (sms).
 */
export function outcome(result) {
  if (result === true || result?.ok === true) return { status: "sent", reason: null };
  if (result && typeof result === "object") {
    const reason = String(result.reason ?? result.error ?? "not_accepted");
    return QUIET[reason] ? { status: QUIET[reason], reason } : { status: "failed", reason };
  }
  return { status: "failed", reason: "not_accepted" };
}

/**
 * Sending and the deliveries log. Every attempt goes through `send()`, which
 * writes one notification_deliveries row, bumps ctx.counts, and logs
 * `[NOTIFY][SEND_FAILED]` (masked target) for real failures only.
 *
 * ctx: { db, event, data, title, recordType, recordId, counts, wroteDelivery }
 */
export function createSender({ store, channels, appUrl, orgName, log, newId }) {
  const linkFor = (event, data, kind) => (event.link ? event.link(data, kind) ?? null : null);
  const absolute = (path) => (path ? `${appUrl}${path}` : null);
  // Static recipients belong to the host side: they get the link of the event's first kind.
  const staticKind = (event) => event.kinds[0];

  async function logDelivery(ctx, { channel, userId, target, status, reason }) {
    try {
      await store.insertDelivery(ctx.db, {
        id: newId(), event: ctx.event.key, channel, userId: userId ?? null, targetMasked: target ? maskAddress(target) : null,
        status, reason: reason ? clip(reason, 200) : null, recordType: ctx.recordType, recordId: ctx.recordId,
      });
      ctx.wroteDelivery = true;
    } catch (err) {
      log.error(`[NOTIFY][LOG_FAILED] event=${ctx.event.key} channel=${channel} reason=${safeReason(err, target)}`);
    }
  }

  async function record(ctx, channel, userId, target, { status, reason }) {
    if (status === "sent") ctx.counts.sent += 1;
    else if (status === "failed") {
      ctx.counts.failed += 1;
      log.error(`[NOTIFY][SEND_FAILED] event=${ctx.event.key} channel=${channel} reason=${reason} target=${maskAddress(target)}`);
    } else ctx.counts.skipped += 1;
    await logDelivery(ctx, { channel, userId, target, status, reason });
  }

  // Run one channel call; a throw is a failure with a masked reason.
  async function send(ctx, channel, userId, target, call) {
    let result;
    try {
      const o = outcome(await call());
      result = o.status === "failed" ? { ...o, reason: safeReason(o.reason, target) } : o;
    } catch (err) {
      result = { status: "failed", reason: safeReason(err, target) };
    }
    await record(ctx, channel, userId, target, result);
  }

  const skip = (ctx, channel, userId, target, reason) => record(ctx, channel, userId, target, { status: "skipped", reason });

  /** One email built by the generic sender from an explicit message. */
  function emailMessage(ctx, userId, message) {
    if (!channels.email?.send) return skip(ctx, "email", userId, message.to, "no_email_channel");
    return send(ctx, "email", userId, message.to, () => channels.email.send(message));
  }

  /** The event's email to one recipient ({ id|null, email, kind|null }); event.email.send wins. */
  function emailOne(ctx, recipient) {
    const { event, data } = ctx;
    const to = recipient.email;
    if (!to) return skip(ctx, "email", recipient.id, null, "no_address");
    if (event.email?.send) {
      return send(ctx, "email", recipient.id, to, () => event.email.send({ id: recipient.id, email: to, kind: recipient.kind }, data));
    }
    return emailMessage(ctx, recipient.id, {
      to,
      subject: clip(event.email?.subject ? event.email.subject(data) : ctx.title, 200),
      heading: ctx.title,
      line: orgName ? `You have a new notification from ${orgName}.` : "You have a new notification.",
      actionUrl: absolute(linkFor(event, data, recipient.kind)),
      actionLabel: "Open",
    });
  }

  function smsOne(ctx, to, body) {
    if (!channels.sms?.send) return skip(ctx, "sms", null, to, "no_sms_channel");
    return send(ctx, "sms", null, to, () => channels.sms.send({ to, body: clip(body, SMS_MAX) }));
  }

  function smsBody(ctx) {
    const { event, data } = ctx;
    if (event.smsText) return String(event.smsText(data) ?? "");
    const url = absolute(linkFor(event, data, staticKind(event)));
    return [orgName ? `${orgName}: ${ctx.title}` : ctx.title, url].filter(Boolean).join(" ");
  }

  return { linkFor, staticKind, skip, emailOne, emailMessage, smsOne, smsBody };
}
