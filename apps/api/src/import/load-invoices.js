import { eq } from "drizzle-orm";
import { OPENING_BALANCE_PREFIX } from "@my-app/shared";
import { invoices, invoiceLines } from "../db/schema/index.js";
import { sealInvoice, sealLine } from "../services/billing/invoice-crypto.js";
import { loadOwners, normAccount } from "./owners.js";
import { planInvoices } from "./map-invoices.js";
import { insertMissing } from "./load-writer.js";
import { enforceSeeds } from "./seed-check.js";
import { problem } from "./problems.js";
import { reattachOwners as reattachRows, planAttach, stillUnowned } from "./reattach.js";

const BATCH = 500;

/**
 * `import:load invoices`: one `kind: legacy` invoice per Seazona invoice, with
 * its lines. Owners come from the clients step (run it first) and only
 * approved doctors qualify (owners.js); a client without one is reported and
 * its invoices are skipped; a client shared by several eligible doctors loads unowned (reported). Legacy invoices keep Seazona's numbers: they never
 * pass through the live number allocator. Each batch of 500 invoices and their
 * lines is one transaction; a re-run skips every invoice already loaded (by
 * legacy_seazona_invoice_id).
 *
 * Fixing an owner problem (a client shared by several doctors, an unapproved
 * link): correct the link, then re-run `import:load invoices`. Every run
 * REATTACHES already-loaded legacy invoices that have no owner (client_user_id
 * null) once their Seazona client resolves to exactly one eligible owner
 * (counts.reattached; a dry run reports what it would do). An invoice that
 * already has an owner is never changed. This also attaches the per-client
 * opening-balance invoices (`opening:<account>`, balances step) that loaded
 * unowned, by account number. Each batch that changes rows writes one audit
 * entry (owner id, planned and changed counts, Seazona invoice ids; no PHI).
 */
export async function loadInvoices({ raw, db, live, target, starts = {} }) {
  const summaries = await raw.records("invoice");
  const details = new Map((await raw.records("invoice_detail")).map((r) => [r.seazonaId, r.payload]));
  const seeds = await enforceSeeds({ raw, db, target, live, starts, invoiceSummaries: summaries });
  const owners = await loadOwners(db);
  const existing = await db
    .select({ seazonaId: invoices.legacySeazonaInvoiceId, number: invoices.invoiceNumber, clientUserId: invoices.clientUserId })
    .from(invoices);
  const existingSeazonaIds = new Set(existing.map((r) => r.seazonaId).filter(Boolean));
  const plan = planInvoices({
    summaries, details, owners: owners.byClient, unownedClients: owners.rejectedClients, ambiguousClients: owners.ambiguousClients,
    existingSeazonaIds, existingNumbers: new Set(existing.map((r) => r.number)),
  });
  const reattach = reattachPlan(existing, summaries, owners);
  plan.counts.reattached = [...reattach.values()].reduce((n, ids) => n + ids.length, 0); // planned; a live run overwrites with what changed
  const clientOfInvoice = new Map(summaries.map((r) => [r.seazonaId, String(r.payload.clientId)]));
  const waiting = stillUnowned(
    existing.filter((r) => r.seazonaId && !r.seazonaId.startsWith(OPENING_BALANCE_PREFIX)).map((r) => ({ clientUserId: r.clientUserId, clientId: clientOfInvoice.get(r.seazonaId) })),
    owners.byClient,
  );
  plan.counts.loadedStillUnowned = waiting.records;
  if (waiting.clients.length) plan.problems.push(problem("loaded_invoices_still_unowned_client", waiting.clients));
  const report = { step: "invoices", live, counts: plan.counts, seeds: seeds.summary, problems: plan.problems };
  if (!live) return report;

  let written = 0;
  let conflicts = 0;
  const dropped = [];
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
      dropped.push(...r.droppedKeys);
    });
  }
  report.written = { invoices: written, conflicts };
  if (dropped.length) report.problems.push(problem("invoice_not_loaded_conflict", dropped));
  plan.counts.reattached = await reattachOwners(db, reattach);
  return report;
}

/**
 * Loaded legacy invoices with no owner whose Seazona client (or, for an
 * opening-balance invoice, account number) now has one: owner id → legacy invoice ids.
 */
export function reattachPlan(existing, summaries, owners) {
  const clientOf = new Map(summaries.map((r) => [r.seazonaId, String(r.payload.clientId)]));
  const out = new Map();
  for (const r of existing) {
    if (!r.seazonaId || r.clientUserId) continue;
    const owner = r.seazonaId.startsWith(OPENING_BALANCE_PREFIX)
      ? owners.byAccount.get(normAccount(r.seazonaId.slice(OPENING_BALANCE_PREFIX.length)))
      : owners.byClient.get(clientOf.get(r.seazonaId));
    if (owner) planAttach(out, owner, r.seazonaId);
  }
  return out;
}

/** Guarded (reattach.js): only a legacy invoice that is still unowned changes. Returns how many were attached. */
export function reattachOwners(db, plan) {
  return reattachRows(db, plan, {
    table: invoices, ownerField: "clientUserId", ownerCol: invoices.clientUserId, keyCol: invoices.legacySeazonaInvoiceId,
    versionCol: invoices.version, scope: eq(invoices.kind, "legacy"),
    action: "import.legacy_invoices_reattached", targetType: "invoice", metadataKey: "legacyInvoiceIds",
  });
}
