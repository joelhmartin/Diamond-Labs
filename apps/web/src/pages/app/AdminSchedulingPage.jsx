import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useResource } from "../../hooks/useResource.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.jsx";
import { CalendarSettingsForm, HolidaysTable } from "../../modules/business-calendar/index.js";
import { WorkflowsTable, WorkflowEditor, AssignmentsTable } from "../../modules/workflows/index.js";

const TABS = [
  { value: "calendar", label: "Calendar" },
  { value: "holidays", label: "Holidays" },
  { value: "workflows", label: "Workflows" },
  { value: "assignments", label: "Assignments" },
];
const NONE = [];
const searchFn = (r, q) => `${r.family} ${r.code} ${r.name}`.toLowerCase().includes(q.toLowerCase());
const COLUMNS = [
  { id: "family", header: "Family", cell: (r) => r.family, sortValue: (r) => r.family },
  { id: "code", header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span>, sortValue: (r) => r.code },
  { id: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name },
];

/** The catalog variants (the same list Admin › Products loads) as assignment subjects. */
function useVariantSubjects() {
  const { data, loading, error, reload } = useResource("/admin/catalog/families");
  const subjects = useMemo(
    () => (data?.families ?? NONE).flatMap((f) => f.variants.map((v) => ({ id: v.id, family: f.name, code: v.code ?? "", name: v.name ?? "" }))),
    [data],
  );
  const families = useMemo(() => [...new Set(subjects.map((s) => s.family))].sort(), [subjects]);
  return { subjects, families, loading, error, reload };
}

function AssignmentsTab() {
  const variants = useVariantSubjects();
  const { data } = useResource("/scheduling/workflows");
  const workflows = useMemo(() => (data?.workflows ?? NONE).filter((w) => w.active).map((w) => ({ key: w.key, name: w.name })), [data]);
  const filters = useMemo(() => [{
    id: "family", label: "Family", type: "select", placeholder: "Any family",
    options: variants.families.map((f) => ({ value: f, label: f })),
    match: (r, v) => r.family === v,
  }], [variants.families]);

  return (
    <AssignmentsTable
      subjectType="variant" subjects={variants.subjects} columns={COLUMNS} workflows={workflows} filters={filters}
      searchFn={searchFn} loading={variants.loading} error={variants.error} reload={variants.reload}
    />
  );
}

function WorkflowsTab() {
  const [editing, setEditing] = useState(null); // { workflow, milestones, workflows }
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <WorkflowsTable onOpen={(workflow, ctx) => setEditing({ workflow, ...ctx })} refreshKey={refreshKey} />
      {editing && (
        <WorkflowEditor
          workflow={editing.workflow}
          milestones={editing.milestones}
          workflows={editing.workflows}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setRefreshKey((k) => k + 1); }}
        />
      )}
    </>
  );
}

/** Admin › Scheduling: the business calendar, holidays, workflow templates and which workflow each item uses. */
export function AdminSchedulingPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "calendar";
  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Scheduling</h1>
          <p className="mt-1 text-sm text-navy/50">Working days, holidays, daily limits and the workflows that set due dates.</p>
        </div>
        <SegmentedControl label="Section" value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} options={TABS} />
      </div>
      {tab === "calendar" && <CalendarSettingsForm />}
      {tab === "holidays" && <HolidaysTable />}
      {tab === "workflows" && <WorkflowsTab />}
      {tab === "assignments" && <AssignmentsTab />}
    </div>
  );
}
