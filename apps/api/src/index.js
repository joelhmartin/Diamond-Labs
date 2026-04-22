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
    : ["http://localhost:5173", "http://localhost:3000"],
  credentials: true,
});
await fastify.register(helmet, { contentSecurityPolicy: false });
await fastify.register(rateLimit, {
  max: project.api.rateLimit.maxRequests,
  timeWindow: project.api.rateLimit.window,
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
