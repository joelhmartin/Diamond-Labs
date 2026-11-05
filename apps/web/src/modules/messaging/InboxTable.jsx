import { useNavigate } from "react-router-dom";
import { CheckCheck, Mail, CheckCircle2, RotateCcw, Archive, ArchiveRestore } from "lucide-react";
import { DataTable } from "../../components/ui/data-table/index.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { pageParams } from "../../lib/data-table/server.js";
import { eachRow } from "../../lib/data-table/bulk.js";
import { formatWhen } from "../notifications/format.js";
import { fetchThreads, setThreadFlag } from "./api.js";

// Bulk id → the thread action it loops over (one POST per selected thread) and its button.
const BULK = {
  read: { label: "Mark read", icon: <CheckCheck size={12} /> },
  unread: { label: "Mark unread", icon: <Mail size={12} /> },
  complete: { label: "Complete", icon: <CheckCircle2 size={12} /> },
  reopen: { label: "Reopen", icon: <RotateCcw size={12} /> },
  archive: { label: "Archive", icon: <Archive size={12} /> },
  unarchive: { label: "Unarchive", icon: <ArchiveRestore size={12} /> },
};

const rowLabel = (t) => t.recordLabel || t.subject || t.id;

/**
 * A user's thread list: server-paged, with a folder switch, an Unread filter,
 * an optional record-type filter and bulk actions.
 *
 *   side        "host" shows the Party column; "party" hides it
 *   threadPath  (id) → the URL of a thread's page
 *   folders     [{ value, label }]; the first is the default
 *   bulk        ids from BULK above
 *   recordTypes [{ value, label }] adds a Record type select
 *   onChanged   called after a bulk action (refresh nav badges)
 */
export function InboxTable({ side = "party", threadPath, folders, bulk = [], recordTypes = [], timeZone, onChanged, onNewMessage }) {
  const navigate = useNavigate();
  const defaultFolder = folders[0]?.value;
  const filters = [
    { id: "unread", label: "Unread only", type: "toggle", match: (t) => t.unread },
    ...(recordTypes.length ? [{ id: "recordType", label: "Record type", type: "select", placeholder: "All records", options: recordTypes, match: (t, v) => t.recordType === v }] : []),
  ];

  async function fetchPage({ page, pageSize, q, filters: f }) {
    const params = { ...pageParams({ page, pageSize, q }), folder: f.folder || defaultFolder };
    if (f.unread === true) params.unread = "true";
    if (f.recordType) params.recordType = f.recordType;
    return fetchThreads(params);
  }

  // The folder lives in the table's filter state (not a declared filter) so switching it resets page and selection.
  const table = useDataTable({ mode: "server", fetchPage, filters, urlKey: "th", getRowId: (t) => t.id });
  const folder = table.filters.folder || defaultFolder;

  const columns = [
    {
      id: "record", header: "Record", exportValue: (t) => t.recordLabel ?? "",
      cell: (t) => (
        <span className="flex items-center gap-2">
          {t.unread
            ? <span aria-label="Unread" role="img" className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />
            : <span className="h-2 w-2 shrink-0" />}
          <span className={t.unread ? "font-semibold text-navy" : "text-navy/70"}>{t.recordLabel || "General"}</span>
        </span>
      ),
    },
    ...(side === "host" ? [{ id: "party", header: "Party", exportValue: (t) => t.partyLabel ?? "", cell: (t) => <span className="text-navy/70">{t.partyLabel || "—"}</span> }] : []),
    {
      id: "subject", header: "Subject", exportValue: (t) => t.subject ?? "",
      cell: (t) => <span className={t.unread ? "font-semibold text-navy" : "text-navy/70"}>{t.subject || "(no subject)"}</span>,
    },
    { id: "last", header: "Last activity", exportValue: (t) => t.lastMessageAt, cell: (t) => <span className="whitespace-nowrap text-xs text-navy/50">{formatWhen(t.lastMessageAt, timeZone)}</span> },
    { id: "count", header: "Messages", align: "right", exportValue: (t) => t.messageCount, cell: (t) => <span className="font-mono text-xs text-navy/50">{t.messageCount}</span> },
  ];

  const bulkActions = bulk.filter((id) => BULK[id]).map((id) => ({
    id, ...BULK[id],
    run: async (rows) => {
      const result = await eachRow(rows, (t) => setThreadFlag(t.id, id), rowLabel);
      table.reload();
      onChanged?.();
      return result;
    },
  }));

  return (
    <DataTable
      table={table}
      columns={columns}
      bulkActions={bulkActions}
      onRowClick={(t) => navigate(threadPath(t.id))}
      toolbarRight={(
        <div className="flex items-center gap-2">
          {folders.length > 1 && <SegmentedControl label="Folder" value={folder} onChange={(v) => table.setFilter("folder", v)} options={folders} />}
          {onNewMessage}
        </div>
      )}
      searchPlaceholder={side === "host" ? "Record or party" : "Record"}
      exportable={false}
      itemLabel="threads"
      emptyText="No messages here."
    />
  );
}
