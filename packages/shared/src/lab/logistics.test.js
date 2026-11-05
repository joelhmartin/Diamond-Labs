import { test } from "vitest";
import assert from "node:assert/strict";
import {
  PICKUP_STATUSES, PICKUP_STATUS_LABELS, PICKUP_MOVES, canMovePickup, isTerminalPickupStatus,
  TIME_PREFERENCES, TIME_PREFERENCE_LABELS,
} from "./logistics.js";
import * as shared from "../index.js";

// The whole table, written out. Every pair not listed here must be refused.
const ALLOWED = {
  requested: ["scheduled", "cancelled"],
  scheduled: ["scheduled", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

test("requested → scheduled|cancelled; scheduled → scheduled|completed|cancelled; terminal → none", () => {
  assert.deepEqual(PICKUP_STATUSES, ["requested", "scheduled", "completed", "cancelled"]);
  assert.deepEqual(PICKUP_MOVES, ALLOWED);
  for (const from of PICKUP_STATUSES) {
    for (const to of PICKUP_STATUSES) {
      assert.equal(canMovePickup(from, to), ALLOWED[from].includes(to), `${from} → ${to}`);
    }
  }
  assert.equal(canMovePickup("nope", "scheduled"), false);
  assert.equal(isTerminalPickupStatus("completed"), true);
  assert.equal(isTerminalPickupStatus("scheduled"), false);
});

test("every status and time preference has a label", () => {
  assert.deepEqual(TIME_PREFERENCES, ["am", "pm", "any"]);
  for (const s of PICKUP_STATUSES) assert.ok(PICKUP_STATUS_LABELS[s], s);
  for (const t of TIME_PREFERENCES) assert.ok(TIME_PREFERENCE_LABELS[t], t);
});

test("the vocabulary is exported from the package, and delivery methods are not (another piece owns them)", () => {
  assert.equal(shared.canMovePickup, canMovePickup);
  assert.equal(shared.DELIVERY_METHODS, undefined);
  assert.equal(typeof shared.pickupRequestSchema?.safeParse, "function");
});
