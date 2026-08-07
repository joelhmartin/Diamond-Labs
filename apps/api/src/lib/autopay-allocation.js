/** Round to cents consistently (avoids FP drift). */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * How much this cycle actually charges.
 *
 * The payoff rule: AUTOPAY_MIN_AMOUNT governs what a doctor may ENROLL at, not
 * what the final payment may be. If the outstanding balance is less than the
 * enrolled amount — even less than the floor — we charge the balance and close
 * the account out rather than stranding money that can never be collected.
 */
export function resolveChargeAmount({ enrolledAmount, totalBalance }) {
  const balance = round2(totalBalance);
  if (!(balance > 0)) return 0;
  return round2(Math.min(round2(enrolledAmount), balance));
}

/**
 * Spread `chargeAmount` across open invoices, oldest first, spilling into the
 * next once one is filled. Standard AR convention, and the same ordering the
 * doctor-facing pay modal already uses.
 *
 * @param {Array<{id: string, invoiceNumber?: string|number, balance: number, dueDate?: string}>} invoices
 * @param {number} chargeAmount
 * @returns {{allocations: Array<{invoiceId: string, invoiceNumber: string|null, amount: number}>, totalAllocated: number}}
 */
export function allocateOldestFirst(invoices, chargeAmount) {
  let remaining = round2(chargeAmount);
  if (!(remaining > 0)) return { allocations: [], totalAllocated: 0 };

  const ordered = [...(invoices || [])]
    .filter((i) => round2(i.balance) > 0)
    .sort((a, b) => {
      const da = a.dueDate ? String(a.dueDate) : "";
      const db = b.dueDate ? String(b.dueDate) : "";
      if (da !== db) return da < db ? -1 : 1;
      // Deterministic tiebreak so a run is reproducible.
      return String(a.invoiceNumber ?? a.id) < String(b.invoiceNumber ?? b.id) ? -1 : 1;
    });

  const allocations = [];
  for (const invoice of ordered) {
    if (remaining <= 0) break;
    const amount = round2(Math.min(round2(invoice.balance), remaining));
    if (amount <= 0) continue;
    allocations.push({
      invoiceId: String(invoice.id),
      invoiceNumber: invoice.invoiceNumber != null ? String(invoice.invoiceNumber) : null,
      amount,
    });
    remaining = round2(remaining - amount);
  }

  const totalAllocated = round2(allocations.reduce((sum, a) => sum + a.amount, 0));
  return { allocations, totalAllocated };
}
