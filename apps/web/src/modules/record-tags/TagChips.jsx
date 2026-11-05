import { tagColorClass } from "./tag-colors.js";

/** Read-only colored chips for a record's tags (`[{ id, label, color }]`); renders nothing for none. */
export function TagChips({ tags }) {
  if (!tags?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t.id} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tagColorClass(t.color)}`}>{t.label}</span>
      ))}
    </span>
  );
}
