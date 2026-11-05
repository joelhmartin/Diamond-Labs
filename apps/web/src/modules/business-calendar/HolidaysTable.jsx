import { useState } from "react";
import { Trash2 } from "lucide-react";
import api from "../../config/api.js";
import { useResource } from "../../hooks/useResource.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { errorText } from "../../lib/requests.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { DataTable } from "../../components/ui/data-table/index.js";

const COLUMNS = [
  { id: "date", header: "Date", cell: (h) => h.date, sortValue: (h) => h.date },
  { id: "label", header: "Label", cell: (h) => h.label, sortValue: (h) => h.label },
];
const NONE = [];
const searchFn = (h, q) => `${h.date} ${h.label}`.toLowerCase().includes(q.toLowerCase());

/** The calendar's holidays: add one, bulk-delete many (two clicks). */
export function HolidaysTable({ basePath = "/scheduling/calendar" }) {
  const { addToast } = useToast();
  const { data, loading, error, reload } = useResource(basePath);
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);

  const table = useDataTable({
    mode: "client", rows: data?.holidays ?? NONE, searchFn, loading, error, reload,
    getRowId: (h) => h.id, initialSort: { id: "date", dir: "asc" },
  });

  const add = async (e) => {
    e.preventDefault();
    setAdding(true);
    try {
      await api.post(`${basePath}/holidays`, { date, label });
      setDate("");
      setLabel("");
      addToast({ message: "Holiday added", type: "success" });
      reload();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setAdding(false);
    }
  };

  const bulkActions = [
    {
      id: "delete", label: "Delete", icon: <Trash2 size={12} />, tone: "danger",
      confirmLabel: "Click again to delete",
      run: async (rows) => {
        const res = await api.post(`${basePath}/holidays/delete`, { ids: rows.map((h) => h.id) });
        table.selection.clear();
        reload();
        return { ok: res.data.data.count, failed: [] };
      },
    },
  ];

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <Input label="Date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label="Label" required maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button type="submit" loading={adding}>Add holiday</Button>
      </form>
      <DataTable table={table} columns={COLUMNS} bulkActions={bulkActions} itemLabel="holidays" exportFileName="holidays.csv" emptyText="No holidays yet." />
    </div>
  );
}
