import { useState } from "react";
import { Archive, ArchiveRestore, Plus } from "lucide-react";
import { DataTable } from "../../components/ui/data-table/index.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { pageParams } from "../../lib/data-table/server.js";
import { eachRow } from "../../lib/data-table/bulk.js";
import { errorText } from "../../lib/requests.js";
import { createOrganization, fetchOrganizations, updateOrganization } from "./api.js";

const FILTERS = [
  {
    id: "status", label: "Status", type: "select", placeholder: "Active",
    options: [{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }],
    match: () => true,
  },
];

function NewOrganizationModal({ open, onClose, onCreated, base, noun }) {
  const { addToast } = useToast();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await createOrganization({ name }, base);
      setName("");
      onCreated(created);
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`New ${noun}`}>
      <form onSubmit={submit} className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!name.trim()}>Create</Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The organizations list: server-paged, searchable, with an Active / Archived
 * filter, bulk Archive / Restore and a "New" button.
 *
 *   onOpen(org)  row click
 *   noun         what one organization is called in the UI ("group")
 *   base         API path (default the admin mount)
 *   refreshKey   change it to reload after an outside edit
 */
export function OrganizationsTable({ onOpen, noun = "group", base, refreshKey }) {
  const { addToast } = useToast();
  const [creating, setCreating] = useState(false);

  const fetchPage = ({ page, pageSize, q, filters }) =>
    fetchOrganizations({ ...pageParams({ page, pageSize, q }), status: filters.status || "active" }, base);
  const table = useDataTable({ mode: "server", fetchPage, filters: FILTERS, urlKey: "org", getRowId: (o) => o.id, deps: [refreshKey] });
  const archived = (table.filters.status || "active") === "archived";

  const columns = [
    { id: "name", header: "Name", exportValue: (o) => o.name, cell: (o) => <span className="font-medium text-navy">{o.name}</span> },
    { id: "accounts", header: "Accounts", align: "right", exportValue: (o) => o.accountCount, cell: (o) => <span className="font-mono text-xs text-navy/60">{o.accountCount}</span> },
    { id: "admins", header: "Admins", align: "right", exportValue: (o) => o.adminCount, cell: (o) => <span className="font-mono text-xs text-navy/60">{o.adminCount}</span> },
  ];

  const setStatus = (status) => async (rows) => {
    const result = await eachRow(rows, (o) => updateOrganization(o.id, { status }, base), (o) => o.name);
    table.reload();
    return result;
  };
  const bulkActions = archived
    ? [{ id: "restore", label: "Restore", icon: <ArchiveRestore size={12} />, run: setStatus("active") }]
    : [{ id: "archive", label: "Archive", icon: <Archive size={12} />, tone: "danger", confirmLabel: "Click again to archive", run: setStatus("archived") }];

  return (
    <>
      <DataTable
        table={table}
        columns={columns}
        bulkActions={bulkActions}
        onRowClick={onOpen}
        searchPlaceholder="Name"
        itemLabel={`${noun}s`}
        exportFileName={`${noun}s.csv`}
        emptyText={archived ? `No archived ${noun}s.` : `No ${noun}s yet.`}
        toolbarRight={<Button size="sm" onClick={() => setCreating(true)}><Plus size={14} /> New {noun}</Button>}
      />
      <NewOrganizationModal
        open={creating}
        noun={noun}
        base={base}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          addToast({ message: `${created.name} created.`, type: "success" });
          table.reload();
          onOpen?.(created);
        }}
      />
    </>
  );
}
