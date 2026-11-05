import { ChevronLeft, ChevronRight } from "lucide-react";
import { monthCells, weekCells, shiftAnchor, monthTitle } from "./calendar-grid.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TINT = { under: "bg-emerald-50", near: "bg-amber-50", over: "bg-red-50" };
const CELL = "flex min-h-[72px] flex-col items-start gap-1 rounded-xl border border-surface-300/50 p-2 text-left text-xs";
const NAV = "rounded-full bg-surface-100 p-1.5 text-navy hover:bg-surface-200";

/** "3" or "3 / 10" when the day has a capacity. */
function loadText(day) {
  return day.capacity == null ? String(day.count) : `${day.count} / ${day.capacity}`;
}

function DefaultCell({ day }) {
  return <span className="font-mono text-[11px] tabular-nums text-navy/70">{loadText(day)}</span>;
}

/**
 * A month (6 weeks) or week grid of days, tinted by load level. `days` is the
 * `…/days` response (`{ date, open, holiday, capacity, count, level }`); dates
 * it does not cover render empty. Closed days show their holiday label and
 * cannot be clicked. `renderCell(day)` replaces the default count text.
 * `onAnchorChange(date)` is asked for the previous/next month or week.
 */
export function CalendarGrid({ days = [], view = "month", anchor, onAnchorChange, onDayClick, renderCell }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const cells = view === "week" ? weekCells(anchor) : monthCells(anchor);
  const inMonth = (date) => view === "week" || date.slice(0, 7) === anchor.slice(0, 7);
  const Body = renderCell ?? DefaultCell;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy">{view === "week" ? `Week of ${cells[0]}` : monthTitle(anchor)}</h3>
        <div className="flex gap-1">
          <button type="button" aria-label="Previous" className={NAV} onClick={() => onAnchorChange?.(shiftAnchor(anchor, view, -1))}><ChevronLeft size={16} /></button>
          <button type="button" aria-label="Next" className={NAV} onClick={() => onAnchorChange?.(shiftAnchor(anchor, view, 1))}><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-1 font-mono text-[10px] uppercase tracking-widest text-navy/40">{w}</div>
        ))}
        {cells.map((date) => {
          const day = byDate.get(date);
          const dayNumber = Number(date.slice(8));
          const faded = inMonth(date) ? "" : "opacity-40";
          if (day && !day.open) {
            return (
              <div key={date} data-testid={`day-${date}`} className={`${CELL} bg-surface-100 text-navy/50 ${faded}`}>
                <span className="font-semibold">{dayNumber}</span>
                <span className="text-[10px] leading-tight">{day.holiday ?? "Closed"}</span>
              </div>
            );
          }
          const tint = TINT[day?.level] ?? "bg-white";
          const content = (
            <>
              <span className="font-semibold text-navy">{dayNumber}</span>
              {day && <Body day={day} />}
            </>
          );
          if (!day || !onDayClick) {
            return <div key={date} data-testid={`day-${date}`} className={`${CELL} ${tint} ${faded}`}>{content}</div>;
          }
          return (
            <button
              key={date}
              type="button"
              data-testid={`day-${date}`}
              aria-label={`${date}, ${loadText(day)}`}
              onClick={() => onDayClick(date)}
              className={`${CELL} ${tint} ${faded} transition-shadow hover:shadow-md`}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}
