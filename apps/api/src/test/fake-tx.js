/**
 * A recording fake of drizzle's transaction surface for service tests (the
 * repo has no DB harness). Every awaited select/update chain pops the next
 * queued result (an array; [] when the queue runs dry); inserts record their
 * values; `transaction(fn)` runs fn against the same fake, as a savepoint
 * would in production. `log` is the ordered list of operations.
 */
export function fakeTx({ selects = [], updates = [] } = {}) {
  const log = [];
  const chain = (queue, record) => {
    const b = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (res, rej) => Promise.resolve(queue ? queue.shift() ?? [] : undefined).then(res, rej);
        return (...args) => { if (record) record(prop, args); return b; };
      },
    });
    return b;
  };
  const tx = {
    log,
    execute: async (q) => { log.push({ op: "execute", q }); return q; },
    select: () => { log.push({ op: "select" }); return chain(selects); },
    selectDistinct: () => { log.push({ op: "select" }); return chain(selects); },
    update: () => {
      const entry = { op: "update" };
      log.push(entry);
      return chain(updates, (m, a) => { if (m === "set") { entry.values = a[0]; log.push({ op: "set", values: a[0] }); } });
    },
    insert: () => {
      const entry = { op: "insert" };
      log.push(entry);
      // Awaited after .returning(), an insert resolves to [{ id }] per inserted row (as postgres does); otherwise undefined.
      const queue = { shift: () => (entry.returning ? [].concat(entry.values ?? []).map((v) => ({ id: v?.id })) : undefined) };
      return chain(queue, (m, a) => { if (m === "values") entry.values = a[0]; if (m === "returning") entry.returning = true; });
    },
    delete: () => { log.push({ op: "delete" }); return chain(null); },
    transaction: (fn) => fn(tx),
  };
  return tx;
}

export const fakeDb = (tx) => ({ transaction: (fn) => fn(tx) });
