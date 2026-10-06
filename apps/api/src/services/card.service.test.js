import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

// One users row's authorizeNetCustomerProfileId. The conditional UPDATE only
// writes while it is empty — the mock models exactly that predicate.
let storedProfileId = null;
let created = 0;

vi.mock("./authorizenet.service.js", () => ({
  createCustomerProfile: vi.fn(async () => `cp-new-${++created}`),
}));

vi.mock("../config/database.js", () => ({
  db: {
    update: () => ({
      set: (values) => ({
        where: () => ({
          returning: async () => {
            if (storedProfileId) return [];
            storedProfileId = values.authorizeNetCustomerProfileId;
            return [{ id: "u1" }];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ authorizeNetCustomerProfileId: storedProfileId }] }),
      }),
    }),
  },
}));

const { ensureCustomerProfile } = await import("./card.service.js");

beforeEach(() => {
  storedProfileId = null;
  created = 0;
});

describe("ensureCustomerProfile", () => {
  it("returns an existing profile without creating one", async () => {
    const user = { id: "u1", authorizeNetCustomerProfileId: "cp-existing" };
    await expect(ensureCustomerProfile(user)).resolves.toBe("cp-existing");
    expect(created).toBe(0);
  });

  it("creates and persists a profile when the user has none", async () => {
    const user = { id: "u1", email: "d@x.com", name: "Doc", authorizeNetCustomerProfileId: null };
    await expect(ensureCustomerProfile(user)).resolves.toBe("cp-new-1");
    expect(storedProfileId).toBe("cp-new-1");
    expect(user.authorizeNetCustomerProfileId).toBe("cp-new-1");
  });

  it("adopts the profile a concurrent request already persisted instead of overwriting it", async () => {
    // Both requests read the user row before either wrote: both see no profile.
    const a = { id: "u1", email: "d@x.com", name: "Doc", authorizeNetCustomerProfileId: null };
    const b = { ...a };
    const first = await ensureCustomerProfile(a);
    const second = await ensureCustomerProfile(b);
    expect(first).toBe("cp-new-1");
    expect(second).toBe("cp-new-1");
    expect(storedProfileId).toBe("cp-new-1");
  });
});
