import { describe, it, test, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";

// Replace the Seazona service entirely so pushCaseToSeazona's decision logic
// is tested in isolation — no env config, no network, and CRITICALLY no way
// for a test run to ever hit the real (production) Seazona API.
vi.mock("../seazona.service.js", () => ({
  createOrder: vi.fn(),
}));

import { createOrder } from "../seazona.service.js";
import { payloadFromLines, pushCaseToSeazona } from "./push-case.service.js";

const caseRow = { seazonaClientId: "c1", patientFirst: "A", patientLast: "B", dueDate: null };

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
  });

  it("a case with no sendable lines at all is refused before Seazona is ever called", async () => {
    const outcome = await pushCaseToSeazona(caseRow, [], { codeToId: {}, userId: "u1" });
    expect(outcome.status).toBe("failed");
    expect(createOrder).not.toHaveBeenCalled();
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
  });

  it("Seazona returning null (the wrapper's signal for both a network error and a non-2xx) lands the case in failed, never pushed", async () => {
    createOrder.mockResolvedValue(null);
    const lines = [{ seazonaCode: "9999", name: "Product", arch: "upper", status: "confirmed", noteOnly: false }];
    const outcome = await pushCaseToSeazona(caseRow, lines, { codeToId: { 9999: "id-9999" }, userId: "u1" });
    expect(outcome.status).toBe("failed");
    expect(outcome.seazonaOrderId).toBeNull();
    expect(outcome.seazonaPushError).toBeTruthy();
    expect(createOrder).toHaveBeenCalledOnce();
  });

  it("Seazona resolving but with no orderId on the response also lands the case in failed", async () => {
    createOrder.mockResolvedValue({ someOtherField: true });
    const lines = [{ seazonaCode: "9999", name: "Product", arch: "upper", status: "confirmed", noteOnly: false }];
    const outcome = await pushCaseToSeazona(caseRow, lines, { codeToId: { 9999: "id-9999" }, userId: "u1" });
    expect(outcome.status).toBe("failed");
    expect(outcome.seazonaOrderId).toBeNull();
  });

  it("a successful create records the order id (as a string) and marks the case pushed", async () => {
    createOrder.mockResolvedValue({ orderId: 555 });
    const lines = [{ seazonaCode: "2608", name: "DDSO Nylon", arch: "upper", status: "confirmed", noteOnly: false }];
    const outcome = await pushCaseToSeazona(caseRow, lines, { codeToId: { 2608: "id-2608" }, userId: "u1" });
    expect(outcome.status).toBe("pushed");
    expect(outcome.seazonaOrderId).toBe("555");
    expect(outcome.seazonaPushError).toBeNull();
    expect(outcome.payload.items).toEqual([{ id: "id-2608", arch: 1 }]);
    expect(createOrder).toHaveBeenCalledOnce();
    expect(createOrder).toHaveBeenCalledWith(outcome.payload);
  });
});
