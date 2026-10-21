process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";
import { fakeLock } from "../test/fake-lock.js";
import { loadClients } from "./load-clients.js";
import { loadInvoices } from "./load-invoices.js";
import { loadOrders } from "./load-orders.js";
import { ImportRefusal } from "./import-errors.js";

// One LOAD lock for EVERY live step (clients and invoices included), none for a dry run.
const raw = { records: async () => [] };
const steps = {
  clients: (extra) => loadClients({ raw, db: fakeTx({ selects: [[], [], []] }), ...extra }),
  invoices: (extra) => loadInvoices({ raw, db: fakeTx(), target: "rehearsal", ...extra }),
  orders: (extra) => loadOrders({ raw, db: fakeTx(), target: "rehearsal", ...extra }),
};

for (const [name, run] of Object.entries(steps)) {
  test(`${name}: a live run holds the load lock for its whole run and releases it`, async () => {
    const lock = fakeLock();
    await run({ live: true, lock });
    assert.equal(lock.calls[0], "tryLock");
    assert.equal(lock.calls.at(-1), "close");
  });

  test(`${name}: a live run is refused while another load holds the lock, before any read`, async () => {
    const lock = fakeLock({ held: false });
    await assert.rejects(run({ live: true, lock }), ImportRefusal);
  });

  test(`${name}: a live run without a lock is a programming error, and a dry run needs none`, async () => {
    await assert.rejects(run({ live: true }), TypeError);
    await run({ live: false });
  });
}
