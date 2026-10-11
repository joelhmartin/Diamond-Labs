import assert from "node:assert/strict";

/**
 * Route-wiring tests have no Fastify harness, so they inspect source: the
 * slice from a registration marker (e.g. `fastify.get("/lab/orders",`) up to
 * the next top-level `fastify.` registration. Shared by every such test.
 */
export function handlerSource(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `route registration not found in source: ${marker}`);
  const next = source.indexOf("\n  fastify.", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}
