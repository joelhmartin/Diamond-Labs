import { test, vi } from "vitest";
import assert from "node:assert/strict";

// The session's connect() options, with the pg client stubbed: no connection is ever made.
const created = [];
vi.mock("../config/pg-client.js", () => ({
  createPgClient: (url, opts) => { created.push({ url, opts }); return { end: async () => {}, options: { parsers: {}, serializers: {} } }; },
}));
vi.mock("./key-check.js", () => ({ assertImportKey: async () => "verified", assertTargetKey: async () => {} }));

const { openTargetSession } = await import("./cli-session.js");
const env = { IMPORT_DATABASE_URL: "postgres://u@127.0.0.1:1/diamond_labs_import", REHEARSAL_DATABASE_URL: "postgres://u@127.0.0.1:1/diamond_labs_rehearsal" };

test("a parity session opens the target read-only at the server; a load session does not", async () => {
  created.length = 0;
  const ro = await openTargetSession(env, { target: "rehearsal" }, { writes: false });
  const targetRo = created.find((c) => c.url.endsWith("diamond_labs_rehearsal"));
  assert.deepEqual(targetRo.opts.connection, { default_transaction_read_only: "on" });
  assert.equal(created.find((c) => c.url.endsWith("diamond_labs_import")).opts.connection, undefined);
  await ro.close();
  created.length = 0;
  const rw = await openTargetSession(env, { target: "rehearsal" }, { writes: true });
  assert.equal(created.find((c) => c.url.endsWith("diamond_labs_rehearsal")).opts.connection, undefined);
  await rw.close();
});
