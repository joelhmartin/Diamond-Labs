import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE_OPTIONS } from "../../hooks/usePagination.js";

/**
 * Shared pagination control. Pair with the `usePagination` hook.
 *
 *   <Pagination {...pagination} itemLabel="invoices" />
 *
 * Edits here propagate to every page that uses it.
 */
export function Pagination({
  page,
  setPage,
  pageSize,
  setPageSize,
  total,
  totalPages,
  rangeStart,
  rangeEnd,
  itemLabel = "items",
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className = "",
}) {
  if (total === 0) return null;

  const pages = buildPageList(page, totalPages);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-4 ${className}`}
    >
      <div className="flex items-center gap-2 text-xs text-navy/50">
        <label htmlFor="page-size" className="font-mono uppercase tracking-widest text-[10px] text-navy/40">
          Per page
        </label>
        <select
          id="page-size"
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="px-2.5 py-1.5 rounded-lg bg-white border border-surface-300/60 text-navy text-xs focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all"
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <span className="ml-2 tabular-nums">
          {rangeStart}–{rangeEnd} of {total} {itemLabel}
        </span>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <PagerButton
            onClick={() => setPage(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={14} />
          </PagerButton>
          {pages.map((p, i) =>
            p === "…" ? (
              <span key={`ellipsis-${i}`} className="px-2 text-navy/30 text-xs">…</span>
            ) : (
              <PagerButton
                key={p}
                onClick={() => setPage(p)}
                active={p === page}
              >
                {p}
              </PagerButton>
            )
          )}
          <PagerButton
            onClick={() => setPage(page + 1)}
            disabled={page === totalPages}
            aria-label="Next page"
          >
            <ChevronRight size={14} />
          </PagerButton>
        </div>
      )}
    </div>
  );
}

function PagerButton({ children, onClick, disabled, active, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-w-[32px] h-8 px-2 rounded-lg text-xs font-mono tabular-nums transition-all ${
        active
          ? "bg-brand-500 text-white"
          : "text-navy/60 hover:bg-surface-200 hover:text-navy disabled:text-navy/30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

function buildPageList(current, total) {
  if (total <= 7) return range(1, total);
  if (current <= 4) return [1, 2, 3, 4, 5, "…", total];
  if (current >= total - 3) return [1, "…", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "…", current - 1, current, current + 1, "…", total];
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
