import { formatCell } from "@my-app/shared";
import { useVisibleInterval } from "./useVisibleInterval.js";

export const FEED_POLL_MS = 30000;
export const FEED_LIMIT = 50;
const TIME_TYPES = new Set(["datetime", "date"]);

/**
 * A live list of recent events (a report's rows, newest first). The first
 * date/datetime column is the timestamp; the other columns read as one line.
 *
 * Polling: `reload()` every 30 s, only while the page is visible. Hidden stops
 * it; becoming visible again refreshes at once and resumes; unmount stops it.
 * DashboardPage passes a `reload` that refetches just this tile.
 *
 *   <FeedTile rows={rows} columns={columnSpecs} reload={() => …} />
 */
export function FeedTile({ rows = [], columns = [], reload, intervalMs = FEED_POLL_MS }) {
  useVisibleInterval(() => reload?.(), intervalMs, Boolean(reload));

  const timeCol = columns.find((c) => TIME_TYPES.has(c.type));
  const rest = columns.filter((c) => c !== timeCol);
  const shown = rows.slice(0, FEED_LIMIT);

  if (shown.length === 0) return <p className="text-sm text-navy/50">Nothing yet.</p>;
  return (
    <ol className="max-h-96 divide-y divide-surface-200 overflow-y-auto" aria-live="polite">
      {shown.map((row, i) => (
        // eslint-disable-next-line react/no-array-index-key -- feed rows carry no id
        <li key={i} className="flex gap-3 py-2 text-sm">
          {timeCol && <time className="shrink-0 font-mono text-[11px] text-navy/50">{formatCell(timeCol, row[timeCol.id])}</time>}
          <span className="min-w-0 text-navy/80">
            {rest.map((c) => formatCell(c, row[c.id])).filter(Boolean).join(" · ")}
          </span>
        </li>
      ))}
    </ol>
  );
}
