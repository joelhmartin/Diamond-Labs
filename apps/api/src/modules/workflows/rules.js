import { WorkflowError } from "./errors.js";
import { addBusinessDays, subtractBusinessDays, dateIn } from "../business-calendar/rules.js";

/**
 * Pure planning rules. A template is { key, name, totalDays, rushWorkflowKey,
 * isDefault, active, stages: [{ key, label, milestone, dayOffset }] }; a plan is
 * { workflowKey, workflowName, startDate, dueAt, direction, stages: [{ key, label, milestone, targetAt }] }.
 * Dates are "YYYY-MM-DD" strings in the calendar's timezone; day counts are business days.
 */

/** Throws INVALID unless the template is internally consistent. */
export function validateTemplate(t) {
  const fail = (message) => { throw new WorkflowError("INVALID", message); };
  const stages = t.stages ?? [];
  if (!stages.length) fail("A workflow needs at least one stage.");
  if (new Set(stages.map((s) => s.key)).size !== stages.length) fail("Stage keys must be unique.");
  let prev = 0;
  for (const s of stages) {
    if (!Number.isInteger(s.dayOffset) || s.dayOffset < 0) fail("Stage day offsets must be whole numbers from 0.");
    if (s.dayOffset < prev) fail("Stage day offsets must not decrease.");
    prev = s.dayOffset;
  }
  if (prev !== t.totalDays) fail("The last stage must fall on the workflow's total days.");
  if (t.rushWorkflowKey && t.rushWorkflowKey === t.key) fail("A workflow cannot be its own rush variant.");
}

/** The rush-linked template when `rush` and it exists and is active; otherwise `template` itself. */
export function resolveRush(template, byKey, rush) {
  if (!rush || !template?.rushWorkflowKey) return template;
  const linked = byKey?.[template.rushWorkflowKey];
  return linked && linked.active !== false ? linked : template;
}

/** Longest template wins; ties go to the lower position, then the key. */
export function pickLongest(templates) {
  if (!templates?.length) return null;
  return [...templates].sort((a, b) =>
    b.totalDays - a.totalDays || (a.position ?? 0) - (b.position ?? 0) || String(a.key).localeCompare(String(b.key)))[0];
}

/** Forward from `startDate`, or in reverse from `dueAt` (clamped to the start) when one is given. */
export function planFromTemplate(template, { startDate, dueAt = null }, calendar) {
  const direction = dueAt ? "reverse" : "forward";
  if (!template) {
    return {
      workflowKey: null, workflowName: null, startDate, direction, stages: [],
      dueAt: dueAt ?? addBusinessDays(startDate, calendar.leadDays ?? 0, calendar),
    };
  }
  const stages = template.stages.map((s) => {
    let targetAt;
    if (direction === "forward") targetAt = addBusinessDays(startDate, s.dayOffset, calendar);
    else if (s.dayOffset === template.totalDays) targetAt = dueAt;
    else {
      targetAt = subtractBusinessDays(dueAt, template.totalDays - s.dayOffset, calendar);
      if (targetAt < startDate) targetAt = startDate;
    }
    return { key: s.key, label: s.label, milestone: s.milestone, targetAt };
  });
  return {
    workflowKey: template.key, workflowName: template.name, startDate, direction, stages,
    dueAt: direction === "reverse" ? dueAt : stages.at(-1).targetAt,
  };
}

/** Pure core of the service's planFor: `templatesByKey` is an object keyed by template key. */
export function planWith(templatesByKey, { workflowKey, startAt, rush = false, dueAt = null }, calendar) {
  const startDate = dateIn(calendar.timezone, startAt ?? new Date());
  if (workflowKey == null) return planFromTemplate(null, { startDate, dueAt }, calendar);
  const base = templatesByKey[workflowKey];
  if (!base) throw new WorkflowError("NOT_FOUND", `Unknown workflow "${workflowKey}".`);
  return planFromTemplate(resolveRush(base, templatesByKey, rush), { startDate, dueAt }, calendar);
}

/**
 * Behind when the first stage whose target has passed is one the record has
 * not reached: `rankOf(milestone)` ranks milestones, `currentRank` is the record's.
 */
export function behindSchedule(stages, currentRank, rankOf, today) {
  for (const s of stages ?? []) {
    if (s.targetAt < today && rankOf(s.milestone) > currentRank) return { behind: true, lateStage: s.key };
  }
  return { behind: false, lateStage: null };
}
