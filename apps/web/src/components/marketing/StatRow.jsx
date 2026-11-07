/* A row of factual figures. tone="dark" for navy sections, "light" otherwise.
   The columns fit the stat count so a short row leaves no empty cell. Each
   stat is a <dt> label followed by its <dd> value (valid description-list
   order); flex-col-reverse shows the number on top. */
const COLUMNS = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3",
};

export function StatRow({ stats, tone = "light" }) {
  const dark = tone === "dark";
  const columns = COLUMNS[stats.length] ?? "grid-cols-2 md:grid-cols-4";
  return (
    <dl className={`grid ${columns} gap-x-8 gap-y-8`}>
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col-reverse justify-end">
          <dt className={`mt-2 text-sm ${dark ? "text-on-dark/70" : "text-navy/70"}`}>{s.label}</dt>
          <dd
            className={`font-heading font-bold text-3xl md:text-5xl tracking-tight ${
              dark ? "text-on-dark" : "text-navy"
            }`}
          >
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
