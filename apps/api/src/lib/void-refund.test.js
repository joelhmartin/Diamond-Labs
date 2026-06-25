import { describe, it, expect, vi, beforeEach } from "vitest";

// Replace the Authorize.net service entirely so the decision logic is tested in
// isolation (no env config, no network).
vi.mock("../services/authorizenet.service.js", () => ({
  getTransactionDetails: vi.fn(),
  voidTransaction: vi.fn(),
  refundTransaction: vi.fn(),
}));

import {
  getTransactionDetails,
  voidTransaction,
  refundTransaction,
} from "../services/authorizenet.service.js";
import { voidOrRefund } from "./void-refund.js";

const baseDetails = {
  transId: "1234567890",
  amount: 100,
  responseCode: "1",
  cardLast4: "1111",
  expirationDate: "XXXX",
};

beforeEach(() => {
  vi.clearAllMocks();
  voidTransaction.mockResolvedValue({ transactionId: "1234567890", responseCode: "1" });
  refundTransaction.mockResolvedValue({ transactionId: "9999999999", responseCode: "1" });
});

describe("voidOrRefund — status → action decision", () => {
  it("VOIDs an authorizedPendingCapture transaction (full, amount ignored)", async () => {
    getTransactionDetails.mockResolvedValue({ ...baseDetails, transactionStatus: "authorizedPendingCapture" });
    const out = await voidOrRefund("1234567890", 25);
    expect(out.action).toBe("void");
    expect(out.amount).toBe(100); // full — the partial amount is not honored
    expect(voidTransaction).toHaveBeenCalledOnce();
    expect(refundTransaction).not.toHaveBeenCalled();
  });

  it("VOIDs a capturedPendingSettlement transaction", async () => {
    getTransactionDetails.mockResolvedValue({ ...baseDetails, transactionStatus: "capturedPendingSettlement" });
    const out = await voidOrRefund("1234567890");
    expect(out.action).toBe("void");
    expect(voidTransaction).toHaveBeenCalledOnce();
  });

  it("REFUNDs a settledSuccessfully transaction for the full captured amount", async () => {
    getTransactionDetails.mockResolvedValue({ ...baseDetails, transactionStatus: "settledSuccessfully" });
    const out = await voidOrRefund("1234567890");
    expect(out.action).toBe("refund");
    expect(out.amount).toBe(100);
    expect(out.transactionId).toBe("9999999999");
    expect(refundTransaction).toHaveBeenCalledWith({
      transId: "1234567890",
      amount: 100,
      cardLast4: "1111",
      expirationDate: "XXXX",
    });
    expect(voidTransaction).not.toHaveBeenCalled();
  });

  it("REFUNDs a settled transaction for a partial amount when given", async () => {
    getTransactionDetails.mockResolvedValue({ ...baseDetails, transactionStatus: "settledSuccessfully" });
    const out = await voidOrRefund("1234567890", 40);
    expect(out.action).toBe("refund");
    expect(out.amount).toBe(40);
    expect(refundTransaction).toHaveBeenCalledWith(expect.objectContaining({ amount: 40 }));
  });

  it("throws a not_found error when the transaction is missing", async () => {
    getTransactionDetails.mockResolvedValue(null);
    await expect(voidOrRefund("nope")).rejects.toMatchObject({ refundErrorKind: "not_found" });
    expect(voidTransaction).not.toHaveBeenCalled();
    expect(refundTransaction).not.toHaveBeenCalled();
  });

  it.each(["declined", "voided", "refundSettledSuccessfully", "FDSPendingReview", ""])(
    "throws a validation error for non-reversible status %s",
    async (status) => {
      getTransactionDetails.mockResolvedValue({ ...baseDetails, transactionStatus: status });
      await expect(voidOrRefund("1234567890")).rejects.toMatchObject({ refundErrorKind: "validation" });
      expect(voidTransaction).not.toHaveBeenCalled();
      expect(refundTransaction).not.toHaveBeenCalled();
    }
  );
});
