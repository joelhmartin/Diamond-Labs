import { useState } from "react";
import { FileDown } from "lucide-react";
import api from "../../config/api.js";
import { useToast } from "../ui/Toast.jsx";
import { recentMonths, labToday } from "../../lib/invoices.js";
import { openPdf, blobErrorText } from "../../lib/requests.js";

/**
 * Pick a month and open that statement as a PDF. `path` is
 * "/invoices/statement.pdf" (a doctor's own) or
 * "/admin/practices/:id/statement.pdf".
 * `subjects` ([{ value, label }]) adds a "which statement" select whose value is sent as `account`
 * (a login with several practices must name one, or a group's combined statement).
 */
export function StatementDownload({ path, compact = false, subjects = null }) {
  const months = recentMonths(labToday(), 12);
  const [month, setMonth] = useState(months[0].value);
  const [subject, setSubject] = useState("");
  const { addToast } = useToast();
  // The select's value when it is still one of the offered subjects, else the first (practices change with the scope).
  const chosen = subjects?.some((s) => s.value === subject) ? subject : subjects?.[0]?.value;
  const open = () =>
    openPdf(api, path, { month, ...(chosen ? { account: chosen } : {}) }).catch(async (err) => addToast({ message: await blobErrorText(err), type: "error" }));
  return (
    <div className="flex items-center gap-2">
      {subjects && subjects.length > 0 && (
        <select
          value={chosen}
          onChange={(e) => setSubject(e.target.value)}
          aria-label="Statement for"
          className="max-w-[14rem] rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          {subjects.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
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
