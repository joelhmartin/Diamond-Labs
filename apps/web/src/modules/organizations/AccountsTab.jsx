import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { DataTable } from "../../components/ui/data-table/index.js";
import { Button } from "../../components/ui/Button.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { eachRow } from "../../lib/data-table/bulk.js";
import { PickerModal } from "./PickerModal.jsx";
import { addAccounts, removeAccount } from "./api.js";

const getRowId = (a) => a.id;
const searchFn = (a, q) => `${a.label}`.toLowerCase().includes(q.toLowerCase());
const NO_GROUP_PARAMS = { ungrouped: true };
// An account that already belongs to an organization (this one or another) is never offered: an account lives in one.
const unassigned = (row) => !row.organizationId;

/**
 * The accounts in one organization, with a picker to add more.
 *
 *   accounts          [{ id, label }] from the organization detail
 *   accountsSource    { list({ q, limit, offset, ungrouped }) → { rows: [{ id, label, detail?, organizationId? }], total } }
 *   describeAccount   (account) → { title, subtitle?, to? }; how a row reads (default: its label)
 *   noun              what an account is called in the UI
 *   onChanged         called after an add or remove (reload the detail)
 */
export function AccountsTab({ organizationId, accounts, accountsSource, describeAccount, noun = "account", base, onChanged }) {
  const { addToast } = useToast();
  const [picking, setPicking] = useState(false);
  const describe = describeAccount ?? ((a) => ({ title: a.label }));
  const table = useDataTable({ rows: accounts, searchFn, getRowId });

  const columns = [{
    id: "account", header: noun[0].toUpperCase() + noun.slice(1), exportValue: (a) => describe(a).title,
    cell: (a) => {
      const d = describe(a);
      return (
        <>
          {d.to ? <Link to={d.to} className="font-medium text-brand-700 hover:underline">{d.title}</Link> : <div className="font-medium text-navy">{d.title}</div>}
          {d.subtitle && <div className="text-xs text-navy/40">{d.subtitle}</div>}
        </>
      );
    },
  }];

  const bulkActions = [{
    id: "remove", label: "Remove from group", icon: <Trash2 size={12} />, tone: "danger", confirmLabel: "Click again to remove",
    run: async (rows) => {
      const result = await eachRow(rows, (a) => removeAccount(organizationId, a.id, base), (a) => describe(a).title);
      table.selection.clear();
      onChanged();
      return result;
    },
  }];

  const add = async (rows) => {
    const { added, alreadyInOther } = await addAccounts(organizationId, rows.map((r) => r.id), base);
    const skipped = alreadyInOther?.length ?? 0;
    addToast({
      message: skipped ? `${added.length} added, ${skipped} skipped (already in another group).` : `${added.length} added.`,
      type: skipped ? "warning" : "success",
    });
    onChanged();
  };

  return (
    <>
      <DataTable
        table={table}
        columns={columns}
        bulkActions={bulkActions}
        searchPlaceholder="Name"
        itemLabel={`${noun}s`}
        exportFileName={`group-${noun}s.csv`}
        emptyText={`No ${noun}s in this group yet.`}
        toolbarRight={<Button size="sm" onClick={() => setPicking(true)}><Plus size={14} /> Add {noun}s</Button>}
      />
      {picking && (
        <PickerModal
          title={`Add ${noun}s`}
          source={accountsSource}
          sourceParams={NO_GROUP_PARAMS}
          keep={unassigned}
          onPick={add}
          onClose={() => setPicking(false)}
          itemLabel={`${noun}s`}
        />
      )}
    </>
  );
}
