import { useNavigate } from "react-router-dom";
import { CheckCheck } from "lucide-react";
import { DataTable } from "../../components/ui/data-table/index.js";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { errorText } from "../../lib/requests.js";
import { pageParams } from "../../lib/data-table/server.js";
import { dismissNotification, fetchNotifications, markRead } from "./api.js";
import { alertTitle, formatWhen } from "./format.js";

const FILTERS = [{ id: "unread", label: "Unread only", type: "toggle", match: (n) => !n.readAt }];

async function fetchPage({ page, pageSize, filters }) {
  const { limit, offset } = pageParams({ page, pageSize });
  return fetchNotifications({ limit, offset, unread: filters.unread === true });
}

/** The user's full alert list: server-paged, filterable to unread, with bulk Mark read. */
export function AlertCenter({ timeZone, onChanged }) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const table = useDataTable({ mode: "server", fetchPage, filters: FILTERS, urlKey: "al", getRowId: (n) => n.id });

  const changed = () => { table.reload(); onChanged?.(); };

  const open = async (n) => {
    if (!n.readAt) {
      try { await markRead({ ids: [n.id] }); onChanged?.(); } catch { /* still go to the record */ }
    }
    if (n.link) navigate(n.link); else table.reload();
  };

  const dismiss = async (n) => {
    try { await dismissNotification(n.id); changed(); } catch (err) { addToast({ message: errorText(err), type: "error" }); }
  };

  const columns = [
    {
      id: "title", header: "Alert", exportValue: alertTitle,
      cell: (n) => (
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-brand-500"}`} />
          <span className={n.readAt ? "text-navy/60" : "font-semibold text-navy"}>{alertTitle(n)}</span>
        </span>
      ),
    },
    { id: "when", header: "When", exportValue: (n) => n.updatedAt, cell: (n) => <span className="whitespace-nowrap text-xs text-navy/50">{formatWhen(n.updatedAt, timeZone)}</span> },
    { id: "state", header: "Status", exportValue: (n) => (n.readAt ? "Read" : "Unread"), cell: (n) => <span className="text-xs text-navy/50">{n.readAt ? "Read" : "Unread"}</span> },
    {
      id: "actions", header: "", export: false, align: "right",
      cell: (n) => (
        <ConfirmButton onConfirm={() => dismiss(n)} confirmLabel="Click again to dismiss" className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
          Dismiss
        </ConfirmButton>
      ),
    },
  ];

  const bulkActions = [{
    id: "read", label: "Mark read", icon: <CheckCheck size={12} />,
    run: async (rows) => {
      await markRead({ ids: rows.map((n) => n.id) });
      changed();
      return { ok: rows.length, failed: [] };
    },
  }];

  return (
    <DataTable
      table={table}
      columns={columns}
      bulkActions={bulkActions}
      onRowClick={open}
      searchable={false}
      exportable={false}
      itemLabel="alerts"
      emptyText="No alerts."
    />
  );
}
