import { useNavigate, useSearchParams } from "react-router-dom";
import { isoDateIn } from "@my-app/shared";
import { useResource } from "../../hooks/useResource.js";
import { errorText } from "../../lib/requests.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.jsx";
import { CalendarGrid, rangeFor } from "../../modules/business-calendar/index.js";

const VIEWS = [{ value: "month", label: "Month" }, { value: "week", label: "Week" }];
const BASES = [{ value: "orders", label: "Orders" }, { value: "units", label: "Units" }];
const pick = (value, allowed, fallback) => (allowed.some((o) => o.value === value) ? value : fallback);

/**
 * Lab › Calendar: the due-date load per day (orders or units), month or week.
 * View, basis and anchor live in the URL; a day opens the board filtered to it.
 */
export function OrdersCalendarPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = pick(params.get("view"), VIEWS, "month");
  const basis = pick(params.get("basis"), BASES, "orders");
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.get("anchor") ?? "") ? params.get("anchor") : isoDateIn();
  const { from, to } = rangeFor(anchor, view);
  const { data, error } = useResource("/scheduling/calendar/days", { params: { from, to, basis } });

  const update = (patch) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    return next;
  }, { replace: true });

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Calendar</h1>
          <p className="mt-1 text-sm text-navy/50">Work due each day. Pick a day to see it on the board.</p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl label="Count" value={basis} onChange={(v) => update({ basis: v })} options={BASES} />
          <SegmentedControl label="Range" value={view} onChange={(v) => update({ view: v })} options={VIEWS} />
        </div>
      </div>
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{errorText(error)}</p>}
      <CalendarGrid
        days={data?.days ?? []}
        view={view}
        anchor={anchor}
        onAnchorChange={(date) => update({ anchor: date })}
        onDayClick={(date) => navigate(`/lab?dueOn=${date}`)}
      />
    </div>
  );
}
