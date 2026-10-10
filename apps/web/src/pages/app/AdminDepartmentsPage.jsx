import { useEffect, useState } from "react";
import { Loader2, Plus, AlertCircle } from "lucide-react";
import api from "../../config/api.js";
import { errorText } from "../../lib/lab-board.js";

const INPUT =
  "px-3 py-2 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500";

export function AdminDepartmentsPage() {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");

  const load = async () => {
    try {
      const res = await api.get("/lab/departments", { params: { includeInactive: "true" } });
      setDepartments(res.data.data.departments);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const call = async (fn) => {
    try { await fn(); await load(); } catch (err) { setError(errorText(err)); }
  };

  const add = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    call(async () => {
      await api.post("/admin/lab/departments", { name: trimmed, position: departments.length });
      setName("");
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 md:p-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Lab departments</h1>
        <p className="mt-1 text-sm text-navy/50">The rooms and benches orders move through. Deactivate a department instead of deleting it — past orders keep their history.</p>
      </div>
      {error && <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={14} /> {error}</div>}
      {loading ? <Loader2 className="animate-spin text-navy/40" /> : (
        <table className="w-full overflow-hidden rounded-xl border border-surface-300/50 text-left">
          <thead className="bg-surface-50 text-xs uppercase text-navy/50">
            <tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Active</th></tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id} className="border-t border-surface-300/40 text-sm">
                <td className="px-3 py-2">
                  <input
                    key={`p-${d.id}-${d.position}`} type="number" min={0} max={1000} className={`${INPUT} w-20`} defaultValue={d.position}
                    onBlur={(e) => Number(e.target.value) !== d.position && call(() => api.patch(`/admin/lab/departments/${d.id}`, { position: Number(e.target.value) }))}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    key={`n-${d.id}-${d.name}`} className={`${INPUT} w-full`} defaultValue={d.name}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== d.name && call(() => api.patch(`/admin/lab/departments/${d.id}`, { name: e.target.value.trim() }))}
                  />
                </td>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={d.active} onChange={(e) => call(() => api.patch(`/admin/lab/departments/${d.id}`, { active: e.target.checked }))} />
                </td>
              </tr>
            ))}
            {departments.length === 0 && <tr><td colSpan={3} className="px-3 py-8 text-center text-sm text-navy/40">No departments yet.</td></tr>}
          </tbody>
        </table>
      )}
      <form onSubmit={add} className="flex gap-2">
        <input className={`${INPUT} flex-1`} placeholder="e.g. Acrylic, Nylon printing, QC, Shipping" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!name.trim()} className="flex items-center gap-1 rounded-lg bg-navy px-4 py-2 text-sm text-white disabled:opacity-40"><Plus size={14} /> Add</button>
      </form>
    </div>
  );
}
