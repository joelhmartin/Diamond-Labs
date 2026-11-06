import { useState } from "react";
import { TagDefinitionsAdmin } from "../../modules/record-tags/index.js";
import { LAB_ORDER_TAG_TYPE } from "../../lib/lab-board.js";
import { CLIENT_REP_TAG_TYPE } from "../../components/admin/ClientRepPicker.jsx";

const KINDS = [
  { type: LAB_ORDER_TAG_TYPE, label: "Order labels", note: "Labels are visible to all staff; don't put patient names in them." },
  { type: CLIENT_REP_TAG_TYPE, label: "Sales reps", note: "Each rep is a label you assign to clients on the Users screen; Sales By Rep reads them." },
];

/** Admin › Labels: the colored labels staff put on lab orders, and the sales reps assigned to clients (same label editor). */
export function AdminLabelsPage() {
  const [type, setType] = useState(LAB_ORDER_TAG_TYPE);
  const kind = KINDS.find((k) => k.type === type);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6 md:p-8">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Labels</h1>
        <p className="mt-1 text-sm text-navy/50">{kind.note}</p>
      </div>
      <div role="tablist" aria-label="Label type" className="flex gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k.type} type="button" role="tab" aria-selected={k.type === type} onClick={() => setType(k.type)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${k.type === type ? "bg-navy text-white" : "bg-surface-100 text-navy/60 hover:bg-surface-200"}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <TagDefinitionsAdmin key={type} recordType={type} />
    </div>
  );
}
