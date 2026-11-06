import gsap from "gsap";

/* Turns a run of scroll positions into pages: one scroll gesture moves exactly one stop,
   so the visitor always comes to rest on a finished view. Wheel, trackpad, touch and
   keyboard all turn pages. Anything else that moves the page (scrollbar, Home/End, a
   resize, restored scroll) settles on the nearest stop. Scrolling past the last stop
   releases the page, so the content below scrolls normally.

   A faster gesture turns the page faster. It never skips a stop. */

const STOP_TOLERANCE_PX = 2;
const SETTLE_DELAY_MS = 200;
const SETTLE_SECONDS = 0.6;
const SLOWEST_TURN_SECONDS = 1.25;
const FASTEST_TURN_SECONDS = 0.85;
const SECONDS_PER_VELOCITY = 0.1; // seconds taken off a turn per px/ms of gesture speed
const SWIPE_DISTANCE_PX = 16;

const WHEEL_DISTANCE_PX = 12; // scrolled before a gesture counts, so a nudge does nothing
const WHEEL_QUIET_MS = 180; // a gap this long ends a gesture
const WHEEL_STRONG_DELTA_PX = 60; // a trackpad's coasting has faded below this by the time a turn ends
const VELOCITY_WINDOW_MS = 100;

const KEY_DIRECTIONS = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 };

/* Tells one wheel gesture from the next. A trackpad keeps sending wheel events long after
   the fingers lift, and those must not turn a second page. A new gesture is a quiet gap, a
   change of direction, a jump above the fading deltas, or (for a mouse wheel spun without
   a pause, which never goes quiet) a strong delta once the turn has finished. */
export function createWheelReader() {
  let lastTime = -Infinity;
  let direction = 0;
  let distance = 0;
  let spent = false;
  let recent = [];
  let samples = [];

  return {
    get spent() {
      return spent;
    },
    read(delta, now, locked) {
      const size = Math.abs(delta);
      const sign = Math.sign(delta);
      const fading = recent.length ? recent.reduce((sum, d) => sum + d, 0) / recent.length : 0;
      const isNew =
        now - lastTime > WHEEL_QUIET_MS ||
        sign !== direction ||
        size > fading * 1.6 + 4 ||
        (!locked && spent && size >= WHEEL_STRONG_DELTA_PX);

      if (isNew) {
        distance = 0;
        spent = false;
        samples = [];
      }
      lastTime = now;
      direction = sign;
      recent = [...recent.slice(-2), size];
      samples = [...samples.filter((s) => now - s.time <= VELOCITY_WINDOW_MS), { time: now, size }];

      if (locked) {
        spent = true; // A gesture that starts during a turn is ignored, not queued.
        return { turn: 0, velocity: 0 };
      }
      if (spent) return { turn: 0, velocity: 0 };
      distance += size;
      if (distance < WHEEL_DISTANCE_PX) return { turn: 0, velocity: 0 };
      spent = true;
      const velocity = samples.reduce((sum, s) => sum + s.size, 0) / VELOCITY_WINDOW_MS;
      return { turn: sign, velocity };
    },
  };
}

export function turnSeconds(velocity = 0) {
  return Math.max(FASTEST_TURN_SECONDS, SLOWEST_TURN_SECONDS - velocity * SECONDS_PER_VELOCITY);
}

/* The stop one step from y in a direction, or undefined past either end. */
export function neighbourStop(stops, y, direction) {
  return direction > 0
    ? stops.find((stop) => stop > y + STOP_TOLERANCE_PX)
    : stops.findLast((stop) => stop < y - STOP_TOLERANCE_PX);
}

export function nearestStop(stops, y) {
  return stops.reduce((best, stop) => (Math.abs(stop - y) < Math.abs(best - y) ? stop : best));
}

function wheelPixels(event) {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * window.innerHeight;
  return event.deltaY;
}

function isTypingOrActivating(event) {
  const target = event.target;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) return true;
  return event.key === " " && /^(BUTTON|A|SUMMARY)$/.test(target?.tagName ?? "");
}

/* A short pause after landing, so the next gesture can't begin before the page has stopped. */
const LAND_PAUSE_SECONDS = 0.1;

/* getStops returns ascending scroll positions in px. It is read on every use, so the
   stops follow layout changes. */
export function createScrollPager({ getStops }) {
  const wheel = createWheelReader();
  let locked = false;
  let tween = null;
  let unlock = null;
  let settleTimer = null;
  let touch = null;

  const scrollTo = (top) => window.scrollTo({ top, behavior: "instant" }); // The site sets smooth scrolling.

  function moveTo(target, seconds) {
    locked = true;
    clearTimeout(settleTimer);
    const position = { y: window.scrollY };
    tween = gsap.to(position, {
      y: target,
      duration: seconds,
      ease: "power2.inOut",
      onUpdate: () => scrollTo(position.y),
      onComplete: () => {
        unlock = gsap.delayedCall(LAND_PAUSE_SECONDS, () => {
          locked = false;
        });
      },
    });
  }

  function turn(direction, velocity) {
    const target = neighbourStop(getStops(), window.scrollY, direction);
    if (target !== undefined) moveTo(target, turnSeconds(velocity));
  }

  /* Where the page is relative to the stops, for an input heading in `direction`. */
  function route(direction) {
    const stops = getStops();
    const y = window.scrollY;
    const last = stops.at(-1);
    if (y > last + STOP_TOLERANCE_PX) return { place: "below", last };
    if (direction > 0 && y >= last - STOP_TOLERANCE_PX) return { place: "leaving" };
    if (direction < 0 && y <= stops[0] + STOP_TOLERANCE_PX) return { place: "top" };
    return { place: "inside" };
  }

  function onWheel(event) {
    if (event.ctrlKey) return; // pinch zoom
    const delta = wheelPixels(event);
    if (!delta) return;
    const { turn: direction, velocity } = wheel.read(delta, event.timeStamp, locked);
    if (locked) {
      event.preventDefault();
      return;
    }
    const { place, last } = route(Math.sign(delta));
    if (place === "below") {
      // Scrolling back up from the content below: stop at the last page rather than run past it.
      if (delta < 0 && window.scrollY + delta < last) {
        event.preventDefault();
        moveTo(last, SETTLE_SECONDS);
      }
      return;
    }
    if (place === "top") return;
    if (place === "leaving") {
      // The fading end of the gesture that arrived here must not carry on past the page.
      if (!direction && wheel.spent) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (direction) turn(direction, velocity);
  }

  function onTouchStart(event) {
    touch = event.touches.length === 1
      ? { x: event.touches[0].clientX, y: event.touches[0].clientY, time: event.timeStamp, turned: false }
      : null;
  }

  function onTouchMove(event) {
    if (!touch || event.touches.length !== 1) return;
    const block = () => event.cancelable && event.preventDefault();
    if (locked) {
      block();
      return;
    }
    const dy = touch.y - event.touches[0].clientY;
    const dx = touch.x - event.touches[0].clientX;
    if (!touch.turned && Math.abs(dx) > Math.abs(dy)) return; // Sideways turns the appliance.
    const { place } = route(Math.sign(dy) || 1);
    if (place === "below" || place === "top") return;
    if (place === "leaving") {
      if (touch.turned) block();
      return;
    }
    block();
    if (!touch.turned && Math.abs(dy) >= SWIPE_DISTANCE_PX) {
      touch.turned = true;
      turn(Math.sign(dy), Math.abs(dy) / Math.max(event.timeStamp - touch.time, 1));
    }
  }

  function settle() {
    if (locked || touch) return;
    const stops = getStops();
    const y = window.scrollY;
    if (y > stops.at(-1) + STOP_TOLERANCE_PX) return;
    const target = nearestStop(stops, y);
    if (Math.abs(target - y) > STOP_TOLERANCE_PX) moveTo(target, SETTLE_SECONDS);
  }

  function settleSoon() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, SETTLE_DELAY_MS);
  }

  function onTouchEnd(event) {
    if (event.touches.length === 0) touch = null;
    settleSoon();
  }

  function onKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || isTypingOrActivating(event)) return;
    const direction = event.key === " " ? (event.shiftKey ? -1 : 1) : KEY_DIRECTIONS[event.key];
    if (!direction) return;
    if (locked) {
      event.preventDefault();
      return;
    }
    if (route(direction).place !== "inside") return;
    event.preventDefault();
    turn(direction, 0);
  }

  function onScroll() {
    if (!locked) settleSoon();
  }

  const active = { passive: false };
  window.addEventListener("wheel", onWheel, active);
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, active);
  window.addEventListener("touchend", onTouchEnd, { passive: true });
  window.addEventListener("touchcancel", onTouchEnd, { passive: true });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", settleSoon, { passive: true });
  settleSoon();

  return {
    destroy() {
      clearTimeout(settleTimer);
      tween?.kill();
      unlock?.kill();
      window.removeEventListener("wheel", onWheel, active);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove, active);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", settleSoon);
    },
  };
}
