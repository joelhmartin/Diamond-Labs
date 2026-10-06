import { useMemo, useState } from "react";

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Use portalBalance (partial-payment-aware) when present; fall back to gross total for safety.
export const balanceOf = (inv) => round2(inv.portalBalance != null ? inv.portalBalance : (parseFloat(inv.total) || 0));
export const idOf = (inv) => inv.id || inv.invoiceId;

/**
 * Oldest-due-first FIFO auto-allocation across a fixed set of invoices.
 *
 * Extracted from PaymentModal.jsx (doctor self-serve charge) so the admin
 * DoctorPaymentDrawer can charge a card on a doctor's behalf using the exact
 * same allocation math — this is money arithmetic, so it must not have two
 * places to diverge.
 *
 * `invoices` is expected to be STABLE for the lifetime of the component that
 * calls this hook (the initial allocation is seeded once via a useState
 * initializer, matching the original PaymentModal behavior). Callers whose
 * invoice list loads asynchronously should only mount the component that
 * calls this hook once the list is ready (e.g. gate rendering on a loading
 * flag, or `key` the subtree on the invoice set) rather than expecting this
 * hook to react to a changing `invoices` reference — re-running the FIFO
 * seed on every parent re-render would silently discard in-progress edits.
 */
export function useInvoiceAllocation(invoices) {
  // Oldest-due-first ordering drives FIFO auto-allocation.
  const ordered = useMemo(
    () => [...invoices].sort((a, b) => new Date(a.due || 0) - new Date(b.due || 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // alloc: { [invoiceId]: appliedAmount } — the source of truth for the charge.
  const [alloc, setAlloc] = useState(() =>
    Object.fromEntries(invoices.map((inv) => [idOf(inv), balanceOf(inv)]))
  );
  const totalBalance = useMemo(
    () => round2(invoices.reduce((s, inv) => s + balanceOf(inv), 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [targetStr, setTargetStr] = useState(String(totalBalance.toFixed(2)));

  // Distribute `target` across invoices oldest-first, capped at each balance.
  const autoAllocate = (target) => {
    let remaining = round2(Math.max(0, target));
    const next = {};
    for (const inv of ordered) {
      const bal = balanceOf(inv);
      const apply = round2(Math.min(bal, remaining));
      next[idOf(inv)] = apply;
      remaining = round2(remaining - apply);
    }
    setAlloc(next);
  };

  const handleTargetChange = (val) => {
    setTargetStr(val);
    const n = parseFloat(val);
    if (!Number.isNaN(n)) autoAllocate(n);
  };

  const setRow = (inv, val) => {
    const bal = balanceOf(inv);
    let n = parseFloat(val);
    if (Number.isNaN(n) || n < 0) n = 0;
    if (n > bal) n = bal;
    setAlloc((prev) => {
      const next = { ...prev, [idOf(inv)]: round2(n) };
      setTargetStr(
        String(round2(Object.values(next).reduce((s, v) => s + (v || 0), 0)).toFixed(2))
      );
      return next;
    });
  };

  const payTotal = round2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));

  const allocations = invoices
    .filter((inv) => (Number(alloc[idOf(inv)]) || 0) > 0)
    .map((inv) => ({
      invoiceId: idOf(inv),
      invoiceNumber: inv.invoiceNumber,
      amount: round2(alloc[idOf(inv)]),
    }));

  const canPay = payTotal > 0 && allocations.length > 0;

  return {
    ordered,
    alloc,
    targetStr,
    totalBalance,
    handleTargetChange,
    setRow,
    payTotal,
    allocations,
    canPay,
  };
}
