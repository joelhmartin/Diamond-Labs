import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { CONTROL } from "../../components/ui/data-table/FilterControl.jsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { errorText } from "../../lib/requests.js";
import { SamePricingTab } from "./SamePricingTab.jsx";

const getRowId = (l) => l.id;
const FILTERS = [{ id: "archived", label: "Archived", type: "toggle", match: (l) => Boolean(l.archivedAt) }];
const searchFn = (l, q) => `${l.name} ${l.description ?? ""}`.toLowerCase().includes(q.toLowerCase());

const formatDate = (d) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

const COLUMNS = [
  {
    id: "name", header: "Name", exportValue: (l) => l.name, sortValue: (l) => l.name.toLowerCase(),
    cell: (l) => (
      <div>
        <span className={`font-semibold text-navy ${l.archivedAt ? "line-through opacity-60" : ""}`}>{l.name}</span>
        {l.archivedAt && <span className="ml-2 rounded-full bg-surface-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy/50">Archived</span>}
        {l.description && <div className="max-w-md truncate text-xs text-navy/40">{l.description}</div>}
      </div>
    ),
  },
  { id: "items", header: "Items", align: "right", exportValue: (l) => l.itemCount, sortValue: (l) => l.itemCount, cell: (l) => l.itemCount },
  { id: "clients", header: "Clients", align: "right", exportValue: (l) => l.clientCount, sortValue: (l) => l.clientCount, cell: (l) => l.clientCount },
  {
    id: "updated", header: "Updated", exportValue: (l) => l.updatedAt ?? "", sortValue: (l) => (l.updatedAt ? new Date(l.updatedAt) : null),
    cell: (l) => <span className="text-xs text-navy/60">{formatDate(l.updatedAt)}</span>,
  },
];

function NewListForm({ onCreated }) {
  const { addToast } = useToast();
  const [name, setName] = useState("");
  async function create(e) {
    e.preventDefault();
    try {
      const res = await api.post("/admin/price-lists", { name });
      onCreated(res.data.data.id);
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
  }
  return (
    <form onSubmit={create} className="flex items-center gap-2">
      <input aria-label="New list name" placeholder="New list name" value={name} onChange={(e) => setName(e.target.value)} className={`${CONTROL} w-48`} />
      <button type="submit" disabled={!name.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-500 px-4 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-40">
        <Plus size={12} /> New list
      </button>
    </form>
  );
}

function ListsTab() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/price-lists", { params: { includeArchived: "1" } });
      setRows(res.data.data);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const table = useDataTable({ mode: "client", rows, searchFn, filters: FILTERS, getRowId, loading, error, reload: load, initialSort: { id: "name", dir: "asc" } });
  return (
    <DataTable
      table={table}
      columns={COLUMNS}
      selectable={false}
      onRowClick={(l) => navigate(ROUTES.ADMIN_PRICE_LIST_DETAIL.replace(":id", l.id))}
      toolbarRight={<NewListForm onCreated={(id) => navigate(ROUTES.ADMIN_PRICE_LIST_DETAIL.replace(":id", id))} />}
      searchPlaceholder="List name"
      itemLabel="lists"
      exportFileName="price-lists.csv"
      emptyText="No price lists yet. Create one to start."
    />
  );
}

const VIEWS = [{ value: "lists", label: "Lists" }, { value: "same", label: "Same pricing" }];

export function AdminPriceListsPage() {
  const [tab, setTab] = useState("lists");
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-6 py-8">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Price lists</h1>
        <p className="mt-1 text-sm text-navy/50">Named price sets assigned to clients. A client's own price beats a list; earlier lists beat later ones.</p>
      </div>
      <SegmentedControl label="Price lists view" value={tab} onChange={setTab} options={VIEWS} />
      {tab === "lists" ? <ListsTab /> : <SamePricingTab />}
    </div>
  );
}
