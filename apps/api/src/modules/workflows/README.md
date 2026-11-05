# workflows

A generic module: named templates with ordered stages, planned in business days against a `business-calendar` Calendar. It knows nothing about what the host app schedules. Each stage names a host-defined **milestone** string. For a worked example of wiring it into an app, see Key File Paths in the root CLAUDE.md.

## Shapes

```
Template = { key, name, totalDays, rushWorkflowKey, isDefault, active, position?,
             stages: [{ key, label, milestone, dayOffset }] }
Plan     = { workflowKey, workflowName, startDate, dueAt, direction: "forward" | "reverse",
             stages: [{ key, label, milestone, targetAt }] }
```

Dates are `"YYYY-MM-DD"` strings in the calendar's timezone. Day counts are business days. Stage offsets never decrease and the last offset equals `totalDays`.

## The milestone contract

Milestones are your app's ordered states (for example "started", "in progress", "done"). The module never orders them: you pass `rankOf(milestone) -> number` to `behindSchedule`, and the routes factory takes the list of allowed milestones.

## Pure rules (`rules.js`)

- `validateTemplate(t)`: throws `INVALID` unless there is at least one stage, stage keys are unique, offsets are non-decreasing and at least 0, the last offset equals `totalDays`, and the rush link is not the template itself.
- `resolveRush(template, byKey, rush)`: the linked template when `rush` and it is active, else the same template.
- `planFromTemplate(template | null, { startDate, dueAt? }, calendar)`: forward from `startDate`, due date = last target; with `dueAt` it plans in reverse (targets clamped to `startDate`, the last stage lands on `dueAt`). No template: `dueAt` (or start plus `calendar.leadDays`) and no stages.
- `planWith(templatesByKey, { workflowKey, startAt, rush, dueAt }, calendar)`: pure core of `planFor`; unknown key throws `NOT_FOUND`.
- `behindSchedule(stages, currentRank, rankOf, today)`: `{ behind, lateStage }`, the first stage whose target has passed and whose milestone ranks above the record's.
- `pickLongest(templates)`: most days, then lower position, then key.

## Data model

`schema.js` (re-exported from `db/schema/index.js`), no foreign keys:

- `workflows`: `id`, `key` (unique), `name`, `total_days`, `rush_workflow_key`, `is_default`, `active`, `position`, stamps.
- `workflow_stages`: `id`, `workflow_id`, `position`, `key`, `label`, `day_offset`, `milestone`.
- `workflow_assignments`: pk (`subject_type`, `subject_id`), `workflow_key`.
- `workflow_plans`: pk (`record_type`, `record_id`), `workflow_key`, `workflow_name`, `start_date`, `due_date`, `direction`, `stages` (jsonb snapshot), stamps; index on (`record_type`, `due_date`).

Plans are snapshots: editing a template never moves a saved plan. Deactivated templates still resolve by key.

## Service

`createWorkflowsService(db)` returns:

- `listWorkflows({ includeInactive })`, `getWorkflow(key)` (inactive included).
- `saveWorkflow(template, { id? })`: validates, replaces stages in one transaction, keeps a single default, `CONFLICT` on a duplicate key.
- `setActive(ids, active)`: bulk; templates are never deleted.
- `planFor({ workflowKey, startAt, rush, dueAt }, calendar)`: loads templates and calls `planWith`.
- `assignmentsFor(subjectType, subjectIds?)`, `setAssignments(subjectType, subjectIds, workflowKey | null)` (null removes).
- `workflowForSubjects([{ type, id }])`: tiers in order; the first tier with assigned active templates wins (longest), else the active default, else null.
- `savePlan(tx, recordType, recordId, plan)`: upsert inside the caller's transaction. `plansFor(recordType, recordIds)`: batched `Map`.

## Routes factory

`workflowRoutes(fastify, { db, prefix = "/scheduling/workflows", readGuard, writeGuard, calendarKey = "default", milestones, onAudit? })`:

- `GET {prefix}`: `{ workflows, milestones }` (readGuard).
- `POST {prefix}`, `PUT {prefix}/:id`: save a whole template (writeGuard). A stage milestone outside `milestones` is a 400.
- `POST {prefix}/active`: `{ ids, active }` (writeGuard).
- `GET {prefix}/assignments?subjectType=`, `PUT {prefix}/assignments` (writeGuard).
- `POST {prefix}/preview`: `{ workflowKey, startAt, rush, dueAt }` returns a plan using the stored calendar (readGuard).

`milestones` is `[{ value, label }]`. `onAudit(request, action, targetId, metadata)` runs after each write; metadata is ids and keys only. Errors reply `{ error: { code, status, message } }`.

## Wiring it into another app

TODO (Task 11).
