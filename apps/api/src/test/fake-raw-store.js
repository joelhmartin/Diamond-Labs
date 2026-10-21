/**
 * An in-memory stand-in for raw-store.js's rawStore(): same method names and
 * shapes, records kept in a Map. For the piece-5 fetcher and CLI tests.
 */
export function fakeRawStore() {
  const recs = new Map();
  const runs = new Map();
  const files = new Map();
  return {
    recs,
    runs,
    upsert: async (entity, records) => { for (const r of records) recs.set(`${entity}:${r.seazonaId}`, r); return records.length; },
    index: async (entity) => new Map([...recs].filter(([k]) => k.startsWith(`${entity}:`)).map(([, r]) => [r.seazonaId, r.lastModified ?? null])),
    startRun: async (o) => { const id = `run${runs.size + 1}`; runs.set(id, { id, ...o, cursor: 0, status: "running" }); return id; },
    saveProgress: async (id, p) => Object.assign(runs.get(id), p),
    finishRun: async (id, p) => Object.assign(runs.get(id), p),
    getRun: async (id) => runs.get(id) ?? null,
    records: async (entity) => [...recs.entries()].filter(([k]) => k.startsWith(`${entity}:`)).map(([, r]) => r),
    files,
    saveFile: async ({ kind, bytes }) => { const id = `file${files.size + 1}`; files.set(id, { kind, bytes }); return id; },
    readFile: async (id) => files.get(id) ?? null,
  };
}

