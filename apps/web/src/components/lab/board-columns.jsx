import { Link } from "react-router-dom";
import { AlertTriangle, Zap, RotateCcw, Tag } from "lucide-react";
import { formatUsDate } from "@my-app/shared";
import { labOrderPath } from "../../config/routes.js";
import { quickMoves } from "../../lib/lab-board.js";
import { labelBadge } from "../../lib/shipping.js";

/** Rush / remake / label badges for a lab order. Shared by the kanban card and the table row. */
export function FlagBadges({ card }) {
  const label = labelBadge(card);
  return (
    <>
      {card.rush && (
        <span title={card.rushTier || "Rush"} className="flex items-center gap-0.5 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
          <Zap size={10} /> Rush
        </span>
      )}
      {card.isRemake && (
        <span className="flex items-center gap-0.5 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700">
          <RotateCcw size={10} /> Remake
        </span>
      )}
      {label && (
        <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
          <Tag size={10} /> {label}
        </span>
      )}
    </>
  );
}

/** "Due 10/30/2026" (red with an alert icon when overdue). */
export function DueLabel({ card, prefix = true }) {
  const text = card.dueDate ? `${prefix ? "Due " : ""}${formatUsDate(card.dueDate)}` : "No due date";
  return (
    <span className={card.overdue ? "flex items-center gap-1 font-semibold text-red-600" : "text-navy/50"}>
      {card.overdue && <AlertTriangle size={11} />}
      {text}
    </span>
  );
}

export function AssigneeInitials({ card }) {
  if (!card.assigneeInitials) return null;
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy/10 text-[10px] font-bold text-navy">
      {card.assigneeInitials}
    </span>
  );
}

/** The card's one-click move buttons. */
export function QuickMoveButtons({ card, busy, onMove }) {
  const moves = quickMoves(card);
  if (moves.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {moves.map((m) => (
        <button
          key={m.to}
          type="button"
          disabled={busy}
          onClick={() => onMove(card, m.to)}
          className="rounded-full bg-surface-100 px-2.5 py-1 text-[11px] font-semibold text-navy hover:bg-surface-200 disabled:opacity-40"
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** DataTable columns for a lab order row. */
export function boardColumns({ busyId, onMove }) {
  return [
    {
      id: "orderNumber", header: "Order #", sortValue: (c) => Number(c.orderNumber) || 0,
      cell: (c) => (
        <Link to={labOrderPath(c.id)} className="font-mono text-sm font-bold text-navy hover:text-brand-600">#{c.orderNumber}</Link>
      ),
      exportValue: (c) => c.orderNumber,
    },
    { id: "practice", header: "Practice", sortValue: (c) => c.practice ?? "", cell: (c) => <span className="text-xs">{c.practice}</span> },
    { id: "device", header: "Device", cell: (c) => <span className="text-xs" title={c.deviceSummary}>{c.deviceSummary}</span>, exportValue: (c) => c.deviceSummary },
    {
      id: "due", header: "Due", sortValue: (c) => c.dueDate ?? "9999",
      cell: (c) => <span className="text-xs"><DueLabel card={c} prefix={false} /></span>,
      exportValue: (c) => c.dueDate ?? "",
    },
    { id: "assignee", header: "Assignee", cell: (c) => <AssigneeInitials card={c} />, exportValue: (c) => c.assigneeInitials ?? "" },
    {
      id: "flags", header: "Flags",
      cell: (c) => <div className="flex flex-wrap gap-1"><FlagBadges card={c} /></div>,
      exportValue: (c) => [c.rush && "Rush", c.isRemake && "Remake"].filter(Boolean).join(" "),
    },
    {
      id: "actions", header: "", export: false,
      cell: (c) => <QuickMoveButtons card={c} busy={busyId === c.id} onMove={onMove} />,
    },
  ];
}
