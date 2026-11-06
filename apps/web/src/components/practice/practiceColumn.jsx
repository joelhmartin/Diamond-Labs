import { practiceLabel } from "@my-app/shared";
import { practiceIdOf } from "../../lib/practices.js";

/** The Practice column for a DataTable. Rows that carry accountName/accountNumber use them; else the scope's practice. */
export function practiceColumn(accounts) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const text = (row) => {
    const a = byId.get(practiceIdOf(row));
    return a ? practiceLabel(a) : practiceLabel({ name: row.accountName, accountNumber: row.accountNumber }) || "—";
  };
  return {
    id: "practice", header: "Practice", sortValue: text, exportValue: text,
    cell: (row) => {
      const a = byId.get(practiceIdOf(row));
      return (
        <span className="text-navy/70">
          {text(row)}
          {a && !a.payable && <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">View only</span>}
        </span>
      );
    },
  };
}
