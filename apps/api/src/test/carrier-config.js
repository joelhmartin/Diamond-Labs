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

/** What a successful UPS createLabel returns (Task 5's parser output for the ship fixture). */
export const TEST_LABEL = {
  trackingNumber: "1Z999AA10123456784", carrierShipmentId: "1Z999AA10123456784", labelFormat: "gif",
  labelData: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", chargeCents: 1142, currency: "USD",
  serviceCode: "03", serviceName: "UPS Ground",
};

/** An adapter double: every method can be overridden; calls are recorded on `.calls`. */
export function fakeAdapter(id, over = {}) {
  const calls = [];
  const rec = (name, fn) => async (...args) => { calls.push([name, ...args]); return fn(...args); };
  return {
    id, label: id.toUpperCase(), tracks: id !== "manual", calls,
    configured: over.configured ?? (() => ({ ok: true })),
    rate: rec("rate", over.rate ?? (async () => [])),
    createLabel: rec("createLabel", over.createLabel ?? (async () => ({ ...TEST_LABEL }))),
    voidLabel: rec("voidLabel", over.voidLabel ?? (async () => ({ ok: true }))),
    track: rec("track", over.track ?? (async () => [])),
  };
}

/** A registry double over the given adapters (the same surface as carrier-registry.js createRegistry). */
export function fakeRegistry(adapters) {
  return {
    get: (id) => {
      const a = adapters.find((x) => x.id === id);
      if (!a) throw new Error(`no adapter ${id}`);
      return a;
    },
    all: () => adapters,
    enabled: () => adapters.filter((a) => a.configured().ok),
    status: () => adapters.map((a) => ({ id: a.id, label: a.label, tracks: a.tracks, ...a.configured() })),
  };
}
