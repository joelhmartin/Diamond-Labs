import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

/**
 * Codex (PR #36): public doctor registration linked the Seazona client whose
 * login email matched the address TYPED into the form — no proof the registrant
 * owns it — and the admin email called that a "verified email" match. Anyone
 * could register with a practice's email, their own password, and on approval
 * read that practice's invoices (PHI). Registration now links nothing; the link
 * is made only after the registrant clicks the verification link sent to that
 * address.
 */

// ── fakes ────────────────────────────────────────────────────────────────────
const state = { selects: [], inserts: [], updates: [], returning: [{ id: "u1" }] };

vi.mock("../config/database.js", () => {
  const selectChain = () => {
    const c = {
      from: () => c,
      where: () => c,
      limit: async () => state.selects.shift() ?? [],
    };
    return c;
  };
  return {
    queryClient: {},
    db: {
      select: () => selectChain(),
      insert: (table) => ({ values: async (v) => { state.inserts.push({ table, v }); } }),
      update: (table) => ({
        set: (v) => {
          const rec = { table, v };
          state.updates.push(rec);
          const where = () => {
            const p = Promise.resolve();
            return Object.assign(p, { returning: async () => state.returning });
          };
          return { where };
        },
      }),
    },
  };
});

const kv = new Map();
vi.mock("../config/redis.js", () => ({
  redis: {
    get: async (k) => kv.get(k)?.value ?? null,
    set: async (k, value, ...flags) => { kv.set(k, { value, flags }); return "OK"; },
    del: async (k) => kv.delete(k),
  },
}));

const seazona = { checkLoginExists: vi.fn(), findClientByPhone: vi.fn() };
vi.mock("./seazona.service.js", () => seazona);

const email = { sendAdminApprovalRequest: vi.fn(), sendWelcome: vi.fn() };
vi.mock("./email.service.js", () => email);

const { registerDoctor, verifyEmail, linkSeazonaClientByVerifiedEmail } = await import("./auth.service.js");
const { users } = await import("../db/schema/index.js");

const FORM = {
  email: "front-desk@practice.example",
  password: "Sup3r-secret-pass!",
  name: "Mallory",
  npiNumber: "1234567890",
  companyName: "Totally The Real Practice",
  address1: "1 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701",
  phone: "512-555-0100",
};
const SEAZONA_CLIENT = { clientId: "sz-client-42", accountNumber: 1324, company: "Rago Orthodontics" };

beforeEach(() => {
  state.selects = [];
  state.inserts = [];
  state.updates = [];
  state.returning = [{ id: "u1" }];
  kv.clear();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("registerDoctor — email match is a pending suggestion, not a link", () => {
  it("creates the user UNLINKED even when the email matches a Seazona client", async () => {
    seazona.checkLoginExists.mockResolvedValue(SEAZONA_CLIENT);
    await registerDoctor(FORM);

    const userRow = state.inserts.find((i) => i.table === users).v;
    expect(userRow.seazonaClientId).toBeNull();
    expect(userRow.seazonaAccountNumber).toBeNull();
    expect(userRow.approvalStatus).toBe("pending");
  });

  it("tells the admin about the match using Seazona's record, not the registrant's company name", async () => {
    seazona.checkLoginExists.mockResolvedValue(SEAZONA_CLIENT);
    await registerDoctor(FORM);

    const args = email.sendAdminApprovalRequest.mock.calls[0][0];
    expect(args.seazonaEmailMatch).toEqual({ clientId: "sz-client-42", accountNumber: "1324", company: "Rago Orthodontics" });
    expect(args).not.toHaveProperty("seazonaLink");
    // Approval stays one-click: the approve/reject links are still there.
    expect(args.approveUrl).toMatch(/\/auth\/approve\/.+\?action=approve$/);
    expect(args.rejectUrl).toMatch(/\/auth\/approve\/.+\?action=reject$/);
  });

  it("sends a 7-day email-verification link to the address that was typed", async () => {
    seazona.checkLoginExists.mockResolvedValue(SEAZONA_CLIENT);
    await registerDoctor(FORM);

    const welcome = email.sendWelcome.mock.calls[0][0];
    expect(welcome.email).toBe(FORM.email);
    const token = new URL(welcome.verifyUrl).searchParams.get("token");
    expect(new URL(welcome.verifyUrl).pathname).toBe("/auth/verify-email");
    const stored = kv.get(`email_verify:${token}`);
    expect(stored.value).toBe(state.inserts.find((i) => i.table === users).v.id);
    expect(stored.flags).toEqual(["EX", 7 * 24 * 60 * 60]);
  });

  it("a phone-only match is still just a suggestion", async () => {
    seazona.checkLoginExists.mockResolvedValue(null);
    seazona.findClientByPhone.mockResolvedValue({ id: "sz-7", accountNumber: "9", company: "Phone Match Co" });
    await registerDoctor(FORM);

    expect(state.inserts.find((i) => i.table === users).v.seazonaClientId).toBeNull();
    const args = email.sendAdminApprovalRequest.mock.calls[0][0];
    expect(args.seazonaEmailMatch).toBeNull();
    expect(args.suggestedSeazonaClient).toMatchObject({ clientId: "sz-7", matchedOn: "phone" });
  });
});

describe("linkSeazonaClientByVerifiedEmail — the link happens only after proof", () => {
  const doctor = (over = {}) => [{ email: FORM.email, role: "doctor", emailVerifiedAt: new Date(), seazonaClientId: null, ...over }];

  it("links a verified doctor to the client matching the verified address", async () => {
    state.selects.push(doctor());
    seazona.checkLoginExists.mockResolvedValue(SEAZONA_CLIENT);

    await expect(linkSeazonaClientByVerifiedEmail("u1")).resolves.toEqual({
      seazonaClientId: "sz-client-42",
      seazonaAccountNumber: "1324",
    });
    expect(seazona.checkLoginExists).toHaveBeenCalledWith(FORM.email);
    expect(state.updates[0].v).toMatchObject({ seazonaClientId: "sz-client-42", seazonaAccountNumber: "1324" });
  });

  it.each([
    ["email not verified", { emailVerifiedAt: null }],
    ["already linked (never overrides an admin's link)", { seazonaClientId: "other" }],
    ["not a doctor", { role: "user" }],
  ])("does nothing when %s", async (_label, over) => {
    state.selects.push(doctor(over));
    seazona.checkLoginExists.mockResolvedValue(SEAZONA_CLIENT);

    await expect(linkSeazonaClientByVerifiedEmail("u1")).resolves.toBeNull();
    expect(state.updates).toHaveLength(0);
  });

  it("reports no link when a concurrent writer linked first (conditional update hit 0 rows)", async () => {
    state.selects.push(doctor());
    state.returning = [];
    seazona.checkLoginExists.mockResolvedValue(SEAZONA_CLIENT);
    await expect(linkSeazonaClientByVerifiedEmail("u1")).resolves.toBeNull();
  });

  it("soft-fails on a Seazona error so email verification itself still succeeds", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.selects.push(doctor());
    seazona.checkLoginExists.mockRejectedValue(new Error("Seazona down"));
    await expect(linkSeazonaClientByVerifiedEmail("u1")).resolves.toBeNull();
  });

  it("verifyEmail marks the address verified, consumes the token, then links", async () => {
    kv.set("email_verify:tok-1", { value: "u1", flags: [] });
    state.selects.push(doctor());
    seazona.checkLoginExists.mockResolvedValue(SEAZONA_CLIENT);

    await verifyEmail("tok-1");

    expect(state.updates[0].v.emailVerifiedAt).toBeInstanceOf(Date);
    expect(kv.has("email_verify:tok-1")).toBe(false);
    expect(state.updates[1].v).toMatchObject({ seazonaClientId: "sz-client-42" });
  });
});
