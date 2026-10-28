import { useEffect, useState } from "react";
import { RefreshCw, KeyRound, Send, CheckCircle, Loader2, CreditCard } from "lucide-react";
import { Link } from "react-router-dom";
import api from "../../config/api.js";
import { useAuth } from "../../hooks/useAuth.js";
import { roleToggleFor } from "@my-app/shared";
import { DoctorPaymentDrawer } from "../../components/admin/DoctorPaymentDrawer.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { errorText } from "../../lib/requests.js";

const ROLE_COLORS = {
  admin:  "bg-brand-500/10 text-brand-700",
  lab:    "bg-amber-500/10 text-amber-700",
  doctor: "bg-emerald-500/10 text-emerald-700",
  user:   "bg-navy/10 text-navy/60",
};

const FILTERS = [
  {
    id: "role", label: "Role", type: "select", placeholder: "All roles",
    options: ["admin", "lab", "doctor", "user"].map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) })),
    match: (u, v) => u.role === v,
  },
  { id: "seazona", label: "Seazona-linked", type: "toggle", match: (u) => Boolean(u.seazonaClientId) },
  { id: "passwordless", label: "No password", type: "toggle", match: (u) => !u.hasPassword },
];

const searchFn = (u, q) =>
  [u.email, u.name, u.account?.name, u.seazonaAccountNumber, u.role].filter(Boolean).join(" ").toLowerCase().includes(q.toLowerCase());

const userLabel = (u) => u.name || u.email;
const getRowId = (u) => u.id;

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

function userColumns({ me, busyId, send, changeRole, setPaymentsUser }) {
  return [
    {
      id: "user", header: "User", exportValue: (u) => `${userLabel(u)} <${u.email}>`,
      sortValue: (u) => userLabel(u).toLowerCase(),
      cell: (u) => (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-surface-200 flex items-center justify-center text-navy/50 text-xs font-bold flex-shrink-0">
            {userLabel(u).charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-navy truncate max-w-[220px]">{userLabel(u)}</div>
            <div className="text-xs text-navy/40 truncate max-w-[220px]">{u.email}</div>
          </div>
        </div>
      ),
    },
    {
      id: "practice", header: "Practice", exportValue: (u) => [u.account?.name, u.seazonaAccountNumber && `Seazona #${u.seazonaAccountNumber}`].filter(Boolean).join(" · "),
      cell: (u) => (
        <div className="text-xs text-navy/60">
          <div className="truncate max-w-[180px]">{u.account?.name || "—"}</div>
          {u.seazonaAccountNumber && <div className="text-[10px] font-mono text-navy/30 mt-0.5">Seazona #{u.seazonaAccountNumber}</div>}
        </div>
      ),
    },
    {
      id: "role", header: "Role", exportValue: (u) => u.role, sortValue: (u) => u.role,
      cell: (u) => (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${ROLE_COLORS[u.role] || ROLE_COLORS.user}`}>{u.role}</span>
      ),
    },
    {
      id: "status", header: "Status", exportValue: (u) => [!u.hasPassword && "No password", u.emailVerifiedAt ? "Verified" : "Unverified"].filter(Boolean).join(", "),
      cell: (u) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {!u.hasPassword && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-700">No password</span>
          )}
          {u.emailVerifiedAt ? (
            <span className="text-[10px] text-emerald-600 flex items-center gap-0.5"><CheckCircle size={10} /> Verified</span>
          ) : (
            <span className="text-[10px] text-navy/40">Unverified</span>
          )}
        </div>
      ),
    },
    {
      id: "lastLogin", header: "Last login", exportValue: (u) => u.lastLoginAt ?? "", sortValue: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt) : null),
      cell: (u) => <span className="text-xs text-navy/60">{u.lastLoginAt ? formatDate(u.lastLoginAt) : <span className="text-navy/30">Never</span>}</span>,
    },
    {
      id: "actions", header: "Actions", align: "right", exportValue: () => "",
      cell: (u) => <UserActions u={u} me={me} busy={busyId === u.id} send={send} changeRole={changeRole} setPaymentsUser={setPaymentsUser} />,
    },
  ];
}

function UserActions({ u, me, busy, send, changeRole, setPaymentsUser }) {
  const toggle = roleToggleFor(u, me?.id);
  return (
    <div className="flex justify-end gap-1">
      {toggle && (
        <button type="button" disabled={busy} onClick={() => changeRole(u, toggle.role)}
          className="flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 disabled:opacity-50">
          {toggle.label}
        </button>
      )}
      {u.role === "doctor" && (
        <Link to={`/admin/users/${u.id}/pricing`} title="Negotiated prices for this client"
          className="flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-100 text-navy/60 hover:bg-surface-200">
          Pricing
        </Link>
      )}
      {u.role === "doctor" && (
        <button type="button" title="Manage cards, charges, and AutoPay"
          onClick={() => setPaymentsUser({ userId: u.id, name: u.name, email: u.email, accountNumber: u.seazonaAccountNumber })}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20">
          <CreditCard size={11} /> Payments
        </button>
      )}
      <button type="button" onClick={() => send(u.id, "invitation")} disabled={busy} title="Send portal invitation"
        className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-brand-500/10 text-brand-700 hover:bg-brand-500/20 disabled:opacity-50">
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Invite
      </button>
      <button type="button" onClick={() => send(u.id, "password-reset")} disabled={busy} title="Send password reset"
        className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-surface-100 text-navy/60 hover:bg-surface-200">
        <KeyRound size={11} /> Reset
      </button>
    </div>
  );
}

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ users: [], summary: null });
  const [busyId, setBusyId] = useState(null);
  const [paymentsUser, setPaymentsUser] = useState(null); // { userId, name, email, accountNumber }

  const load = async () => {
    try {
      const res = await api.get("/admin/users");
      setData(res.data.data);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const table = useDataTable({ mode: "client", rows: data.users, searchFn, filters: FILTERS, getRowId, loading, error, reload: load });

  async function send(userId, kind) {
    try {
      setBusyId(userId);
      await api.post(`/admin/users/${userId}/send-${kind === "invitation" ? "invitation" : "password-reset"}`);
      addToast({ message: kind === "invitation" ? "Invitation sent" : "Password reset sent", type: "success" });
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(u, role) {
    try {
      setBusyId(u.id);
      await api.put(`/admin/users/${u.id}/role`, { role });
      addToast({ message: role === "lab" ? `${u.email} is now lab staff` : `${u.email} no longer has lab access`, type: "success" });
      await load();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusyId(null);
    }
  }

  // One POST for the whole selection; the server reports how many it sent.
  const bulkSend = (kind) => async (rows) => {
    const res = await api.post("/admin/users/bulk-email", { userIds: rows.map((u) => u.id), kind });
    const { sent, requested } = res.data.data;
    addToast({ message: `Sent ${sent}/${requested} ${kind === "invitation" ? "invitations" : "password resets"}`, type: "success" });
    table.selection.clear();
  };
  const bulkActions = [
    { id: "invite", label: "Send invitations", confirmLabel: "Click again to send", icon: <Send size={12} />, run: bulkSend("invitation") },
    { id: "reset", label: "Send password resets", confirmLabel: "Click again to send", icon: <KeyRound size={12} />, run: bulkSend("password-reset") },
  ];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-heading font-bold text-3xl text-navy tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-navy/50">Every user in the system — admins, doctors, and imported Seazona clients.</p>
        </div>
        <button type="button" onClick={load}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all">
          <RefreshCw size={12} /> Refresh
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

      <DataTable
        table={table}
        columns={userColumns({ me, busyId, send, changeRole, setPaymentsUser })}
        bulkActions={bulkActions}
        searchPlaceholder="Name, email, practice, or Seazona account #"
        itemLabel="users"
        exportFileName="users.csv"
        emptyText="No users match."
      />

      {paymentsUser && <DoctorPaymentDrawer doctor={paymentsUser} onClose={() => setPaymentsUser(null)} />}

      <p className="mt-6 text-[11px] font-mono text-navy/30 text-center">
        Emails are console-logged until Resend is configured — the "sent" state just means a reset token was generated.
      </p>
    </div>
  );
}
