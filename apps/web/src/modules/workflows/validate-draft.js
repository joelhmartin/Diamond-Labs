import { workflowTemplateSchema } from "@my-app/shared";

/** A lowercase, dash-separated key from free text ("Rush order" -> "rush-order"). */
export function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** Give each stage without a key one from its label, unique within the list. */
export function withStageKeys(stages) {
  const taken = new Set(stages.map((s) => s.key).filter(Boolean));
  return stages.map((s) => {
    if (s.key) return s;
    const base = slugify(s.label) || "stage";
    let key = base;
    for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`.slice(0, 60);
    taken.add(key);
    return { ...s, key };
  });
}

/**
 * The first reason a workflow template cannot be saved, or null. Same rules and
 * wording as the server's `validateTemplate`, then the shared schema for field
 * shapes, so the editor can explain before it sends.
 */
export function validateWorkflowDraft(t) {
  const stages = t.stages ?? [];
  if (!stages.length) return "A workflow needs at least one stage.";
  if (new Set(stages.map((s) => s.key)).size !== stages.length) return "Stage keys must be unique.";
  let prev = 0;
  for (const s of stages) {
    if (!Number.isInteger(s.dayOffset) || s.dayOffset < 0) return "Stage day offsets must be whole numbers from 0.";
    if (s.dayOffset < prev) return "Stage day offsets must not decrease.";
    prev = s.dayOffset;
  }
  if (prev !== t.totalDays) return "The last stage must fall on the workflow's total days.";
  if (t.rushWorkflowKey && t.rushWorkflowKey === t.key) return "A workflow cannot be its own rush variant.";
  const parsed = workflowTemplateSchema.safeParse(t);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return `${issue.path.join(" ")}: ${issue.message}`.replace(/^: /, "");
  }
  return null;
}
