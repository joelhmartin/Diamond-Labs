import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { slugify } from "@my-app/shared";
import {
  clientEmail, placeholderEmail, isPlaceholderEmail, profileFromClient, existingFromRows, ownerIndex, accountOwnerIndex, planClients, PLACEHOLDER_EMAIL_DOMAIN,
} from "./map-clients.js";

const clients = JSON.parse(readFileSync(new URL("../../test-fixtures/seazona/clients.json", import.meta.url), "utf8"));
const now = new Date("2026-11-01T00:00:00Z");
const userRows = [
  { id: "u-old", email: "one@example.test", seazonaClientId: null, seazonaAccountNumber: null, createdAt: new Date("2026-01-01") },
  { id: "u-linked", email: "linked@example.test", seazonaClientId: "c-9999", seazonaAccountNumber: "9999", createdAt: new Date("2026-01-02") },
];

test("the first plausible email; placeholders use the reserved .invalid domain", () => {
  assert.equal(clientEmail("Two@Example.test; b@x.test"), "two@example.test");
  assert.equal(clientEmail("not an email"), null);
  assert.equal(clientEmail(null), null);
  assert.equal(placeholderEmail("C-3005"), `client-c-3005@${PLACEHOLDER_EMAIL_DOMAIN}`);
  assert.equal(isPlaceholderEmail(placeholderEmail("x")), true);
  assert.equal(isPlaceholderEmail("doc@practice.test"), false);
});

test("a profile only from a complete address, with a blank NPI for the lab to fill", () => {
  const p = profileFromClient(clients[0], "u1", now);
  assert.equal(p.userId, "u1");
  assert.equal(p.npiNumber, "");
  assert.equal(p.companyName, "Example Dental");
  assert.equal(p.zip, "78201");
  assert.equal(profileFromClient(clients[1], "u2", now), null, "no address");
});

test("owners: the oldest doctor sharing a Seazona client id or account number", () => {
  const rows = [
    { id: "b", seazonaClientId: "c1", seazonaAccountNumber: "1", createdAt: new Date("2026-02-01") },
    { id: "a", seazonaClientId: "c1", seazonaAccountNumber: "1", createdAt: new Date("2026-01-01") },
  ];
  assert.equal(ownerIndex(rows).get("c1"), "a");
  assert.equal(accountOwnerIndex(rows).get("1"), "a");
});

test("plan: link by email, create with a real or placeholder email, skip linked, report a taken email", () => {
  const existing = existingFromRows(userRows, [{ slug: slugify("Sample Ortho & Co") }], []);
  const plan = planClients(clients, existing, { now });
  assert.deepEqual(plan.link, [{ userId: "u-old", seazonaClientId: "c-1324", seazonaAccountNumber: "1324" }]);
  assert.deepEqual(plan.create.map((c) => [c.user.seazonaClientId, c.user.email, c.user.status]), [
    ["c-2001", "two@example.test", "active"],
    ["c-3005", placeholderEmail("c-3005"), "suspended"],
  ]);
  for (const c of plan.create) {
    assert.equal(c.user.role, "doctor");
    assert.equal(c.user.approvalStatus, "approved");
    assert.equal(c.user.passwordHash, null);
    assert.equal(c.account.ownerId, c.user.id);
    assert.equal(c.membership.role, "owner");
    assert.ok(c.account.slug.length <= 50);
  }
  assert.equal(plan.create[0].account.slug, `${slugify("Sample Ortho & Co")}-1`, "slug stays unique");
  assert.deepEqual(plan.skipped.emailTaken, ["c-4000"], "a second client on an email already used this run");
  assert.equal(plan.skipped.alreadyLinked, 1);
  assert.deepEqual(plan.profiles.map((p) => p.userId).sort(), ["u-old", plan.create[1].user.id].sort());
  assert.equal(plan.profiles.find((p) => p.userId === "u-old").companyName, "Example Dental");
});

test("--no-email skip leaves email-less clients out and says so", () => {
  const plan = planClients(clients, existingFromRows(userRows, [], []), { noEmail: "skip", now });
  assert.deepEqual(plan.skipped.noEmail, ["c-3005"]);
  assert.equal(plan.create.some((c) => c.user.seazonaClientId === "c-3005"), false);
});

test("an existing profile is never replaced", () => {
  const plan = planClients(clients, existingFromRows(userRows, [], [{ userId: "u-old" }]), { now });
  assert.equal(plan.profiles.some((p) => p.userId === "u-old"), false);
});
