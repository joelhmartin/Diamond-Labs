// Build-time environment helpers. Pure and import-free so vite.config.js (Node)
// and the app bundle can both use them.

const ACCEPT_JS = {
  production: "https://js.authorize.net/v1/Accept.js",
  sandbox: "https://jstest.authorize.net/v1/Accept.js",
};

/**
 * Accept.js URL for a VITE_AUTHORIZE_NET_ENV value. Unset/empty means production,
 * so a build with no new args is unchanged. An unknown value throws: silently
 * picking the live script for a typo'd "sandbox" would be the dangerous failure.
 */
export function acceptJsUrl(authNetEnv) {
  const key = authNetEnv || "production";
  if (!Object.hasOwn(ACCEPT_JS, key)) {
    throw new Error(`VITE_AUTHORIZE_NET_ENV must be "sandbox" or "production" (got "${authNetEnv}")`);
  }
  return ACCEPT_JS[key];
}

/**
 * Swap the production Accept.js URL in html for the target env's URL. Throws if a
 * different URL is needed but the production URL is absent, so the swap can never
 * silently do nothing (a staging build would then ship the live script).
 */
export function swapAcceptJsUrl(html, authNetEnv) {
  const target = acceptJsUrl(authNetEnv);
  if (target === ACCEPT_JS.production) return html;
  if (!html.includes(ACCEPT_JS.production)) {
    throw new Error(`Accept.js swap failed: ${ACCEPT_JS.production} not found in index.html, cannot point it at ${target}`);
  }
  return html.replace(ACCEPT_JS.production, target);
}

/** Build-time guard: a staging bundle must load the sandbox Accept.js. Throws otherwise. */
export function assertStagingBuildSafe(appEnv, authNetEnv) {
  if (isStagingBuild(appEnv) && authNetEnv !== "sandbox") {
    throw new Error(`VITE_APP_ENV=staging requires VITE_AUTHORIZE_NET_ENV=sandbox (got "${authNetEnv ?? ""}")`);
  }
}

export const isStagingBuild = (appEnv) => appEnv === "staging";
