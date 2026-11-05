import { useState } from "react";
import { LAB_TIMEZONE } from "@my-app/shared";
import { AlertCenter, PreferencesPanel } from "../../modules/notifications/index.js";

const TABS = [
  { id: "alerts", label: "Alerts" },
  { id: "preferences", label: "Preferences" },
];

/** My notifications: the alert list and the per-alert channel switches. Used by both shells. */
export function NotificationsPage() {
  const [tab, setTab] = useState("alerts");
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 md:p-8">
      <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Notifications</h1>
      <div role="tablist" className="flex gap-1 border-b border-surface-300/50">
        {TABS.map((t) => (
          <button
            key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t.id ? "border-brand-500 text-brand-700" : "border-transparent text-navy/50 hover:text-navy"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "alerts" ? <AlertCenter timeZone={LAB_TIMEZONE} /> : <PreferencesPanel />}
    </div>
  );
}
