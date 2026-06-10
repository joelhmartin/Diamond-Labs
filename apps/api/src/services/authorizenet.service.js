import { env } from "../config/env.js";

/**
 * Authorize.net service using the JSON API directly.
 * All card data is tokenized on the frontend via Accept.js — the backend
 * only receives opaque nonces (dataDescriptor + dataValue).
 */

// `mode` is "sandbox" | "production". When omitted it falls back to the
// global AUTHORIZE_NET_ENV. The test payment flow forces a mode explicitly so
// sandbox testing never depends on flipping the global env.
function resolveMode(mode) {
  if (mode === "sandbox" || mode === "production") return mode;
  return env.AUTHORIZE_NET_ENV === "production" ? "production" : "sandbox";
}

function apiUrl(mode) {
  return resolveMode(mode) === "production"
    ? "https://api.authorize.net/xml/v1/request.api"
    : "https://apitest.authorize.net/xml/v1/request.api";
}

/** The Accept Hosted form-POST endpoint (different host from the API). */
export function hostedFormUrl(mode) {
  return resolveMode(mode) === "production"
    ? "https://accept.authorize.net/payment/payment"
    : "https://test.authorize.net/payment/payment";
}

/** The Accept Hosted Customer profile page for adding a payment method. */
export function hostedAddCardUrl(mode) {
  return resolveMode(mode) === "production"
    ? "https://accept.authorize.net/customer/addPayment"
    : "https://test.authorize.net/customer/addPayment";
}

function merchantAuth(mode) {
  return resolveMode(mode) === "production"
    ? { name: env.AUTHORIZE_NET_API_LOGIN, transactionKey: env.AUTHORIZE_NET_TRANSACTION_KEY }
    : { name: env.AUTHORIZE_NET_SANDBOX_API_LOGIN, transactionKey: env.AUTHORIZE_NET_SANDBOX_TRANSACTION_KEY };
}

async function apiRequest(payload, mode) {
  const auth = merchantAuth(mode);
  if (!auth.name || !auth.transactionKey) {
    console.warn(`[Authorize.net] ${resolveMode(mode)} API credentials not configured`);
    return null;
  }

  const res = await fetch(apiUrl(mode), {
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
 *
 * Optional `billTo`/`shipTo` enable AVS (address verification). They are plain
 * objects shaped like Authorize.net's nameAndAddressType
 * ({ firstName, lastName, company, address, city, state, zip, country } — billTo
 * may also carry `phoneNumber`). AVS scores the billTo street address + zip.
 *
 * IMPORTANT: Authorize.net JSON is field-ORDER-SENSITIVE. Per the
 * createTransactionRequest schema, transactionRequest fields must appear in
 * order: transactionType, amount, payment, …, order, …, customer, billTo,
 * shipTo. We build the object by inserting keys in that order (JS preserves
 * string-key insertion order), so `billTo`/`shipTo` land AFTER `order`. When
 * absent (e.g. doctor invoice charges) the request is byte-for-byte unchanged.
 */
export async function chargeWithNonce({ amount, opaqueData, description, invoiceNumber, billTo, shipTo }) {
  const transactionRequest = {
    transactionType: "authCaptureTransaction",
    amount: String(amount),
    payment: {
      opaqueData: {
        dataDescriptor: opaqueData.dataDescriptor,
        dataValue: opaqueData.dataValue,
      },
    },
  };
  if (invoiceNumber) transactionRequest.order = { invoiceNumber, description };
  // billTo/shipTo intentionally added after `order` to honor field order.
  if (billTo) transactionRequest.billTo = billTo;
  if (shipTo) transactionRequest.shipTo = shipTo;

  const data = await apiRequest({
    createTransactionRequest: {
      merchantAuthentication: merchantAuth(),
      transactionRequest,
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

/**
 * Accept Hosted: get a one-time form token for the hosted payment page. The
 * amount is baked into the token server-side so it can't be tampered with in
 * the browser. The card data is entered on Authorize.net's hosted iframe — it
 * never touches our DOM (SAQ A). Returns { token, formUrl }.
 *
 * Optional save-card mode: pass `customerProfileId` + `allowSaveCard: true` to
 * link the transaction to a CIM profile and show the "save card" checkbox on
 * the hosted form (hostedPaymentCustomerOptions.addPaymentProfile). The
 * `profile.customerProfileId` is added to `transactionRequest` so Authorize.net
 * stores any saved card under that profile. Existing behavior is unchanged when
 * these params are absent.
 */
export async function getHostedPaymentPageToken(
  { amount, invoiceNumber, description, refId, iframeCommunicatorUrl, customerProfileId, allowSaveCard },
  mode
) {
  const saveCard = Boolean(allowSaveCard && customerProfileId);

  const setting = [
    { settingName: "hostedPaymentReturnOptions", settingValue: JSON.stringify({ showReceipt: false }) },
    { settingName: "hostedPaymentButtonOptions", settingValue: JSON.stringify({ text: "Pay" }) },
    { settingName: "hostedPaymentPaymentOptions", settingValue: JSON.stringify({ cardCodeRequired: true, showCreditCard: true, showBankAccount: false }) },
    { settingName: "hostedPaymentSecurityOptions", settingValue: JSON.stringify({ captcha: false }) },
    { settingName: "hostedPaymentBillingAddressOptions", settingValue: JSON.stringify({ show: true, required: false }) },
    {
      settingName: "hostedPaymentCustomerOptions",
      settingValue: JSON.stringify({ showEmail: false, requiredEmail: false, ...(saveCard ? { addPaymentProfile: true } : {}) }),
    },
    { settingName: "hostedPaymentOrderOptions", settingValue: JSON.stringify({ show: true, merchantName: "Diamond Orthotic Lab" }) },
  ];
  if (iframeCommunicatorUrl) {
    setting.push({
      settingName: "hostedPaymentIFrameCommunicatorUrl",
      settingValue: JSON.stringify({ url: iframeCommunicatorUrl }),
    });
  }

  const data = await apiRequest({
    getHostedPaymentPageRequest: {
      merchantAuthentication: merchantAuth(mode),
      refId: refId ? String(refId).slice(0, 20) : undefined,
      transactionRequest: {
        transactionType: "authCaptureTransaction",
        amount: String(amount),
        // profile links the transaction to an existing CIM record so Authorize.net
        // can attach any newly saved payment profile to that customer.
        ...(saveCard ? { profile: { customerProfileId } } : {}),
        order: invoiceNumber
          ? { invoiceNumber: String(invoiceNumber).slice(0, 20), description: description?.slice(0, 255) }
          : undefined,
      },
      hostedPaymentSettings: { setting },
    },
  }, mode);

  return { token: data?.token || null, formUrl: hostedFormUrl(mode) };
}

/**
 * Accept Hosted Customer Profile: get a one-time token for the hosted
 * add-payment-method page (getHostedProfilePageRequest). The customer enters
 * their card on Authorize.net's domain — card data never touches our DOM (SAQ A).
 * Returns { token, addCardUrl }. The iframe is pointed at addCardUrl; the token
 * is submitted as a form-POST body to authenticate the hosted session (production
 * vs sandbox mirrors the API credentials in use).
 */
export async function getHostedAddCardToken({ customerProfileId, iframeCommunicatorUrl }, mode) {
  if (!customerProfileId) {
    throw new Error("[Authorize.net] customerProfileId is required for getHostedAddCardToken");
  }

  const setting = [
    {
      settingName: "hostedProfileValidationMode",
      settingValue: resolveMode(mode) === "production" ? "liveMode" : "testMode",
    },
  ];
  if (iframeCommunicatorUrl) {
    setting.push({
      settingName: "hostedProfileIFrameCommunicatorUrl",
      settingValue: JSON.stringify({ url: iframeCommunicatorUrl }),
    });
  }

  const data = await apiRequest({
    getHostedProfilePageRequest: {
      merchantAuthentication: merchantAuth(mode),
      customerProfileId,
      hostedProfileSettings: { setting },
    },
  }, mode);

  return { token: data?.token || null, addCardUrl: hostedAddCardUrl(mode) };
}

/**
 * Update a saved payment profile — typically to renew the expiration date.
 * To preserve the stored PAN, pass the masked cardNumber exactly as returned
 * by listPaymentProfiles (e.g., "XXXX1234"). validationMode is "none" because
 * a masked card number cannot be submitted to the live gateway for re-validation.
 * billTo is optional; include it to update billing address alongside the card.
 */
export async function updateCustomerPaymentProfile({ customerProfileId, paymentProfileId, cardNumber, expirationDate, billTo }) {
  const missing = [
    !customerProfileId && "customerProfileId",
    !paymentProfileId && "paymentProfileId",
    !cardNumber && "cardNumber",
    !expirationDate && "expirationDate",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`[Authorize.net] updateCustomerPaymentProfile: required fields missing: ${missing.join(", ")}`);
  }

  const paymentProfile = {
    customerPaymentProfileId: paymentProfileId,
    payment: {
      creditCard: {
        cardNumber,
        expirationDate,
      },
    },
  };
  if (billTo) paymentProfile.billTo = billTo;

  await apiRequest({
    updateCustomerPaymentProfileRequest: {
      merchantAuthentication: merchantAuth(),
      customerProfileId,
      paymentProfile,
      validationMode: "none",
    },
  });
}

/**
 * Look up a transaction by id — used to verify, server-side, the amount and
 * status that Authorize.net actually captured before we record anything.
 */
export async function getTransactionDetails(transId, mode) {
  const data = await apiRequest({
    getTransactionDetailsRequest: {
      merchantAuthentication: merchantAuth(mode),
      transId: String(transId),
    },
  }, mode);

  const t = data?.transaction;
  if (!t) return null;
  return {
    transId: t.transId,
    amount: Number(t.authAmount ?? t.settleAmount ?? 0),
    responseCode: t.responseCode,
    status: t.transactionStatus,
  };
}
