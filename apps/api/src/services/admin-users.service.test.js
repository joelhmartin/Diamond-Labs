import { test, expect, vi } from "vitest";
import { adminUsersQuerySchema } from "@my-app/shared";
import { fakeTx } from "../test/fake-tx.js";

vi.mock("../modules/record-tags/index.js", () => ({ tagsFor: vi.fn(async () => new Map()) }));
const administering = vi.fn(async () => new Set());
vi.mock("./client-scope.js", () => ({ usersAdministeringAPractice: (...a) => administering(...a) }));

const { listAdminUsers } = await import("./admin-users.service.js");

const user = (id, role = "user", extra = {}) => ({ id, email: `${id}@x.test`, name: id, role, hasPassword: true, lastLoginAt: new Date(), seazonaClientId: null, ...extra });

test("adminUsersQuerySchema: comma lists become arrays, limit coerces, unknown roles are refused", () => {
  const ok = adminUsersQuerySchema.parse({ q: " ann ", ids: "a, b,,c", excludeIds: "d", limit: "10", offset: "20", role: "lab" });
  expect(ok).toEqual({ q: "ann", ids: ["a", "b", "c"], excludeIds: ["d"], limit: 10, offset: 20, role: "lab" });
  expect(adminUsersQuerySchema.parse({})).toEqual({});
  expect(adminUsersQuerySchema.safeParse({ role: "root" }).success).toBe(false);
  expect(adminUsersQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
});

test("no limit: the whole list plus the screen's summary, as before", async () => {
  const db = fakeTx({ selects: [[user("a", "admin"), user("b", "doctor", { seazonaClientId: "s1" })], [{ userId: "b", accountId: "ac1", role: "owner", accountName: "P", accountSlug: "p" }]] });
  const out = await listAdminUsers({}, db);
  expect(out.users.map((u) => u.id)).toEqual(["a", "b"]);
  expect(out.users[1].account).toEqual({ accountId: "ac1", name: "P", slug: "p", role: "owner" });
  expect(out.users[1].repTags).toEqual([]);
  expect(out.summary).toMatchObject({ total: 2, admins: 1, doctors: 1, seazonaLinked: 1 });
  expect(out.total).toBeUndefined();
});

test("with a limit: one page and the filtered total, no summary, and the page is limited/offset in SQL", async () => {
  const db = fakeTx({ selects: [[user("a")], [], [{ n: 41 }]] });
  const out = await listAdminUsers({ q: "a", limit: 10, offset: 30 }, db);
  expect(out.users).toHaveLength(1);
  expect(out.total).toBe(41);
  expect(out.summary).toBeUndefined();
  const calls = db.log.filter((e) => e.op === "select")[0].calls;
  expect(calls).toEqual(expect.arrayContaining(["where", "orderBy", "limit", "offset"]));
});

test("runsPractice comes from the shared rule (usersAdministeringAPractice), asked only about role=user logins", async () => {
  administering.mockResolvedValueOnce(new Set(["own"]));
  const db = fakeTx({ selects: [[user("own"), user("doc", "doctor"), user("none")], []] });
  const out = await listAdminUsers({}, db);
  expect(administering.mock.calls.at(-1)[0]).toEqual(["own", "none"]);
  expect(Object.fromEntries(out.users.map((u) => [u.id, u.runsPractice]))).toEqual({ own: true, doc: false, none: false });
});
