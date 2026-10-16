import { useMemo, useState } from "react";
import { allocateOldestFirst, sortOldestFirst, parseMoneyInput, toDecimalString } from "@my-app/shared";
import { typedCents } from "../lib/invoices.js";

/**
 * Oldest-due-first allocation of one payment across a fixed set of invoices,
 * in integer cents. It uses the same allocateOldestFirst the server uses for
 * AutoPay and manual payments, so the split a person previews is the split
 * that gets recorded. Shared by the doctor's PaymentModal and the admin
 * DoctorPaymentDrawer.
 *
 * `invoices` ([{ id, invoiceNumber, balanceCents, dueDate }]) must be STABLE
 * for the component's lifetime: the allocation is seeded once. Mount the
 * component after the list has loaded, or key it on the list; re-seeding on
 * every render would throw away in-progress edits.
 */
export function useInvoiceAllocation(invoices) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ordered = useMemo(() => sortOldestFirst(invoices), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const totalBalanceCents = useMemo(() => invoices.reduce((s, i) => s + i.balanceCents, 0), []);
  const spread = (cents) =>
    Object.fromEntries(allocateOldestFirst(invoices, cents).allocations.map((a) => [a.invoiceId, a.amountCents]));

  const [alloc, setAlloc] = useState(() => spread(totalBalanceCents));
  const [targetStr, setTargetStr] = useState(() => toDecimalString(totalBalanceCents));

  const handleTargetChange = (val) => {
    setTargetStr(val);
    const cents = parseMoneyInput(String(val ?? "").replace(/\.$/, ""));
    if (Number.isSafeInteger(cents) && cents >= 0) setAlloc(spread(cents));
  };

  const setRow = (inv, val) => {
    const cents = Math.min(typedCents(val), inv.balanceCents);
    setAlloc((prev) => {
      const next = { ...prev, [inv.id]: cents };
      setTargetStr(toDecimalString(Object.values(next).reduce((s, v) => s + (v || 0), 0)));
      return next;
    });
  };

  const payTotalCents = Object.values(alloc).reduce((s, v) => s + (v || 0), 0);
  const allocations = ordered
    .filter((inv) => (alloc[inv.id] ?? 0) > 0)
    .map((inv) => ({ invoiceId: inv.id, amountCents: alloc[inv.id] }));

  return {
    ordered, alloc, targetStr, totalBalanceCents, handleTargetChange, setRow, payTotalCents, allocations,
    canPay: payTotalCents > 0 && allocations.length > 0,
  };
}
