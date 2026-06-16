import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { env } from "./config/env.js";
import project from "../../../project.config.js";
import { errorHandler } from "./middleware/error-handler.js";
import authRoutes from "./routes/auth.routes.js";
import healthRoutes from "./routes/health.routes.js";
import userRoutes from "./routes/user.routes.js";
import accountRoutes from "./routes/account.routes.js";
import memberRoutes from "./routes/member.routes.js";
import invitationRoutes from "./routes/invitation.routes.js";
import invoiceRoutes from "./routes/invoice.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import rxRoutes from "./routes/rx.routes.js";

const fastify = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
  },
  trustProxy: true,
});

// Treat an empty JSON body as {} instead of erroring. Several POSTs carry no
// body and rely on cookies/headers instead (e.g. /auth/refresh, /auth/logout);
// without this, axios's default `Content-Type: application/json` + empty body
// makes Fastify 400 ("Body cannot be empty") and silently breaks silent-refresh.
fastify.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  if (!body || body.trim() === "") return done(null, {});
  try {
    done(null, JSON.parse(body));
  } catch (err) {
    err.statusCode = 400;
    done(err);
  }
});

// Catch-all: a POST with no/odd content-type (e.g. an empty body and no header)
// would otherwise 415. Treat empty as {}; attempt JSON for anything non-empty.
fastify.addContentTypeParser("*", { parseAs: "string" }, (req, body, done) => {
  if (!body || body.trim() === "") return done(null, {});
  try {
    done(null, JSON.parse(body));
  } catch {
    done(null, {});
  }
});

// Plugins
await fastify.register(multipart, {
  // 20 MB per file; individual routes may further constrain via per-request opts.
  // The parts/files caps here are global backstops; the rx-cases route enforces
  // tighter limits via its own per-request options object.
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB
    files: 20,
    parts: 50,
  },
});
await fastify.register(cookie);
await fastify.register(cors, {
  origin: env.NODE_ENV === "production"
    ? project.api.cors.origins
    // Vite auto-bumps the dev port when taken, so allow any localhost origin in dev.
    // Also allow dev tunnels (cloudflared/ngrok) used to test Authorize.net
    // Accept Hosted, which requires an https FQDN rather than localhost.
    : (origin, cb) => {
        if (!origin) return cb(null, true);
        try {
          const host = new URL(origin).hostname;
          const allowed =
            host === "localhost" ||
            host === "127.0.0.1" ||
            host.endsWith(".trycloudflare.com") ||
            host.endsWith(".ngrok-free.app") ||
            host.endsWith(".ngrok.io");
          if (allowed) return cb(null, true);
        } catch {}
        cb(new Error("CORS: origin not allowed"), false);
      },
  credentials: true,
});
await fastify.register(helmet, { contentSecurityPolicy: false });

// Rate limit: production caps per the project config; dev gets a much higher
// ceiling so refreshes + HMR + dashboard fan-out don't lock out the single
// developer on their machine.
await fastify.register(rateLimit, {
  max: env.NODE_ENV === "production" ? project.api.rateLimit.maxRequests : 10000,
  timeWindow: env.NODE_ENV === "production" ? project.api.rateLimit.window : "1 minute",
  // Skip rate limiting entirely for requests from localhost in dev
  allowList: env.NODE_ENV === "production" ? [] : ["127.0.0.1", "::1"],
});

// Global error handler
fastify.setErrorHandler(errorHandler);

// Routes
await fastify.register(healthRoutes, { prefix: "/api/v1" });
await fastify.register(authRoutes, { prefix: "/api/v1/auth" });

await fastify.register(userRoutes, { prefix: "/api/v1/user" });
await fastify.register(accountRoutes, { prefix: "/api/v1/accounts" });
await fastify.register(memberRoutes, { prefix: "/api/v1/accounts" });
await fastify.register(invitationRoutes, { prefix: "/api/v1/invitations" });
await fastify.register(invoiceRoutes, { prefix: "/api/v1" });
await fastify.register(paymentRoutes, { prefix: "/api/v1" });
await fastify.register(adminRoutes,   { prefix: "/api/v1" });
await fastify.register(rxRoutes,      { prefix: "/api/v1" });

// Serve the built React frontend from this same service (single Cloud Run app:
// the SPA and the /api/v1 backend share one origin, which is what the frontend's
// relative `/api/v1` axios baseURL + httpOnly auth cookie require). In the
// production image the Vite build lands at apps/web/dist (baked in by the
// Dockerfile). In local dev that folder doesn't exist — Vite serves the
// frontend on its own port — so we skip static serving and stay API-only.
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDist)) {
  await fastify.register(fastifyStatic, { root: webDist, wildcard: false });

  // SPA fallback: any non-API GET that didn't match a file returns index.html
  // so client-side (React Router) routes resolve. Unmatched /api routes and
  // non-GET methods still get a JSON 404.
  fastify.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({
      error: "Not Found",
      message: `Route ${request.method}:${request.url} not found`,
    });
  });
  fastify.log.info(`Serving frontend from ${webDist}`);
}

// Start
const start = async () => {
  try {
    await fastify.listen({ port: env.PORT, host: "0.0.0.0" });
    console.log(`Server running on port ${env.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
