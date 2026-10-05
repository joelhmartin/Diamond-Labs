import { describe, it, test, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Replace the Seazona service entirely so pushCaseToSeazona's decision logic
// is tested in isolation — no env config, no network, and CRITICALLY no way
// for a test run to ever hit the real (production) Seazona API.
vi.mock("../seazona.service.js", () => ({
  createOrder: vi.fn(),
}));

import { createOrder } from "../seazona.service.js";
import { payloadFromLines, pushCaseToSeazona, shouldReleasePushLock } from "./push-case.service.js";
import * as caseGates from "./case-gates.js";
import * as routesModule from "../../routes/admin-rx-cases.routes.js";

const caseRow = { seazonaClientId: "c1", patientFirst: "A", patientLast: "B", dueDate: null };

// ─── Task 10 fix 1 — the circular import (service importing from routes/) ──
//
// push-case.service.js used to import canPush from admin-rx-cases.routes.js
// while that route module imported pushCaseToSeazona from this service — a
// real cycle that survived only on ESM function hoisting, and forced any
// service test to transitively load Fastify, drizzle, and config/database.js
// just to test a pure function. The fix moved the pure domain rules into
// case-gates.js (which imports nothing from routes/) and made the route
// re-export them so every existing importer keeps working unchanged.

test("push-case.service.js imports canPush from case-gates.js, never from routes/ — no circular import", () => {
  const path = fileURLToPath(new URL("./push-case.service.js", import.meta.url));
  const source = readFileSync(path, "utf8");
  assert.doesNotMatch(
    source,
    /from\s+["'][^"']*\/routes\//,
    "push-case.service.js must not import anything from a routes/ module"
  );
  assert.match(
    source,
    /canPush.*from\s+["']\.\/case-gates\.js["']/,
    "push-case.service.js should import canPush from ./case-gates.js"
  );
});

test("case-gates.js exports everything admin-rx-cases.routes.js re-exports, as the exact same bindings", () => {
  const expectedExports = [
    "CASE_STATUSES",
    "DEFAULT_QUEUE_STATUSES",
    "canPush",
    "canTransition",
    "isFrozen",
    "normalizeSeazonaCode",
    "overrideRowFor",
    "statusForLine",
    "summariseLines",
  ];
  for (const name of expectedExports) {
    assert.ok(name in caseGates, `case-gates.js is missing export "${name}"`);
    assert.ok(name in routesModule, `admin-rx-cases.routes.js no longer re-exports "${name}"`);
    assert.equal(
      routesModule[name],
      caseGates[name],
      `admin-rx-cases.routes.js's "${name}" is not the same binding as case-gates.js's — the re-export is not a plain pass-through`
    );
  }
});

// ─── payloadFromLines ──────────────────────────────────────────────────────

test("the payload is built from the stored lines, not re-resolved", () => {
  const { payload, ok } = payloadFromLines(
    caseRow,
    [{ seazonaCode: "9999", name: "Staff-chosen product", arch: "upper", status: "confirmed", noteOnly: false }],
    { codeToId: { 9999: "id-9999" }, userId: "u1" }
  );
  assert.equal(ok, true);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, "id-9999");
});

test("a noteOnly line travels in the notes, not as an item", () => {
  const { payload } = payloadFromLines(
    caseRow,
    [
      { seazonaCode: "2608", name: "DDSO Nylon", status: "confirmed", noteOnly: false },
      { seazonaCode: null, sourceLabel: "Wrap distal of last molars", status: "open", noteOnly: true },
    ],
    { codeToId: { 2608: "id-2608" }, userId: "u1" }
  );
  assert.equal(payload.items.length, 1);
  assert.match(payload.notes, /Wrap distal of last molars/);
});

test("a line whose code has no catalog id fails loudly rather than vanishing", () => {
  const { ok, warnings } = payloadFromLines(
    caseRow,
    [{ seazonaCode: "2608", name: "DDSO Nylon", status: "confirmed", noteOnly: false }],
    { codeToId: {}, userId: "u1" }
  );
  assert.equal(ok, false);
  assert.ok(warnings.some((w) => /2608/.test(w)));
});

test("arch strings normalize to Seazona 1/2/null, mirroring build-order-payload.js", () => {
  const { payload } = payloadFromLines(
    caseRow,
    [
      { seazonaCode: "1", name: "Upper", arch: "Upper", status: "confirmed", noteOnly: false },
      { seazonaCode: "2", name: "Lower", arch: "Lower", status: "confirmed", noteOnly: false },
      { seazonaCode: "3", name: "Both", arch: "Both", status: "confirmed", noteOnly: false },
    ],
    { codeToId: { 1: "id-1", 2: "id-2", 3: "id-3" }, userId: "u1" }
  );
  assert.deepEqual(payload.items.map((i) => i.arch), [1, 2, null]);
});

test("general comments and noteOnly labels are joined in the notes", () => {
  const { payload } = payloadFromLines(
    { ...caseRow, generalComments: "cover 1st molar to 1st molar" },
    [{ seazonaCode: null, sourceLabel: "Trim distal", status: "open", noteOnly: true }],
    { codeToId: {}, userId: "u1" }
  );
  assert.match(payload.notes, /cover 1st molar to 1st molar/);
  assert.match(payload.notes, /Trim distal/);
});

// Regression for a review finding: a noteOnly line with no sourceLabel AND no
// name used to `continue` silently — no line, no note, no warning. It
// disappears from the order with nothing telling a human it ever existed.
// mapKey is the last fallback (mirroring the codeless-line branch just below
// it in payloadFromLines, which already falls back to mapKey) — an unmapped
// line seeded with `name: null, sourceLabel: mapKey` still has a name-shaped
// identifier worth recording even when sourceLabel/name are genuinely empty.
test("a noteOnly line with no sourceLabel or name falls back to mapKey and still reaches the notes", () => {
  const { payload, ok } = payloadFromLines(
    caseRow,
    [
      { seazonaCode: "2608", name: "DDSO Nylon", arch: "upper", status: "confirmed", noteOnly: false },
      { seazonaCode: null, name: null, sourceLabel: null, mapKey: "mod:x", status: "open", noteOnly: true },
    ],
    { codeToId: { 2608: "id-2608" }, userId: "u1" }
  );
  assert.match(payload.notes, /mod:x/);
  assert.equal(ok, true);
});

// The true edge case: a noteOnly line with NOTHING to name it (no
// sourceLabel, no name, no mapKey either). This must not vanish silently —
// it has to surface as a warning a human sees, which also means the push is
// refused (ok === false) rather than sent short an instruction the lab ruled
// on.
test("a noteOnly line with no name, sourceLabel, or mapKey at all produces a warning instead of vanishing", () => {
  const { payload, ok, warnings } = payloadFromLines(
    caseRow,
    [{ seazonaCode: null, name: null, sourceLabel: null, mapKey: null, status: "open", noteOnly: true }],
    { codeToId: {}, userId: "u1" }
  );
  assert.equal(ok, false);
  assert.ok(warnings.length > 0, "expected a warning for the unnameable noteOnly line");
  assert.doesNotMatch(payload.notes, /null/);
});

// ─── pushCaseToSeazona — the actual send decision ─────────────────────────

describe("pushCaseToSeazona — one push attempt, decision logic only (Seazona mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a case that fails canPush is refused before Seazona is ever called", async () => {
    const lines = [{ seazonaCode: null, name: "x", status: "open", noteOnly: false }];
    const outcome = await pushCaseToSeazona(caseRow, lines, { codeToId: {}, userId: "u1" });
    expect(outcome.status).toBe("failed");
    expect(outcome.seazonaOrderId).toBeNull();
    expect(outcome.seazonaPushError).toBeTruthy();
    expect(createOrder).not.toHaveBeenCalled();
    expect(outcome.contactedSeazona).toBe(false);
  });

  it("a case with no sendable lines at all is refused before Seazona is ever called", async () => {
    const outcome = await pushCaseToSeazona(caseRow, [], { codeToId: {}, userId: "u1" });
    expect(outcome.status).toBe("failed");
    expect(createOrder).not.toHaveBeenCalled();
    expect(outcome.contactedSeazona).toBe(false);
  });

  it("a line whose code has no catalog id fails the push before Seazona is called", async () => {
    // canPush only checks status/seazonaCode presence, not codeToId — so this
    // passes the gate but must still fail loudly at the payload-build step,
    // never silently drop the line and send a partial order.
    const lines = [{ seazonaCode: "2608", name: "DDSO Nylon", status: "confirmed", noteOnly: false }];
    const outcome = await pushCaseToSeazona(caseRow, lines, { codeToId: {}, userId: "u1" });
    expect(outcome.status).toBe("failed");
    expect(outcome.seazonaOrderId).toBeNull();
    expect(outcome.seazonaPushError).toMatch(/2608/);
    expect(createOrder).not.toHaveBeenCalled();
    expect(outcome.contactedSeazona).toBe(false);
  });

  it("Seazona returning null (the wrapper's signal for both a network error and a non-2xx) lands the case in failed, never pushed, and is marked contacted", async () => {
    createOrder.mockResolvedValue(null);
    const lines = [{ seazonaCode: "9999", name: "Product", arch: "upper", status: "confirmed", noteOnly: false }];
    const outcome = await pushCaseToSeazona(caseRow, lines, { codeToId: { 9999: "id-9999" }, userId: "u1" });
    expect(outcome.status).toBe("failed");
    expect(outcome.seazonaOrderId).toBeNull();
    expect(outcome.seazonaPushError).toBeTruthy();
    expect(createOrder).toHaveBeenCalledOnce();
    // This is the whole point of the flag: a null result is ambiguous (could
    // be a network error OR an order that actually landed) — the caller must
    // be told Seazona was contacted so it knows a retry might duplicate.
    expect(outcome.contactedSeazona).toBe(true);
  });

  it("Seazona resolving but with no orderId on the response also lands the case in failed, and is marked contacted", async () => {
    createOrder.mockResolvedValue({ someOtherField: true });
    const lines = [{ seazonaCode: "9999", name: "Product", arch: "upper", status: "confirmed", noteOnly: false }];
    const outcome = await pushCaseToSeazona(caseRow, lines, { codeToId: { 9999: "id-9999" }, userId: "u1" });
    expect(outcome.status).toBe("failed");
    expect(outcome.seazonaOrderId).toBeNull();
    expect(outcome.contactedSeazona).toBe(true);
  });

  it("a successful create records the order id (as a string), marks the case pushed, and is marked contacted", async () => {
    createOrder.mockResolvedValue({ orderId: 555 });
    const lines = [{ seazonaCode: "2608", name: "DDSO Nylon", arch: "upper", status: "confirmed", noteOnly: false }];
    const outcome = await pushCaseToSeazona(caseRow, lines, { codeToId: { 2608: "id-2608" }, userId: "u1" });
    expect(outcome.status).toBe("pushed");
    expect(outcome.seazonaOrderId).toBe("555");
    expect(outcome.seazonaPushError).toBeNull();
    expect(outcome.payload.items).toEqual([{ id: "id-2608", arch: 1 }]);
    expect(createOrder).toHaveBeenCalledOnce();
    expect(createOrder).toHaveBeenCalledWith(outcome.payload);
    expect(outcome.contactedSeazona).toBe(true);
  });
});

// ─── shouldReleasePushLock — B1: the lock must not release on an ambiguous
// failure ─────────────────────────────────────────────────────────────────
//
// Regression for a review finding: the push route used to release the
// claim/lock (seazonaPushStatus back out of "pushing") on EVERY failed
// outcome, including one where Seazona was actually contacted and the
// result was lost — exactly the case where a retry risks creating a real
// duplicate order (Seazona has no idempotency key). This is the pure
// decision the route now defers to instead of writing the release logic
// itself.

test("a successful push releases the lock", () => {
  assert.equal(shouldReleasePushLock({ status: "pushed", contactedSeazona: true }), true);
});

test("a failure where Seazona was never contacted releases the lock — a retry cannot duplicate anything", () => {
  assert.equal(shouldReleasePushLock({ status: "failed", contactedSeazona: false }), true);
});

test("a failure where Seazona WAS contacted keeps the lock held — the response was ambiguous, a retry could duplicate a real order", () => {
  assert.equal(shouldReleasePushLock({ status: "failed", contactedSeazona: true }), false);
});

// ── design intent travels in the notes of the REAL push ─────────────────────
// Occlusal contact / design preference stopped being $0 line items (the lab
// never bills them), so the stored-lines push is now their only channel.

test("the pushed order's notes carry each device's design intent", () => {
  const { payload } = payloadFromLines(
    {
      ...caseRow,
      deviceOptions: {
        devices: [
          { deviceKey: "ddso", label: "DDSO", deviceOptions: { occlusalContact: "TRIPOD Occlusion", designPreference: "Lingual-Free" } },
          {
            deviceKey: "guard",
            label: "Nightguard",
            deviceOptions: { standardGuards: { "Occlusal Guard - Slider Type__Increase for clearance": "2mm" } },
          },
        ],
      },
    },
    [{ seazonaCode: "2608", status: "confirmed" }],
    { codeToId: { 2608: "id-2608" } }
  );
  assert.match(payload.notes, /\[DDSO\] Occlusal Contact: TRIPOD Occlusion, Design Preference: Lingual-Free/);
  assert.match(payload.notes, /\[Nightguard\] Occlusal Guard - Slider Type: Increase for clearance: 2mm/);
});

test("a case with no devices adds nothing to the notes", () => {
  const { payload } = payloadFromLines(caseRow, [{ seazonaCode: "2608", status: "confirmed" }], { codeToId: { 2608: "id" } });
  assert.equal(payload.notes, "");
});

test("note-only instructions survive a long free-text comment", () => {
  const caseRow = { seazonaClientId: "c1", patientFirst: "A", patientLast: "B", generalComments: "x".repeat(2500), deviceOptions: { devices: [] } };
  const lines = [
    { mapKey: "primary:ddso:nylon", seazonaCode: "2608", status: "confirmed", noteOnly: false },
    { mapKey: "mod:wrap-distal", noteOnly: true, sourceLabel: "Wrap distal of last molars" },
  ];
  const { payload } = payloadFromLines(caseRow, lines, { codeToId: { 2608: "id-2608" } });
  assert.ok(payload.notes.startsWith("Wrap distal of last molars"));
  assert.equal(payload.notes.length, 2000);
});
