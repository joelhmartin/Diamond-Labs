import { Check, Circle } from "lucide-react";

/**
 * A plan's stages with their target dates. `stages` is `[{ key, label, targetAt,
 * reached?, late? }]`: the host marks which milestones are reached and which stage
 * is late. Renders nothing for a plan without stages.
 */
export function StageSchedule({ stages = [] }) {
  if (!stages.length) return null;
  return (
    <ol className="space-y-1.5">
      {stages.map((s) => (
        <li key={s.key} className={`flex items-center gap-2 text-sm ${s.late ? "font-semibold text-red-600" : "text-navy"}`}>
          {s.reached ? <Check size={14} aria-label="Reached" className="text-emerald-600" /> : <Circle size={10} aria-hidden="true" className="text-navy/30" />}
          <span className="flex-1">{s.label}</span>
          <span className="font-mono text-xs tabular-nums">{s.targetAt}</span>
        </li>
      ))}
    </ol>
  );
}
