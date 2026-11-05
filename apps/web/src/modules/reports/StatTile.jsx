import { Link } from "react-router-dom";
import { formatCell } from "@my-app/shared";

/**
 * Change vs the previous period: `{ arrow, text, words }`, or null when there
 * is nothing to compare with (previous missing or 0).
 */
export function deltaOf(value, previous) {
  const now = Number(value);
  const before = Number(previous);
  if (previous === null || previous === undefined || previous === "" || !Number.isFinite(before) || before === 0 || !Number.isFinite(now)) {
    return null;
  }
  const pct = ((now - before) / Math.abs(before)) * 100;
  const text = `${Math.abs(pct).toFixed(1)}%`;
  if (pct > 0) return { arrow: "▲", text, words: `up ${text} on the previous period` };
  if (pct < 0) return { arrow: "▼", text, words: `down ${text} on the previous period` };
  return { arrow: "", text, words: "no change on the previous period" };
}

/**
 * One headline number. `format` is a column type ("int", "money", "pct",
 * "duration_days", …) and goes through the shared formatCell, so a tile and
 * its report show the same text. The delta is neutral ink: whether up is good
 * depends on the number, so it is not coloured. `href` makes the tile a link.
 * `detail` is an optional list of related counts shown under the value
 * (`[{ id, label, value, format? }]` reads "35 declining · 111 inactive").
 *
 *   <StatTile title="New today" value={7} previous={5} format="int" href="/reports/x" />
 */
export function StatTile({ title, value, previous, format = "int", href, note, detail }) {
  const shown = formatCell({ type: format }, value) || "—";
  const delta = deltaOf(value, previous);
  const details = Array.isArray(detail) && detail.length > 0
    ? detail.map((d) => `${formatCell({ type: d.format ?? "int" }, d.value) || "0"} ${d.label}`).join(" · ")
    : null;
  const body = (
    <>
      <p className="font-mono text-[10px] uppercase tracking-widest text-navy/50">{title}</p>
      <p className="mt-2 font-heading text-3xl font-bold tabular-nums tracking-tight text-navy">{shown}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-navy/60">
        {delta && (
          <span className="tabular-nums">
            <span aria-hidden="true">{delta.arrow}{delta.arrow ? " " : ""}{delta.text}</span>
            <span className="sr-only">{delta.words}</span>
          </span>
        )}
        {details && <span>{details}</span>}
        {note && <span>{note}</span>}
      </div>
    </>
  );
  const cls = "block h-full rounded-2xl border border-surface-300/50 bg-white p-5";
  return href ? (
    <Link to={href} className={`${cls} transition-transform hover:scale-[1.01] hover:border-brand-500/50`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
