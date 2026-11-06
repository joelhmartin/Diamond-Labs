import { Plus } from "lucide-react";
import { DataTable } from "../../components/ui/data-table/index.js";
import { Modal } from "../../components/ui/Modal.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { pageParams } from "../../lib/data-table/server.js";

const getRowId = (r) => r.id;
const COLUMNS = [
  {
    id: "label", header: "Name", exportValue: (r) => r.label,
    cell: (r) => (
      <>
        <div className="font-medium text-navy">{r.label}</div>
        {r.detail && <div className="text-xs text-navy/40">{r.detail}</div>}
      </>
    ),
  },
];

/**
 * A modal list to pick rows (mount it only while picking) from a searchable source and hand them back.
 *
 *   source        { list({ q, limit, offset, ...sourceParams }) → { rows: [{ id, label, detail? }], total } }
 *   sourceParams  extra query passed to source.list (e.g. { ungrouped: true })
 *   keep(row)     optional extra filter on the loaded rows
 *   onPick(rows)  async; the modal closes when it resolves
 */
export function PickerModal({ onClose, title, source, sourceParams, keep, onPick, actionLabel = "Add", itemLabel = "rows", single = false }) {
  const fetchPage = async ({ page, pageSize, q }) => {
    const res = await source.list({ ...pageParams({ page, pageSize, q }), ...sourceParams });
    return { ...res, rows: keep ? res.rows.filter(keep) : res.rows };
  };
  const table = useDataTable({ mode: "server", fetchPage, getRowId, deps: [JSON.stringify(sourceParams ?? {})], initialPageSize: 10 });
  const bulkActions = [{
    id: "pick", label: actionLabel, icon: <Plus size={12} />,
    disabled: (rows) => single && rows.length !== 1,
    run: async (rows) => {
      await onPick(rows);
      table.selection.clear();
      onClose();
    },
  }];
  return (
    <Modal open onClose={onClose} title={title} className="max-w-2xl">
      <DataTable table={table} columns={COLUMNS} bulkActions={bulkActions} exportable={false} itemLabel={itemLabel} searchPlaceholder="Search" emptyText="Nothing to add." dense />
    </Modal>
  );
}
