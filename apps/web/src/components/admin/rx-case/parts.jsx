import { Info } from "lucide-react";

export function Field({ label, value, className = "" }) {
  return (
    <div className={className}>
      <div className="text-[10px] font-mono text-navy/40 uppercase tracking-widest">{label}</div>
      <div className="mt-1 text-sm text-navy break-words">{value || "—"}</div>
    </div>
  );
}

export function Banner({ tone = "info", icon: Icon = Info, children, action }) {
  const tones = {
    info: "border-blue-200 bg-blue-50 text-blue-800",
    error: "border-red-200 bg-red-50 text-red-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
  };
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 ${tones[tone]}`}>
      <Icon size={16} className="mt-0.5 flex-shrink-0" />
      <div className="flex-1 text-sm">{children}</div>
      {action}
    </div>
  );
}

export function LineStatusBadge({ line }) {
  if (line.noteOnly) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-500/10 text-slate-600">
        Note only
      </span>
    );
  }
  if (line.status === "confirmed") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-700">
        Confirmed
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-500/10 text-red-600">
      Needs code
    </span>
  );
}
