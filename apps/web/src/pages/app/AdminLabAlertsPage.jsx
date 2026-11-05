import { useEffect, useState } from "react";
import { LAB_TIMEZONE } from "@my-app/shared";
import { DeliveriesTable, RecipientsPanel, fetchEvents } from "../../modules/notifications/index.js";

/** Admin › Lab alerts: who gets a text for each lab event, and what was actually sent. */
export function AdminLabAlertsPage() {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    let live = true;
    fetchEvents().then((rows) => { if (live) setEvents(rows); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const eventLabels = Object.fromEntries(events.map((e) => [e.key, e.label]));
  const smsEvents = events.filter((e) => e.sms);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 md:p-8">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Lab alerts</h1>
        <p className="mt-1 text-sm text-navy/50">Text-message recipients for each lab event, and the delivery log.</p>
      </div>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-navy">Text recipients</h2>
        <RecipientsPanel events={smsEvents} />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-navy">Deliveries</h2>
        <DeliveriesTable timeZone={LAB_TIMEZONE} eventLabels={eventLabels} />
      </section>
    </div>
  );
}
