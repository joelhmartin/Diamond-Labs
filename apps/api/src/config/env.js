import { z } from "zod";
import project from "../../../../project.config.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url().default("http://localhost:5173"),
  API_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRY: z.string().default(project.auth.jwtExpiry),
  REFRESH_TOKEN_EXPIRY: z.string().default(project.auth.refreshExpiry),
  MFA_ENCRYPTION_KEY: z.string().min(32).optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().optional(),

  // Email (Mailgun HTTP API). RESEND_API_KEY kept (unused) for back-compat.
  RESEND_API_KEY: z.string().optional(),
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  MAILGUN_API_BASE: z.string().optional(),
  EMAIL_FROM: z.string().default(`noreply@${project.domain}`),

  // Seazona
  SEAZONA_API_KEY: z.string().optional(),
  SEAZONA_SECRET: z.string().optional(),
  SEAZONA_BASE_URL: z.string().url().optional(),
  // Lab-staff Seazona user id that catalog-order pushes are attributed to
  // (createOrder requires a `userId`). LEFT UNSET INTENTIONALLY until the lab
  // confirms which staff id to use — when unset, the Seazona order push does not
  // fire (the order is still recorded locally). Never hardcode/guess this id.
  SEAZONA_ORDER_USER_ID: z.string().optional(),

  // Authorize.net
  AUTHORIZE_NET_API_LOGIN: z.string().optional(),
  AUTHORIZE_NET_TRANSACTION_KEY: z.string().optional(),
  AUTHORIZE_NET_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  // Sandbox creds (from developer.authorize.net) — used by the test payment flow
  // regardless of AUTHORIZE_NET_ENV, so we can sandbox-test without touching prod.
  AUTHORIZE_NET_SANDBOX_API_LOGIN: z.string().optional(),
  AUTHORIZE_NET_SANDBOX_TRANSACTION_KEY: z.string().optional(),

  // Google Cloud Storage
  RX_GCS_BUCKET: z.string().optional(),
  // Digital Rx live Seazona push gate.
  // NOTE: the live-push branch is currently a stub — even when set to "true",
  // the /rx/cases/:id/approve route still dry-runs (seazonaPushStatus =
  // "push_skipped_dryrun") and does NOT call seazonaService.createOrder.
  // The createOrder call is commented-out pending lab confirmation of the
  // staff userId and end-to-end payload validation. When unset or any other
  // value the route also dry-runs. Matches the gated pattern used by the
  // shop's createOrder path; the gate itself will activate once the TODO
  // block in rx.routes.js is uncommented.
  RX_LIVE_PUSH: z.string().optional(),

  // Admin
  ADMIN_NOTIFICATION_EMAIL: z.string().email().optional(),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
