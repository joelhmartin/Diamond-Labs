import { describeEvent } from "../../lib/lab-board.js";
import { Panel } from "./Panel.jsx";

export function TimelinePanel({ events, staffById, departmentsById }) {
  return (
    <Panel title="Timeline">
      <ol className="space-y-2 text-sm">
        {events.map((e) => (
          <li key={e.id} className="flex gap-3">
            <span className="w-36 flex-shrink-0 text-xs text-navy/40">{new Date(e.at).toLocaleString()}</span>
            <span className="text-navy">{describeEvent(e, { staffById, departmentsById })}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
