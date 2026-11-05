import { useEffect, useState } from "react";
import { calendarSettingsSchema } from "@my-app/shared";
import api from "../../config/api.js";
import { useResource } from "../../hooks/useResource.js";
import { errorText } from "../../lib/requests.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.jsx";
import { useToast } from "../../components/ui/Toast.jsx";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BASES = [{ value: "none", label: "No limit" }, { value: "orders", label: "Orders" }, { value: "units", label: "Units" }];

/** Form state from the API's settings (capacity numbers become text so a blank means "no limit"). */
function toForm(s) {
  return {
    timezone: s.timezone,
    leadDays: String(s.leadDays),
    closedWeekdays: [...s.closedWeekdays],
    capacityBasis: s.capacityBasis,
    capacityByWeekday: Object.fromEntries(WEEKDAYS.map((_, i) => [i, s.capacityByWeekday?.[i] == null ? "" : String(s.capacityByWeekday[i])])),
  };
}

function toPayload(f) {
  return {
    timezone: f.timezone.trim(),
    leadDays: f.leadDays === "" ? Number.NaN : Number(f.leadDays),
    closedWeekdays: [...f.closedWeekdays].sort(),
    capacityBasis: f.capacityBasis,
    capacityByWeekday: Object.fromEntries(Object.entries(f.capacityByWeekday).map(([k, v]) => [k, v === "" ? null : Number(v)])),
  };
}

/** Lead days, closed weekdays, timezone and per-weekday capacity for one business calendar. */
export function CalendarSettingsForm({ basePath = "/scheduling/calendar", onSaved }) {
  const { addToast } = useToast();
  const { data, loading, error } = useResource(basePath);
  const [form, setForm] = useState(null);
  const [problem, setProblem] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data) setForm(toForm(data)); }, [data]);

  if (error) return <p className="text-sm text-red-600">{errorText(error)}</p>;
  if (loading || !form) return <p className="text-sm text-navy/50">Loading…</p>;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleClosed = (i) =>
    set({ closedWeekdays: form.closedWeekdays.includes(i) ? form.closedWeekdays.filter((d) => d !== i) : [...form.closedWeekdays, i] });

  const save = async (e) => {
    e.preventDefault();
    const payload = toPayload(form);
    const parsed = calendarSettingsSchema.safeParse(payload);
    if (!parsed.success) {
      setProblem(parsed.error.issues[0].message);
      return;
    }
    setProblem(null);
    setSaving(true);
    try {
      const res = await api.put(basePath, parsed.data);
      addToast({ message: "Calendar saved", type: "success" });
      onSaved?.(res.data.data);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="max-w-xl space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Timezone" value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} />
        <Input label="Lead days" type="number" min="0" value={form.leadDays} onChange={(e) => set({ leadDays: e.target.value })} />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-gray-700">Closed weekdays</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map((name, i) => (
            <label key={name} className="flex items-center gap-1.5 text-sm text-navy">
              <input type="checkbox" checked={form.closedWeekdays.includes(i)} onChange={() => toggleClosed(i)} />
              {name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700">Daily limit counts</p>
        <SegmentedControl label="Capacity basis" value={form.capacityBasis} onChange={(capacityBasis) => set({ capacityBasis })} options={BASES} />
      </div>

      {form.capacityBasis !== "none" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {WEEKDAYS.map((name, i) => (
            <Input
              key={name}
              label={`${name} limit`}
              type="number"
              min="0"
              placeholder="No limit"
              disabled={form.closedWeekdays.includes(i)}
              value={form.capacityByWeekday[i]}
              onChange={(e) => set({ capacityByWeekday: { ...form.capacityByWeekday, [i]: e.target.value } })}
            />
          ))}
        </div>
      )}

      {problem && <p role="alert" className="text-sm text-red-600">{problem}</p>}
      <Button type="submit" loading={saving}>Save calendar</Button>
    </form>
  );
}
