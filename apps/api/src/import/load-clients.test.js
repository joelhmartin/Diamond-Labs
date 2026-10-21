import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeTx } from "../test/fake-tx.js";
import { loadClients } from "./load-clients.js";

const clients = JSON.parse(readFileSync(new URL("../../test-fixtures/seazona/clients.json", import.meta.url), "utf8"));
const raw = { records: async (entity) => (entity === "client" ? clients.map((c) => ({ seazonaId: c.id, payload: c })) : []) };
const userRows = [{ id: "u-old", role: "doctor", approvalStatus: "approved", emailVerifiedAt: new Date("2026-01-01"), email: "one@example.test", seazonaClientId: null, seazonaAccountNumber: null, createdAt: new Date("2026-01-01") }];
const db = (updates = [[{ id: "u-old" }]]) => fakeTx({ selects: [userRows, [], []], updates });

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
  const report = await loadClients({ raw, db: tx, live: true });
  const inserts = tx.log.filter((e) => e.op === "insert").map((e) => e.values);
  assert.equal(inserts.filter((v) => v.role === "doctor").length, 3);
  assert.equal(inserts.filter((v) => v.role === "owner").length, 3);
  assert.equal(inserts.filter((v) => "npiNumber" in v).length, 2);
  assert.equal(report.counts.profiles, 2);
  const set = tx.log.find((e) => e.op === "set").values;
  assert.equal(set.seazonaClientId, "c-1324");
});

test("a link whose guarded update touches 0 rows is reported, not counted", async () => {
  const tx = db([[]]);
  const report = await loadClients({ raw, db: tx, live: true });
  assert.equal(report.counts.link, 0);
  assert.equal(report.counts.profiles, 1, "live profiles count is what was written, not planned");
  assert.deepEqual(report.problems.find((p) => p.kind === "link_skipped_already_linked").seazonaIds, ["c-1324"]);
  assert.equal(tx.log.filter((e) => e.op === "insert" && "npiNumber" in (e.values ?? {})).length, 1, "no profile for the unlinked user");
});

test("a shopper with a client's email is reported as a new problem kind", async () => {
  const tx = fakeTx({ selects: [[{ ...userRows[0], role: "user", approvalStatus: "not_required" }], [], []] });
  const report = await loadClients({ raw, db: tx, live: false });
  assert.deepEqual(report.problems.find((p) => p.kind === "email_matches_unverified_or_non_doctor_user").seazonaIds, ["c-1324"]);
});

test("counts.profiles is the rows the database actually inserted", async () => {
  const tx = db();
  const real = tx.insert;
  tx.insert = (table) => {
    const chain = real(table);
    return { values: (v) => (v && "npiNumber" in v ? { onConflictDoNothing: () => ({ returning: async () => [] }) } : chain.values(v)) };
  };
  const report = await loadClients({ raw, db: tx, live: true });
  assert.equal(report.counts.profiles, 0, "every profile conflicted");
});
