import { describe, it, expect, vi } from "vitest";
import { SCROLL_CONTAINER_ATTR, resetScrollPositions } from "../scroll.js";

/** Minimal stand-ins — these tests run in vitest's default node env, no jsdom. */
function fakeElement() {
  return { scrollTop: 1200, scrollLeft: 40 };
}

function fakeDoc(containers = []) {
  return {
    querySelectorAll: vi.fn(() => containers),
  };
}

function fakeWin() {
  return { scrollTo: vi.fn() };
}

describe("resetScrollPositions", () => {
  it("scrolls the window to the top", () => {
    const win = fakeWin();
    resetScrollPositions({ win, doc: fakeDoc() });

    expect(win.scrollTo).toHaveBeenCalledTimes(1);
    expect(win.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0, left: 0 }),
    );
  });

  it("scrolls instantly, never smoothly", () => {
    // Regression: `html { scroll-behavior: smooth }` turns a default scrollTo
    // into an async animation. GSAP's ScrollTrigger.refresh() — which
    // MarketingLayout fires on every pathname change — snapshots and restores
    // the mid-animation scroll offset, undoing the scroll to top.
    const win = fakeWin();
    resetScrollPositions({ win, doc: fakeDoc() });

    expect(win.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "instant" }),
    );
  });

  it("resets every element marked as a scroll container", () => {
    // Regression: AppShell scrolls an inner <main overflow-auto>, not the
    // window, and that node survives child route changes — so its scrollTop
    // persisted across navigation.
    const a = fakeElement();
    const b = fakeElement();
    const doc = fakeDoc([a, b]);

    resetScrollPositions({ win: fakeWin(), doc });

    expect(doc.querySelectorAll).toHaveBeenCalledWith(`[${SCROLL_CONTAINER_ATTR}]`);
    expect(a).toEqual({ scrollTop: 0, scrollLeft: 0 });
    expect(b).toEqual({ scrollTop: 0, scrollLeft: 0 });
  });

  it("does not throw when there are no scroll containers", () => {
    expect(() => resetScrollPositions({ win: fakeWin(), doc: fakeDoc([]) })).not.toThrow();
  });

  it("tolerates a missing window or document", () => {
    expect(() => resetScrollPositions({ win: undefined, doc: undefined })).not.toThrow();
  });
});
