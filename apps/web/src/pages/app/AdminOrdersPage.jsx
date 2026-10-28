import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { LAB_ORDER_STATUSES, LAB_STATUS_LABELS, formatLabDate } from "@my-app/shared";
import api from "../../config/api.js";
import { labOrderPath } from "../../config/routes.js";
import { sourceLabel } from "../../lib/staff.js";
import { moveBulkActions } from "../../lib/lab-board.js";
import { pageParams } from "../../lib/data-table/server.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { FlagBadges, DueLabel } from "../../components/lab/board-columns.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";

const opt = (list, label) => list.map((x) => ({ value: x.id, label: label(x) }));

/** Admin filters; departments and staff arrive after the first render. */
function orderFilters(departments, staff) {
  return [
    { id: "status", label: "Status", type: "select", placeholder: "All statuses", options: LAB_ORDER_STATUSES.map((s) => ({ value: s, label: LAB_STATUS_LABELS[s] })) },
    { id: "source", label: "Source", type: "select", placeholder: "Rx cases and shop", options: [{ value: "rx_case", label: "Rx cases" }, { value: "shop_order", label: "Shop orders" }] },
    { id: "departmentId", label: "Department", type: "select", placeholder: "All departments", options: opt(departments, (d) => d.name) },
    { id: "assigneeUserId", label: "Assignee", type: "select", placeholder: "Anyone", options: opt(staff, (s) => s.name) },
    { id: "rush", label: "Rush only", type: "toggle" },
    { id: "dueBefore", label: "Due by", type: "date" },
  ];
}

// The admin list shows closed orders too; the board does not.
async function fetchPage({ page, pageSize, q, filters }) {
  const params = { ...pageParams({ page, pageSize, q }), includeClosed: "true" };
  for (const k of ["status", "source", "departmentId", "assigneeUserId", "dueBefore"]) if (filters[k]) params[k] = filters[k];
  if (filters.rush) params.rush = "true";
  const res = await api.get("/lab/orders", { params });
  return { rows: res.data.data.orders, total: res.data.data.total };
}

const COLUMNS = [
  {
    id: "order", header: "Order", exportValue: (o) => o.orderNumber,
    cell: (o) => <Link className="font-mono font-bold text-navy hover:text-brand-600" to={labOrderPath(o.id)}>#{o.orderNumber}</Link>,
  },
  {
    id: "source", header: "Source", exportValue: (o) => sourceLabel(o.source),
    cell: (o) => <span className="text-xs">{sourceLabel(o.source)}<div className="font-mono text-navy/40">{o.reference ?? ""}</div></span>,
  },
  { id: "practice", header: "Practice", cell: (o) => o.practice, exportValue: (o) => o.practice ?? "" },
  {
    id: "items", header: "Items", className: "max-w-xs truncate text-navy/70", exportValue: (o) => o.deviceSummary ?? "",
    cell: (o) => <span title={o.deviceSummary}>{o.deviceSummary}</span>,
  },
  {
    id: "status", header: "Status", exportValue: (o) => LAB_STATUS_LABELS[o.status] ?? o.status,
    cell: (o) => (
      <span className="flex flex-wrap items-center gap-1">
        <span className="rounded-full bg-surface-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">{LAB_STATUS_LABELS[o.status]}</span>
        <FlagBadges card={o} />
      </span>
    ),
  },
  { id: "due", header: "Due", cell: (o) => <span className="text-xs"><DueLabel card={o} prefix={false} /></span>, exportValue: (o) => o.dueDate ?? "" },
  { id: "received", header: "Received", cell: (o) => <span className="text-navy/60">{formatLabDate(o.receivedAt) || "—"}</span>, exportValue: (o) => o.receivedAt ?? "" },
];

/** Every lab order — Rx cases and shop orders, open and closed. The board is for working them. */
export function AdminOrdersPage() {
  const [departments, setDepartments] = useState([]);
  const [staff, setStaff] = useState([]);
  useEffect(() => {
    Promise.all([api.get("/lab/departments"), api.get("/lab/staff")])
      .then(([d, s]) => { setDepartments(d.data.data.departments); setStaff(s.data.data.staff); })
      .catch(() => { /* the department and assignee filters just stay empty */ });
  }, []);

  const table = useDataTable({ mode: "server", fetchPage, filters: orderFilters(departments, staff), urlKey: "ord", getRowId: (o) => o.id });
  const bulkActions = moveBulkActions(table.selection.selectedRows, { after: table.reload });

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6 md:p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Orders</h1>
          <p className="mt-1 text-sm text-navy/50">Every lab order, from Rx cases and the shop.</p>
        </div>
        <button type="button" onClick={table.reload} className="flex items-center gap-1.5 rounded-full bg-surface-100 px-4 py-2 text-xs font-semibold text-navy hover:bg-surface-200">
          <RefreshCw size={12} className={table.loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      <DataTable
        table={table}
        columns={COLUMNS}
        bulkActions={bulkActions}
        searchPlaceholder="Order #, case #, practice, item…"
        itemLabel="orders"
        exportFileName="orders.csv"
        emptyText="No orders match."
      />
    </div>
  );
}
