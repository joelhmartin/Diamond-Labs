import { LAB_ENCLOSED_KINDS, LAB_ENCLOSED_LABELS, LAB_ENCLOSURE_NOTE_MAX } from "@my-app/shared";
import { INPUT_BASE } from "../form-styles.js";

/**
 * The enclosed-items editor: one tick per kind, with a date and a short note
 * for each ticked kind. Controlled: `value` is [{ kind, date?, note? }] and
 * `onChange` gets the next list, kept in kind order with blank date/note
 * left out. Used by the production panel and the New order page; the labels
 * come from the shared vocabulary.
 */
export function EnclosedFields({ value, onChange, disabled = false }) {
  const items = Array.isArray(value) ? value : [];
  const byKind = new Map(items.map((e) => [e.kind, e]));

  const emit = (map) => onChange(LAB_ENCLOSED_KINDS.filter((k) => map.has(k)).map((k) => map.get(k)));
  const toggle = (kind) => {
    const next = new Map(byKind);
    if (next.has(kind)) next.delete(kind);
    else next.set(kind, { kind });
    emit(next);
  };
  const edit = (kind, key, text) => {
    const next = new Map(byKind);
    const { [key]: _old, ...rest } = next.get(kind);
    next.set(kind, text ? { ...rest, [key]: text } : rest);
    emit(next);
  };

  return (
    <div className="space-y-2">
      {LAB_ENCLOSED_KINDS.map((kind) => {
        const item = byKind.get(kind);
        const label = LAB_ENCLOSED_LABELS[kind];
        return (
          <div key={kind} className="flex flex-wrap items-center gap-2">
            <label className="flex w-28 items-center gap-2 text-sm text-navy">
              <input type="checkbox" disabled={disabled} checked={Boolean(item)} onChange={() => toggle(kind)} />
              {label}
            </label>
            {item && (
              <>
                <input
                  type="date"
                  aria-label={`${label} date`}
                  disabled={disabled}
                  className={`${INPUT_BASE} w-40`}
                  value={item.date ?? ""}
                  onChange={(e) => edit(kind, "date", e.target.value)}
                />
                <input
                  type="text"
                  aria-label={`${label} note`}
                  placeholder="Note"
                  maxLength={LAB_ENCLOSURE_NOTE_MAX}
                  disabled={disabled}
                  className={`${INPUT_BASE} min-w-0 flex-1`}
                  value={item.note ?? ""}
                  onChange={(e) => edit(kind, "note", e.target.value)}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
