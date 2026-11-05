import { useCallback, useEffect, useState } from "react";
import { Send, Plus, AlertTriangle } from "lucide-react";
import { DataTable } from "../../components/ui/data-table/index.js";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { useDataTable } from "../../hooks/useDataTable.js";
import { errorText } from "../../lib/requests.js";
import { addRecipient, fetchChannels, fetchRecipients, removeRecipient, sendRecipientTest, setRecipientActive } from "./api.js";
import { normalizePhone } from "./phone.js";

const FIELD = "h-9 rounded-xl border border-surface-300/60 bg-white px-3 text-sm text-navy focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/10";
const BAD_PHONE = "Use a 10-digit US number or +country format.";

/** Per-event text-message recipients: add, pause, test, remove. `events` is `[{ key, label }]`. */
export function RecipientsPanel({ events = [] }) {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [channels, setChannels] = useState(null);
  const [form, setForm] = useState({ event: events[0]?.key ?? "", phone: "", label: "" });
  const [formError, setFormError] = useState(null);
  const [adding, setAdding] = useState(false);
  const labels = Object.fromEntries(events.map((e) => [e.key, e.label]));

  const load = useCallback(async () => {
    try { setRows(await fetchRecipients()); setError(null); } catch (err) { setError(err); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); fetchChannels().then(setChannels).catch(() => setChannels(null)); }, [load]);
  useEffect(() => { if (!form.event && events[0]) setForm((f) => ({ ...f, event: events[0].key })); }, [events, form.event]);

  const table = useDataTable({
    mode: "client", rows: rows.filter((r) => r.channel === "sms"), loading, error, reload: load,
    searchFn: (r, q) => `${r.label ?? ""} ${labels[r.event] ?? r.event}`.toLowerCase().includes(q.toLowerCase()),
    getRowId: (r) => r.id,
  });

  const run = async (fn, ok) => {
    try { await fn(); if (ok) addToast({ message: ok, type: "success" }); await load(); } catch (err) { addToast({ message: errorText(err), type: "error" }); }
  };

  const test = async (r) => {
    try {
      const res = await sendRecipientTest(r.id);
      addToast(res.ok ? { message: "Test sent.", type: "success" } : { message: "The test was not sent. See the delivery log for the reason.", type: "warning" });
    } catch (err) { addToast({ message: errorText(err), type: "error" }); }
  };

  const submit = async (e) => {
    e.preventDefault();
    const address = normalizePhone(form.phone);
    if (!address) { setFormError(BAD_PHONE); return; }
    setFormError(null);
    setAdding(true);
    try {
      const label = form.label.trim();
      await addRecipient({ event: form.event, channel: "sms", address, ...(label ? { label } : {}) });
      setForm((f) => ({ ...f, phone: "", label: "" }));
      addToast({ message: "Recipient added.", type: "success" });
      await load();
    } catch (err) { setFormError(errorText(err)); } finally { setAdding(false); }
  };

  const columns = [
    { id: "event", header: "Alert", exportValue: (r) => r.event, cell: (r) => labels[r.event] ?? r.event },
    { id: "label", header: "Name", exportValue: (r) => r.label ?? "", cell: (r) => r.label || <span className="text-navy/30">—</span> },
    { id: "address", header: "Number", exportValue: (r) => r.address, cell: (r) => <span className="font-mono text-xs">{r.address}</span> },
    {
      id: "active", header: "Active", cell: (r) => (
        <input type="checkbox" role="switch" aria-label={`Active: ${r.label || r.address}`} checked={r.active} className="accent-brand-500"
          onChange={() => run(() => setRecipientActive(r.id, !r.active))} />
      ),
    },
    {
      id: "actions", header: "", align: "right", export: false, cell: (r) => (
        <span className="inline-flex items-center gap-1">
          <button type="button" onClick={() => test(r)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-500/10">
            <Send size={12} /> Send test
          </button>
          <ConfirmButton onConfirm={() => run(() => removeRecipient(r.id), "Recipient removed.")} confirmLabel="Click again to remove" className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
            Remove
          </ConfirmButton>
        </span>
      ),
    },
  ];

  const sms = channels?.sms;
  return (
    <div className="space-y-4">
      {sms && !sms.ok && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{sms.reason ?? "Text messages are not configured."} Numbers can still be added; nothing is sent until the provider is on.</span>
        </div>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-2xl border border-surface-300/50 bg-white p-4">
        <label className="space-y-1 text-[10px] font-mono uppercase tracking-widest text-navy/40">Alert
          <select aria-label="Alert" value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })} className={`${FIELD} block`}>
            {events.map((ev) => <option key={ev.key} value={ev.key}>{ev.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-mono uppercase tracking-widest text-navy/40">Phone number
          <input aria-label="Phone number" inputMode="tel" value={form.phone} onChange={(e) => { setForm({ ...form, phone: e.target.value }); setFormError(null); }} placeholder="(512) 555-1234" className={`${FIELD} block`} />
        </label>
        <label className="space-y-1 text-[10px] font-mono uppercase tracking-widest text-navy/40">Name (optional)
          <input aria-label="Name" maxLength={80} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={`${FIELD} block`} />
        </label>
        <button type="submit" disabled={adding || !form.event} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-500 px-4 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
          <Plus size={14} /> Add
        </button>
        {formError && <p role="alert" className="w-full text-xs text-red-600">{formError}</p>}
      </form>
      <DataTable table={table} columns={columns} selectable={false} exportable={false} searchPlaceholder="Name or alert" itemLabel="recipients" emptyText="No text recipients yet." />
    </div>
  );
}
