import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/* The script of the appliance film: what the camera does, what the appliance looks
   like and what the page says at each point of the scroll.

   Each chapter's `vh` is its length on the one timeline that drives both the words and
   the picture, so they cannot drift apart. The page turns from chapter to chapter (see
   filmStops), so `vh` sets the scrollbar's scale, not how long a chapter stays on screen.
   To retime or reorder the film, edit this file only. Copy follows the rules in CLAUDE.md: facts come from
   data/products.js and the lab's Rx material, with no invented figures. */

/* What the appliance looks like. The film moves through these in order, and between two
   neighbours the scan plane wipes one into the other. */
export const LOOKS = [
  { device: "ddso-posterior", mode: "solid", tray: { upper: "nylon", lower: "nylon" } },
  { device: "ddso-posterior", mode: "points" },
  { device: "ddso-posterior", mode: "wire" },
  { device: "ddso-posterior", mode: "solid", tray: { upper: "nylon", lower: "nylon" } },
  { device: "ddso-anterior", mode: "solid", tray: { upper: "nylon", lower: "nylon" } },
  { device: "ond", mode: "solid", tray: { upper: "nylon", lower: "trutaine" } },
  { device: "onp", mode: "solid", tray: "variant", yawOffset: Math.PI },
];

/* Materials the visitor can switch between on the last chapter. */
export const VARIANTS = [
  { key: "trutaine", label: "Trutaine", image: "/images/onp-clear.webp" },
  { key: "nylon", label: "Nylon", image: "/images/onp-nylon.webp" },
  { key: "bioflex", label: "Bioflex", image: "/images/onp-bioflex-new.webp" },
];

/* Pose: yaw and pitch in radians, dist from camera to device, (x, y) where the camera
   looks, so a negative x puts the device on the right of the frame. */
export const CHAPTERS = [
  {
    id: "opening",
    vh: 100,
    look: 0,
    pose: { yaw: 0.72, pitch: 0.2, dist: 7, x: -1.25, y: 0.42, open: 0, labels: 0 },
    fallback: "/images/ddso-post-render.webp",
  },
  {
    id: "anatomy",
    vh: 100,
    look: 0,
    pose: { yaw: 1.05, pitch: 0.16, dist: 8.2, x: -1.3, y: 0.66, open: 1, labels: 1 },
    title: "Every part",
    accent: "has a job.",
    body: "The DDSO posterior design covers the full arch. An adjustable nylon band system gives you progressive mandibular advancement.",
    specs: ["FDA 510(k) cleared", "Nylon PA12", "SLS printed"],
    fallback: "/images/ddso-post-stacked.webp",
  },
  {
    id: "scan",
    vh: 100,
    look: 1,
    numeral: 1,
    pose: { yaw: 2.2, pitch: 0.62, dist: 5.8, x: -0.92, y: 0.3, open: 0, labels: 0 },
    title: "Scan",
    body: "Intraoral digital capture replaces traditional impressions. Send STL or native files from your scanner.",
    fallback: "/images/ddso-isometric.webp",
  },
  {
    id: "design",
    vh: 100,
    look: 2,
    numeral: 2,
    pose: { yaw: 3.55, pitch: 0.8, dist: 6, x: -1, y: 0.3, open: 0, labels: 0 },
    title: "Design",
    body: "CAD articulation to the parameters on your Rx. Every occlusal surface mapped.",
    fallback: "/images/ddso-post-interior.webp",
  },
  {
    id: "fabricate",
    vh: 100,
    look: 3,
    numeral: 3,
    pose: { yaw: 4.5, pitch: 0.24, dist: 7, x: -1.2, y: 0.36, open: 0, labels: 0 },
    title: "Fabricate",
    body: "Printed appliances are made in biocompatible nylon. Quality verified, then shipped with tracking and a care kit.",
    fallback: "/images/ddso-post-overview.webp",
  },
  {
    id: "anterior",
    vh: 100,
    look: 4,
    pose: { yaw: 6.75, pitch: 0.22, dist: 6.6, x: -1.15, y: 0.4, open: 0, labels: 0 },
    kicker: "Sleep appliance",
    title: "DDSO",
    accent: "Anterior.",
    body: "Anterior contact design for mandibular advancement without posterior occlusal loading.",
    specs: ["FDA 510(k) cleared", "Nylon PA12", "SLS printed"],
    link: { label: "See the DDSO", to: "/products" },
    fallback: "/images/ddso-ant-overview.webp",
  },
  {
    id: "ond",
    vh: 100,
    look: 5,
    pose: { yaw: 7.15, pitch: 0.28, dist: 6.4, x: -1.15, y: 0.4, open: 0, labels: 0, house: 0.42 },
    kicker: "TMD orthotic",
    title: "OND",
    accent: "Two materials.",
    body: "The Olmos Neuromuscular Device pairs a printed nylon part with a thermoformed Trutaine part.",
    specs: ["Nylon / Trutaine", "CAD/CAM + 3D print"],
    link: { label: "See the OND", to: "/products" },
    fallback: "/images/ond-overview.webp",
  },
  {
    id: "onp",
    vh: 100,
    look: 6,
    pose: { yaw: 9.05, pitch: 0.3, dist: 6.4, x: -1.15, y: 0.4, open: 0, labels: 0, house: 0.42 },
    kicker: "TMD orthotic",
    title: "ONP",
    accent: "Your material.",
    body: "The Olmos Neuromuscular Positioner comes in three materials. Pick one and watch it change.",
    variants: true,
    link: { label: "See the ONP", to: "/products" },
    fallback: "/images/onp-clear.webp",
  },
];

export const FILM_VH = CHAPTERS.reduce((sum, c) => sum + c.vh, 0);

/* Live values the 3D scene reads every frame. GSAP writes them; nothing re-renders. */
export function createFilmState() {
  return {
    ...CHAPTERS[0].pose,
    house: 1, // backdrop brightness: dimmed so clear parts read as clear
    look: 0,
    drift: 0,
    intro: 0, // 0..1: the device rising through the scan plane on load
    swap: 1, // 0..1: a material change sweeping through
    variant: VARIANTS[0].key,
    previousVariant: VARIANTS[0].key,
  };
}

/* Words swap in place, on either side of the moment a chapter lands (in vh on the timeline). */
const COPY_OUT = { at: -74, duration: 26 };
const COPY_IN = { at: -34, duration: 34 };

/* Builds the one scrubbed timeline. Its duration is the scroll distance in vh, so a
   position on it is simply "how many vh have been scrolled", and a chapter lands at its
   `start`. All copy shares one held layer, so later chapters start hidden. Every move
   into a chapter ends by its `start`, so a page resting there is never mid-animation. */
export function buildFilmTimeline(root, film) {
  const timeline = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: { trigger: root, start: "top top", end: "bottom bottom", scrub: 0.35 },
  });

  const end = FILM_VH - 100;
  timeline.to(film, { drift: 1.1, duration: end }, 0);

  let start = 0;
  CHAPTERS.forEach((chapter, i) => {
    const copy = root.querySelector(`[data-chapter="${chapter.id}"] [data-copy]`);
    const next = CHAPTERS[i + 1];

    if (i > 0) {
      // Camera move starts as the section comes up the screen and lands as it arrives.
      timeline.to(film, { house: 1, ...chapter.pose, duration: 85, ease: "power2.inOut" }, start - 85);
      if (chapter.look !== CHAPTERS[i - 1].look) {
        // The wipe sits after the trays have closed, so the plane cuts a whole device.
        timeline.to(film, { look: chapter.look, duration: 62 }, start - 62);
      }
      if (copy) {
        gsap.set(copy, { autoAlpha: 0, y: 28 });
        timeline.to(copy, { autoAlpha: 1, y: 0, duration: COPY_IN.duration, ease: "power2.out" }, start + COPY_IN.at);
      }
    }
    if (copy && next) {
      timeline.to(copy, { autoAlpha: 0, y: -20, duration: COPY_OUT.duration, ease: "power1.in" }, start + chapter.vh + COPY_OUT.at);
    }
    start += chapter.vh;
  });

  timeline.set({}, {}, end);
  return timeline;
}

/* Where each chapter lands, in scroll px. The page rests only on these. */
export function filmStops(timeline) {
  const { start, end } = timeline.scrollTrigger;
  const length = FILM_VH - 100;
  let landing = 0;
  return CHAPTERS.map((chapter) => {
    const stop = start + (landing / length) * (end - start);
    landing += chapter.vh;
    return stop;
  });
}
