import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";

const getRowId = (c) => c.id;
const searchFn = (c, q) => `${c.name} ${c.email} ${c.practice ?? ""} ${c.accountNumber ?? ""}`.toLowerCase().includes(q.toLowerCase());

const COLUMNS = [
  {
    id: "client", header: "Client", exportValue: (c) => c.name, sortValue: (c) => c.name.toLowerCase(),
    cell: (c) => (
      <div>
        <div className="font-semibold text-navy">{c.name}</div>
        {c.name !== c.email && <div className="text-xs text-navy/40">{c.email}</div>}
      </div>
    ),
  },
  { id: "practice", header: "Practice", exportValue: (c) => c.practice ?? "", sortValue: (c) => (c.practice ?? "").toLowerCase(), cell: (c) => <span className="text-navy/60">{c.practice ?? "—"}</span> },
  { id: "account", header: "Account #", exportValue: (c) => c.accountNumber ?? "", cell: (c) => <span className="font-mono text-xs text-navy/60">{c.accountNumber ?? "—"}</span> },
  { id: "position", header: "Precedence", align: "right", exportValue: (c) => c.position + 1, sortValue: (c) => c.position, cell: (c) => c.position + 1 },
];

/** The clients assigned to one price list; a row opens that client's pricing page. */
export function PriceListClientsTab({ listId }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/price-lists/${listId}/clients`);
      setRows(res.data.data);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [listId]);
  useEffect(() => { load(); }, [load]);

  const table = useDataTable({ mode: "client", rows, searchFn, getRowId, loading, error, reload: load });
  return (
    <DataTable
      table={table}
      columns={COLUMNS}
      selectable={false}
      onRowClick={(c) => navigate(ROUTES.ADMIN_CLIENT_PRICING.replace(":userId", c.id))}
      searchPlaceholder="Name, email, practice or account #"
      itemLabel="clients"
      exportFileName="price-list-clients.csv"
      emptyText="No clients are on this list yet. Assign it from the Users page."
    />
  );
}
