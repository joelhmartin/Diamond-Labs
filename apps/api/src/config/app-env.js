/**
 * Staging safety switches. Pure (no imports, no process.env reads) so every rule
 * is unit-testable by passing an env object. With APP_ENV unset or "production"
 * every function here is a no-op / identity, so production behaviour is unchanged.
 */

export const isStaging = (env) => env?.APP_ENV === "staging";

/**
 * Boot gate. Under APP_ENV=staging, refuse to start unless payments are sandbox,
 * mail is redirected and Seazona is hard-disabled. Reports every problem at once.
 */
export function assertSafeConfig(env) {
  // Re-creation guard: a Cloud Run service named *-staging that was re-created
  // without APP_ENV=staging would otherwise boot as a normal (unsafe) instance.
  // K_SERVICE is injected by Cloud Run; unset locally and "diamond-labs-api" in prod.
  if (!isStaging(env) && typeof env?.K_SERVICE === "string" && env.K_SERVICE.endsWith("-staging")) {
    throw new Error(
      `Unsafe configuration, refusing to boot: Cloud Run service "${env.K_SERVICE}" is a staging service but APP_ENV is not "staging"`,
    );
  }
  if (!isStaging(env)) return;
  const problems = [];
  if (env.AUTHORIZE_NET_ENV !== "sandbox") problems.push('AUTHORIZE_NET_ENV must be "sandbox"');
  if (!env.STAGING_EMAIL_TO) problems.push("STAGING_EMAIL_TO must be set (all outbound mail is redirected there)");
  if (env.SEAZONA_DISABLED !== "true") problems.push('SEAZONA_DISABLED must be "true"');
  // Live-money credentials must not exist in staging at all (defence in depth
  // behind the sandbox-only mode resolution in authorizenet.service.js).
  if (env.AUTHORIZE_NET_API_LOGIN) problems.push("AUTHORIZE_NET_API_LOGIN (live credential) must be unset");
  if (env.AUTHORIZE_NET_TRANSACTION_KEY) problems.push("AUTHORIZE_NET_TRANSACTION_KEY (live credential) must be unset");
  // No AutoPay charging and no HTTP job trigger in staging.
  if (env.AUTOPAY_LIVE_RUN === true || env.AUTOPAY_LIVE_RUN === "true") problems.push("AUTOPAY_LIVE_RUN must be false/unset");
  if (env.JOBS_TRIGGER_SECRET) problems.push("JOBS_TRIGGER_SECRET must be unset (no job trigger in staging)");
  if (problems.length) {
    throw new Error(`Unsafe staging configuration, refusing to boot: ${problems.join("; ")}`);
  }
}

/**
 * Rewrite an outbound email for staging: recipient becomes STAGING_EMAIL_TO, the
 * subject is prefixed with the original recipient, cc/bcc are dropped. Identity
 * outside staging. Returns null (fail closed: do not send) if staging has no
 * redirect address.
 */
export function stagingRewrite(message, env) {
  if (!isStaging(env)) return message;
  if (!env.STAGING_EMAIL_TO) return null;
  const { cc: _cc, bcc: _bcc, ...rest } = message;
  return {
    ...rest,
    to: env.STAGING_EMAIL_TO,
    subject: `[STAGING → ${message.to}] ${message.subject}`,
  };
}

/**
 * Gateway mode actually used. Staging is always sandbox, whatever was asked for
 * (explicit mode args included); otherwise an explicit valid mode wins, else the
 * global AUTHORIZE_NET_ENV (production only when exactly "production").
 */
export function effectiveGatewayMode(mode, env) {
  if (isStaging(env)) return "sandbox";
  if (mode === "sandbox" || mode === "production") return mode;
  return env?.AUTHORIZE_NET_ENV === "production" ? "production" : "sandbox";
}

/** Error message for an invalid/forbidden test-route `mode`, or null when acceptable. */
export function testModeError(mode, env) {
  if (mode !== "sandbox" && mode !== "production") return "mode must be 'sandbox' or 'production'.";
  if (mode === "production" && isStaging(env)) return "mode 'production' is not allowed in staging.";
  return null;
}

/** Under staging, mark every response (static files, 404s, errors) as non-indexable. */
export function registerStagingHeaders(fastify, env) {
  if (!isStaging(env)) return;
  fastify.addHook("onSend", async (_request, reply) => {
    reply.header("X-Robots-Tag", "noindex, nofollow");
  });
}
