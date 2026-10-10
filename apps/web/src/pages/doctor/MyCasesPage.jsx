import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RotateCcw } from "lucide-react";
import { formatUsDate } from "@my-app/shared";
import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";

const TONES = {
  Submitted: "bg-blue-500/10 text-blue-700",
  Received: "bg-violet-500/10 text-violet-700",
  "In production": "bg-amber-500/10 text-amber-800",
  "On hold": "bg-red-500/10 text-red-700",
  Shipped: "bg-emerald-500/10 text-emerald-700",
  "Sent to lab": "bg-emerald-500/10 text-emerald-700",
  Cancelled: "bg-gray-200 text-gray-700",
};

const dateText = (d) => formatUsDate(d) || "—";

export function MyCasesPage() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.get("/rx/cases")
      .then((res) => setCases(res.data.data))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="font-heading text-2xl font-bold text-gray-900">My cases</h1>
        <Link to={ROUTES.RX_CHOOSER} className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">New Rx</Link>
      </div>
      {loading ? <Loader2 className="animate-spin text-gray-400" /> : failed ? (
        <p className="text-sm text-red-600">We couldn't load your cases. Please refresh in a moment.</p>
      ) : cases.length === 0 ? (
        <p className="text-sm text-gray-500">No cases yet. Submitted prescriptions appear here with their production status.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr><th className="px-4 py-3">Case</th><th className="px-4 py-3">Patient</th><th className="px-4 py-3">Device</th><th className="px-4 py-3">Submitted</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Due</th></tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-mono text-xs">{c.caseNumber}</td>
                  <td className="px-4 py-3">{c.patientName ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.deviceSummary ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{dateText(c.submittedAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONES[c.status] ?? "bg-gray-100 text-gray-700"}`}>{c.status}</span>
                    {c.isRemake && <span className="ml-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-violet-700"><RotateCcw size={10} /> Remake</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{dateText(c.dueDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
