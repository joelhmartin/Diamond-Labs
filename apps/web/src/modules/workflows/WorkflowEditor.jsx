import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import api from "../../config/api.js";
import { errorText } from "../../lib/requests.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { slugify, validateWorkflowDraft, withStageKeys } from "./validate-draft.js";

const SELECT = "block w-full rounded-lg border border-gray-300 px-2 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";
const ICON_BTN = "rounded-full p-1.5 text-navy/60 hover:bg-surface-100 hover:text-navy disabled:opacity-30";

const BLANK = { key: "", name: "", totalDays: 0, rushWorkflowKey: null, isDefault: false, active: true, stages: [] };

const toDraft = (w) => ({
  ...BLANK, ...w,
  totalDays: String(w?.totalDays ?? 0),
  stages: (w?.stages ?? []).map((s) => ({ ...s, dayOffset: String(s.dayOffset) })),
});

/** The template the API takes: numbers parsed, stage keys filled in. */
function toTemplate(draft, creating) {
  const num = (v) => (v === "" ? Number.NaN : Number(v));
  return {
    key: creating ? (draft.key || slugify(draft.name)) : draft.key,
    name: draft.name.trim(),
    totalDays: num(draft.totalDays),
    rushWorkflowKey: draft.rushWorkflowKey || null,
    isDefault: draft.isDefault,
    active: draft.active,
    stages: withStageKeys(draft.stages).map((s) => ({ key: s.key, label: s.label.trim(), milestone: s.milestone, dayOffset: num(s.dayOffset) })),
  };
}

/**
 * Create (`workflow` null) or edit a workflow template in a modal: name, total
 * business days, rush variant, and an ordered stage list (label, host
 * milestone, day offset; add, remove, move). Checks the rules client-side
 * before saving. `milestones` is `[{ value, label }]`; `workflows` (optional,
 * `[{ key, name }]`) feeds the rush-variant select.
 */
export function WorkflowEditor({ basePath = "/scheduling/workflows", workflow = null, milestones = [], workflows = [], onSaved, onClose }) {
  const { addToast } = useToast();
  const creating = !workflow?.id;
  const [draft, setDraft] = useState(() => toDraft(workflow));
  const [problem, setProblem] = useState(null);
  const [saving, setSaving] = useState(false);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setStage = (i, patch) => set({ stages: draft.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const removeStage = (i) => set({ stages: draft.stages.filter((_, j) => j !== i) });
  const moveStage = (i, by) => {
    const next = [...draft.stages];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    set({ stages: next });
  };
  const addStage = () => {
    const last = draft.stages.at(-1);
    set({ stages: [...draft.stages, { key: "", label: "", milestone: milestones[0]?.value ?? "", dayOffset: last ? last.dayOffset : "0" }] });
  };

  const save = async (e) => {
    e.preventDefault();
    const template = toTemplate(draft, creating);
    const reason = validateWorkflowDraft(template);
    if (reason) {
      setProblem(reason);
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      const res = creating ? await api.post(basePath, template) : await api.put(`${basePath}/${workflow.id}`, template);
      addToast({ message: "Workflow saved", type: "success" });
      onSaved?.(res.data.data);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={creating ? "New workflow" : `Edit ${workflow.name}`} className="max-w-2xl">
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          <Input label="Key" disabled={!creating} placeholder={slugify(draft.name) || "auto"} value={draft.key} onChange={(e) => set({ key: e.target.value })} />
          <Input label="Total days" type="number" min="0" value={draft.totalDays} onChange={(e) => set({ totalDays: e.target.value })} />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          {workflows.length > 0 && (
            <label className="block text-sm font-medium text-gray-700">
              Rush variant
              <select className={`${SELECT} mt-1`} value={draft.rushWorkflowKey ?? ""} onChange={(e) => set({ rushWorkflowKey: e.target.value || null })}>
                <option value="">None</option>
                {workflows.filter((w) => w.key !== draft.key).map((w) => <option key={w.key} value={w.key}>{w.name}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-1.5 text-sm text-navy">
            <input type="checkbox" checked={draft.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} /> Default
          </label>
          <label className="flex items-center gap-1.5 text-sm text-navy">
            <input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} /> Active
          </label>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-700">Stages</legend>
          {draft.stages.map((s, i) => (
            <div key={s.key || `new-${i}`} className="grid grid-cols-[1fr_9rem_5rem_auto] items-center gap-2">
              <input aria-label="Stage label" className={SELECT} placeholder="Label" value={s.label} onChange={(e) => setStage(i, { label: e.target.value })} />
              <select aria-label="Stage milestone" className={SELECT} value={s.milestone} onChange={(e) => setStage(i, { milestone: e.target.value })}>
                {milestones.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <input aria-label="Stage day offset" type="number" min="0" className={SELECT} value={s.dayOffset} onChange={(e) => setStage(i, { dayOffset: e.target.value })} />
              <span className="flex">
                <button type="button" aria-label={`Move ${s.label} up`} className={ICON_BTN} disabled={i === 0} onClick={() => moveStage(i, -1)}><ArrowUp size={14} /></button>
                <button type="button" aria-label={`Move ${s.label} down`} className={ICON_BTN} disabled={i === draft.stages.length - 1} onClick={() => moveStage(i, 1)}><ArrowDown size={14} /></button>
                <button type="button" aria-label={`Remove ${s.label}`} className={ICON_BTN} onClick={() => removeStage(i)}><X size={14} /></button>
              </span>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={addStage}><Plus size={14} /> Add stage</Button>
        </fieldset>

        {problem && <p role="alert" className="text-sm text-red-600">{problem}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
