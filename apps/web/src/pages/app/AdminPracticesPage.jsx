import { useEffect, useState } from "react";
import { FolderPlus } from "lucide-react";
import api from "../../config/api.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { pageParams } from "../../lib/data-table/server.js";
import { eachRow } from "../../lib/data-table/bulk.js";
import { formatCents } from "../../lib/money.js";
import { PracticeDrawer } from "./PracticeDrawer.jsx";

const getRowId = (p) => p.id;

const COLUMNS = [
  {
    id: "practice", header: "Practice", exportValue: (p) => p.name,
    cell: (p) => <span className="font-medium text-navy">{p.name}</span>,
  },
  {
    id: "account", header: "Account #", exportValue: (p) => p.accountNumber ?? "",
    cell: (p) => (p.accountNumber ? <span className="font-mono text-xs text-navy/60">{p.accountNumber}</span> : <span className="text-xs font-semibold text-amber-700">Missing</span>),
  },
  { id: "group", header: "Group", exportValue: (p) => p.organization?.name ?? "", cell: (p) => <span className="text-navy/60">{p.organization?.name ?? "—"}</span> },
  { id: "members", header: "Members", align: "right", exportValue: (p) => p.memberCount, cell: (p) => <span className="font-mono text-xs text-navy/60">{p.memberCount}</span> },
  {
    id: "balance", header: "Open balance", align: "right", exportValue: (p) => (p.openBalanceCents / 100).toFixed(2),
    cell: (p) => <span className={p.openBalanceCents > 0 ? "font-semibold" : "text-navy/40"}>{p.openBalanceCents > 0 ? formatCents(p.openBalanceCents) : "—"}</span>,
  },
];

/** Admin > Practices: every practice with its account number, group, members and open balance. A row opens the drawer. */
export function AdminPracticesPage() {
  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    api.get("/admin/organizations", { params: { status: "active", limit: 200 } })
      .then((res) => setGroups(res.data.data.rows))
      .catch(() => setGroups([]));
  }, []);

  const filters = [
    { id: "organizationId", label: "Group", type: "select", placeholder: "All groups", options: groups.map((g) => ({ value: g.id, label: g.name })), match: () => true },
    { id: "missingNumber", label: "No account number", type: "toggle", match: () => true },
  ];

  async function fetchPage({ page, pageSize, q, filters: f }) {
    const params = pageParams({ page, pageSize, q });
    if (f.organizationId) params.organizationId = f.organizationId;
    if (f.missingNumber) params.missingNumber = "true";
    const res = await api.get("/admin/practices", { params });
    return res.data.data;
  }
  const table = useDataTable({ mode: "server", fetchPage, filters, urlKey: "pr", getRowId });

  const bulkActions = [{
    id: "add-to-group", label: "Add to group", icon: <FolderPlus size={12} />,
    choices: groups.map((g) => ({ value: g.id, label: g.name })), choicePlaceholder: "Choose a group…",
    run: async (rows, groupId) => {
      const result = await eachRow(rows, (p) => api.post(`/admin/organizations/${groupId}/accounts`, { accountIds: [p.id] }).then((res) => {
        if (res.data.data.alreadyInOther?.length) throw new Error("Already in another group.");
      }), (p) => p.name);
      table.reload();
      return result;
    },
  }];

  return (
    <div className="mx-auto max-w-6xl p-6 md:p-8">
      <div className="mb-6">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Practices</h1>
        <p className="mt-1 text-sm text-navy/50">Account numbers, groups and who works where.</p>
      </div>
      <DataTable
        table={table}
        columns={COLUMNS}
        bulkActions={bulkActions}
        onRowClick={setOpen}
        searchPlaceholder="Practice name or account #"
        itemLabel="practices"
        exportFileName="practices.csv"
        emptyText="No practices match."
      />
      {open && (
        <PracticeDrawer practice={open} onClose={() => setOpen(null)} onChanged={() => table.reload()} />
      )}
    </div>
  );
}
