import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import api from "../../config/api.js";
import { DataTable } from "../../components/ui/data-table/index.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { eachRow } from "../../lib/data-table/bulk.js";
import { errorText } from "../../lib/requests.js";
import { PickerModal } from "../../modules/organizations/index.js";
import { usersSource } from "./practice-sources.js";

const ROLES = [{ value: "admin", label: "Admin" }, { value: "member", label: "Member" }, { value: "viewer", label: "Viewer (read only)" }];
const getRowId = (m) => m.userId;
const searchFn = (m, q) => `${m.name ?? ""} ${m.email}`.toLowerCase().includes(q.toLowerCase());
const SELECT = "h-8 rounded-lg border border-surface-300/60 bg-white px-2 text-xs text-navy";

/** The account-number editor: save, or clear with an empty value. A taken number reads as the server's message. */
function AccountNumberForm({ practice, onSaved }) {
  const { addToast } = useToast();
  const [saved, setSaved] = useState(practice.accountNumber ?? "");
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.patch(`/admin/practices/${practice.id}`, { accountNumber: value });
      addToast({ message: "Account number saved.", type: "success" });
      setSaved(res.data.data.accountNumber ?? "");
      setValue(res.data.data.accountNumber ?? "");
      onSaved();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="flex-1"><Input label="Lab account number" value={value} onChange={(e) => setValue(e.target.value)} maxLength={100} /></div>
      <Button type="submit" size="sm" loading={saving} disabled={value.trim() === saved}>Save</Button>
    </form>
  );
}

/** A practice's side panel: the lab account number and the people who work there. */
export function PracticeDrawer({ practice, onClose, onChanged }) {
  const { addToast } = useToast();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [picking, setPicking] = useState(false);
  const [newRole, setNewRole] = useState("member");
  const path = `/admin/practices/${practice.id}/members`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMembers((await api.get(path)).data.data);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => { load(); }, [load]);

  const table = useDataTable({ rows: members, getRowId, searchFn, loading, error, reload: load });

  const changeRole = async (m, role) => {
    try {
      await api.patch(`${path}/${m.userId}`, { role });
      addToast({ message: "Role saved.", type: "success" });
      load();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
  };

  const columns = [
    {
      id: "member", header: "Member", exportValue: (m) => m.email,
      cell: (m) => (
        <>
          <div className="font-medium text-navy">{m.name || m.email}</div>
          {m.name && <div className="text-xs text-navy/40">{m.email}</div>}
        </>
      ),
    },
    {
      id: "role", header: "Role", exportValue: (m) => m.role,
      cell: (m) => (m.isOwner
        ? <span className="text-xs font-semibold text-navy/60">Owner</span>
        : (
          <select aria-label={`Role for ${m.name || m.email}`} value={m.role} onChange={(e) => changeRole(m, e.target.value)} className={SELECT}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        )),
    },
  ];

  const bulkActions = [{
    id: "remove", label: "Remove", icon: <Trash2 size={12} />, tone: "danger", confirmLabel: "Click again to remove",
    run: async (rows) => {
      const result = await eachRow(rows, (m) => api.delete(`${path}/${m.userId}`), (m) => m.name || m.email);
      table.selection.clear();
      load();
      onChanged();
      return result;
    },
  }];

  const add = async (picked) => {
    const result = await eachRow(picked, (u) => api.post(path, { userId: u.id, role: newRole }), (u) => u.label);
    addToast({ message: result.failed.length ? `${result.failed[0].message}` : `${result.ok} added.`, type: result.failed.length ? "error" : "success" });
    load();
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <aside role="dialog" aria-label={`${practice.name} details`} className="relative z-10 h-full w-full max-w-xl space-y-6 overflow-y-auto bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl font-bold text-navy">{practice.name}</h2>
            <p className="text-xs text-navy/50">{practice.organization ? `Group: ${practice.organization.name}` : "Not in a group"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-navy/50 hover:bg-surface-100"><X size={16} /></button>
        </div>

        <AccountNumberForm practice={practice} onSaved={() => onChanged()} />

        <section>
          <h3 className="mb-2 text-sm font-semibold text-navy">Members</h3>
          <DataTable
            table={table}
            columns={columns}
            bulkActions={bulkActions}
            searchPlaceholder="Name or email"
            itemLabel="members"
            exportable={false}
            emptyText="Nobody works at this practice yet."
            dense
            toolbarRight={(
              <div className="flex items-center gap-2">
                <select aria-label="Role for new members" value={newRole} onChange={(e) => setNewRole(e.target.value)} className={SELECT}>
                  {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <Button size="sm" onClick={() => setPicking(true)}><Plus size={14} /> Add member</Button>
              </div>
            )}
          />
        </section>
      </aside>
      {picking && (
        <PickerModal
          title="Add members"
          source={usersSource}
          keep={(u) => !members.some((m) => m.userId === u.id)}
          onPick={add}
          onClose={() => setPicking(false)}
          itemLabel="people"
        />
      )}
    </div>
  );
}
