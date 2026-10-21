import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeTx } from "../test/fake-tx.js";
import { loadClients } from "./load-clients.js";

const clients = JSON.parse(readFileSync(new URL("../../test-fixtures/seazona/clients.json", import.meta.url), "utf8"));
const raw = { records: async (entity) => (entity === "client" ? clients.map((c) => ({ seazonaId: c.id, payload: c })) : []) };
const userRows = [{ id: "u-old", email: "one@example.test", seazonaClientId: null, seazonaAccountNumber: null, createdAt: new Date("2026-01-01") }];
const db = () => fakeTx({ selects: [userRows, [], []] });

test("a dry run reports counts and writes nothing", async () => {
  const tx = db();
  const report = await loadClients({ raw, db: tx, live: false });
  assert.equal(report.step, "clients");
  assert.equal(report.counts.seazonaClients, 5);
  assert.equal(report.counts.create, 3);
  assert.equal(report.counts.placeholders, 1);
  assert.equal(report.counts.link, 1);
  assert.equal(tx.log.some((e) => e.op === "insert" || e.op === "update"), false);
  assert.ok(!JSON.stringify(report).includes("example.test"), "the report carries no email or name");
});

test("a live run writes users, accounts, memberships, links and profiles in one transaction", async () => {
  const tx = db();
  await loadClients({ raw, db: tx, live: true });
  const inserts = tx.log.filter((e) => e.op === "insert").map((e) => e.values);
  assert.equal(inserts.filter((v) => v.role === "doctor").length, 3);
  assert.equal(inserts.filter((v) => v.role === "owner").length, 3);
  assert.equal(inserts.filter((v) => "npiNumber" in v).length, 2);
  const set = tx.log.find((e) => e.op === "set").values;
  assert.equal(set.seazonaClientId, "c-1324");
});
