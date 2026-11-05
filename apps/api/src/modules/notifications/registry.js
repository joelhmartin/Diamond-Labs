/**
 * Notification event registry. The host app registers each event once at boot
 * (its glue file); `notify()` looks events up by key. Keys are
 * `<domain>.<past_tense>`.
 *
 * defineNotificationEvent({
 *   key, label,
 *   kinds: string[],                         audience kinds this event can reach
 *   defaults: { [kind]: { in_app, email } }, per-kind channel defaults; a channel
 *                                            missing here is not offered to that kind
 *   sms?: bool,                              text the event's static SMS list
 *   title(data) → string,                    in-app title, email heading, SMS text
 *   link(data, kind) → string | null,        app-relative path
 *   email?: { subject(data), send?(recipient, data) → Promise<boolean> },
 *   smsText?(data) → string,
 * })
 */
const events = new Map();

export function defineNotificationEvent(def) {
  const { key, label, kinds, defaults, title, link, email, smsText } = def ?? {};
  if (typeof key !== "string" || !key.trim()) throw new Error("notification event needs a key");
  if (events.has(key)) throw new Error(`notification event ${key} is already registered`);
  if (!Array.isArray(kinds) || kinds.length === 0) throw new Error(`notification event ${key} needs kinds`);
  for (const k of kinds) {
    if (!defaults?.[k] || typeof defaults[k] !== "object") throw new Error(`notification event ${key} needs defaults for kind ${k}`);
  }
  if (typeof title !== "function") throw new Error(`notification event ${key} needs a title(data) function`);
  if (link != null && typeof link !== "function") throw new Error(`notification event ${key}: link must be a function`);
  if (email?.subject != null && typeof email.subject !== "function") throw new Error(`notification event ${key}: email.subject must be a function`);
  if (email?.send != null && typeof email.send !== "function") throw new Error(`notification event ${key}: email.send must be a function`);
  if (smsText != null && typeof smsText !== "function") throw new Error(`notification event ${key}: smsText must be a function`);
  const event = Object.freeze({ ...def, label: label || key, kinds: [...kinds], sms: Boolean(def.sms) });
  events.set(key, event);
  return event;
}

export function getEvent(key) {
  return events.get(key) ?? null;
}

/** Every registered event, in registration order; `kind` keeps only events that reach it. */
export function listEvents({ kind } = {}) {
  const all = [...events.values()];
  return kind ? all.filter((e) => e.kinds.includes(kind)) : all;
}

/** Test only. */
export function clearEvents() {
  events.clear();
}
