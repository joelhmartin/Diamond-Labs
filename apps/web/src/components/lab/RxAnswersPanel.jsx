import { Panel } from "./Panel.jsx";

/** The prescription answers, grouped as `groupRxAnswers` returns them. */
export function RxAnswersPanel({ groups }) {
  if (!groups.length) return null;
  return (
    <Panel title="Prescription">
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.id}>
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-navy/50">{g.title}</h3>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              {g.items.map((i) => (
                <div key={i.key} className="contents">
                  <dt className="text-navy/50">{i.label}</dt>
                  <dd className="text-navy">{i.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Panel>
  );
}
