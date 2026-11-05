import { addDays } from "../../modules/business-calendar/index.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekdayOf = (date) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

/** "Due tomorrow", or "Due Mon" when the next working day is not the next calendar day. */
function tomorrowLabel({ today, tomorrowDate }) {
  if (!today || !tomorrowDate || tomorrowDate === addDays(today, 1)) return "Due tomorrow";
  return `Due ${weekdayOf(tomorrowDate)}`;
}

/**
 * The production board's schedule tiles. `tiles` is the `/lab/schedule/tiles`
 * reply; `active` the selected tile key (or null). Clicking the active tile
 * calls `onSelect(null)`, any other `onSelect(key)`.
 */
export function BoardTiles({ tiles, active, onSelect }) {
  const t = tiles ?? {};
  const items = [
    { key: "past_due", label: "Past due", count: t.pastDue, tone: "text-red-600" },
    { key: "due_today", label: "Due today", count: t.dueToday },
    { key: "due_tomorrow", label: tomorrowLabel(t), count: t.dueTomorrow },
    { key: "on_hold", label: "On hold", count: t.onHold },
    { key: "at_risk", label: "At risk", count: t.atRisk, tone: "text-amber-600" },
  ];
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
      {items.map((i) => {
        const on = active === i.key;
        return (
          <button
            key={i.key}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect(on ? null : i.key)}
            className={`flex items-baseline justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${on ? "border-navy bg-navy text-white" : "border-surface-300/50 bg-white hover:bg-surface-50"}`}
          >
            <span className={`text-xs font-semibold ${on ? "text-white" : "text-navy/70"}`}>{i.label}</span>
            <span className={`font-heading text-2xl font-bold tabular-nums ${on ? "text-white" : i.tone ?? "text-navy"}`}>{i.count ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}
