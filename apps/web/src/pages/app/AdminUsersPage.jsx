import { useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  Mail,
  KeyRound,
  Send,
  User,
  CheckCircle,
  AlertCircle,
  Loader2,
  Link2,
  XCircle,
} from "lucide-react";
import api from "../../config/api.js";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";

const ROLE_COLORS = {
  admin:  "bg-brand-500/10 text-brand-700",
  doctor: "bg-emerald-500/10 text-emerald-700",
  user:   "bg-navy/10 text-navy/60",
};

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Stat({ label, value, tint = "text-navy" }) {
  return (
    <div className="bg-white rounded-2xl border border-surface-300/50 p-4">
      <div className={`font-heading font-bold text-2xl tracking-tight ${tint}`}>{value}</div>
      <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest mt-0.5">{label}</div>
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th className={`text-left px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal ${className}`}>
      {children}
    </th>
  );
}

function Toast({ tone, children, onDismiss }) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-[9999] px-4 py-3 rounded-xl shadow-xl shadow-navy/20 flex items-center gap-2 text-sm ${
        tone === "error" ? "bg-red-500 text-white" : "bg-emerald-500 text-white"
      }`}
    >
      {tone === "error" ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
      <span>{children}</span>
      <button onClick={onDismiss} className="ml-2 opacity-80 hover:opacity-100">
        <XCircle size={14} />
      </button>
    </div>
  );
}

export function AdminUsersPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ users: [], summary: null });
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [seazonaOnly, setSeazonaOnly] = useState(false);
  const [passwordlessOnly, setPasswordlessOnly] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = async () => {
    try {
      const res = await api.get("/admin/users");
      setData(res.data.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (seazonaOnly && !u.seazonaClientId) return false;
      if (passwordlessOnly && u.hasPassword) return false;
      if (!q) return true;
      const blob = [
        u.email,
        u.name,
        u.account?.name,
        u.seazonaAccountNumber,
        u.role,
      ].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [data.users, query, roleFilter, seazonaOnly, passwordlessOnly]);

  const allSelected = filtered.length > 0 && filtered.every((u) => selected.has(u.id));
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((u) => u.id)));
  }
  function toggleOne(id) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  async function send(userId, kind) {
    try {
      setBusyId(userId);
      await api.post(`/admin/users/${userId}/send-${kind === "invitation" ? "invitation" : "password-reset"}`);
      setToast({ tone: "ok", text: kind === "invitation" ? "Invitation sent" : "Password reset sent" });
    } catch (err) {
      setToast({ tone: "error", text: err.response?.data?.error?.message || "Send failed" });
    } finally {
      setBusyId(null);
    }
  }

  async function bulkSend(kind) {
    if (selected.size === 0) return;
    try {
      setBulkBusy(true);
      const res = await api.post("/admin/users/bulk-email", {
        userIds: [...selected],
        kind,
      });
      const { sent, requested } = res.data.data;
      setToast({ tone: "ok", text: `Sent ${sent}/${requested} ${kind === "invitation" ? "invitations" : "password resets"}` });
      setSelected(new Set());
    } catch (err) {
      setToast({ tone: "error", text: err.response?.data?.error?.message || "Bulk send failed" });
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-heading font-bold text-3xl text-navy tracking-tight">
            Users
          </h1>
          <p className="mt-1 text-sm text-navy/50">
            Every user in the system — admins, doctors, and imported Seazona clients.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {data.summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          <Stat label="Total"         value={data.summary.total} />
          <Stat label="Admins"        value={data.summary.admins} tint="text-brand-700" />
          <Stat label="Doctors"       value={data.summary.doctors} tint="text-emerald-700" />
          <Stat label="Seazona-linked" value={data.summary.seazonaLinked} />
          <Stat label="No password yet" value={data.summary.passwordlessCount} tint="text-amber-700" />
          <Stat label="Never logged in" value={data.summary.neverLoggedIn} tint="text-navy/50" />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-navy/30" />
          <input
            type="text"
            className={`${INPUT} pl-10`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, practice, or Seazona account #…"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["all", "admin", "doctor", "user"].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(r)}
              className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-all capitalize ${
                roleFilter === r ? "bg-navy text-white" : "bg-surface-100 text-navy/60 hover:text-navy"
              }`}
            >
              {r}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSeazonaOnly((v) => !v)}
            className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
              seazonaOnly ? "bg-brand-500 text-white" : "bg-surface-100 text-navy/60 hover:text-navy"
            }`}
          >
            <Link2 size={11} />
            Seazona-linked
          </button>
          <button
            type="button"
            onClick={() => setPasswordlessOnly((v) => !v)}
            className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
              passwordlessOnly ? "bg-amber-500 text-white" : "bg-surface-100 text-navy/60 hover:text-navy"
            }`}
          >
            No password
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-3 bg-navy text-white rounded-xl px-4 py-3">
          <span className="text-sm font-semibold">
            {selected.size} selected
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => bulkSend("invitation")}
            disabled={bulkBusy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand-500 hover:bg-brand-600 text-xs font-semibold disabled:opacity-60"
          >
            {bulkBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Send invitations
          </button>
          <button
            type="button"
            onClick={() => bulkSend("password-reset")}
            disabled={bulkBusy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold disabled:opacity-60"
          >
            <KeyRound size={12} />
            Send password resets
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-white/60 hover:text-white"
          >
            Clear
          </button>
        </div>
      )}

      {/* Results */}
      <div className="mb-3 text-xs font-mono text-navy/40">
        {filtered.length} {filtered.length === 1 ? "user" : "users"}
      </div>

      {loading ? (
        <div className="py-20 flex items-center justify-center text-navy/40">
          <Loader2 size={18} className="animate-spin mr-2" />
          Loading users…
        </div>
      ) : error ? (
        <div className="py-20 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-500/40" />
          <p className="text-sm text-navy/60 max-w-md mx-auto">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-4 px-4 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-300/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-100 border-b border-surface-300/50">
                  <Th className="w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </Th>
                  <Th>User</Th>
                  <Th>Practice</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Last login</Th>
                  <Th className="text-right pr-4">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-navy/40">
                      No users match.
                    </td>
                  </tr>
                ) : (
                  filtered.map((u) => (
                    <tr key={u.id} className="border-b border-surface-300/30 hover:bg-surface-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(u.id)}
                          onChange={() => toggleOne(u.id)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-surface-200 flex items-center justify-center text-navy/50 text-xs font-bold flex-shrink-0">
                            {(u.name || u.email).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-navy truncate max-w-[220px]">
                              {u.name || u.email}
                            </div>
                            <div className="text-xs text-navy/40 truncate max-w-[220px]">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-navy/60">
                        <div className="truncate max-w-[180px]">
                          {u.account?.name || "—"}
                        </div>
                        {u.seazonaAccountNumber && (
                          <div className="text-[10px] font-mono text-navy/30 mt-0.5">
                            Seazona #{u.seazonaAccountNumber}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${ROLE_COLORS[u.role] || ROLE_COLORS.user}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {!u.hasPassword && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-700">
                              No password
                            </span>
                          )}
                          {u.emailVerifiedAt ? (
                            <span className="text-[10px] text-emerald-600 flex items-center gap-0.5">
                              <CheckCircle size={10} /> Verified
                            </span>
                          ) : (
                            <span className="text-[10px] text-navy/40">Unverified</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-navy/60">
                        {u.lastLoginAt ? formatDate(u.lastLoginAt) : <span className="text-navy/30">Never</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => send(u.id, "invitation")}
                            disabled={busyId === u.id}
                            title="Send portal invitation"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-brand-500/10 text-brand-700 hover:bg-brand-500/20 disabled:opacity-50"
                          >
                            {busyId === u.id ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                            Invite
                          </button>
                          <button
                            type="button"
                            onClick={() => send(u.id, "password-reset")}
                            disabled={busyId === u.id}
                            title="Send password reset"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-100 text-navy/60 hover:bg-surface-200"
                          >
                            <KeyRound size={11} />
                            Reset
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {toast && (
        <Toast tone={toast.tone} onDismiss={() => setToast(null)}>
          {toast.text}
        </Toast>
      )}

      <p className="mt-6 text-[11px] font-mono text-navy/30 text-center">
        Emails are console-logged until Resend is configured — the "sent" state just means a reset token was generated.
      </p>
    </div>
  );
}
