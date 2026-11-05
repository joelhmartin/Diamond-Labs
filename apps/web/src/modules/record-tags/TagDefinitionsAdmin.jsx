import { useMemo, useState } from "react";
import { TAG_COLORS } from "@my-app/shared";
import api from "../../config/api.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { errorText } from "../../lib/requests.js";
import { Button } from "../../components/ui/Button.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { DataTable } from "../../components/ui/data-table/index.js";
import { TagChips } from "./TagChips.jsx";
import { useTagDefinitions } from "./useTagDefinitions.js";

const FIELD = "h-8 rounded-lg border border-surface-300/60 bg-white px-2 text-sm text-navy focus:border-brand-500 focus:outline-none";

/**
 * Manage one record type's label vocabulary: add, rename, recolor, deactivate
 * (labels are never deleted, so history keeps its meaning). Uses the admin routes.
 */
export function TagDefinitionsAdmin({ recordType }) {
  const { addToast } = useToast();
  const { definitions, loading, error, reload } = useTagDefinitions(recordType, { includeInactive: true });
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("slate");
  const [adding, setAdding] = useState(false);
  const base = `/admin/tags/${recordType}/definitions`;

  const save = async (id, patch) => {
    try {
      await api.patch(`${base}/${id}`, patch);
      reload();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
      reload(); // put a rejected rename back to what the server has
    }
  };

  const add = async (e) => {
    e.preventDefault();
    setAdding(true);
    try {
      await api.post(base, { label, color });
      setLabel("");
      addToast({ message: "Label added", type: "success" });
      reload();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setAdding(false);
    }
  };

  const columns = useMemo(() => [
    {
      id: "label", header: "Label", sortValue: (t) => t.label, exportValue: (t) => t.label,
      cell: (t) => (
        <input
          key={`${t.id}:${t.label}`}
          aria-label={`Name of ${t.label}`}
          defaultValue={t.label}
          maxLength={40}
          className={`${FIELD} w-48`}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => { const next = e.target.value.trim(); if (next && next !== t.label) save(t.id, { label: next }); }}
        />
      ),
    },
    {
      id: "color", header: "Color", exportValue: (t) => t.color,
      cell: (t) => (
        <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <select aria-label={`Color of ${t.label}`} className={FIELD} value={t.color} onChange={(e) => save(t.id, { color: e.target.value })}>
            {TAG_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <TagChips tags={[t]} />
        </span>
      ),
    },
    {
      id: "active", header: "Status", sortValue: (t) => (t.active ? 0 : 1), exportValue: (t) => (t.active ? "Active" : "Inactive"),
      cell: (t) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); save(t.id, { active: !t.active }); }}
          className="rounded-full bg-surface-100 px-3 py-1 text-xs font-semibold text-navy hover:bg-surface-200"
        >
          {t.active ? "Deactivate" : "Activate"}
        </button>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [recordType]);

  const table = useDataTable({
    mode: "client", rows: definitions, loading, error, reload, getRowId: (t) => t.id, initialSort: null,
  });

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <input
          className={`${FIELD} h-10 w-56`} placeholder="New label" aria-label="New label" required maxLength={40}
          value={label} onChange={(e) => setLabel(e.target.value)}
        />
        <select className={`${FIELD} h-10`} aria-label="New label color" value={color} onChange={(e) => setColor(e.target.value)}>
          {TAG_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Button type="submit" loading={adding}>Add label</Button>
      </form>
      <DataTable table={table} columns={columns} searchable={false} selectable={false} paginated={false} itemLabel="labels" exportFileName="labels.csv" emptyText="No labels yet." />
    </div>
  );
}
