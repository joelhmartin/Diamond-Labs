/** Small pill toggle for switching between a few views. options: [{ value, label, icon? }]. */
export function SegmentedControl({ value, onChange, options, label = "View" }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-surface-100 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "bg-white text-navy shadow-sm" : "text-navy/50 hover:text-navy"}`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
