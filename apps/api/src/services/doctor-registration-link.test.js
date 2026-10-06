import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableColumns, SQL } from "drizzle-orm";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

/**
 * Public doctor registration must never hand out a Seazona client's invoices
 * (patient names — PHI) on the registrant's say-so.
 *
 *  - Codex (PR #36): linking on the typed email, unverified, let anyone register
 *    with a practice's address and their own password.
 *  - CodeRabbit (PR #36, follow-up): verifying the email proves inbox access, not
 *    authority over the practice (shared front-desk inbox). So the link needs
 *    BOTH a verified email AND an admin approval confirming that exact client,
 *    in either order; reject / approve-without-linking links nothing.
 */

// ── In-memory drizzle fake ──────────────────────────────────────────────────
// Rows are stored with drizzle JS keys. WHERE clauses are rendered with the real
// PgDialect and evaluated for the shapes the auth service uses: AND of
// `col = $n`, `col is null`, `col is not null`. That makes the conditional
// UPDATEs (the heart of the both-orders guarantee) behave like Postgres would.
const dialect = new PgDialect();
const tables = new Map();

function colMap(table) {
  const byName = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) byName[col.name] = key;
  return byName;
}
function rowsOf(table) {
  if (!tables.has(table)) tables.set(table, []);
  return tables.get(table);
}
function matcher(table, where) {
  if (!where) return () => true;
  const { sql, params } = dialect.sqlToQuery(where);
  const names = colMap(table);
  const conds = [...sql.matchAll(/"(\w+)" (= \$(\d+)|is not null|is null)/g)].map((m) => ({
    key: names[m[1]],
    op: m[2].startsWith("=") ? "eq" : m[2],
    value: m[3] ? params[Number(m[3]) - 1] : undefined,
  }));
  return (row) =>
    conds.every((c) => {
      const v = row[c.key] ?? null;
      if (c.op === "eq") return v !== null && String(v) === String(c.value);
      if (c.op === "is null") return v === null;
      return v !== null;
    });
}
function projector(table, fields) {
  if (!fields) return (row) => ({ ...row });
  const names = colMap(table);
  return (row) => Object.fromEntries(Object.entries(fields).map(([alias, col]) => [alias, row[names[col.name]] ?? null]));
}
function resolveSetValue(table, row, value) {
  if (value instanceof SQL) {
    const { sql } = dialect.sqlToQuery(value);
    const col = sql.match(/"(\w+)"$/)?.[1];
    return row[colMap(table)[col]] ?? null;
  }
  return value;
}

const fakeDb = {
  select: (fields) => ({
    from: (table) => {
      let where;
      const run = () => rowsOf(table).filter(matcher(table, where)).map(projector(table, fields));
      const q = {
        where: (w) => { where = w; return q; },
        limit: async (n) => run().slice(0, n),
        then: (res, rej) => Promise.resolve(run()).then(res, rej),
      };
      return q;
    },
  }),
  insert: (table) => ({
    values: async (v) => { rowsOf(table).push({ ...v }); },
  }),
  update: (table) => ({
    set: (values) => ({
      where: (where) => {
        let applied;
        const apply = () => {
          if (!applied) {
            applied = rowsOf(table).filter(matcher(table, where));
            for (const row of applied) {
              const next = {};
              for (const [k, v] of Object.entries(values)) next[k] = resolveSetValue(table, row, v);
              Object.assign(row, next);
            }
          }
          return applied;
        };
        return {
          then: (res, rej) => Promise.resolve().then(apply).then(() => undefined).then(res, rej),
          returning: async (fields) => apply().map(projector(table, fields)),
        };
      },
    }),
  }),
};
vi.mock("../config/database.js", () => ({ db: fakeDb, queryClient: {} }));

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

const email = {
  sendAdminApprovalRequest: vi.fn(),
  sendWelcome: vi.fn(),
  sendDoctorApproved: vi.fn(),
  sendDoctorRejected: vi.fn(),
};
vi.mock("./email.service.js", () => email);

const auth = await import("./auth.service.js");
const { users, approvalTokens } = await import("../db/schema/index.js");

// ── helpers ─────────────────────────────────────────────────────────────────
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

const user = () => rowsOf(users)[0];
const approvalToken = () => rowsOf(approvalTokens)[0].token;
const verifyToken = () => [...kv.keys()].find((k) => k.startsWith("email_verify:")).slice("email_verify:".length);
const approve = (action = "approve") => auth.processApproval(approvalToken(), action);
const verify = () => auth.verifyEmail(verifyToken());

async function registerWithEmailMatch() {
  seazona.checkLoginExists.mockResolvedValue(SEAZONA_CLIENT);
  await auth.registerDoctor(FORM);
}

beforeEach(() => {
  tables.clear();
  kv.clear();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  seazona.checkLoginExists.mockResolvedValue(null);
  seazona.findClientByPhone.mockResolvedValue(null);
});

// ── tests ───────────────────────────────────────────────────────────────────
describe("registration stores the email match as a pending suggestion", () => {
  it("creates the user unlinked, with the match pending", async () => {
    await registerWithEmailMatch();
    expect(user()).toMatchObject({
      seazonaClientId: null,
      seazonaAccountNumber: null,
      pendingSeazonaClientId: "sz-client-42",
      pendingSeazonaAccountNumber: "1324",
      approvalStatus: "pending",
    });
    expect(user().pendingSeazonaLinkApprovedAt ?? null).toBeNull();
  });

  it("binds that exact client into the approval token, labelled from Seazona's record", async () => {
    await registerWithEmailMatch();
    expect(rowsOf(approvalTokens)[0]).toMatchObject({
      seazonaClientId: "sz-client-42",
      seazonaClientLabel: "Rago Orthodontics (acct 1324)",
    });
    const preview = await auth.getApprovalPreview(approvalToken());
    expect(preview.seazonaClient).toEqual({ clientId: "sz-client-42", label: "Rago Orthodontics (acct 1324)" });
  });

  it("gives the admin email the client, an approve-and-link and an approve-without-linking choice", async () => {
    await registerWithEmailMatch();
    const args = email.sendAdminApprovalRequest.mock.calls[0][0];
    expect(args.seazonaEmailMatch).toEqual({ clientId: "sz-client-42", accountNumber: "1324", company: "Rago Orthodontics" });
    expect(args.approveUrl).toMatch(/\?action=approve$/);
    expect(args.approveUnlinkedUrl).toMatch(/\?action=approve_unlinked$/);
    expect(args.rejectUrl).toMatch(/\?action=reject$/);
  });

  it("sends a 7-day verification link to the typed address", async () => {
    await registerWithEmailMatch();
    const welcome = email.sendWelcome.mock.calls[0][0];
    expect(welcome.email).toBe(FORM.email);
    expect(new URL(welcome.verifyUrl).pathname).toBe("/auth/verify-email");
    expect(kv.get(`email_verify:${verifyToken()}`).flags).toEqual(["EX", 7 * 24 * 60 * 60]);
  });

  it("a phone-only match is never stored or bound — suggestion in the email only", async () => {
    seazona.findClientByPhone.mockResolvedValue({ id: "sz-7", accountNumber: "9", company: "Phone Match Co" });
    await auth.registerDoctor(FORM);
    expect(user().pendingSeazonaClientId).toBeNull();
    expect(rowsOf(approvalTokens)[0].seazonaClientId).toBeNull();
    expect(email.sendAdminApprovalRequest.mock.calls[0][0].suggestedSeazonaClient).toMatchObject({ clientId: "sz-7" });
  });
});

describe("the link needs BOTH a verified email AND an admin-confirmed client", () => {
  it("verify, then approve → linked on approval", async () => {
    await registerWithEmailMatch();

    await verify();
    expect(user().emailVerifiedAt).toBeInstanceOf(Date);
    expect(user().seazonaClientId).toBeNull(); // inbox access alone is not enough

    const result = await approve();
    expect(result).toMatchObject({ approved: true, seazonaClientConfirmed: true, seazonaLinked: true });
    expect(user()).toMatchObject({
      seazonaClientId: "sz-client-42",
      seazonaAccountNumber: "1324",
      pendingSeazonaClientId: null,
      pendingSeazonaLinkApprovedAt: null,
    });
  });

  it("approve, then verify → linked on verification", async () => {
    await registerWithEmailMatch();

    const result = await approve();
    expect(result).toMatchObject({ approved: true, seazonaClientConfirmed: true, seazonaLinked: false });
    expect(user().seazonaClientId).toBeNull(); // admin confirmation alone is not enough
    expect(user().pendingSeazonaLinkApprovedAt).toBeInstanceOf(Date);

    await verify();
    expect(user()).toMatchObject({ seazonaClientId: "sz-client-42", pendingSeazonaClientId: null });
  });

  it("approve WITHOUT linking → doctor approved, suggestion discarded, verifying links nothing", async () => {
    await registerWithEmailMatch();
    const result = await approve("approve_unlinked");
    expect(result).toMatchObject({ approved: true, seazonaClientConfirmed: false });
    expect(user()).toMatchObject({ approvalStatus: "approved", pendingSeazonaClientId: null });

    await verify();
    expect(user().seazonaClientId).toBeNull();
  });

  it("reject → nothing linked, even after verification", async () => {
    await registerWithEmailMatch();
    await verify();
    const result = await approve("reject");
    expect(result).toMatchObject({ rejected: true });
    expect(user()).toMatchObject({ approvalStatus: "rejected", seazonaClientId: null, pendingSeazonaClientId: null });
  });

  it("approving confirms only the client bound into the token — a swapped pending client links nothing", async () => {
    await registerWithEmailMatch();
    user().pendingSeazonaClientId = "sz-someone-else"; // changed after the admin was shown sz-client-42
    await verify();
    const result = await approve();
    expect(result.seazonaClientConfirmed).toBe(false);
    expect(user().seazonaClientId).toBeNull();
    expect(user().pendingSeazonaClientId).toBeNull();
  });

  it("an approval token is single-use", async () => {
    await registerWithEmailMatch();
    const token = approvalToken();
    await auth.processApproval(token, "approve_unlinked");
    await expect(auth.processApproval(token, "approve")).rejects.toThrow();
    expect(user().pendingSeazonaLinkApprovedAt ?? null).toBeNull();
  });

  it("rejects an unknown action without consuming the token", async () => {
    await registerWithEmailMatch();
    await expect(approve("approve_and_link_everything")).rejects.toThrow();
    expect(rowsOf(approvalTokens)[0].usedAt ?? null).toBeNull();
  });
});

describe("unchanged paths", () => {
  it("no-match registration: one-click approve works and links nothing", async () => {
    await auth.registerDoctor(FORM);
    const preview = await auth.getApprovalPreview(approvalToken());
    expect(preview.seazonaClient).toBeNull();
    expect(email.sendAdminApprovalRequest.mock.calls[0][0].approveUnlinkedUrl).toBeNull();

    const result = await approve();
    expect(result).toMatchObject({ approved: true, seazonaClientConfirmed: false, seazonaLinked: false });
    expect(user()).toMatchObject({ approvalStatus: "approved", seazonaClientId: null });
  });

  it("an already-linked (imported) doctor keeps their link; completePendingSeazonaLink is a no-op", async () => {
    rowsOf(users).push({
      id: "imported-1",
      email: "doc@clinic.example",
      name: "Imported",
      role: "doctor",
      approvalStatus: "approved",
      emailVerifiedAt: null,
      seazonaClientId: "sz-imported",
      seazonaAccountNumber: "1009",
      pendingSeazonaClientId: null,
      pendingSeazonaAccountNumber: null,
      pendingSeazonaLinkApprovedAt: null,
    });
    await expect(auth.completePendingSeazonaLink("imported-1")).resolves.toBe(false);
    expect(rowsOf(users)[0].seazonaClientId).toBe("sz-imported");
  });

  it("never overrides an existing link even when both conditions hold", async () => {
    await registerWithEmailMatch();
    user().seazonaClientId = "sz-set-by-hand";
    await verify();
    await approve();
    expect(user().seazonaClientId).toBe("sz-set-by-hand");
  });
});
