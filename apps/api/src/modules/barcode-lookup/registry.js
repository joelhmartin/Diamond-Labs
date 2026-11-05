/**
 * A registry of resolvers that turn one scanned code into the records it may
 * identify. The module knows nothing about the records: each resolver is
 * supplied by the host app.
 *
 * Hit = { recordType, recordId, title, subtitle?, href }
 */
export function createLookupRegistry({ log = console } = {}) {
  const resolvers = [];

  /** match(code) → normalized value or null (not this resolver's shape); resolve(normalized, database) → Hit[] */
  function defineResolver({ key, match, resolve }) {
    if (!key || typeof match !== "function" || typeof resolve !== "function") throw new Error("Invalid resolver.");
    if (resolvers.some((r) => r.key === key)) throw new Error(`Resolver "${key}" is already defined.`);
    resolvers.push({ key, match, resolve });
  }

  async function lookup(code, database) {
    const seen = new Set();
    const hits = [];
    for (const r of resolvers) {
      let found;
      try {
        const normalized = r.match(code);
        if (normalized === null || normalized === undefined) continue;
        found = await r.resolve(normalized, database);
      } catch {
        // Key only: a resolver's error can carry the scanned code or record data.
        log.error(`barcode-lookup: resolver "${r.key}" failed`);
        continue;
      }
      for (const hit of found ?? []) {
        const id = `${hit.recordType}:${hit.recordId}`;
        if (seen.has(id)) continue;
        seen.add(id);
        hits.push(hit);
      }
    }
    return { code, hits };
  }

  return { defineResolver, lookup };
}
