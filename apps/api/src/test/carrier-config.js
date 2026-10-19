import { readFileSync } from "node:fs";

/**
 * Carrier test doubles. Nothing here is a real credential, and nothing here
 * reaches a carrier: adapters are given `fakeFetch`, which answers from a
 * queue and records every call.
 */
export const TEST_SHIP_FROM = {
  name: "Test Lab", company: "Test Lab", phone: "2105550199", address1: "1 Lab Way", address2: null,
  city: "San Antonio", state: "TX", postalCode: "78205", country: "US",
};

export function testCarrierConfig(over = {}) {
  return {
    carrierEnv: "sandbox",
    labelFormat: "image",
    shipFrom: TEST_SHIP_FROM,
    shipFromMissing: [],
    ups: { clientId: "ups-test-id", clientSecret: "ups-test-secret", accountNumber: "A1B2C3", host: "https://ups.test" },
    fedex: { apiKey: "fx-test-key", secretKey: "fx-test-secret", accountNumber: "740561073", host: "https://fedex.test" },
    ...over,
  };
}

/** A fetch double: each call takes the next queued answer ({ status, body } or an Error to throw). */
export function fakeFetch(responses) {
  const queue = [...responses];
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch: ${url}`);
    if (next instanceof Error) throw next;
    const text = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return { ok: next.status >= 200 && next.status < 300, status: next.status, text: async () => text };
  };
  fn.calls = calls;
  return fn;
}

/** What fetch throws when AbortSignal.timeout fires. */
export const timeoutError = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

/** A recorded/constructed carrier body from apps/api/test-fixtures/carriers/<carrier>/<name>.json. */
export const fixture = (carrier, name) =>
  JSON.parse(readFileSync(new URL(`../../test-fixtures/carriers/${carrier}/${name}.json`, import.meta.url), "utf8"));
