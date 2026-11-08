import { glideTo, isGliding } from "./scroll";

/* Turns a run of scroll positions into pages: one scroll gesture moves exactly one stop,
   so the visitor always comes to rest on a finished view. Wheel, trackpad, touch and
   keyboard all turn pages. Anything else that moves the page (scrollbar, Home/End, a
   resize, restored scroll) settles on the nearest stop. Scrolling past the last stop
   releases the page, so the content below scrolls normally.

   Every turn is committed for a moment, which is what stops one gesture turning two pages.
   After that a new gesture can move on before the turn has landed, so getting through the
   stops doesn't take as long as all their animations added together. A gesture moves one
   stop at most, a faster one turns the page faster, and the page only rests on a stop. */

const STOP_TOLERANCE_PX = 2;
const SETTLE_DELAY_MS = 200;
const SETTLE_SMOOTH_TIME = 0.2;
const SLOWEST_TURN_SMOOTH_TIME = 0.3;
const FASTEST_TURN_SMOOTH_TIME = 0.2;
const SMOOTH_TIME_PER_VELOCITY = 0.025; // taken off a turn per px/ms of gesture speed
const COMMITTED_MS = 450; // input is ignored this long after a turn starts
const SWIPE_DISTANCE_PX = 16;

const WHEEL_DISTANCE_PX = 12; // scrolled before a gesture counts, so a nudge does nothing
const WHEEL_QUIET_MS = 180; // a gap this long ends a gesture
const WHEEL_SPIN_DELTA_PX = 60; // a mouse wheel notch is at least this big
const WHEEL_SPIN_EVENT_GAP_MS = 30; // a trackpad sends events every 16ms or so; a wheel's notches are further apart
const VELOCITY_WINDOW_MS = 100;

const KEY_DIRECTIONS = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 };

/* Tells one wheel gesture from the next. A trackpad keeps sending wheel events long after
   the fingers lift, and those must not turn a second page. A new gesture is a quiet gap, a
   change of direction, a sharp jump after the deltas had clearly faded, or the next notch
   of a mouse wheel being spun without a pause. Nothing can turn during the committed
   window, and a gesture that starts in it is dropped, not queued. */
export function createWheelReader() {
  let lastTime = -Infinity;
  let lastTurn = -Infinity;
  let direction = 0;
  let distance = 0;
  let spent = false;
  let peak = 0;
  let last = 0;
  let samples = [];

  return {
    get spent() {
      return spent;
    },
    read(delta, now) {
      const size = Math.abs(delta);
      const sign = Math.sign(delta);
      const gap = now - lastTime;
      const isJump = last < peak * 0.5 && size > last * 2 + 10;
      const isNextNotch = size >= WHEEL_SPIN_DELTA_PX && gap >= WHEEL_SPIN_EVENT_GAP_MS;

      if (gap > WHEEL_QUIET_MS || sign !== direction || isJump || isNextNotch) {
        distance = 0;
        spent = false;
        peak = 0;
        samples = [];
      }
      lastTime = now;
      direction = sign;
      peak = Math.max(peak, size);
      last = size;
      samples = [...samples.filter((s) => now - s.time <= VELOCITY_WINDOW_MS), { time: now, size }];

      if (now - lastTurn < COMMITTED_MS) {
        spent = true;
        return { turn: 0, velocity: 0 };
      }
      if (spent) return { turn: 0, velocity: 0 };
      distance += size;
      if (distance < WHEEL_DISTANCE_PX) return { turn: 0, velocity: 0 };
      spent = true;
      lastTurn = now;
      const velocity = samples.reduce((sum, s) => sum + s.size, 0) / VELOCITY_WINDOW_MS;
      return { turn: sign, velocity };
    },
  };
}

export function turnSmoothTime(velocity = 0) {
  return Math.max(FASTEST_TURN_SMOOTH_TIME, SLOWEST_TURN_SMOOTH_TIME - velocity * SMOOTH_TIME_PER_VELOCITY);
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

/* getStops returns ascending scroll positions in px. It is read on every use, so the
   stops follow layout changes. */
export function createScrollPager({ getStops }) {
  const wheel = createWheelReader();
  let target = null; // the stop a turn is heading to, or null at rest
  let glide = null;
  let lastTurnAt = -Infinity;
  let settleTimer = null;
  let touch = null;

  const moving = () => target !== null;
  const here = () => (moving() ? target : window.scrollY);

  function moveTo(stop, smoothTime) {
    clearTimeout(settleTimer);
    glide = glideTo(stop, {
      smoothTime,
      onComplete: () => {
        target = null;
      },
      onInterrupt: () => {
        target = null;
      },
    });
    target = stop; // After glideTo, which interrupts any turn already running.
  }

  function turn(direction, velocity) {
    const now = performance.now();
    if (now - lastTurnAt < COMMITTED_MS) return;
    const stop = neighbourStop(getStops(), here(), direction);
    if (stop === undefined) return;
    lastTurnAt = now;
    moveTo(stop, turnSmoothTime(velocity));
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
    const { turn: direction, velocity } = wheel.read(delta, event.timeStamp);
    if (moving()) {
      event.preventDefault();
      if (direction) turn(direction, velocity);
      return;
    }
    const { place, last } = route(Math.sign(delta));
    if (place === "below") {
      // Scrolling back up from the content below: stop at the last page rather than run past it.
      if (delta < 0 && window.scrollY + delta < last) {
        event.preventDefault();
        moveTo(last, SETTLE_SMOOTH_TIME);
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
    const dy = touch.y - event.touches[0].clientY;
    const dx = touch.x - event.touches[0].clientX;
    if (!touch.turned && Math.abs(dx) > Math.abs(dy)) return; // Sideways turns the appliance.
    if (!moving()) {
      const { place } = route(Math.sign(dy) || 1);
      if (place === "below" || place === "top") return;
      if (place === "leaving") {
        if (touch.turned) block();
        return;
      }
    }
    block();
    if (!touch.turned && Math.abs(dy) >= SWIPE_DISTANCE_PX) {
      touch.turned = true;
      turn(Math.sign(dy), Math.abs(dy) / Math.max(event.timeStamp - touch.time, 1));
    }
  }

  function settle() {
    if (isGliding() || touch) return;
    const stops = getStops();
    const y = window.scrollY;
    if (y > stops.at(-1) + STOP_TOLERANCE_PX) return;
    const stop = nearestStop(stops, y);
    if (Math.abs(stop - y) > STOP_TOLERANCE_PX) moveTo(stop, SETTLE_SMOOTH_TIME);
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
    if (!moving() && route(direction).place !== "inside") return;
    event.preventDefault();
    turn(direction, 0);
  }

  function onScroll() {
    if (!isGliding()) settleSoon();
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
      glide?.interrupt();
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
