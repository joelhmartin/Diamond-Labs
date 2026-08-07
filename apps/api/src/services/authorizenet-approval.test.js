import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";
// Sandbox creds must be present or apiRequest short-circuits to null.
process.env.AUTHORIZE_NET_SANDBOX_API_LOGIN ||= "test-login";
process.env.AUTHORIZE_NET_SANDBOX_TRANSACTION_KEY ||= "test-key";

const { chargeWithNonce, chargeCustomerProfile } = await import("./authorizenet.service.js");

/** Build a fetch stub returning an Authorize.net envelope, BOM and all. */
function mockGatewayResponse(body) {
  return vi.fn().mockResolvedValue({
    text: async () => "﻿" + JSON.stringify(body),
  });
}

/** An envelope that says "Ok" while the transaction itself was NOT captured. */
function envelope(responseCode, extra = {}) {
  return {
    messages: { resultCode: "Ok", message: [{ text: "Successful." }] },
    transactionResponse: {
      responseCode: String(responseCode),
      transId: "60000000001",
      authCode: "ABC123",
      ...extra,
    },
  };
}

/**
 * Regression guard: a charge is only a charge when responseCode is "1".
 *
 * Authorize.net returns envelope resultCode "Ok" for transactions that were
 * declined (2), errored (3), or HELD FOR REVIEW by the Fraud Detection Suite
 * (4) — none of which captured funds. Returning those as success credits the
 * local ledger, writes a payment to Seazona, and emails a receipt for money
 * that never moved. This matters most for unattended AutoPay runs.
 */
describe("charge approval enforcement", () => {
  beforeEach(() => {
    vi.stubEnv("AUTHORIZE_NET_ENV", "sandbox");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  for (const [code, label] of [
    ["2", "declined"],
    ["3", "error"],
    ["4", "held for review by FDS"],
  ]) {
    it(`chargeWithNonce throws when the transaction is ${label} (responseCode ${code})`, async () => {
      vi.stubGlobal("fetch", mockGatewayResponse(envelope(code)));

      await expect(
        chargeWithNonce({
          amount: 100,
          opaqueData: { dataDescriptor: "d", dataValue: "v" },
        })
      ).rejects.toThrow(/not approved/i);
    });

    it(`chargeCustomerProfile throws when the transaction is ${label} (responseCode ${code})`, async () => {
      vi.stubGlobal("fetch", mockGatewayResponse(envelope(code)));

      await expect(
        chargeCustomerProfile({
          customerProfileId: "cp_1",
          paymentProfileId: "pp_1",
          amount: 100,
        })
      ).rejects.toThrow(/not approved/i);
    });
  }

  it("attaches the gateway response so the route maps it to a 402, not a 502", async () => {
    vi.stubGlobal("fetch", mockGatewayResponse(envelope("2")));

    await expect(
      chargeCustomerProfile({ customerProfileId: "cp_1", paymentProfileId: "pp_1", amount: 100 })
    ).rejects.toMatchObject({ authNetResponse: expect.objectContaining({ messages: expect.anything() }) });
  });

  it("still returns the transaction on an approved charge (responseCode 1)", async () => {
    vi.stubGlobal("fetch", mockGatewayResponse(envelope("1")));

    await expect(
      chargeCustomerProfile({ customerProfileId: "cp_1", paymentProfileId: "pp_1", amount: 100 })
    ).resolves.toEqual({
      transactionId: "60000000001",
      responseCode: "1",
      authCode: "ABC123",
    });
  });
});
