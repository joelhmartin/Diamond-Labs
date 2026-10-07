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
  if (!isStaging(env)) return;
  const problems = [];
  if (env.AUTHORIZE_NET_ENV !== "sandbox") problems.push('AUTHORIZE_NET_ENV must be "sandbox"');
  if (!env.STAGING_EMAIL_TO) problems.push("STAGING_EMAIL_TO must be set (all outbound mail is redirected there)");
  if (env.SEAZONA_DISABLED !== "true") problems.push('SEAZONA_DISABLED must be "true"');
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

/** Under staging, mark every response (static files, 404s, errors) as non-indexable. */
export function registerStagingHeaders(fastify, env) {
  if (!isStaging(env)) return;
  fastify.addHook("onSend", async (_request, reply) => {
    reply.header("X-Robots-Tag", "noindex, nofollow");
  });
}
