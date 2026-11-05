import { useMemo, useState } from "react";
import api from "../../config/api.js";
import { useResource } from "../../hooks/useResource.js";
import { errorText, isStale } from "../../lib/requests.js";
import { Badge } from "../ui/Badge.jsx";
import { useToast } from "../ui/Toast.jsx";
import { StageSchedule } from "../../modules/workflows/index.js";
import { INPUT } from "./form-styles.js";

const NONE = [];

/**
 * An order's schedule: the workflow in use, a way to switch it, and the stage
 * targets. `schedule` is the order detail's `schedule` (null when it has no plan).
 * Applying posts the order's version; a stale reply toasts and calls `onChanged`
 * so the page reloads, as does a successful change.
 */
export function SchedulePanel({ order, schedule, onChanged }) {
  const { addToast } = useToast();
  const { data } = useResource("/scheduling/workflows");
  const options = useMemo(() => (data?.workflows ?? NONE).filter((w) => w.active), [data]);
  const [picked, setPicked] = useState(null);
  const [keepDueDate, setKeepDueDate] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = schedule?.workflowKey ?? "";
  const value = picked ?? current;

  const apply = async () => {
    setBusy(true);
    try {
      await api.post(`/lab/orders/${order.id}/workflow`, { workflowKey: value, keepDueDate, expectedVersion: order.version });
      addToast({ message: "Workflow changed", type: "success" });
      setPicked(null);
      onChanged?.();
    } catch (err) {
      addToast({ message: isStale(err) ? `${errorText(err)} The latest version has been loaded.` : errorText(err), type: "error" });
      if (isStale(err)) onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const stages = schedule?.stages ?? NONE;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {schedule ? <span className="font-medium text-navy">{schedule.workflowName ?? "Lead time only, no workflow"}</span> : <span className="text-navy/50">No schedule yet.</span>}
        {schedule?.behind && <Badge color="red">Behind</Badge>}
        {schedule?.atRisk && <Badge color="yellow">At risk</Badge>}
      </div>
      <label className="block">
        <span className="text-xs text-navy/50">Workflow</span>
        <select className={INPUT} disabled={busy} value={value} onChange={(e) => setPicked(e.target.value)}>
          {!current && <option value="" disabled>Choose a workflow</option>}
          {current && !options.some((w) => w.key === current) && <option value={current} disabled>{schedule.workflowName} (inactive)</option>}
          {options.map((w) => <option key={w.key} value={w.key}>{w.name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-navy">
        <input type="checkbox" checked={keepDueDate} onChange={(e) => setKeepDueDate(e.target.checked)} />
        Keep due date
      </label>
      <button
        type="button"
        disabled={busy || !value || value === current}
        onClick={apply}
        className="rounded-full bg-navy px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
      >
        Apply
      </button>
      <StageSchedule stages={stages} />
    </div>
  );
}
