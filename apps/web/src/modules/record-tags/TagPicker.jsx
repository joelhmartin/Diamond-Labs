import { useTagDefinitions } from "./useTagDefinitions.js";
import { tagColorClass } from "./tag-colors.js";

/**
 * Toggle chips over the record type's active labels. Controlled: `value` is the
 * chosen tag ids and `onChange(nextIds)` fires on every toggle. `applied` (tags
 * already on the record) keeps an inactive label visible so it can be removed.
 */
export function TagPicker({ recordType, value = [], onChange, applied = [], disabled = false }) {
  const { definitions } = useTagDefinitions(recordType);
  const options = [...definitions, ...applied.filter((a) => !definitions.some((d) => d.id === a.id))];
  if (options.length === 0) return null;
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((t) => {
        const on = value.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => toggle(t.id)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all disabled:opacity-40 ${
              on ? `${tagColorClass(t.color)} ring-2 ring-navy/30` : "bg-surface-100 text-navy/50 hover:bg-surface-200"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
