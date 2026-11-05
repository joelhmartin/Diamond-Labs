/* A row of factual figures. tone="dark" for navy sections, "light" otherwise. */
export function StatRow({ stats, tone = "light" }) {
  const dark = tone === "dark";
  return (
    <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-8">
      {stats.map((s) => (
        <div key={s.label}>
          <dd
            className={`font-heading font-bold text-3xl md:text-5xl tracking-tight ${
              dark ? "text-on-dark" : "text-navy"
            }`}
          >
            {s.value}
          </dd>
          <dt className={`mt-2 text-sm ${dark ? "text-on-dark/70" : "text-navy/70"}`}>{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}
