import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { INTAKE_STATUSES } from "@my-app/shared";
import api from "../../config/api.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { pageParams } from "../../lib/data-table/server.js";
import { errorText } from "../../lib/requests.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { DataTable } from "../../components/ui/data-table/index.js";

const STATUS_WORDS = { pending: "Pending", promoted: "Used", discarded: "Discarded" };
const FILTERS = [
  { id: "status", label: "Status", type: "select", placeholder: "All", options: INTAKE_STATUSES.map((s) => ({ value: s, label: STATUS_WORDS[s] })) },
];
const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const fileNames = (i) => (i.files ?? []).map((f) => f.originalName).join(", ");

/**
 * The queue of dropped files waiting to become a record. Each pending row links to the host's
 * record form (`createHref(intake)`) and can be discarded; selected rows discard together.
 * Both discards ask for a second click. `basePath` is where the intake routes are mounted.
 */
export function IntakeQueue({ basePath = "/intake", createHref, createLabel = "Create order", refreshKey }) {
  const { addToast } = useToast();

  const fetchPage = useMemo(() => async ({ page, pageSize, filters }) => {
    const params = pageParams({ page, pageSize });
    if (filters.status) params.status = filters.status;
    const { data } = await api.get(basePath, { params });
    return { rows: data.data.rows, total: data.data.total };
  }, [basePath]);

  const table = useDataTable({
    mode: "server", fetchPage, filters: FILTERS, initialFilters: { status: "pending" }, getRowId: (i) => i.id,
    isRowSelectable: (i) => i.status === "pending", deps: [refreshKey ?? 0],
  });

  const discard = (id) => api.post(`${basePath}/${encodeURIComponent(id)}/discard`, {});

  const discardOne = async (intake) => {
    try {
      await discard(intake.id);
      addToast({ message: "Discarded", type: "success" });
      table.reload();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
  };

  const columns = [
    { id: "when", header: "When", cell: (i) => when(i.createdAt), exportValue: (i) => i.createdAt },
    {
      id: "files", header: "Files", exportValue: fileNames,
      cell: (i) => (
        <span title={fileNames(i)} className="text-navy/80">
          {(i.files ?? []).length} {(i.files ?? []).length === 1 ? "file" : "files"}
          <span className="ml-2 text-xs text-navy/40">{fileNames(i).slice(0, 60)}</span>
        </span>
      ),
    },
    { id: "by", header: "By", cell: (i) => i.byName ?? "—", exportValue: (i) => i.byName ?? "" },
    { id: "status", header: "Status", cell: (i) => STATUS_WORDS[i.status] ?? i.status, exportValue: (i) => i.status },
    {
      id: "actions", header: "", export: false, align: "right",
      cell: (i) => (i.status !== "pending" ? null : (
        <span className="flex items-center justify-end gap-3 text-xs">
          <Link to={createHref(i)} className="font-semibold text-brand-700 hover:underline">{createLabel}</Link>
          <ConfirmButton onConfirm={() => discardOne(i)} confirmLabel="Click again to discard" className="text-navy/50 hover:text-red-600">Discard</ConfirmButton>
        </span>
      )),
    },
  ];

  const bulkActions = [
    {
      id: "discard", label: "Discard selected", icon: <Trash2 size={12} />, tone: "danger", confirmLabel: "Click again to discard",
      run: async (selected) => {
        let ok = 0;
        const failed = [];
        for (const i of selected) {
          try {
            await discard(i.id);
            ok += 1;
          } catch (err) {
            failed.push({ id: i.id, message: errorText(err) });
          }
        }
        table.selection.clear();
        table.reload();
        return { ok, failed };
      },
    },
  ];

  return (
    <DataTable
      table={table}
      columns={columns}
      bulkActions={bulkActions}
      searchable={false}
      exportable={false}
      itemLabel="intakes"
      emptyText="Nothing waiting. Drop scanner files above to start."
    />
  );
}
