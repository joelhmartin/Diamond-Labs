import { useState } from "react";
import { FileDown } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { recentMonths, labToday } from "../../lib/invoices.js";
import { openPdf, blobErrorText } from "../../lib/requests.js";

/**
 * Pick a month and open that statement as a PDF. `path` is
 * "/invoices/statement.pdf" (a doctor's own) or
 * "/admin/clients/:userId/statement.pdf".
 */
export function StatementDownload({ path, compact = false }) {
  const months = recentMonths(labToday(), 12);
  const [month, setMonth] = useState(months[0].value);
  const { addToast } = useToast();
  const open = () =>
    openPdf(api, path, { month }).catch(async (err) => addToast({ message: await blobErrorText(err), type: "error" }));
  return (
    <div className="flex items-center gap-2">
      <select
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        aria-label="Statement month"
        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
      >
        {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-200"
      >
        <FileDown size={12} /> {compact ? "Statement" : "Download statement"}
      </button>
    </div>
  );
}
