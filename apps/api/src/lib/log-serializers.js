// Custom Fastify/pino log serializers.
//
// B3 fix: Fastify's default `req` serializer (fastify/lib/logger-pino.js)
// logs `req.url` verbatim — query string included. GET /admin/rx-cases?q=
// implements a patient-name search (see admin-rx-cases.routes.js's
// matchesQuery) that decrypts case rows and matches client-side; the portal
// otherwise keeps patient data encrypted at rest everywhere. Without this,
// `GET /admin/rx-cases?q=Jane+Doe` writes "Jane Doe" straight into Cloud
// Logging at `info` in production — outside that encrypted-at-rest boundary.
//
// Fix: log the path only, stripping the query string. Keep method/id/
// remoteAddress — every other log line's actual dependency — rather than
// disabling request logging wholesale, which would lose far more than it
// fixes. Do NOT restore the query string here; if a future need arises for
// it, it must be redacted/allow-listed field by field, not logged raw again.
//
// Extracted into its own module (rather than an inline function in
// index.js) so it's unit-testable without booting Fastify — index.js starts
// listening at import time and has no test-safe entry point.

/**
 * @param {{ method: string, url: string, id?: string|number, ip?: string }} req
 *   The Fastify request instance Fastify hands its serializers (not the raw
 *   Node IncomingMessage) — it has `.method`, `.url`, `.id`, `.ip`.
 */
export function reqSerializer(req) {
  const rawUrl = req?.url;
  const url = typeof rawUrl === "string" ? rawUrl.split("?")[0] : rawUrl;
  return {
    method: req?.method,
    url,
    id: req?.id,
    remoteAddress: req?.ip,
  };
}
