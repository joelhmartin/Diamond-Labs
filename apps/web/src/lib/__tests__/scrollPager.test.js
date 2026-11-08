import { describe, expect, test } from "vitest";
import { createWheelReader, nearestStop, neighbourStop, turnSmoothTime } from "../scrollPager";

/* Feeds [time, delta] pairs through a reader and returns the turns it fired. */
function turnsFrom(events) {
  const reader = createWheelReader();
  return events.flatMap(([time, delta]) => {
    const { turn } = reader.read(delta, time);
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

  test("fingers speeding up at the start of a flick are one turn", () => {
    const rampThenCoast = [4, 20, 60, 120, 180, 220, 200, 170, 140, 110, 80, 60, 40, 25, 15, 8, 3];
    expect(turnsFrom(rampThenCoast.map((size, i) => [1000 + i * 16, size]))).toEqual([1]);
  });

  test("a second flick during the first one's coasting turns once it is past the committed window", () => {
    const first = flick(1000).slice(0, 40); // 640ms, and faded
    expect(turnsFrom([...first, ...flick(first.at(-1)[0] + 16)])).toEqual([1, 1]);
  });

  test("a flick inside the committed window is dropped, along with its coasting", () => {
    const first = flick(1000).slice(0, 20); // 320ms
    expect(turnsFrom([...first, ...flick(first.at(-1)[0] + 16)])).toEqual([1]);
  });

  test("a very hard coast never turns twice, even with noisy deltas", () => {
    const noisy = flick(1000, 500, 0.97).map(([time, size], i) => [time, size + (i % 2 ? 2 : -1)]);
    expect(turnsFrom(noisy)).toEqual([1]);
  });

  test("a mouse wheel spun without a pause turns once per committed window", () => {
    const spin = Array.from({ length: 40 }, (_, i) => [1000 + i * 50, 100]); // 2 seconds
    expect(turnsFrom(spin)).toHaveLength(5);
  });
});

describe("page turn speed", () => {
  test("a faster gesture turns faster, within limits", () => {
    expect(turnSmoothTime(0)).toBeGreaterThan(turnSmoothTime(3));
    expect(turnSmoothTime(0)).toBe(0.3);
    expect(turnSmoothTime(1000)).toBe(0.2);
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
