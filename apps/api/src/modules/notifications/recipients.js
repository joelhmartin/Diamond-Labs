import { RECIPIENT_CHANNELS } from "@my-app/shared";
import { clip, NotificationInputError, zero } from "./util.js";

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanAddress(channel, address) {
  const a = String(address ?? "").trim();
  if (channel === "sms" && E164.test(a)) return a;
  if (channel === "email" && a.length <= 320 && EMAIL.test(a)) return a.toLowerCase();
  throw new NotificationInputError(channel === "sms" ? "address must be an E.164 number (+15125551234)" : "address must be an email", "invalid_address");
}

/** The static per-event recipient list: list, add, setActive, remove, sendTest. */
export function createRecipients({ store, events, sender, orgName, use, newId }) {
  return {
    list: (db, { event } = {}) => store.listRecipients(use(db), { event }),

    async add(db, { event: key, channel, address, label = null, createdByUserId = null } = {}) {
      const event = events.getEvent(key);
      if (!event) throw new NotificationInputError(`unknown event ${key}`, "unknown_event");
      if (!RECIPIENT_CHANNELS.includes(channel)) throw new NotificationInputError(`channel ${channel} has no recipient list`, "invalid_channel");
      if (channel === "sms" && !event.sms) throw new NotificationInputError(`event ${key} does not send sms (channel)`, "invalid_channel");
      const saved = await store.insertRecipient(use(db), {
        id: newId(), event: key, channel, address: cleanAddress(channel, address),
        label: clip(String(label ?? "").trim(), 80) || null, active: true, createdByUserId,
      });
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
      if (r.channel === "sms") await sender.smsOne(ctx, r.address, orgName ? `${orgName}: ${what}` : what);
      else {
        await sender.emailMessage(ctx, null, {
          to: r.address, subject: `Test: ${event.label}`, heading: "Test notification",
          line: `This address receives "${event.label}" notifications.`, actionUrl: null, actionLabel: "Open",
        });
      }
      return ctx.counts.sent ? { ok: true } : { ok: false, error: "not_sent" };
    },
  };
}
