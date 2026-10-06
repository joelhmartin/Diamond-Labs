import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

// AutoPay ships switched off. These are the structural halves of that promise —
// the behavioural halves (the AUTOPAY_LIVE_RUN gate, dry-run sweeps) are in
// config/env.autopay.test.js and jobs/definitions/autopay.job.test.js.

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) {
      out.push(full);
    }
  }
  return out;
}

describe("AutoPay is switched off on merge", () => {
  it("creates enrollments in exactly one place: the explicit upsert behind the two authenticated PUT routes", () => {
    const writers = sourceFiles(SRC)
      .filter((f) => /insert\(\s*autopayEnrollments\s*\)/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(writers).toEqual(["services/autopay.service.js"]);
  });

  it("no migration inserts or enables an enrollment", () => {
    const migrationsDir = join(SRC, "db/migrations");
    const offending = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => {
        const sql = readFileSync(join(migrationsDir, f), "utf8");
        return /insert\s+into\s+"?autopay_enrollments"?/i.test(sql) || /update\s+"?autopay_enrollments"?/i.test(sql);
      });
    expect(offending).toEqual([]);
  });

  it("an enrollment row defaults to disabled at the database level", async () => {
    const { autopayEnrollments } = await import("../db/schema/index.js");
    expect(autopayEnrollments.enabled.default).toBe(false);
    expect(autopayEnrollments.enabled.notNull).toBe(true);
  });

  it("the job CLI is a dry run unless --live is passed", async () => {
    const { parseCliArgs } = await import("./cli-args.js");
    expect(parseCliArgs(["autopay"])).toEqual({ list: false, name: "autopay", dryRun: true });
    expect(parseCliArgs(["autopay", "--live"])).toEqual({ list: false, name: "autopay", dryRun: false });
    expect(parseCliArgs([])).toEqual({ list: true });
  });
});
