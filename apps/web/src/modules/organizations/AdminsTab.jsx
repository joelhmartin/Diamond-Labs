import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { DataTable } from "../../components/ui/data-table/index.js";
import { Button } from "../../components/ui/Button.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { eachRow } from "../../lib/data-table/bulk.js";
import { errorText } from "../../lib/requests.js";
import { PickerModal } from "./PickerModal.jsx";
import { addAdmin, removeAdmin } from "./api.js";

const getRowId = (a) => a.userId;

/**
 * The people who act across a whole organization.
 *
 *   admins        [{ userId, status }] from the organization detail (only active ones are listed)
 *   usersSource   { list({ q, limit, offset, excludeIds }) -> { rows: [{ id, label, detail? }], total },
 *                   labels(ids) -> { [id]: label } }
 *   onChanged     called after an add or remove (reload the detail)
 */
export function AdminsTab({ organizationId, admins, usersSource, base, onChanged }) {
  const { addToast } = useToast();
  const [picking, setPicking] = useState(false);
  const [labels, setLabels] = useState({});
  const active = useMemo(() => admins.filter((a) => a.status === "active"), [admins]);
  const key = active.map((a) => a.userId).join(",");

  useEffect(() => {
    if (!active.length) return undefined;
    let live = true;
    usersSource.labels(active.map((a) => a.userId)).then((found) => { if (live) setLabels(found ?? {}); }).catch(() => {});
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const nameOf = (a) => labels[a.userId] ?? a.userId;

  const table = useDataTable({
    rows: active, getRowId,
    searchFn: (a, q) => nameOf(a).toLowerCase().includes(q.toLowerCase()),
  });

  const columns = [{ id: "user", header: "Admin", exportValue: nameOf, cell: (a) => <span className="font-medium text-navy">{nameOf(a)}</span> }];

  const bulkActions = [{
    id: "remove", label: "Remove", icon: <Trash2 size={12} />, tone: "danger", confirmLabel: "Click again to remove",
    run: async (picked) => {
      const result = await eachRow(picked, (a) => removeAdmin(organizationId, a.userId, base), nameOf);
      table.selection.clear();
      onChanged();
      return result;
    },
  }];

  const add = async (picked) => {
    try {
      for (const u of picked) await addAdmin(organizationId, u.id, base);
      addToast({ message: `${picked.length} added.`, type: "success" });
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
    onChanged();
  };

  return (
    <>
      <DataTable
        table={table}
        columns={columns}
        bulkActions={bulkActions}
        searchPlaceholder="Name"
        itemLabel="admins"
        exportable={false}
        emptyText="Nobody administers this group yet."
        toolbarRight={<Button size="sm" onClick={() => setPicking(true)}><Plus size={14} /> Add admin</Button>}
      />
      {picking && (
        <PickerModal title="Add admins" source={usersSource} excludeIds={active.map((a) => a.userId)} onPick={add} onClose={() => setPicking(false)} itemLabel="people" />
      )}
    </>
  );
}
