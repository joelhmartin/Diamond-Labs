/**
 * Splitting money across a client's open invoices, in integer cents. One
 * implementation for AutoPay, staff-recorded manual payments (API) and the
 * pay screens' preview (web), so what a person sees is what gets recorded.
 */

/**
 * How much an AutoPay cycle charges. The payoff rule: AUTOPAY_MIN_AMOUNT
 * governs what a doctor may ENROLL at, not what the final payment may be. If
 * the balance is less than the enrolled amount, charge the balance and close
 * the account out. A money function clamps its own inputs: anything that isn't
 * positive integer cents charges nothing.
 */
export function resolveChargeCents({ enrolledCents, totalBalanceCents }) {
  if (!Number.isSafeInteger(totalBalanceCents) || totalBalanceCents <= 0) return 0;
  if (!Number.isSafeInteger(enrolledCents) || enrolledCents <= 0) return 0;
  return Math.min(enrolledCents, totalBalanceCents);
}

const byNumberOrId = (a, b) => {
  const na = a.invoiceNumber ?? a.id;
  const nb = b.invoiceNumber ?? b.id;
  if (typeof na === "number" && typeof nb === "number") return na - nb;
  const sa = String(na);
  const sb = String(nb);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

/**
 * Oldest due first. A missing due date sorts LAST: "no date recorded" is not
 * "most overdue" (a live dry run once paid two undated invoices ahead of a
 * genuinely overdue 2024 one, which got only the remainder). Ties fall back
 * to the invoice number.
 */
export function sortOldestFirst(invoices) {
  return [...(invoices || [])].sort((a, b) => {
    const da = a.dueDate ? String(a.dueDate) : null;
    const db = b.dueDate ? String(b.dueDate) : null;
    if (da === null && db !== null) return 1;
    if (db === null && da !== null) return -1;
    if (da !== null && db !== null && da !== db) return da < db ? -1 : 1;
    return byNumberOrId(a, b);
  });
}

/**
 * Spread `chargeCents` across open invoices, oldest due first
 * (sortOldestFirst), spilling into the next once one is filled.
 *
 * @param {Array<{ id: string, invoiceNumber?: number|string, balanceCents: number, dueDate?: string|null }>} invoices
 * @returns {{ allocations: Array<{ invoiceId: string, invoiceNumber: string|null, amountCents: number }>, totalAllocatedCents: number }}
 */
export function allocateOldestFirst(invoices, chargeCents) {
  if (!Number.isSafeInteger(chargeCents) || chargeCents <= 0) return { allocations: [], totalAllocatedCents: 0 };
  const ordered = sortOldestFirst((invoices || []).filter((i) => Number.isSafeInteger(i.balanceCents) && i.balanceCents > 0));

  let remaining = chargeCents;
  const allocations = [];
  for (const invoice of ordered) {
    if (remaining <= 0) break;
    const amountCents = Math.min(invoice.balanceCents, remaining);
    allocations.push({
      invoiceId: String(invoice.id),
      invoiceNumber: invoice.invoiceNumber != null ? String(invoice.invoiceNumber) : null,
      amountCents,
    });
    remaining -= amountCents;
  }
  return { allocations, totalAllocatedCents: chargeCents - remaining };
}
