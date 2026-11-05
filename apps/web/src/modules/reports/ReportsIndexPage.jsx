import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Search, Star } from "lucide-react";
import { reportPath } from "../../config/routes.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { errorText } from "../../lib/requests.js";
import { listReports, setFavorite } from "./api.js";

/** Case-insensitive match on title, description and group title. */
export function matchesReport(report, groupTitle, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [report.title, report.description, groupTitle].some((s) => String(s ?? "").toLowerCase().includes(needle));
}

/** Sections in display sequence: the person's stars, featured, then each group in the server's sequence. */
export function buildSections(groups, reports) {
  const sections = [
    { key: "favorites", title: "Favorites", items: reports.filter((r) => r.favorite) },
    { key: "featured", title: "Featured", items: reports.filter((r) => r.featured) },
    ...groups.map((g) => ({ key: g.key, title: g.title, items: reports.filter((r) => r.group === g.key) })),
  ];
  return sections.filter((s) => s.items.length > 0);
}

/** Every report the person may see: search, stars, featured and the groups. */
export function ReportsIndexPage() {
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    listReports().then(setData).catch(setLoadError);
  }, []);

  const groupTitle = useMemo(() => new Map((data?.groups ?? []).map((g) => [g.key, g.title])), [data]);
  const sections = useMemo(() => {
    if (!data) return [];
    const shown = data.reports.filter((r) => matchesReport(r, groupTitle.get(r.group), q));
    return buildSections(data.groups, shown);
  }, [data, groupTitle, q]);

  const patch = (key, favorite) =>
    setData((d) => ({ ...d, reports: d.reports.map((r) => (r.key === key ? { ...r, favorite } : r)) }));

  // Optimistic: flip now, put it back if the save fails.
  const toggleStar = async (report) => {
    const next = !report.favorite;
    patch(report.key, next);
    try {
      await setFavorite(report.key, next);
    } catch (err) {
      patch(report.key, !next);
      addToast({ message: errorText(err), type: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Reports</h1>
        <div className="relative w-full sm:w-80">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy/30" />
          <input
            type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search reports…" aria-label="Search reports"
            className="h-9 w-full rounded-xl border border-surface-300/60 bg-white pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>
      </div>
      {loadError && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{errorText(loadError)}</p>}
      {!data && !loadError && (
        <p className="inline-flex items-center gap-2 text-sm text-navy/40"><Loader2 size={14} className="animate-spin" /> Loading…</p>
      )}
      {data && sections.length === 0 && <p className="text-sm text-navy/50">No reports match “{q}”.</p>}
      {sections.map((section) => (
        <section key={section.key} aria-labelledby={`reports-${section.key}`}>
          <h2 id={`reports-${section.key}`} className="mb-2 font-mono text-[10px] uppercase tracking-widest text-navy/40">
            {section.title}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((r) => <ReportCard key={r.key} report={r} onStar={() => toggleStar(r)} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ReportCard({ report, onStar }) {
  const { title, description, available, missing } = report;
  return (
    <li className={`flex items-start gap-3 rounded-2xl border border-surface-300/50 bg-white p-4 ${available ? "" : "opacity-60"}`}>
      <div className="min-w-0 flex-1">
        {available ? (
          <Link to={reportPath(report.key)} className="font-semibold text-navy hover:text-brand-600">{title}</Link>
        ) : (
          <span className="font-semibold text-navy/70">{title}</span>
        )}
        {description && <p className="mt-0.5 text-xs text-navy/60">{description}</p>}
        {!available && (
          <p className="mt-1 text-[11px] font-medium text-navy/50">
            Not available yet{missing?.length ? ` (needs ${missing.join(", ")})` : ""}
          </p>
        )}
      </div>
      <button
        type="button" onClick={onStar} aria-pressed={Boolean(report.favorite)}
        aria-label={`${report.favorite ? "Unstar" : "Star"} ${title}`}
        className="rounded-full p-1 text-navy/30 hover:text-amber-500"
      >
        <Star size={16} className={report.favorite ? "fill-amber-400 text-amber-400" : ""} />
      </button>
    </li>
  );
}
