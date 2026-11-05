// The one place app code emits notifications (roadmap rulings R-B / R-H).
// Import `notify` from here, never from modules/notifications. It delegates to
// the notifier installed by configureNotifications(); with none installed it
// resolves to zeros. It never throws, and callers must not depend on the
// counts it returns. Call it AFTER your transaction commits, with the root db.
import { currentNotifier } from "../modules/notifications/index.js";

const zero = () => ({ inApp: 0, sent: 0, skipped: 0, failed: 0 });

export async function notify(db, args) {
  let event;
  try {
    const { recordType, recordId, audience, data } = args ?? {};
    ({ event } = args ?? {});
    const notifier = currentNotifier();
    if (!notifier) return zero();
    return (await notifier.notify(db, { event, recordType, recordId, audience, data })) ?? zero();
  } catch (err) {
    console.error(`[NOTIFY][FAILED] event=${String(event ?? "").slice(0, 80)} reason=${String(err?.name ?? "Error").slice(0, 80)}`); // the name only: a message can echo an address
    return zero();
  }
}
