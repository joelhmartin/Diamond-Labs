import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
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

const fastify = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
  },
  trustProxy: true,
});

// Plugins
await fastify.register(cookie);
await fastify.register(cors, {
  origin: env.NODE_ENV === "production"
    ? project.api.cors.origins
    // Vite auto-bumps the dev port when taken, so allow any localhost origin in dev.
    : (origin, cb) => {
        if (!origin) return cb(null, true);
        try {
          const host = new URL(origin).hostname;
          if (host === "localhost" || host === "127.0.0.1") return cb(null, true);
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
