import { test } from "vitest";
import assert from "node:assert/strict";
import { statementSubjects, practiceIdOf } from "./practices.js";

const accounts = [{ id: "a1", name: "North", accountNumber: "1" }, { id: "a2", name: "South", accountNumber: "2" }];

test("statement subjects: each practice (the one in view first) plus a combined statement only where the group allows it", () => {
  const organizations = [{ id: "g1", name: "Group A", combinedStatement: true }, { id: "g2", name: "Group B", combinedStatement: false }];
  assert.deepEqual(statementSubjects({ accounts, organizations, scope: "a2" }), [
    { value: "a2", label: "South (2)" }, { value: "a1", label: "North (1)" }, { value: "organization:g1", label: "Combined statement: Group A" },
  ]);
  assert.deepEqual(statementSubjects({ accounts, scope: "all" }).map((s) => s.value), ["a1", "a2"]);
});

test("a row's practice is its accountId or its practice party key", () => {
  assert.equal(practiceIdOf({ accountId: "a1" }), "a1");
  assert.equal(practiceIdOf({ partyKey: "practice:a9" }), "a9");
  assert.equal(practiceIdOf({ partyKey: "user:u1" }), null);
});
