/* The home hero's backdrop: navy-to-blue gradient, slow drifting diamonds and
   readability overlays. Absolutely positioned; the parent needs `relative`. */
export function HeroStage() {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-navy to-navy-dark overflow-hidden">
      <div className="absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] bg-brand-500/20 opacity-30 animate-float-1 mix-blend-screen" />
      <div className="absolute top-[20%] right-[-10%] w-[50vw] h-[50vw] bg-brand-400/20 opacity-40 animate-float-2 mix-blend-screen" style={{ animationDelay: "-1s" }} />
      <div className="absolute bottom-[-15%] left-[20%] w-[45vw] h-[45vw] bg-brand-500/15 opacity-20 animate-float-3 mix-blend-screen" style={{ animationDelay: "-2s" }} />
      <div className="absolute top-[40%] left-[60%] w-[25vw] h-[25vw] bg-brand-300/20 opacity-30 animate-float-1 mix-blend-screen" style={{ animationDelay: "-1.5s" }} />
      <div className="absolute inset-0 bg-gradient-to-r from-navy/60 via-navy/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-navy/80 via-transparent to-transparent" />
    </div>
  );
}
