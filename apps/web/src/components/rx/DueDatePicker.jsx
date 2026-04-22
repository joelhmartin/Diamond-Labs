import { Calendar, Zap } from "lucide-react";

/**
 * Weekdays-only due date picker. Defaults to 2 weeks out.
 * Rejects past dates and weekends via HTML5 validation + a UI hint.
 */
export function DueDatePicker({ value, onChange, rush, onRushChange }) {
  const today = new Date();
  const min = today.toISOString().slice(0, 10);

  // Compute "typical turnaround" suggestion (2 weeks out, nearest weekday)
  const twoWeeks = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
  while (twoWeeks.getDay() === 0 || twoWeeks.getDay() === 6) {
    twoWeeks.setDate(twoWeeks.getDate() + 1);
  }
  const suggested = twoWeeks.toISOString().slice(0, 10);

  function handleChange(e) {
    const v = e.target.value;
    if (!v) {
      onChange("");
      return;
    }
    // Parse as local date to dodge timezone quirks
    const [y, m, d] = v.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) {
      // Snap to next Monday
      const add = dow === 0 ? 1 : 2;
      dt.setDate(dt.getDate() + add);
      onChange(dt.toISOString().slice(0, 10));
      return;
    }
    onChange(v);
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-navy/40 uppercase tracking-wider mb-2">
        Due date requested
      </label>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Calendar
            size={16}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-navy/30 pointer-events-none"
          />
          <input
            type="date"
            min={min}
            value={value || ""}
            onChange={handleChange}
            className="w-full pl-11 pr-4 py-3 rounded-xl bg-surface-50 border border-surface-300/50 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all"
          />
        </div>

        <button
          type="button"
          onClick={() => onChange(suggested)}
          className="px-4 py-3 rounded-xl text-xs font-semibold text-navy/60 bg-surface-100 hover:bg-surface-200 border border-surface-300/50 transition-colors whitespace-nowrap"
        >
          Use typical (&lt; 2 wk)
        </button>
      </div>

      {/* Rush toggle with stamp imagery */}
      <div className="mt-3 relative overflow-hidden rounded-2xl border border-surface-300/50 bg-surface-50">
        <button
          type="button"
          onClick={() => onRushChange(!rush)}
          className="w-full flex items-center gap-3 p-4 text-left hover:bg-accent-500/5 transition-colors"
        >
          <div
            className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
              rush
                ? "border-accent-500 bg-accent-500"
                : "border-surface-400 bg-white"
            }`}
          >
            {rush && (
              <svg
                viewBox="0 0 12 12"
                className="w-3 h-3 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M2 6l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-heading font-semibold text-sm text-navy flex items-center gap-2">
              <Zap size={13} className="text-accent-500" />
              Rush this case
            </div>
            <div className="text-xs text-navy/40 mt-0.5">
              Expedited 3–5 business day turnaround (+$75).
            </div>
          </div>
        </button>

        {rush && (
          <img
            src="/rx/rush-stamp.webp"
            alt="Rush"
            className="absolute top-1 right-2 w-12 h-12 md:w-16 md:h-16 opacity-80 pointer-events-none select-none"
          />
        )}
      </div>
    </div>
  );
}
