import { useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import api from "../../config/api.js";
import { useResource } from "../../hooks/useResource.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { Button } from "../../components/ui/Button.jsx";
import { DataTable } from "../../components/ui/data-table/index.js";

const NONE = [];
const searchFn = (w, q) => `${w.name} ${w.key}`.toLowerCase().includes(q.toLowerCase());
const FILTERS = [
  {
    id: "active", label: "Status", type: "select", placeholder: "Any status",
    options: [{ value: "yes", label: "Active" }, { value: "no", label: "Inactive" }],
    match: (w, v) => (v === "yes" ? w.active : !w.active),
  },
];

/**
 * The workflow templates. Row click calls `onOpen(workflow, { milestones, workflows })`;
 * the "New workflow" button calls it with `null`. Bulk Activate / Deactivate.
 * Pass a changed `refreshKey` to reload after the editor saves.
 */
export function WorkflowsTable({ basePath = "/scheduling/workflows", onOpen, refreshKey }) {
  const { data, loading, error, reload } = useResource(basePath);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else reload();
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const workflows = data?.workflows ?? NONE;
  const milestones = data?.milestones ?? NONE;
  const byKey = new Map(workflows.map((w) => [w.key, w]));

  const columns = [
    { id: "name", header: "Name", cell: (w) => <span className="font-medium text-navy">{w.name}</span>, sortValue: (w) => w.name },
    { id: "totalDays", header: "Days", align: "right", cell: (w) => w.totalDays, sortValue: (w) => w.totalDays },
    { id: "stages", header: "Stages", align: "right", cell: (w) => w.stages.length, sortValue: (w) => w.stages.length },
    { id: "rush", header: "Rush variant", cell: (w) => (w.rushWorkflowKey ? byKey.get(w.rushWorkflowKey)?.name ?? w.rushWorkflowKey : ""), sortValue: (w) => w.rushWorkflowKey ?? "" },
    { id: "isDefault", header: "Default", cell: (w) => (w.isDefault ? "Default" : ""), sortValue: (w) => (w.isDefault ? 1 : 0) },
    { id: "active", header: "Active", cell: (w) => (w.active ? "Active" : "Inactive"), sortValue: (w) => (w.active ? 1 : 0) },
  ];

  const table = useDataTable({ mode: "client", rows: workflows, searchFn, filters: FILTERS, loading, error, reload, getRowId: (w) => w.id });

  const setActive = (active) => async (rows) => {
    const res = await api.post(`${basePath}/active`, { ids: rows.map((w) => w.id), active });
    table.selection.clear();
    reload();
    return { ok: res.data.data.count, failed: [] };
  };
  const bulkActions = [
    { id: "activate", label: "Activate", run: setActive(true) },
    { id: "deactivate", label: "Deactivate", run: setActive(false) },
  ];
  const open = (w) => onOpen?.(w, { milestones, workflows });

  return (
    <DataTable
      table={table}
      columns={columns}
      bulkActions={bulkActions}
      onRowClick={open}
      itemLabel="workflows"
      exportFileName="workflows.csv"
      emptyText="No workflows yet."
      toolbarRight={<Button size="sm" onClick={() => open(null)}><Plus size={14} /> New workflow</Button>}
    />
  );
}
