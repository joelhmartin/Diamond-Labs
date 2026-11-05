/* The home hero's backdrop: gradient, slow drifting diamonds and, on dark,
   readability overlays. Absolutely positioned; the parent needs `relative`.
   tone="light" puts faint versions of the same diamonds on a white surface. */
const DIAMONDS = [
  { place: "top-[-10%] left-[-5%] w-[40vw] h-[40vw]", dark: "bg-brand-500/20 opacity-30", light: "bg-brand-500/[0.06]", drift: "animate-float-1" },
  { place: "top-[20%] right-[-10%] w-[50vw] h-[50vw]", dark: "bg-brand-400/20 opacity-40", light: "bg-brand-400/[0.08]", drift: "animate-float-2", delay: "-1s" },
  { place: "bottom-[-15%] left-[20%] w-[45vw] h-[45vw]", dark: "bg-brand-500/15 opacity-20", light: "bg-brand-500/[0.05]", drift: "animate-float-3", delay: "-2s" },
  { place: "top-[40%] left-[60%] w-[25vw] h-[25vw]", dark: "bg-brand-300/20 opacity-30", light: "bg-brand-300/[0.1]", drift: "animate-float-1", delay: "-1.5s" },
];

export function HeroStage({ tone = "dark" }) {
  const dark = tone === "dark";
  return (
    <div className={`absolute inset-0 overflow-hidden ${dark ? "bg-gradient-to-br from-navy to-navy-dark" : "bg-white"}`}>
      {DIAMONDS.map((d) => (
        <div
          key={d.place}
          className={`absolute ${d.place} ${dark ? `${d.dark} mix-blend-screen` : d.light} ${d.drift}`}
          style={d.delay ? { animationDelay: d.delay } : undefined}
        />
      ))}
      {dark && (
        <>
          <div className="absolute inset-0 bg-gradient-to-r from-navy/60 via-navy/30 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-navy/80 via-transparent to-transparent" />
        </>
      )}
    </div>
  );
}
