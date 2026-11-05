/** A titled card on the order detail page; `action` sits at the right of the heading. */
export function Panel({ title, children, action }) {
  return (
    <section className="rounded-2xl border border-surface-300/50 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-sm font-bold text-navy">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
