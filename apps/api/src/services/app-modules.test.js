import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { configureAppModules, appModuleRoutes } = await import("./app-modules.js");
const { currentNotifier, configureNotifications, listEvents } = await import("../modules/notifications/index.js");
const { authenticate } = await import("../middleware/authenticate.js");
const { requireAdmin } = await import("../middleware/require-role.js");

test("configureAppModules installs the notifier with the lab events; twice is harmless", () => {
  configureNotifications(null);
  const env = { APP_URL: "https://portal.test", LAB_NAME: "Test Lab" };
  configureAppModules({ env, db: {}, log: { info() {}, warn() {}, error() {} } });
  configureAppModules({ env, db: {}, log: { info() {}, warn() {}, error() {} } });
  assert.ok(currentNotifier());
  assert.ok(listEvents().some((e) => e.key === "lab.order_shipped"));
});

test("appModuleRoutes registers the notification routes with the app's guards", async () => {
  const registered = [];
  const inner = [];
  const add = (method) => (path, opts) => inner.push({ method, path, opts });
  const fastify = {
    register: async (plugin, opts) => {
      registered.push(opts);
      await plugin({ get: add("GET"), post: add("POST"), put: add("PUT"), patch: add("PATCH"), delete: add("DELETE") }, opts);
    },
  };
  await appModuleRoutes(fastify);
  assert.ok(inner.length >= 14);
  assert.ok(inner.every((r) => r.opts.preHandler[0] === authenticate));
  assert.ok(inner.filter((r) => r.path.startsWith("/admin/")).every((r) => r.opts.preHandler.includes(requireAdmin)));
  assert.equal(registered[0].kindOf({ role: "lab" }), "staff");
  assert.equal(registered[0].kindOf({ role: "doctor" }), "client");
});

test("both entrypoints configure the modules before anything can emit", () => {
  const index = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const configured = index.indexOf("configureAppModules({ env, db, log: fastify.log });");
  assert.ok(configured > 0 && configured < index.indexOf("await fastify.register(healthRoutes"));
  assert.match(index, /await fastify\.register\(appModuleRoutes, \{ prefix: "\/api\/v1" \}\);/);
  const cli = readFileSync(new URL("../jobs/cli.js", import.meta.url), "utf8");
  assert.ok(cli.indexOf("configureAppModules({ env, db });") < cli.indexOf("registerAllJobs();"));
});
