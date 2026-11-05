import { useMemo } from "react";
import api from "../../config/api.js";
import { useResource } from "../../hooks/useResource.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { DataTable } from "../../components/ui/data-table/index.js";

const NONE = [];

/**
 * The host's subjects (any rows with an `id`) with the workflow each one uses.
 * `columns` are the host's DataTable columns; a "Workflow" column is added.
 * `workflows` is `[{ key, name }]` for the filter and the bulk select. Bulk
 * "Set workflow…" and "Clear workflow" PUT the selected ids. `filters`
 * (optional, host FilterDefs with `match`) sit beside the built-in Workflow filter.
 */
export function AssignmentsTable({
  basePath = "/scheduling/workflows", subjectType, subjects = NONE, columns, workflows = NONE, filters = NONE, searchFn, loading = false,
  error = null, reload,
}) {
  const assigned = useResource(`${basePath}/assignments`, { params: { subjectType } });
  const keyById = useMemo(() => new Map((assigned.data?.assignments ?? NONE).map((a) => [a.subjectId, a.workflowKey])), [assigned.data]);
  const nameByKey = useMemo(() => new Map(workflows.map((w) => [w.key, w.name])), [workflows]);
  const keyOf = (row) => keyById.get(row.id) ?? null;

  const allColumns = [
    ...columns,
    {
      id: "workflow", header: "Workflow",
      cell: (r) => (keyOf(r) ? nameByKey.get(keyOf(r)) ?? keyOf(r) : <span className="text-navy/30">None</span>),
      sortValue: (r) => nameByKey.get(keyOf(r)) ?? keyOf(r) ?? "",
      exportValue: (r) => nameByKey.get(keyOf(r)) ?? keyOf(r) ?? "",
    },
  ];
  const allFilters = [
    ...filters,
    {
      id: "workflow", label: "Workflow", type: "select", placeholder: "Any workflow",
      options: [{ value: "none", label: "No workflow" }, ...workflows.map((w) => ({ value: w.key, label: w.name }))],
      match: (r, v) => (v === "none" ? !keyOf(r) : keyOf(r) === v),
    },
  ];

  const table = useDataTable({
    mode: "client", rows: subjects, searchFn, filters: allFilters, loading: loading || assigned.loading, error: error ?? assigned.error,
    reload: reload ?? assigned.reload, getRowId: (r) => r.id,
  });

  // `fixedKey` is a key or null for a fixed action; undefined means "use the key picked in the bulk bar".
  const assign = (fixedKey) => async (rows, picked) => {
    const key = fixedKey === undefined ? picked : fixedKey;
    const res = await api.put(`${basePath}/assignments`, { subjectType, subjectIds: rows.map((r) => r.id), workflowKey: key });
    table.selection.clear();
    assigned.reload();
    return { ok: res.data.data.count, failed: [] };
  };
  const bulkActions = [
    { id: "set", label: "Set workflow…", choices: workflows.map((w) => ({ value: w.key, label: w.name })), choicePlaceholder: "Workflow", run: assign(undefined) },
    { id: "clear", label: "Clear workflow", run: assign(null) },
  ];

  return <DataTable table={table} columns={allColumns} bulkActions={bulkActions} itemLabel="items" exportFileName="workflow-assignments.csv" />;
}
