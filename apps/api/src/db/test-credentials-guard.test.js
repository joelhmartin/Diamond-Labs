import { describe, it, expect } from "vitest";
import { assertTestCredentialsAllowed, assertNotCloudSql } from "./test-credentials-guard.js";

/**
 * CodeRabbit (PR #36): set-test-credentials blocked only NODE_ENV=production, so
 * an unset NODE_ENV with DATABASE_URL pointed at prod would still write a known
 * password onto a real, Seazona-linked doctor. It now needs an explicit opt-in,
 * a dev/test NODE_ENV, a loopback non-prod URL, and a non-Cloud-SQL server.
 */
const LOCAL = "postgresql://bif@localhost:5432/diamond_labs";
const ok = (over = {}) => ({ NODE_ENV: "development", ALLOW_TEST_CREDENTIALS: "1", DATABASE_URL: LOCAL, ...over });

describe("assertTestCredentialsAllowed", () => {
  it("allows a deliberate local run", () => {
    expect(() => assertTestCredentialsAllowed(ok())).not.toThrow();
    expect(() => assertTestCredentialsAllowed(ok({ NODE_ENV: "test", DATABASE_URL: "postgres://u:p@127.0.0.1:5432/x" }))).not.toThrow();
  });

  it.each([
    ["unset NODE_ENV", { NODE_ENV: undefined }, /NODE_ENV/],
    ["production NODE_ENV", { NODE_ENV: "production" }, /NODE_ENV/],
    ["unexpected NODE_ENV", { NODE_ENV: "staging" }, /NODE_ENV/],
    ["missing opt-in", { ALLOW_TEST_CREDENTIALS: undefined }, /ALLOW_TEST_CREDENTIALS=1/],
    ["opt-in not exactly 1", { ALLOW_TEST_CREDENTIALS: "true" }, /ALLOW_TEST_CREDENTIALS=1/],
    ["Cloud SQL unix socket", { DATABASE_URL: "postgresql://u:p@/anchor?host=/cloudsql/diamond-labs-prod:us-central1:diamond-labs-db" }, /production/],
    ["prod public IP", { DATABASE_URL: "postgresql://u:p@34.45.85.116:5432/diamond_labs" }, /production/],
    ["non-loopback host", { DATABASE_URL: "postgresql://u:p@db.internal:5432/x" }, /not loopback/],
    ["missing DATABASE_URL", { DATABASE_URL: undefined }, /missing or unparseable/],
  ])("refuses: %s", (_label, over, msg) => {
    expect(() => assertTestCredentialsAllowed(ok(over))).toThrow(msg);
  });
});

describe("assertNotCloudSql", () => {
  const fakeSql = (rows) => async () => rows;

  it("refuses when the connected server has the cloudsqlsuperuser role (e.g. a proxy tunnel into prod)", async () => {
    await expect(assertNotCloudSql(fakeSql([{ "?column?": 1 }]))).rejects.toThrow(/Cloud SQL/);
  });

  it("passes on a plain local Postgres", async () => {
    await expect(assertNotCloudSql(fakeSql([]))).resolves.toBeUndefined();
  });
});
