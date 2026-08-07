import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor, requireAdmin } from "../middleware/require-role.js";
import * as seazonaService from "../services/seazona.service.js";
import { ERROR_CODES } from "@my-app/shared";
import { db } from "../config/database.js";
import { users } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { createId } from "../lib/id.js";
import {
  getPortalPaidMap,
  getInvoicePortalPaid,
  getInvoicePortalPaidStrict,
  getGlobalPortalPaidMap,
} from "../services/invoice-ledger.service.js";
import * as auditService from "../services/audit.service.js";
import { redis } from "../config/redis.js";
import { withInvoiceLocks, InvoiceLockedError } from "../lib/payment-helpers.js";
import { recordPaymentAndAllocations } from "../services/payment-recording.service.js";

/** Round to cents consistently (avoids FP drift). */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Doctor-shaped column set the offline-payment route needs to pass a full
// `user` into recordPaymentAndAllocations (receipt email + optional Seazona
// write) — more than the id-only select the route used before unification.
const DOCTOR_COLUMNS = {
  id: users.id,
  email: users.email,
  name: users.name,
  seazonaClientId: users.seazonaClientId,
  seazonaAccountNumber: users.seazonaAccountNumber,
};

/**
 * Normalize a Seazona invoice into the shape the frontend renders.
 *
 * Real Seazona invoice fields (from live API):
 *   id, invoiceNumber, patient, clientId, fullName, company,
 *   sales, tax, discounts, total, status, due, lastModified
 *
 * The Seazona API does NOT expose paid-vs-unpaid on the invoice itself —
 * `status` is a workflow state ("Shipped", "Hold", "In Production", …).
 *
 * @param {object} inv - Raw Seazona invoice object.
 * @param {number} [portalPaid=0] - Sum of payments recorded in the local
 *   invoice_payments ledger (Authorize.net charges made through this portal).
 *   Payments entered directly in Seazona by staff are NOT included here.
 */
function normalizeInvoice(inv, portalPaid = 0) {
  const total = Number(inv.total || 0);
  // Round to 2 decimal places; Drizzle returns numeric columns as strings.
  const portalPaidAmount = Math.round(parseFloat(portalPaid || 0) * 100) / 100;
  // Floor balance at 0 — over-payment should not produce a negative balance
  // that the UI could inadvertently multiply into a new charge.
  const portalBalance = Math.max(0, Math.round((total - portalPaidAmount) * 100) / 100);
  // Float epsilon: anything under half a cent is considered fully paid.
  const portalPaidFlag = portalBalance < 0.005;

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    patient: inv.patient || "",
    clientId: inv.clientId || null,
    clientName: inv.fullName || inv.company || "",
    clientCompany: inv.company || "",
    sales: Number(inv.sales || 0),
    tax: Number(inv.tax || 0),
    discounts: Number(inv.discounts || 0),
    total,
    status: inv.status || "",
    due: inv.due || null,
    lastModified: inv.lastModified || null,
    // Portal-payment ledger fields (Authorize.net charges made via this portal
    // only — payments entered directly in Seazona are NOT reflected here).
    portalPaidAmount,
    portalBalance,
    portalPaid: portalPaidFlag,
  };
}

export default async function invoiceRoutes(fastify) {
  // ───────────────────────────────────────────────────────────────
  // ADMIN — all invoices across every client, enriched with client contact
  // info (one bulk listClients call — cheap vs N individual fetches).
  // Returns { invoices, clients, summary, statusCounts }.
  // ───────────────────────────────────────────────────────────────
  fastify.get("/admin/invoices", {
    preHandler: [authenticate, requireAdmin],
  }, async (request) => {
    const [invResult, clientList, paidMap] = await Promise.all([
      request.query.lastModified
        ? seazonaService.getInvoicesResult(request.query.lastModified)
        : seazonaService.getAllInvoicesResult(),
      seazonaService.listClients(),
      getGlobalPortalPaidMap(),
    ]);
    const seazonaUnavailable = !invResult.reachable;

    const invoices = invResult.invoices.map((inv) => normalizeInvoice(inv, paidMap[String(inv.id)] || 0));

    // Index clients by id for lookup
    const clients = {};
    for (const c of clientList) {
      if (c.id) clients[c.id] = c;
    }

    // Unique status labels actually present in the data
    const statusCounts = {};
    for (const inv of invoices) {
      const s = inv.status || "Unknown";
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    }

    const summary = {
      count: invoices.length,
      totalAmount: invoices.reduce((s, i) => s + i.total, 0),
      clientCount: new Set(invoices.map((i) => i.clientId).filter(Boolean)).size,
      statuses: statusCounts,
    };

    return { data: { invoices, clients, summary }, meta: { seazonaUnavailable } };
  });

  // ADMIN — single client detail (for expanding rows, etc.)
  fastify.get("/admin/clients/:id", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const client = await seazonaService.getClient(request.params.id);
    if (!client) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    return { data: client };
  });

  // List invoices for the current doctor's Seazona client
  fastify.get("/invoices", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { seazonaClientId } = request.user;

    if (!seazonaClientId) {
      return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
    }

    // Fetch Seazona invoices and the local portal-payment ledger in parallel.
    const [invResult, portalPaidMap] = await Promise.all([
      request.query.lastModified
        ? seazonaService.getInvoicesResult(request.query.lastModified)
        : seazonaService.getAllInvoicesResult(),
      getPortalPaidMap(request.user.id),
    ]);

    const doctorInvoices = invResult.invoices
      .filter((inv) => String(inv.clientId) === String(seazonaClientId))
      .map((inv) => normalizeInvoice(inv, portalPaidMap[String(inv.id)] || 0));

    // Tell the UI "billing system unreachable" apart from "you have no invoices":
    // an empty list with seazonaUnavailable=true is an outage, not a clean slate.
    return { data: doctorInvoices, meta: { seazonaUnavailable: !invResult.reachable } };
  });

  // Get a specific invoice
  fastify.get("/invoices/:id", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { seazonaClientId } = request.user;

    if (!seazonaClientId) {
      return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
    }

    const invoice = await seazonaService.getInvoice(request.params.id);
    if (!invoice) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    // Ensure the invoice belongs to this doctor
    if (String(invoice.clientId) !== String(seazonaClientId)) {
      return reply.code(403).send({ error: ERROR_CODES.FORBIDDEN });
    }

    // Aggregate portal payments for this single invoice.
    const portalPaid = await getInvoicePortalPaid(request.user.id, String(request.params.id));

    // Audit PHI access — the invoice payload carries the patient name.
    auditService.logSafe({
      userId: request.user.id,
      action: "invoice.read",
      targetType: "invoice",
      targetId: String(request.params.id),
      ipAddress: request.ip,
    });

    return { data: normalizeInvoice(invoice, portalPaid) };
  });

  // ───────────────────────────────────────────────────────────────
  // ADMIN — record an OFFLINE payment (#4 mitigation). By default this covers
  // payments staff already entered DIRECTLY in Seazona, which are invisible to
  // the portal balance (Seazona exposes no readable paid-state) — this reflects
  // such a payment in the local invoice_payments ledger so the doctor's portal
  // balance is accurate, WITHOUT writing to Seazona (the payment already exists
  // there — writing again would double-credit the client's account).
  //
  // `recordInSeazona: true` opts into the other case — a check/cash payment the
  // lab has received but NOT yet entered anywhere — and makes this route also
  // write the one account-level Seazona payment via the shared
  // recordPaymentAndAllocations component (same as every other payment path).
  // Defaults to false so existing callers see no behavior change.
  //
  // Routes through recordPaymentAndAllocations (shared with every other
  // payment path) so an offline record also sends the doctor a receipt email
  // (copy adjusted — "recorded", not "charged") and emits the same
  // [PAYMENT][LEDGER_WRITE_FAILED] alertable line on a ledger-insert failure
  // instead of a bare 500. transactionId is still an OFFLINE-<id> sentinel;
  // seazonaPaymentId is null unless recordInSeazona was set.
  //
  // Body: { amount, invoiceNumber?, seazonaClientId, userId?, recordInSeazona? }.
  // The ledger row's userId is the invoice's doctor — resolved from
  // seazonaClientId, or taken from the body when provided. Capped at the
  // invoice's remaining balance (C1 helper).
  // ───────────────────────────────────────────────────────────────
  fastify.post("/admin/invoices/:invoiceId/offline-payment", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const invoiceId = String(request.params.invoiceId);
    const { amount, invoiceNumber, seazonaClientId, userId: bodyUserId, recordInSeazona } = request.body || {};

    const amt = Number(amount);
    if (!(amt > 0) || amt > 100000 || Number(amt.toFixed(2)) !== amt) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "amount must be a positive value (≤ 100000) with at most 2 decimals." },
      });
    }
    if (!seazonaClientId) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "seazonaClientId is required." },
      });
    }

    // The invoice must exist and belong to the named Seazona client.
    const invoice = await seazonaService.getInvoice(invoiceId);
    if (!invoice) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }
    if (String(invoice.clientId) !== String(seazonaClientId)) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Invoice does not belong to the given seazonaClientId." },
      });
    }

    // Resolve the doctor user for the ledger row: explicit userId wins, else the
    // user linked to this Seazona client. Load the full doctor-shaped row (not
    // just id) — recordPaymentAndAllocations needs email/name/seazonaAccountNumber
    // for the receipt email and (when recordInSeazona is set) the Seazona write.
    //
    // An explicit userId MUST be verified to belong to this Seazona client. The
    // remaining-balance cap below is computed per (userId, invoiceId), so an
    // unchecked userId would compute "already paid = 0" against a user with no
    // ledger history and re-open the invoice's full balance for re-recording.
    let doctorUser = null;
    if (bodyUserId) {
      const [named] = await db
        .select(DOCTOR_COLUMNS)
        .from(users)
        .where(eq(users.id, String(bodyUserId)))
        .limit(1);
      if (!named || String(named.seazonaClientId) !== String(seazonaClientId)) {
        return reply.code(422).send({
          error: {
            ...ERROR_CODES.VALIDATION_ERROR,
            message: "The given userId is not linked to this seazonaClientId.",
          },
        });
      }
      doctorUser = named;
    } else {
      const [doctor] = await db
        .select(DOCTOR_COLUMNS)
        .from(users)
        .where(eq(users.seazonaClientId, String(seazonaClientId)));
      doctorUser = doctor || null;
    }
    if (!doctorUser) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "No portal user is linked to this seazonaClientId; pass an explicit userId." },
      });
    }
    const ledgerUserId = doctorUser.id;
    const resolvedInvoiceNumber = invoiceNumber
      ? String(invoiceNumber)
      : invoice.invoiceNumber != null
        ? String(invoice.invoiceNumber)
        : null;

    // Cap-then-record must be atomic against other writers on this invoice.
    // Without the lock, two submits (or one racing a doctor's card charge, which
    // holds this same invoice mutex) both read `alreadyPaid`, both pass the cap,
    // and both record — over-crediting the invoice so the portal shows paid when
    // it isn't. This is the same guard every card path already takes.
    let recorded;
    try {
      recorded = await withInvoiceLocks(redis, [invoiceId], async () => {
        // Cap at the invoice's remaining balance (C1 helper). Already-paid portion
        // is whatever the local ledger has recorded for THIS doctor + invoice.
        // STRICT read: this is a guard, so a DB error must abort rather than report
        // "paid so far = 0" and re-open the full balance.
        const alreadyPaid = await getInvoicePortalPaidStrict(ledgerUserId, invoiceId);
        const remaining = round2(Number(invoice.total || 0) - alreadyPaid);
        if (amt > remaining + 0.005) {
          const err = new Error(
            `Offline payment $${amt.toFixed(2)} exceeds the invoice's remaining balance of $${remaining.toFixed(2)}.`
          );
          err.capExceeded = true;
          throw err;
        }

        // Routed through the same shared component every other payment path
        // uses (#offline-payment-unification): this is what gives the offline
        // path a receipt email (copy adjusted for "recorded" vs "charged"), an
        // alertable [PAYMENT][LEDGER_WRITE_FAILED] line on ledger-insert failure
        // instead of a bare 500, and — when recordInSeazona is set — the one
        // account-level Seazona write. transactionId keeps its OFFLINE-<id>
        // sentinel shape (nothing else parses beyond the prefix — see
        // lib/payment-summary.js's OFFLINE_PREFIX).
        const transactionId = `OFFLINE-${createId()}`;
        const { seazonaPaymentId, ledgerWriteFailed } = await recordPaymentAndAllocations({
          user: doctorUser,
          amount: amt,
          transactionId,
          allocations: [{ invoiceId, invoiceNumber: resolvedInvoiceNumber, amount: amt }],
          source: "admin_offline",
          // Default false — staff have typically already entered this payment
          // directly in Seazona; writing again would double-credit the client.
          writeToSeazona: recordInSeazona === true,
          // Not a card charge — the receipt email must say so.
          wasCharged: false,
          // The shared component's default audit action is "payment.charge";
          // an offline record must not be logged as one (the admin UI already
          // renders this exact action as "Offline payment recorded"). The actor
          // is the admin who recorded it, not the doctor the payment credits.
          auditAction: "payment.offline_recorded",
          actorUserId: request.user.id,
        });
        return { transactionId, seazonaPaymentId, ledgerWriteFailed };
      });
    } catch (err) {
      if (err?.capExceeded) {
        return reply.code(422).send({
          error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message },
        });
      }
      if (err instanceof InvoiceLockedError) {
        return reply.code(409).send({
          error: {
            ...ERROR_CODES.VALIDATION_ERROR,
            message: "This invoice is being paid right now. Try again in a moment.",
          },
        });
      }
      throw err;
    }

    request.log.info(
      { invoiceId, seazonaClientId, ledgerUserId, amount: amt, recordInSeazona: recordInSeazona === true },
      "admin recorded offline payment in portal ledger"
    );

    return {
      data: {
        invoiceId,
        amount: amt,
        recorded: true,
        userId: ledgerUserId,
        transactionId: recorded.transactionId,
        seazonaPaymentId: recorded.seazonaPaymentId,
        ...(recorded.ledgerWriteFailed ? { ledgerWriteFailed: true } : {}),
      },
    };
  });
}
