import { eq } from "drizzle-orm";
import { LEGACY_SETTLEMENT_SOURCE, OPENING_BALANCE_PREFIX } from "@my-app/shared";
import { invoices, invoiceLines, invoicePayments } from "../db/schema/index.js";
import { ImportRefusal } from "./import-errors.js";
import { sealInvoice, sealLine } from "../services/billing/invoice-crypto.js";
import { loadOwners, normAccount } from "./owners.js";
import { planInvoices } from "./map-invoices.js";
import { insertMissing } from "./load-writer.js";
import { enforceSeeds } from "./seed-check.js";
import { problem } from "./problems.js";
import { withLoadLock } from "./load-lock.js";
import { reattachOwners as reattachRows, planAttach, stillUnowned } from "./reattach.js";

const BATCH = 500;

/**
 * `import:load invoices`: one `kind: legacy` invoice per Seazona invoice, with
 * its lines. Owners come from the clients step (run it first) and only
 * approved doctors qualify (owners.js). A client linked only to a user who
 * can't own it, or shared by several eligible doctors, loads UNOWNED and is
 * reported (ruling F2, the same as the orders step); a client with no linked
 * user at all is client_not_loaded and skipped. Legacy invoices keep Seazona's numbers: they never
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
 *
 * After `balances` (ruling F2): once the target has settlement rows or
 * opening-balance invoices, newly inserted history would load UNSETTLED (its
 * full total owed). A live run that would insert refuses unless
 * `allowAfterBalances` (`--allow-after-balances`), and then the report tells
 * the operator to re-run `balances` with the same --file-id (idempotent).
 *
 * A live run holds the target's load lock (`lock`, load-lock.js), like every live load step.
 */
export async function loadInvoices({ raw, db, live, target, starts = {}, lock = null, allowAfterBalances = false }) {
  return withLoadLock({ lock, live, step: "invoices" }, (guard) => run({ raw, db, live, target, starts, guard, allowAfterBalances }));
}

export const RERUN_BALANCES_NOTE =
  "This run inserted invoices after balances had run: they are UNSETTLED. Re-run `import:load balances` with the same --balances mode and --file-id now, before parity.";

/** True when a balances run has written to the target (settlement rows or opening-balance invoices). */
async function balancesHaveRun(db, existing) {
  if (existing.some((r) => r.seazonaId?.startsWith(OPENING_BALANCE_PREFIX))) return true;
  const rows = await db.select({ id: invoicePayments.id }).from(invoicePayments).where(eq(invoicePayments.source, LEGACY_SETTLEMENT_SOURCE)).limit(1);
  return rows.length > 0;
}

async function run({ raw, db, live, target, starts, guard, allowAfterBalances }) {
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
  const afterBalances = plan.rows.length > 0 && (await balancesHaveRun(db, existing));
  if (afterBalances) report.problems.push(problem("invoices_inserted_after_balances", plan.rows.map((r) => r.invoice.legacySeazonaInvoiceId)));
  if (!live) return report;
  if (afterBalances && !allowAfterBalances) {
    throw new ImportRefusal(`${plan.rows.length} invoice(s) would be inserted after balances already ran, so they would load unsettled. `
      + "Re-run with --allow-after-balances, then re-run `import:load balances` with the same --file-id before parity.");
  }

  let written = 0;
  let conflicts = 0;
  const dropped = [];
  for (let i = 0; i < plan.rows.length; i += BATCH) {
    const chunk = plan.rows.slice(i, i + BATCH);
    guard();
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
  if (afterBalances && written > 0) report.next = RERUN_BALANCES_NOTE;
  if (dropped.length) report.problems.push(problem("invoice_not_loaded_conflict", dropped));
  plan.counts.reattached = await reattachOwners(db, reattach, guard);
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
export function reattachOwners(db, plan, guard) {
  return reattachRows(db, plan, {
    guard,
    table: invoices, ownerField: "clientUserId", ownerCol: invoices.clientUserId, keyCol: invoices.legacySeazonaInvoiceId,
    versionCol: invoices.version, scope: eq(invoices.kind, "legacy"),
    action: "import.legacy_invoices_reattached", targetType: "invoice", metadataKey: "legacyInvoiceIds",
  });
}
