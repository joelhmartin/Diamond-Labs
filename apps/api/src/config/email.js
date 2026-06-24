import { env } from "./env.js";

/**
 * Mailgun config for the transactional email layer (HTTP API, no SDK needed).
 * Null when no API key / domain is set — `send()` then no-ops (dev) and logs.
 * The domain tolerates a stray trailing slash (it's easy to paste in).
 */
const domain = (env.MAILGUN_DOMAIN || "").replace(/\/+$/, "").trim();

export const mailgun = env.MAILGUN_API_KEY && domain
  ? {
      apiKey: env.MAILGUN_API_KEY,
      domain,
      // US region by default; set MAILGUN_API_BASE=https://api.eu.mailgun.net for EU.
      apiBase: (env.MAILGUN_API_BASE || "https://api.mailgun.net").replace(/\/+$/, ""),
    }
  : null;
