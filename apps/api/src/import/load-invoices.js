import { isNotNull } from "drizzle-orm";
import { invoices, invoiceLines, users } from "../db/schema/index.js";
import { sealInvoice, sealLine } from "../services/billing/invoice-crypto.js";
import { OWNER_COLUMNS, resolveOwners } from "./owners.js";
import { planInvoices } from "./map-invoices.js";
import { insertMissing } from "./load-writer.js";
import { enforceSeeds } from "./seed-check.js";

const BATCH = 500;

/**
 * `import:load invoices`: one `kind: legacy` invoice per Seazona invoice, with
 * its lines. Owners come from the clients step (run it first) and only
 * approved doctors qualify (owners.js); a client without one is reported and
 * its invoices are skipped; a client shared by several eligible doctors loads unowned (reported). Legacy invoices keep Seazona's numbers: they never
 * pass through the live number allocator. Each batch of 500 invoices and their
 * lines is one transaction; a re-run skips every invoice already loaded (by
 * legacy_seazona_invoice_id).
 */
export async function loadInvoices({ raw, db, live, target, starts = {} }) {
  const summaries = await raw.records("invoice");
  const details = new Map((await raw.records("invoice_detail")).map((r) => [r.seazonaId, r.payload]));
  const seeds = await enforceSeeds({ raw, db, target, live, starts, invoiceSummaries: summaries });
  const userRows = await db.select(OWNER_COLUMNS).from(users).where(isNotNull(users.seazonaClientId));
  const owners = resolveOwners(userRows);
  const existing = await db.select({ seazonaId: invoices.legacySeazonaInvoiceId, number: invoices.invoiceNumber }).from(invoices);
  const existingSeazonaIds = new Set(existing.map((r) => r.seazonaId).filter(Boolean));
  const plan = planInvoices({
    summaries, details, owners: owners.byClient, unownedClients: owners.rejectedClients, ambiguousClients: owners.ambiguousClients,
    existingSeazonaIds, existingNumbers: new Set(existing.map((r) => r.number)),
  });
  const report = { step: "invoices", live, counts: plan.counts, seeds: seeds.summary, problems: plan.problems };
  if (!live) return report;

  let written = 0;
  let conflicts = 0;
  for (let i = 0; i < plan.rows.length; i += BATCH) {
    const chunk = plan.rows.slice(i, i + BATCH);
    await db.transaction(async (tx) => {
      const r = await insertMissing(tx, invoices, chunk.map((x) => sealInvoice(x.invoice)), {
        keyOf: (inv) => inv.legacySeazonaInvoiceId, existingKeys: existingSeazonaIds,
      });
      const lines = chunk.filter((x) => r.insertedIds.has(x.invoice.id)).flatMap((x) => x.lines.map(sealLine));
      for (let j = 0; j < lines.length; j += BATCH) await tx.insert(invoiceLines).values(lines.slice(j, j + BATCH));
      written += r.insertedIds.size;
      conflicts += r.conflicts;
    });
  }
  report.written = { invoices: written, conflicts };
  return report;
}
