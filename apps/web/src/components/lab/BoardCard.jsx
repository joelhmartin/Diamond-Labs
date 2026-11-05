import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import { TagChips } from "../../modules/record-tags/index.js";
import { labOrderPath } from "../../config/routes.js";
import { FlagBadges, DueLabel, AssigneeInitials, QuickMoveButtons } from "./board-columns.jsx";

/** One order on the kanban board. */
export function BoardCard({ card, busy, onMove }) {
  return (
    <div className={`rounded-2xl border bg-white p-3 shadow-sm ${card.overdue ? "border-red-300" : "border-surface-300/50"}`}>
      <div className="flex items-start justify-between gap-2">
        <Link to={labOrderPath(card.id)} className="font-mono text-sm font-bold text-navy hover:text-brand-600">
          #{card.orderNumber}
          {card.starred && <Star size={11} className="ml-1 inline text-amber-500" fill="currentColor" aria-label="Starred" />}
        </Link>
        <div className="flex flex-wrap justify-end gap-1">
          <FlagBadges card={card} />
        </div>
      </div>
      <div className="mt-1 truncate text-xs text-navy/60">{card.practice}</div>
      <div className="mt-0.5 truncate text-xs text-navy" title={card.deviceSummary}>{card.deviceSummary}</div>
      {(card.reference || card.panNumber) && (
        <div className="mt-0.5 font-mono text-[10px] text-navy/40">
          {[card.reference, card.panNumber && `Pan ${card.panNumber}`].filter(Boolean).join(" · ")}
        </div>
      )}
      {card.tags?.length > 0 && <div className="mt-1.5"><TagChips tags={card.tags} /></div>}
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <DueLabel card={card} />
        <AssigneeInitials card={card} />
      </div>
      <div className="mt-2 empty:hidden">
        <QuickMoveButtons card={card} busy={busy} onMove={onMove} />
      </div>
    </div>
  );
}
