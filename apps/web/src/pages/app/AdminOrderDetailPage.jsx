import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  FileText,
  Download,
  User,
  Calendar,
  Package,
  ClipboardList,
  Mail,
  Phone,
  MapPin,
} from "lucide-react";
import api from "../../config/api.js";

const STATUS_COLORS = {
  "In Prod":        "bg-blue-500/10 text-blue-700",
  "In Production":  "bg-blue-500/10 text-blue-700",
  "Shipped":        "bg-emerald-500/10 text-emerald-700",
  "Hold":           "bg-amber-500/10 text-amber-700",
  "Cancelled":      "bg-red-500/10 text-red-600",
};

function statusColor(s) { return STATUS_COLORS[s] || "bg-gray-200 text-gray-700"; }

function formatDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatBytes(b) {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function Field({ label, value, Icon }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-navy/40 uppercase tracking-widest">
        {Icon && <Icon size={10} />}
        {label}
      </div>
      <div className="mt-1 text-sm text-navy">{value || "—"}</div>
    </div>
  );
}

export function AdminOrderDetailPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/admin/orders/${id}`);
        setData(res.data.data);
        setError(null);
      } catch (err) {
        setError(err.response?.data?.error?.message || err.message || "Failed to load order.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="py-20 flex items-center justify-center text-navy/40">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading order…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <Link to="/admin/orders" className="inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy mb-6">
          <ArrowLeft size={12} /> Back to orders
        </Link>
        <div className="py-20 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-red-500/40" />
          <p className="text-sm text-navy/60">{error}</p>
        </div>
      </div>
    );
  }

  const { order, client } = data;

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <Link to="/admin/orders" className="inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy mb-6">
        <ArrowLeft size={12} /> Back to orders
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-navy/40 uppercase tracking-widest">
            <ClipboardList size={12} />
            Order
          </div>
          <h1 className="mt-2 font-heading font-bold text-3xl text-navy tracking-tight">
            Invoice #{order.invoiceNumber}
          </h1>
          <div className="mt-2 text-sm text-navy/50">
            {order.patient && <span>Patient: <span className="text-navy">{order.patient}</span></span>}
          </div>
        </div>
        {order.status && (
          <span className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${statusColor(order.status)}`}>
            {order.status}
          </span>
        )}
      </div>

      {/* Workflow */}
      <div className="bg-white rounded-2xl border border-surface-300/50 p-6 mb-5">
        <h2 className="font-heading font-bold text-sm text-navy mb-4">Workflow</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          <Field label="Department" value={order.department} Icon={Package} />
          <Field label="Assigned to" value={order.assignedTo} Icon={User} />
          <Field label="Ordered"  value={formatDateTime(order.ordered)} Icon={Calendar} />
          <Field label="Due"      value={formatDateTime(order.due)} Icon={Calendar} />
        </div>
        {order.notes && (
          <div className="mt-5 pt-5 border-t border-surface-300/40">
            <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest mb-1.5">Notes</div>
            <p className="text-sm text-navy/70 whitespace-pre-wrap leading-relaxed">{order.notes}</p>
          </div>
        )}
      </div>

      {/* Client */}
      {(client || order.clientName || order.company) && (
        <div className="bg-white rounded-2xl border border-surface-300/50 p-6 mb-5">
          <h2 className="font-heading font-bold text-sm text-navy mb-4">Client</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Name" value={client?.fullName || order.clientName} Icon={User} />
            <Field label="Company" value={client?.company || order.company} />
            {client?.accountNumber && (
              <Field label="Account #" value={client.accountNumber} />
            )}
            <Field label="Email" value={client?.email} Icon={Mail} />
            <Field label="Phone" value={client?.phone1} Icon={Phone} />
            <Field
              label="Location"
              value={[client?.city, client?.region, client?.postalCode].filter(Boolean).join(", ")}
              Icon={MapPin}
            />
          </div>
        </div>
      )}

      {/* Products */}
      {Array.isArray(order.products) && order.products.length > 0 && (
        <div className="bg-white rounded-2xl border border-surface-300/50 p-6 mb-5">
          <h2 className="font-heading font-bold text-sm text-navy mb-4">
            Products
          </h2>
          <div className="space-y-2">
            {order.products.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-3 bg-surface-50 rounded-lg">
                <Package size={14} className="text-navy/40 flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-sm text-navy">{p.name}</div>
                  {p.code && <div className="text-[10px] font-mono text-navy/40">#{p.code}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files */}
      {Array.isArray(order.files) && order.files.length > 0 && (
        <div className="bg-white rounded-2xl border border-surface-300/50 p-6 mb-5">
          <h2 className="font-heading font-bold text-sm text-navy mb-4">Files</h2>
          <div className="space-y-2">
            {order.files.map((f) => (
              <a
                key={f.name}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-surface-50 rounded-lg hover:bg-surface-100 transition-colors"
              >
                <FileText size={14} className="text-navy/40 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-navy truncate">
                    {f.originalName || f.name}
                  </div>
                  <div className="text-[10px] font-mono text-navy/40">
                    {f.extension} · {formatBytes(f.size)}
                  </div>
                </div>
                <Download size={14} className="text-brand-500" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Settings */}
      {Array.isArray(order.settings) && order.settings.length > 0 && (
        <div className="bg-white rounded-2xl border border-surface-300/50 p-6">
          <h2 className="font-heading font-bold text-sm text-navy mb-4">Settings</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {order.settings.map((s) => (
              <div key={s.name} className="flex items-center justify-between px-3 py-2 bg-surface-50 rounded-lg">
                <dt className="text-xs text-navy/50">{s.name}</dt>
                <dd className="text-sm font-semibold text-navy">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
