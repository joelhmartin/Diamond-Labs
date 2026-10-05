import { test } from "vitest";
import assert from "node:assert/strict";
import { canPush } from "./case-gates.js";

test("canPush refuses a case whose only sendable lines are model/lab services", () => {
  const lines = [
    { mapKey: "service:model-fab", seazonaCode: "2367", status: "confirmed", noteOnly: false },
    { mapKey: "service:model-fab", seazonaCode: "2367", status: "confirmed", noteOnly: false },
  ];
  const r = canPush(lines);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no appliance line/);
  assert.equal(canPush([...lines, { mapKey: "primary:ddso:nylon", seazonaCode: "2608", status: "confirmed", noteOnly: false }]).ok, true);
});
