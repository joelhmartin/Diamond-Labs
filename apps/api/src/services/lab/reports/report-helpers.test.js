import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { renderSql } from "../../../test/sql-text.js";
import {
  ADMIN, UNCATEGORIZED, clientsOnlyJoin, int, money, optionalClientJoin, share, sumOf, sums, uncategorizedSql,
} from "./report-helpers.js";

const dir = fileURLToPath(new URL(".", import.meta.url));
const sources = readdirSync(dir)
  .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js") && f !== "report-helpers.js")
  .map((f) => [f, readFileSync(`${dir}${f}`, "utf8")]);

test("totals, shares and column specs", () => {
  const rows = [{ a: 2, b: 1 }, { a: 3 }, { a: null, b: 4 }];
  assert.equal(sumOf(rows, "a"), 5);
  assert.deepEqual(sums(rows, ["a", "b"]), { a: 5, b: 5 });
  assert.equal(share(1, 4), 0.25);
  assert.equal(share(1, 0), 0);
  assert.deepEqual(int("n", "N"), { id: "n", label: "N", type: "int" });
  assert.deepEqual(money("m", "M", { sortable: false }), { id: "m", label: "M", type: "money", sortable: false });
  assert.deepEqual([...ADMIN], ["admin"]);
});

test("the two client joins: optional keeps every row, clients-only drops non-clients", () => {
  const optional = renderSql(sql`${optionalClientJoin(sql.raw("x.client_user_id"))}`).text;
  assert.equal(optional, "left join users on users.id = x.client_user_id left join doctor_profiles on doctor_profiles.user_id = users.id");
  const only = renderSql(sql`${clientsOnlyJoin(sql.raw("x.client_user_id"))}`).text;
  assert.equal(only, "join users on users.id = x.client_user_id and users.role = 'doctor' left join doctor_profiles on doctor_profiles.user_id = users.id");
});

test("one spelling for products without a category, as a SQL literal", () => {
  assert.equal(UNCATEGORIZED, "Uncategorized");
  assert.equal(renderSql(sql`${uncategorizedSql}`).text, "'Uncategorized'");
  for (const [f, src] of sources) assert.doesNotMatch(src, /Uncategori[sz]ed/, `${f} spells it itself`);
});

test("no report file keeps its own copy of a shared helper", () => {
  const copies = /^const (sumOf|sums|sum|share|int|money|ADMIN|clientJoin) = /m;
  for (const [f, src] of sources) assert.doesNotMatch(src, copies, `${f} redefines a report-helpers.js helper`);
});
