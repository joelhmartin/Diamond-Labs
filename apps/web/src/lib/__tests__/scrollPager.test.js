import { describe, expect, test } from "vitest";
import { createWheelReader, nearestStop, neighbourStop, turnSeconds } from "../scrollPager";

/* Feeds [time, delta] pairs through a reader and returns the turns it fired. As on the
   page, input is locked for a while after each turn. */
function turnsFrom(events, lockMs = 950) {
  const reader = createWheelReader();
  let lockedUntil = -Infinity;
  return events.flatMap(([time, delta]) => {
    const { turn } = reader.read(delta, time, time < lockedUntil);
    if (turn) lockedUntil = time + lockMs;
    return turn ? [turn] : [];
  });
}

/* A trackpad flick: deltas every 16ms that decay after the fingers lift. */
function flick(startTime, peak = 120, decay = 0.93) {
  const events = [];
  for (let i = 0, size = peak; size >= 1; i++, size *= decay) events.push([startTime + i * 16, Math.round(size) || 1]);
  return events;
}

describe("wheel gestures", () => {
  test("a trackpad flick and all its coasting is one turn", () => {
    expect(turnsFrom(flick(1000))).toEqual([1]);
  });

  test("a very hard flick is still one turn once the short lock ends", () => {
    expect(turnsFrom(flick(1000, 500, 0.96))).toEqual([1]);
  });

  test("a nudge too small to mean anything does not turn", () => {
    expect(turnsFrom([[1000, 3], [1016, 4], [1032, 2]])).toEqual([]);
  });

  test("one notch of a mouse wheel turns", () => {
    expect(turnsFrom([[1000, 100]])).toEqual([1]);
  });

  test("a second flick after a pause turns again", () => {
    const first = flick(1000);
    const after = first.at(-1)[0] + 400;
    expect(turnsFrom([...first, ...flick(after)])).toEqual([1, 1]);
  });

  test("reversing direction turns the other way", () => {
    expect(turnsFrom([[1000, 100], [3000, -100]])).toEqual([1, -1]);
  });

  test("a gesture started during a turn is dropped, not queued", () => {
    expect(turnsFrom([[1000, 100], [1500, 100], [2100, 2]])).toEqual([1]);
  });

  test("a mouse wheel spun without a pause keeps turning once each turn ends", () => {
    const spin = Array.from({ length: 90 }, (_, i) => [1000 + i * 50, 100]); // 4.5 seconds
    expect(turnsFrom(spin).length).toBeGreaterThanOrEqual(2);
  });
});

describe("page turn speed", () => {
  test("a faster gesture turns faster, within limits", () => {
    expect(turnSeconds(0)).toBeGreaterThan(turnSeconds(3));
    expect(turnSeconds(0)).toBeLessThanOrEqual(1.25);
    expect(turnSeconds(1000)).toBe(0.85);
  });
});

describe("stops", () => {
  const stops = [0, 100, 200];

  test("steps one stop from a stop or from between stops", () => {
    expect(neighbourStop(stops, 100, 1)).toBe(200);
    expect(neighbourStop(stops, 100, -1)).toBe(0);
    expect(neighbourStop(stops, 140, 1)).toBe(200);
    expect(neighbourStop(stops, 140, -1)).toBe(100);
  });

  test("has nothing past either end", () => {
    expect(neighbourStop(stops, 200, 1)).toBeUndefined();
    expect(neighbourStop(stops, 0, -1)).toBeUndefined();
  });

  test("nearest stop", () => {
    expect(nearestStop(stops, 140)).toBe(100);
    expect(nearestStop(stops, 160)).toBe(200);
  });
});
