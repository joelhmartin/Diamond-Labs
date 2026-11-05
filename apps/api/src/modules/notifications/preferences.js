/**
 * Whether a user of `kind` gets `event` on `channel` ("in_app" | "email").
 *
 * A channel is offered to a kind only when the event reaches that kind and
 * lists the channel in `defaults[kind]`; otherwise it is off whatever the user
 * saved. When offered, the user's saved row wins and a missing row means the
 * default. `rows` are that user's preference rows ({ event, channel, enabled }).
 */
export function isOffered(event, kind, channel) {
  return Boolean(event?.kinds?.includes(kind)) && typeof event.defaults?.[kind]?.[channel] === "boolean";
}

export function effectivePreference(rows, event, kind, channel) {
  if (!isOffered(event, kind, channel)) return false;
  const row = (rows ?? []).find((r) => r.event === event.key && r.channel === channel);
  return row ? Boolean(row.enabled) : event.defaults[kind][channel];
}
