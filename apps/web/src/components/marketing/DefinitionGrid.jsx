/* Three-up grid of terms with short descriptions, each under a thin top rule.
   Used wherever a page lists a few named points (levels, focus areas,
   advantages, tips). Item: { term, body, Icon?, note? }. `large` makes the
   term a bigger heading; `note` is an optional second line (any node). */
export function DefinitionGrid({ items, large = false, className = "mt-10" }) {
  return (
    <dl className={`${className} grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-8`}>
      {items.map(({ term, body, Icon, note }) => (
        <div key={term} className="border-t border-navy/15 pt-5">
          {Icon && <Icon size={20} className="text-brand-700 mb-3" aria-hidden="true" />}
          <dt className={`font-heading font-bold text-navy ${large ? "text-2xl" : "text-lg"}`}>{term}</dt>
          <dd className={`mt-2 text-navy/70 leading-relaxed ${large ? "" : "text-sm"}`}>{body}</dd>
          {note && <dd className="mt-3 text-sm text-navy/70">{note}</dd>}
        </div>
      ))}
    </dl>
  );
}
