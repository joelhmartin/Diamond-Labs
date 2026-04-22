import { env } from "../config/env.js";

/**
 * Authorize.net service using the JSON API directly.
 * All card data is tokenized on the frontend via Accept.js — the backend
 * only receives opaque nonces (dataDescriptor + dataValue).
 */

const API_URL = env.AUTHORIZE_NET_ENV === "production"
  ? "https://api.authorize.net/xml/v1/request.api"
  : "https://apitest.authorize.net/xml/v1/request.api";

function merchantAuth() {
  return {
    name: env.AUTHORIZE_NET_API_LOGIN,
    transactionKey: env.AUTHORIZE_NET_TRANSACTION_KEY,
  };
}

async function apiRequest(payload) {
  if (!env.AUTHORIZE_NET_API_LOGIN || !env.AUTHORIZE_NET_TRANSACTION_KEY) {
    console.warn("[Authorize.net] API credentials not configured");
    return null;
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Authorize.net returns a BOM character — strip it
  const text = await res.text();
  const cleaned = text.replace(/^\uFEFF/, "");
  const data = JSON.parse(cleaned);

  if (data.messages?.resultCode !== "Ok") {
    const msg = data.messages?.message?.[0]?.text || "Unknown error";
    const err = new Error(`[Authorize.net] ${msg}`);
    err.authNetResponse = data;
    throw err;
  }

  return data;
}

/**
 * Charge using an Accept.js opaque nonce (one-time payment).
 */
export async function chargeWithNonce({ amount, opaqueData, description, invoiceNumber }) {
  const data = await apiRequest({
    createTransactionRequest: {
      merchantAuthentication: merchantAuth(),
      transactionRequest: {
        transactionType: "authCaptureTransaction",
        amount: String(amount),
        payment: {
          opaqueData: {
            dataDescriptor: opaqueData.dataDescriptor,
            dataValue: opaqueData.dataValue,
          },
        },
        order: invoiceNumber ? { invoiceNumber, description } : undefined,
      },
    },
  });

  return {
    transactionId: data.transactionResponse?.transId,
    responseCode: data.transactionResponse?.responseCode,
    authCode: data.transactionResponse?.authCode,
  };
}

/**
 * Create a CIM customer profile.
 */
export async function createCustomerProfile({ email, description }) {
  const data = await apiRequest({
    createCustomerProfileRequest: {
      merchantAuthentication: merchantAuth(),
      profile: {
        email,
        description: description || email,
      },
    },
  });

  return data.customerProfileId;
}

/**
 * Add a payment profile to a customer using an Accept.js nonce.
 */
export async function addPaymentProfileFromNonce({ customerProfileId, opaqueData }) {
  const data = await apiRequest({
    createCustomerPaymentProfileRequest: {
      merchantAuthentication: merchantAuth(),
      customerProfileId,
      paymentProfile: {
        payment: {
          opaqueData: {
            dataDescriptor: opaqueData.dataDescriptor,
            dataValue: opaqueData.dataValue,
          },
        },
      },
      validationMode: env.AUTHORIZE_NET_ENV === "production" ? "liveMode" : "testMode",
    },
  });

  return data.customerPaymentProfileId;
}

/**
 * List saved payment profiles for a customer.
 */
export async function listPaymentProfiles(customerProfileId) {
  if (!customerProfileId) return [];

  const data = await apiRequest({
    getCustomerProfileRequest: {
      merchantAuthentication: merchantAuth(),
      customerProfileId,
      includeIssuerInfo: "true",
    },
  });

  const profiles = data.profile?.paymentProfiles || [];
  return profiles.map((p) => ({
    paymentProfileId: p.customerPaymentProfileId,
    cardNumber: p.payment?.creditCard?.cardNumber, // masked, e.g., XXXX1234
    cardType: p.payment?.creditCard?.cardType,
    expirationDate: p.payment?.creditCard?.expirationDate,
  }));
}

/**
 * Charge a saved payment profile.
 */
export async function chargeCustomerProfile({ customerProfileId, paymentProfileId, amount, invoiceNumber }) {
  const data = await apiRequest({
    createTransactionRequest: {
      merchantAuthentication: merchantAuth(),
      transactionRequest: {
        transactionType: "authCaptureTransaction",
        amount: String(amount),
        profile: {
          customerProfileId,
          paymentProfile: { paymentProfileId },
        },
        order: invoiceNumber ? { invoiceNumber } : undefined,
      },
    },
  });

  return {
    transactionId: data.transactionResponse?.transId,
    responseCode: data.transactionResponse?.responseCode,
    authCode: data.transactionResponse?.authCode,
  };
}

/**
 * Delete a saved payment profile.
 */
export async function deletePaymentProfile({ customerProfileId, paymentProfileId }) {
  await apiRequest({
    deleteCustomerPaymentProfileRequest: {
      merchantAuthentication: merchantAuth(),
      customerProfileId,
      customerPaymentProfileId: paymentProfileId,
    },
  });
}
