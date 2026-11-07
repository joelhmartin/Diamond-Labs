/* Plain section heading: sans H2 (no accented word) plus optional intro.
   `as` lets a page keep a valid outline; `align` is "left" or "center". */
export function SectionHeading({ title, intro, as: Tag = "h2", align = "left" }) {
  const centered = align === "center";
  return (
    <div className={centered ? "text-center mx-auto max-w-2xl" : "max-w-2xl"}>
      <Tag className="font-heading font-bold text-3xl md:text-5xl tracking-tight text-navy">{title}</Tag>
      {intro && <p className="mt-4 text-navy/70 text-lg leading-relaxed">{intro}</p>}
    </div>
  );
}
