import { useEffect, useState } from "react";
import { Panel } from "./Panel.jsx";
import { INPUT } from "./form-styles.js";

/**
 * Assignee, department and due date, plus who the order is for. The due-date
 * input only resets when the server value (or the order) changes, so a reload
 * doesn't wipe a date being typed.
 */
export function WorkPanel({ order, staff, departments, busy, closed, practice, patient, onField }) {
  const [due, setDue] = useState(order.dueDate ?? "");
  useEffect(() => { setDue(order.dueDate ?? ""); }, [order.id, order.dueDate]);
  return (
    <Panel title="Work">
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-xs text-navy/50">Assigned to</span>
          <select className={INPUT} disabled={busy || closed} value={order.assigneeUserId ?? ""} onChange={(e) => onField("assign", e.target.value || null)}>
            <option value="">Nobody</option>
            {/* Former staff stay visible (as inactive) rather than reading as "Nobody". */}
            {order.assigneeUserId && !staff.some((s) => s.id === order.assigneeUserId) && (
              <option value={order.assigneeUserId} disabled>{order.assigneeName || "Former staff"} (inactive)</option>
            )}
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-navy/50">Department</span>
          <select className={INPUT} disabled={busy || closed} value={order.departmentId ?? ""} onChange={(e) => onField("department", e.target.value || null)}>
            <option value="">None</option>
            {departments.filter((d) => d.active || d.id === order.departmentId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <div>
          <span className="text-xs text-navy/50">Due date</span>
          <div className="flex gap-2">
            <input type="date" className={INPUT} disabled={busy || closed} value={due} onChange={(e) => setDue(e.target.value)} />
            <button type="button" disabled={busy || closed || due === (order.dueDate ?? "")} onClick={() => onField("due", due || null)} className="rounded-lg bg-surface-100 px-3 text-xs font-semibold text-navy disabled:opacity-40">Save</button>
          </div>
        </div>
        <div className="text-xs text-navy/50">
          Practice: <span className="text-navy">{practice || "—"}</span><br />
          {patient && <>Patient: <span className="text-navy">{patient}</span></>}
        </div>
      </div>
    </Panel>
  );
}
