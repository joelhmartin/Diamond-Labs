import { test, expect, vi } from "vitest";
import { adminUsersQuerySchema } from "@my-app/shared";
import { fakeTx } from "../test/fake-tx.js";

vi.mock("../modules/record-tags/index.js", () => ({ tagsFor: vi.fn(async () => new Map()) }));

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
  const db = fakeTx({ selects: [[user("a")], [], [], [{ n: 41 }]] });
  const out = await listAdminUsers({ q: "a", limit: 10, offset: 30 }, db);
  expect(out.users).toHaveLength(1);
  expect(out.total).toBe(41);
  expect(out.summary).toBeUndefined();
  const calls = db.log.filter((e) => e.op === "select")[0].calls;
  expect(calls).toEqual(expect.arrayContaining(["where", "orderBy", "limit", "offset"]));
});

test("runsPractice: a direct owner/admin of an active practice or an active group admin; a plain member or doctor-less login is not", async () => {
  const db = fakeTx({ selects: [
    [user("own"), user("mem"), user("grp"), user("none")],
    [
      { userId: "own", accountId: "a1", role: "owner", accountName: "P", accountSlug: "p", practice: true },
      { userId: "mem", accountId: "a1", role: "member", accountName: "P", accountSlug: "p", practice: true },
    ],
    [{ userId: "grp" }],
  ] });
  const out = await listAdminUsers({}, db);
  expect(Object.fromEntries(out.users.map((u) => [u.id, u.runsPractice]))).toEqual({ own: true, mem: false, grp: true, none: false });
});
