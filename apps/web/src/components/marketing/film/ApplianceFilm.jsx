import { Component, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { prefersReducedMotion } from "../../../lib/reducedMotion";
import { CHAPTERS, FILM_VH, VARIANTS, buildFilmTimeline, createFilmState } from "./filmScript";

const FilmStage = lazy(() => import("./FilmStage.jsx"));

/* A real appliance held on screen for the whole scroll while the words pass over it.
   Everything readable is plain DOM, so the page still works without WebGL: visitors with
   reduced motion, Save-Data or no WebGL get the same chapters with the lab's photos. */

function canRunFilm() {
  if (prefersReducedMotion() || navigator.connection?.saveData) return false;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext(); // browsers cap live contexts
    return Boolean(gl);
  } catch {
    return false;
  }
}

class StageBoundary extends Component {
  componentDidCatch(error) {
    console.error("[ApplianceFilm] stage failed, using photos", error);
    this.props.onError();
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  state = { failed: false };
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function VariantPicker({ variant, onPick, tone = "dark" }) {
  return (
    <div role="group" aria-label="Choose a material" className="flex flex-wrap gap-2">
      {VARIANTS.map((v) => {
        const active = v.key === variant;
        return (
          <button
            key={v.key}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(v.key)}
            className={`min-h-[44px] px-5 rounded-full text-sm font-semibold border transition-all duration-300 hover:scale-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 ${
              active
                ? "bg-white text-navy border-white"
                : tone === "dark"
                ? "bg-white/5 text-white border-white/25 hover:bg-white/15"
                : "bg-white text-navy border-navy/15 hover:bg-surface-200"
            }`}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

function OpeningCopy() {
  return (
    <div data-copy className="max-w-[46rem]">
      <div data-film-intro className="mb-4">
        <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white/80 font-mono text-xs font-semibold tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
          TMD &amp; SLEEP ORTHOTIC LAB
        </span>
      </div>
      <h1 className="text-white">
        <span data-film-intro className="block font-heading font-bold text-4xl sm:text-5xl md:text-6xl lg:text-7xl [@media(max-height:760px)]:lg:text-5xl tracking-tight leading-[0.95]">
          Precision is the
        </span>
        <span data-film-intro className="block font-drama italic text-[4.5rem] sm:text-8xl md:text-[8.5rem] lg:text-[10.5rem] [@media(max-height:760px)]:lg:text-8xl tracking-tight leading-[0.85] text-brand-400">
          Protocol.
        </span>
      </h1>
      <p data-film-intro className="mt-6 text-white/75 text-base md:text-lg max-w-lg leading-relaxed font-medium">
        The orthotic lab for TMD and sleep dentistry. Digital workflow. Clinical accuracy. Every appliance, every time.
      </p>
      <div data-film-intro className="mt-8 flex flex-wrap items-center gap-4 pointer-events-auto">
        <Link to="/contact" className="btn-magnetic group px-7 py-3.5 rounded-full bg-accent-500 text-white font-semibold text-sm shadow-xl shadow-accent-500/20">
          <span className="btn-bg bg-accent-600 rounded-full" />
          <span className="relative z-10 flex items-center gap-2">
            Contact Our Lab
            <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
          </span>
        </Link>
        <Link to="/products" className="px-7 py-3.5 rounded-full bg-white/5 backdrop-blur-sm border border-white/20 text-white/85 font-semibold text-sm hover:bg-white/10 transition-all duration-300">
          View Products
        </Link>
      </div>
    </div>
  );
}

function ChapterCopy({ chapter, variant, onPick, tone = "dark" }) {
  const dark = tone === "dark";
  return (
    <div data-copy className="max-w-xl">
      {chapter.numeral && (
        <span aria-hidden="true" className="block font-drama italic lining-nums text-7xl md:text-8xl leading-none text-brand-400">
          {chapter.numeral}
        </span>
      )}
      {chapter.kicker && <p className={`text-sm font-semibold ${dark ? "text-brand-300" : "text-brand-700"}`}>{chapter.kicker}</p>}
      <h2 className={`mt-2 font-heading font-bold text-5xl md:text-7xl tracking-tight leading-[0.95] ${dark ? "text-white" : "text-navy"}`}>
        {chapter.title}
        {chapter.accent && <span className={`block font-drama italic font-normal ${dark ? "text-brand-400" : "text-brand-700"}`}>{chapter.accent}</span>}
      </h2>
      <p className={`mt-5 text-base md:text-lg leading-relaxed max-w-md ${dark ? "text-white/75" : "text-navy/70"}`}>{chapter.body}</p>
      {chapter.specs && (
        <ul className={`mt-5 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs ${dark ? "text-white/70" : "text-navy/70"}`}>
          {chapter.specs.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {chapter.variants && (
        <div className="mt-6 pointer-events-auto">
          <VariantPicker variant={variant} onPick={onPick} tone={tone} />
        </div>
      )}
      {chapter.link && (
        <Link to={chapter.link.to} className={`group mt-6 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold pointer-events-auto ${dark ? "text-white" : "text-navy"}`}>
          {chapter.link.label}
          <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
        </Link>
      )}
    </div>
  );
}

/* The film's words: one layer held in place for the whole scroll, with every chapter
   stacked in it. The timeline crossfades them, so the words never slide up the page. */
function FilmCopy({ variant, onPick }) {
  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        {CHAPTERS.map((chapter) => (
          <section key={chapter.id} data-chapter={chapter.id} className="absolute inset-0 section-pad flex items-end pb-28 md:pb-16 lg:items-center lg:pb-0 lg:pt-24">
            <div className="w-full max-w-6xl mx-auto">
              {chapter.id === "opening" ? <OpeningCopy /> : <ChapterCopy chapter={chapter} variant={variant} onPick={onPick} />}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/* The same chapters as a calm photographic page, for visitors who get no film. */
function StaticFilm({ variant, onPick }) {
  const pick = VARIANTS.find((v) => v.key === variant);
  return (
    <div className="relative bg-navy">
      {CHAPTERS.map((chapter, i) => (
        <section key={chapter.id} data-chapter={chapter.id} className={`section-pad ${i === 0 ? "pt-40 pb-16" : "py-16 md:py-24"}`}>
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-10 items-center">
            {chapter.id === "opening" ? <OpeningCopy /> : <ChapterCopy chapter={chapter} variant={variant} onPick={onPick} />}
            <img
              src={chapter.variants ? pick.image : chapter.fallback}
              alt=""
              loading={i === 0 ? "eager" : "lazy"}
              className="w-full max-h-[420px] object-contain rounded-[2.5rem] bg-white/5 p-6"
            />
          </div>
        </section>
      ))}
    </div>
  );
}

export function ApplianceFilm() {
  const root = useRef(null);
  const film = useMemo(createFilmState, []);
  const [mode, setMode] = useState(() => (canRunFilm() ? "film" : "photos"));
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(true);
  const [variant, setVariant] = useState(film.variant);

  useLayoutEffect(() => {
    if (mode !== "film") return undefined;
    const ctx = gsap.context(() => {
      buildFilmTimeline(root.current, film);
      gsap.fromTo(
        "[data-film-intro]",
        { y: 36, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 1, stagger: 0.09, ease: "power3.out", delay: 0.2, clearProps: "all" }
      );
    }, root);
    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, [mode, film]);

  // Stop drawing when the film is off screen.
  useEffect(() => {
    if (mode !== "film" || !root.current) return undefined;
    const io = new IntersectionObserver(([entry]) => setRunning(entry.isIntersecting));
    io.observe(root.current);
    return () => io.disconnect();
  }, [mode]);

  const pickVariant = (next) => {
    if (next === variant) return;
    // The scene reads these in the same frame the sweep starts; state only updates the buttons.
    film.previousVariant = film.variant;
    film.variant = next;
    setVariant(next);
    gsap.killTweensOf(film, "swap");
    gsap.fromTo(film, { swap: 0 }, { swap: 1, duration: 1.15, ease: "power2.inOut" });
  };

  // Drag to turn the appliance; vertical movement stays with the page.
  const drag = useRef(null);
  const stageEvents = {
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drag.current = { x: e.clientX, yaw: film.userYaw };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e) => {
      if (drag.current) film.userYaw = drag.current.yaw + (e.clientX - drag.current.x) * 0.007;
      if (e.pointerType === "mouse") {
        film.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
        film.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
      }
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
  };

  const lowPower = useMemo(() => matchMedia("(pointer: coarse), (max-width: 767px)").matches, []);
  const handleLoaded = useCallback(() => setLoaded(true), []);
  const handleLost = useCallback(() => setMode("photos"), []);

  if (mode === "photos") return <StaticFilm variant={variant} onPick={pickVariant} />;

  return (
    <div ref={root} data-film-root className="relative bg-navy" style={{ height: `${FILM_VH}vh` }}>
      {/* This wrapper is the sticky stage's containing block, so the stage stops exactly where the film ends. */}
      <div className="absolute inset-0">
      <div
        {...stageEvents}
        aria-hidden="true"
        className="sticky top-0 h-[100lvh] overflow-hidden cursor-grab active:cursor-grabbing bg-gradient-to-br from-navy to-navy-dark [touch-action:pan-y]"
      >
        <StageBoundary onError={handleLost}>
          <Suspense fallback={null}>
            <FilmStage
              film={film}
              lowPower={lowPower}
              running={running}
              onLoaded={handleLoaded}
              onLost={handleLost}
            />
          </Suspense>
        </StageBoundary>
        <div className={`absolute right-6 bottom-6 w-28 h-0.5 rounded-full bg-white/15 overflow-hidden transition-opacity duration-500 ${loaded ? "opacity-0" : "opacity-100"}`}>
          <div className="h-full w-1/3 bg-white/70 motion-safe:animate-pulse" />
        </div>
        {/* Phones stack copy over the picture, so the lower part needs a scrim. */}
        <div className="absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-[rgb(7_23_45/0.9)] via-[rgb(7_23_45/0.55)] to-transparent lg:hidden pointer-events-none" />
        <div className="hidden lg:block absolute inset-y-0 left-0 w-[58%] bg-gradient-to-r from-[rgb(7_23_45/0.62)] to-transparent pointer-events-none" />
      </div>
      </div>
      <FilmCopy variant={variant} onPick={pickVariant} />
    </div>
  );
}
