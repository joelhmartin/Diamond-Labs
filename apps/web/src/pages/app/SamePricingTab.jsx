import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { CONTROL } from "../../components/ui/data-table/FilterControl.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";

const getRowId = (g) => g.signature;
const preview = (g) => g.clients.slice(0, 3).map((c) => c.name).join(", ") + (g.size > 3 ? `, +${g.size - 3} more` : "");
const searchFn = (g, q) => `${g.lists.join(" ")} ${g.clients.map((c) => `${c.name} ${c.practice ?? ""} ${c.accountNumber ?? ""}`).join(" ")}`.toLowerCase().includes(q.toLowerCase());
const listsText = (g) => (g.lists.length ? g.lists.join(", ") : "Base prices");

const COLUMNS = [
  { id: "size", header: "Clients", align: "right", exportValue: (g) => g.size, sortValue: (g) => g.size, cell: (g) => <span className="font-semibold text-navy">{g.size}</span> },
  { id: "lists", header: "Lists", exportValue: listsText, sortValue: (g) => listsText(g).toLowerCase(), cell: (g) => <span className="text-navy/70">{listsText(g)}</span> },
  { id: "overrides", header: "Overrides", align: "right", exportValue: (g) => g.overrideCount, sortValue: (g) => g.overrideCount, cell: (g) => g.overrideCount },
  { id: "clients", header: "Clients (first three)", exportValue: (g) => g.clients.map((c) => c.name).join("; "), cell: (g) => <span className="text-navy/60">{preview(g)}</span> },
];

function GroupClients({ group }) {
  return (
    <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {group.clients.map((c) => (
        <li key={c.id}>
          <Link to={ROUTES.ADMIN_CLIENT_PRICING.replace(":userId", c.id)} className="font-medium text-brand-600 hover:underline">{c.name}</Link>
          {(c.practice || c.accountNumber) && (
            <span className="ml-2 text-xs text-navy/40">{[c.practice, c.accountNumber && `#${c.accountNumber}`].filter(Boolean).join(" · ")}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Clients grouped by identical effective prices. Singletons are hidden until the toggle is on (refetches with includeSingles). */
export function SamePricingTab() {
  const [includeSingles, setIncludeSingles] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const latest = useRef(0);
  const load = useCallback(async () => {
    const token = ++latest.current; // a slower, older response must not overwrite the newer one
    setLoading(true);
    try {
      const res = await api.get("/admin/prices/same-pricing", { params: includeSingles ? { includeSingles: "1" } : {} });
      if (token !== latest.current) return;
      setRows(res.data.data.groups);
      setError(null);
    } catch (err) {
      if (token === latest.current) setError(err);
    } finally {
      if (token === latest.current) setLoading(false);
    }
  }, [includeSingles]);
  useEffect(() => { load(); }, [load]);

  const table = useDataTable({ mode: "client", rows, searchFn, getRowId, loading, error, reload: load, initialSort: { id: "size", dir: "desc" } });
  return (
    <DataTable
      table={table}
      columns={COLUMNS}
      selectable={false}
      toolbarRight={(
        <button type="button" aria-pressed={includeSingles} onClick={() => setIncludeSingles((v) => !v)}
          className={`${CONTROL} font-medium ${includeSingles ? "border-brand-500 bg-brand-500/10 text-brand-700" : "text-navy/60 hover:text-navy"}`}>
          Include single clients
        </button>
      )}
      renderExpanded={(g) => <GroupClients group={g} />}
      searchPlaceholder="List, client, practice or account #"
      itemLabel="groups"
      exportFileName="same-pricing.csv"
      emptyText="No two clients share the same pricing."
    />
  );
}
