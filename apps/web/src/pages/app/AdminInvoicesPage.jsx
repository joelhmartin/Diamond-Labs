import { useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileText,
  AlertCircle,
  Loader2,
  Mail,
  Phone,
  User,
  Building2,
} from "lucide-react";
import api from "../../config/api.js";

const STATUS_META = {
  paid:    { label: "Paid",     color: "bg-emerald-500/10 text-emerald-600" },
  unpaid:  { label: "Unpaid",   color: "bg-red-500/10 text-red-600" },
  partial: { label: "Partial",  color: "bg-amber-500/10 text-amber-600" },
  void:    { label: "Void",     color: "bg-navy/10 text-navy/50" },
};

const INPUT =
  "w-full px-3.5 py-2.5 rounded-lg bg-white border border-surface-300/60 text-navy text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 transition-all placeholder:text-navy/25";

function formatUSD(n) {
  return Number(n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function clientName(client, id) {
  if (!client) return `Client #${id}`;
  if (client.companyName) return client.companyName;
  if (client.firstName || client.lastName) {
    return `${client.firstName || ""} ${client.lastName || ""}`.trim();
  }
  if (client.name) return client.name;
  return `Client #${id}`;
}

/* ─── Stat card ─── */
function Stat({ label, value, tint = "text-navy" }) {
  return (
    <div className="bg-white rounded-2xl border border-surface-300/50 p-4">
      <div className={`font-heading font-bold text-2xl tracking-tight ${tint}`}>
        {value}
      </div>
      <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest mt-0.5">
        {label}
      </div>
    </div>
  );
}

/* ─── Invoice row (inside a client group) ─── */
function InvoiceRow({ invoice }) {
  const status = STATUS_META[invoice.status] || STATUS_META.unpaid;
  return (
    <tr className="border-t border-surface-300/30 hover:bg-surface-50/50">
      <td className="px-4 py-2.5 font-mono text-xs text-navy/60">
        {invoice.invoiceNumber || invoice.id}
      </td>
      <td className="px-4 py-2.5 text-xs text-navy/60">
        {formatDate(invoice.issueDate)}
      </td>
      <td className="px-4 py-2.5 text-xs text-navy/60">
        {formatDate(invoice.dueDate)}
      </td>
      <td className="px-4 py-2.5 text-sm font-semibold text-navy text-right tabular-nums">
        {formatUSD(invoice.amount)}
      </td>
      <td className="px-4 py-2.5 text-sm text-navy/60 text-right tabular-nums">
        {formatUSD(invoice.paidAmount)}
      </td>
      <td className="px-4 py-2.5 text-sm font-semibold text-navy text-right tabular-nums">
        {formatUSD(invoice.balance)}
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${status.color}`}
        >
          {status.label}
        </span>
      </td>
    </tr>
  );
}

/* ─── Client group ─── */
function ClientGroup({ clientId, client, invoices }) {
  const [open, setOpen] = useState(false);

  const totalAmount = invoices.reduce((s, i) => s + i.amount, 0);
  const totalBalance = invoices.reduce((s, i) => s + i.balance, 0);
  const unpaidCount = invoices.filter(
    (i) => i.status === "unpaid" || i.status === "partial"
  ).length;

  const name = clientName(client, clientId);
  const email = client?.email || client?.emailAddress;
  const phone = client?.phone || client?.phoneNumber;

  return (
    <div className="bg-white rounded-2xl border border-surface-300/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-4 p-4 md:p-5 text-left hover:bg-surface-50 transition-colors"
      >
        <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center text-brand-500">
          {client?.companyName ? (
            <Building2 size={18} />
          ) : (
            <User size={18} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="font-heading font-semibold text-sm text-navy truncate">
              {name}
            </div>
            <span className="font-mono text-[10px] text-navy/40">
              #{clientId}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1 text-[11px] text-navy/50 truncate">
            {email && (
              <span className="flex items-center gap-1 truncate">
                <Mail size={10} />
                {email}
              </span>
            )}
            {phone && (
              <span className="flex items-center gap-1">
                <Phone size={10} />
                {phone}
              </span>
            )}
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-6 flex-shrink-0">
          <div className="text-right">
            <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest">
              Invoices
            </div>
            <div className="font-mono text-sm text-navy tabular-nums">
              {invoices.length}
              {unpaidCount > 0 && (
                <span className="ml-1.5 text-red-500">
                  · {unpaidCount} open
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest">
              Total billed
            </div>
            <div className="font-heading font-bold text-sm text-navy tabular-nums">
              {formatUSD(totalAmount)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest">
              Balance
            </div>
            <div
              className={`font-heading font-bold text-sm tabular-nums ${
                totalBalance > 0 ? "text-red-600" : "text-emerald-600"
              }`}
            >
              {formatUSD(totalBalance)}
            </div>
          </div>
        </div>

        {open ? (
          <ChevronDown size={16} className="text-navy/40 flex-shrink-0" />
        ) : (
          <ChevronRight size={16} className="text-navy/40 flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-t border-surface-300/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-100">
                <Th>Invoice #</Th>
                <Th>Issued</Th>
                <Th>Due</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Paid</Th>
                <Th className="text-right">Balance</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <InvoiceRow key={inv.id} invoice={inv} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th
      className={`text-left px-4 py-2.5 text-[10px] font-mono uppercase tracking-widest text-navy/40 font-normal ${className}`}
    >
      {children}
    </th>
  );
}

/* ─── Main page ─── */
export function AdminInvoicesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ invoices: [], clients: {}, summary: null });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      setRefreshing(true);
      const res = await api.get("/admin/invoices");
      setData(res.data.data);
      setError(null);
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
          "Failed to load invoices. Check the Seazona connection."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter + group
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = data.invoices.filter((inv) => {
      if (statusFilter !== "all" && inv.status !== statusFilter) return false;
      if (!q) return true;
      const client = data.clients[inv.clientId];
      const name = clientName(client, inv.clientId).toLowerCase();
      const email = (client?.email || "").toLowerCase();
      return (
        name.includes(q) ||
        email.includes(q) ||
        String(inv.clientId).includes(q) ||
        String(inv.invoiceNumber || "").toLowerCase().includes(q)
      );
    });

    const byClient = new Map();
    for (const inv of filtered) {
      const key = inv.clientId || "unassigned";
      if (!byClient.has(key)) byClient.set(key, []);
      byClient.get(key).push(inv);
    }

    return [...byClient.entries()]
      .map(([clientId, invoices]) => ({
        clientId,
        client: data.clients[clientId],
        invoices: invoices.sort((a, b) =>
          new Date(b.issueDate || 0) - new Date(a.issueDate || 0)
        ),
      }))
      .sort((a, b) => {
        // Clients with unpaid balances first
        const aBal = a.invoices.reduce((s, i) => s + i.balance, 0);
        const bBal = b.invoices.reduce((s, i) => s + i.balance, 0);
        return bBal - aBal;
      });
  }, [data, query, statusFilter]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-heading font-bold text-3xl text-navy tracking-tight">
            Invoices
          </h1>
          <p className="mt-1 text-sm text-navy/50">
            Every invoice across every Seazona client.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold text-navy/60 hover:text-navy hover:bg-surface-100 transition-all disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      {data.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Stat label="Invoices" value={data.summary.count} />
          <Stat label="Clients" value={data.summary.clientCount} />
          <Stat
            label="Unpaid"
            value={data.summary.unpaidCount + data.summary.partialCount}
            tint="text-red-600"
          />
          <Stat
            label="Total billed"
            value={formatUSD(data.summary.totalAmount)}
          />
          <Stat
            label="Outstanding"
            value={formatUSD(data.summary.totalBalance)}
            tint={data.summary.totalBalance > 0 ? "text-red-600" : "text-emerald-600"}
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-navy/30"
          />
          <input
            type="text"
            className={`${INPUT} pl-10`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by client name, email, #id, or invoice number…"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {["all", "unpaid", "partial", "paid", "void"].map((s) => {
            const meta = s === "all" ? null : STATUS_META[s];
            const active = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-all ${
                  active
                    ? "bg-navy text-white"
                    : s === "all"
                    ? "bg-surface-100 text-navy/60 hover:text-navy"
                    : `${meta.color} hover:bg-navy/10`
                }`}
              >
                {s === "all" ? "All" : meta.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-20 flex items-center justify-center text-navy/40">
          <Loader2 size={18} className="animate-spin mr-2" />
          Loading invoices…
        </div>
      ) : error ? (
        <div className="py-20 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-500/40" />
          <p className="text-sm text-navy/60 max-w-md mx-auto">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-4 px-4 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600"
          >
            Retry
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="py-20 text-center">
          <FileText size={32} className="mx-auto mb-3 text-navy/20" />
          <p className="text-sm text-navy/40">
            {data.invoices.length === 0
              ? "No invoices returned by Seazona."
              : "No invoices match your filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <ClientGroup
              key={g.clientId}
              clientId={g.clientId}
              client={g.client}
              invoices={g.invoices}
            />
          ))}
        </div>
      )}
    </div>
  );
}
