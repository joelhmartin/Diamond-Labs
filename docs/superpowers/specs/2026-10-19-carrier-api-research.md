# UPS + FedEx REST carrier APIs — reference (researched 2026-10-19)

Legend: [V] verified from an official source (cited). [3P] third-party only. [MEM] my recollection, NOT verified. [?] could not verify.

Source caveat: developer.ups.com is a JS SPA and timed out / returned empty to fetches. UPS facts below come from UPS's own OpenAPI
specs on GitHub (https://github.com/UPS-API/api-documentation, raw files Shipping.yaml, Rating.yaml, AddressValidation.yaml, Tracking.yaml,
UPSTrackAlert.yaml, OAuthClientCredentials.yaml) — official, but `info.version` is blank so I can't date them.
developer.fedex.com guide pages fetch fine, but its API *reference* (paths/schemas) is JS-rendered, so FedEx paths/fields are partly [3P]/[MEM].

## 1. Auth

| | UPS | FedEx |
|---|---|---|
| Flow | OAuth2 client_credentials [V] (also an auth-code flow for acting on others' accounts) | OAuth2 client_credentials [V] (`grant_type=csp_credentials` / `client_pc_credentials` variants for integrators/parent-child) |
| Token URL (prod) | `POST https://onlinetools.ups.com/security/v1/oauth/token` [V] | `POST https://apis.fedex.com/oauth/token` [V path, 3P host] |
| Token URL (test) | `POST https://wwwcie.ups.com/security/v1/oauth/token` [V] | `POST https://apis-sandbox.fedex.com/oauth/token` [3P] |
| Token request | HTTP Basic (client_id:secret), body `application/x-www-form-urlencoded` `grant_type=client_credentials`. Optional header `x-merchant-id` = 6-digit UPS account number [V] | Body form-encoded `grant_type=client_credentials&client_id=<API key>&client_secret=<secret>` [V] |
| Lifetime | Spec returns `expires_in` (string). UPS notice: lifespan changes 4h -> 1h on 2026-04-01 (notice updated 2025-12-03); read `expires_in`, never hardcode [3P: https://www.pitneybowes.com/us/support/article/000097963/ups-oauth-token-lifespan-change.html]. "~250 token requests/day" is a blog claim, unverified | 3600 s (1 h) [V: https://developer.fedex.com/api/en-us/catalog/authorization/v1/docs.html, https://developer.fedex.com/api/en-us/guides/ratelimits.html] |
| Request headers on API calls | `Authorization: Bearer`; optional `transId` (unique per request, len 32) and `transactionSrc` (client app name, len 512, spec default "testing") [V Shipping.yaml] | `Authorization: Bearer`; `Content-Type: application/json`; `x-customer-transaction-id`, `x-locale` optional [MEM — not on any page I could read] |
| Shipper account number per request? | Yes: `Shipment.Shipper.ShipperNumber` (required) and `PaymentInformation.ShipmentCharge.BillShipper.AccountNumber` [V]. Token itself is not account-bound (x-merchant-id optional) | Yes: `accountNumber.value` in Ship/Rate/Cancel (required per FedEx docs: "Account number" is a required Create Shipment input) [V https://developer.fedex.com/api/en-us/catalog/ship/docs.html] |

FedEx token-endpoint throttle (per public IP): 3 hits/s over 5 s burst, 1 hit/s average over 2 min; violation = 10-minute 403 penalty. Cache the token. [V ratelimits guide]

## 2. Base URLs

| | Test | Production |
|---|---|---|
| UPS | `https://wwwcie.ups.com/api` (CIE) [V] | `https://onlinetools.ups.com/api` [V] |
| FedEx | `https://apis-sandbox.fedex.com` [3P] | `https://apis.fedex.com` [3P + FedEx community thread] |

## 3. Create shipment / label

| | UPS | FedEx |
|---|---|---|
| Endpoint | `POST /api/shipments/v2409/ship` (version path param; only valid value `v2409`; older `deprecatedVersion` path also exists) [V]. Optional query `additionaladdressvalidation=city` | `POST /ship/v1/shipments` [3P: https://jentic.com/apis/fedex.com/fedex.md]; plus `POST /ship/v1/shipments/validate` (dry run, single-piece, no street-address validation), `GET /ship/v1/shipments/async/{jobId}` (use async for >40 packages) [V names]. |
| Min request | `ShipmentRequest.Request{RequestOption: "nonvalidate"\|"validate", SubVersion}`; `Shipment{Shipper{Name, ShipperNumber, Address, Phone}, ShipTo{Name, Address, Phone}, ShipFrom (optional), PaymentInformation.ShipmentCharge{Type:"01", BillShipper.AccountNumber}, Service{Code}, Package{Packaging.Code ("02" customer pkg), PackageWeight{UnitOfMeasurement.Code LBS, Weight}, Dimensions (optional)}}`; `LabelSpecification{LabelImageFormat.Code, LabelStockSize{Height,Width}}` (schema marks both required) [V Shipping.yaml] | Required inputs: account number, pickup type, service type, packaging type, shipper + recipient, shipping payment type (+ payer info unless SENDER), per-package weights, label specification [V ship docs]. Exact JSON field names (`requestedShipment.*`, `labelSpecification`, `shippingChargesPayment.paymentType=SENDER`) [MEM]. Decimal L/W/H are truncated to integer for rating; avoid non-ASCII [V] |
| Label returns as | `ShipmentResponse.ShipmentResults.PackageResults[].ShippingLabel.GraphicImage` = base64 [V]; GIF additionally gets `HTMLImage`. Tracking: `ShipmentResults.ShipmentIdentificationNumber` (1Z of first pkg) + per-package `TrackingNumber` [V] | Response "provides the tracking number and label information" [V]; `output.transactionShipments[].pieceResponses[].packageDocuments[].encodedLabel` / `masterTrackingNumber` [MEM — field names unverified] |
| Formats | `LabelImageFormat.Code`: **GIF, ZPL, EPL, SPL** only [V]. **No PDF or PNG on /ship** (PNG shows in recovery sample; Label Recovery can return GIF or PDF) | `imageType`: **PDF, PNG** (laser), **ZPLII, EPL2** (thermal) [V https://developer.fedex.com/api/en-us/catalog/ship/docs.html]. `labelFormatType`: COMMON2D, LABEL_DATA_ONLY. 300 dpi thermal added 2024-07 (203 before) [V changelog] |
| Sizes | Thermal (ZPL/EPL/SPL): width 4, height 6 or 8; "image will only scale up to 4x6 even when requesting 4x8". GIF is a 4x6 label image (HTML wrapper). No 8.5x11 option documented [V] | `labelStockType`: PAPER_4X6, PAPER_4X8, PAPER_4X9, PAPER_4X675; plain paper PAPER_LETTER, PAPER_85X11_TOP_HALF_LABEL, PAPER_85X11_BOTTOM_HALF_LABEL, PAPER_7X47; thermal 4x6, 4x6.75, 4x8, 4x8.5, 4x9, 4x10.5, plus STOCK_4X85/4X105_TRAILING_DOC_TAB [V] |
| Charges | `ShipmentResults.ShipmentCharges` (published) and `NegotiatedRateCharges` (account rate) — latter returned only if request has `Shipment.ShipmentRatingOptions.NegotiatedRatesIndicator` ("X"/"") and the account is eligible [V] | Rate details in response; to include rates ask for them in the request [MEM]. Rate API distinguishes LIST vs ACCOUNT vs PREFERRED rate types [V rate docs] |

UPS return of "Package label too small to read": UPS GIF is browser-oriented; for a 4x6 thermal or PDF-print workflow plan on ZPL (thermal) or decode GIF -> your own PDF. FedEx can hand back PDF directly.

## 4. Void / cancel

| | UPS | FedEx |
|---|---|---|
| Endpoint | `DELETE /api/shipments/v2409/void/cancel/{shipmentidentificationnumber}` ; optional query `trackingnumber=["1Z..","1Z.."]` to void individual packages; header `shipperNumber` only for Roadie [V] | Cancel Shipment: inputs tracking number + account number, `emailReturnShipment` flag for email returns, `deletioncontrol` for package vs whole shipment [V]. Method/path: `PUT /ship/v1/shipments/cancel` seen in a FedEx community thread [3P]; Jentic lists `DELETE /ship/v1/shipments/{trackingNumber}` [3P] — **conflict, verify in sandbox** |
| Constraints | Time window not stated in the spec [?] (legacy UPS lore: void before pickup/end-of-day manifest; not verified) | Only shipments **not yet tendered** to FedEx can be cancelled. Express already tendered -> fail. Ground US multi-piece: single package deletable; Express intl: delete via master; COD rules differ [V ship docs] |

## 5. Rating

| | UPS | FedEx |
|---|---|---|
| Endpoint | `POST /api/rating/v2409/{requestoption}` — `Rate`, `Shop`, `Ratetimeintransit`, `Shoptimeintransit`; `Shop` returns all UPS products for the lane [V]. Query `additionalinfo=timeintransit` | Rate endpoint (path `POST /rate/v1/rates/quotes` [MEM]). Omit `serviceType` -> "Multiple services rates are returned" [V https://developer.fedex.com/api/en-us/catalog/rate/docs.html]. LIST request returns both list and account rates [V] |
| Negotiated | Request `ShipmentRatingOptions.NegotiatedRatesIndicator` [V] | Account-number rates come back as ACCOUNT rate type [V] |

## 6. Address validation

| | UPS | FedEx |
|---|---|---|
| Endpoint | `POST /api/addressvalidation/v2/{requestoption}` — 1 validate, 2 classify (residential/commercial), 3 both [V]. Street-level = USPS data for **US and Puerto Rico**; in CIE only NY and CA addresses produce results [V]. `regionalrequestindicator`, `maximumcandidatelistsize` (0-50, default 15) | "Validate Address" endpoint (path `POST /address/v1/addresses/resolve` [MEM]). Many countries (US, CA, MX, much of EU, etc.) [V https://developer.fedex.com/api/en-us/catalog/address-validation/docs.html]. Classification: unknown/business/residential/mixed. Docs say results are "suggested use only", not a deliverability guarantee [V] |
| Separate product? | Not stated in spec; on the portal it's a separate API you add to the app [?] | Not stated; a separate API entry in the catalog [?] |

## 7. Tracking

| | UPS | FedEx |
|---|---|---|
| Pull | `GET /api/track/v1/details/{inquiryNumber}` (7-34 chars); also `/track/v1/reference/details/{referenceNumber}` and `/track/v1/shipment/details/{inquiryNumber}`; query `locale`, `returnSignature`, `returnMilestones`, `returnPOD` [V Tracking.yaml] | Track by number; **max 30 tracking numbers per request**; by-reference needs account or dest postal+country; signature image needs shipper account [V https://developer.fedex.com/api/en-us/catalog/track/docs.html]. Path `POST /track/v1/trackingnumbers` [MEM] |
| Push | **Track Alert v2**: `POST /api/track/v2/subscription/{type}/package` with `locale`, `countryCode`, `trackingNumberList`, optional `eventPreferences` (D/I/M...). Webhook credentials managed separately ("Manage Webhook Credentials") in v2 [V UPSTrackAlert.yaml]. Cost/approval: **not verifiable** — one 3P article calls it paid; 3P says pushes for ~14 days [?] | **Advanced Integrated Visibility webhooks**: register in Developer Portal, create org, billing account, add shipping accounts, webhook project with HTTPS callback + 26-100 char security token; **US-billing/shipping accounts only**; eligible: US domestic, CA domestic, US-CA; retry/redelivery included; customers can subscribe by account number, integrators by tracking number. Fees governed by "Order Form(s)" — not stated [V https://developer.fedex.com/api/en-us/legal/ShipmentVisibilityWebhookServiceDescription.html]. Basic email notifications (ON_DELIVERY, ON_EXCEPTION, ON_TENDER, ON_ESTIMATED_DELIVERY, up to 4 recipients) exist in Track API [V] |

## 8. Service codes (US domestic)

| Speed | UPS (Service.Code) [V Rating.yaml] | FedEx serviceType |
|---|---|---|
| Ground | 03 Ground | FEDEX_GROUND (business), GROUND_HOME_DELIVERY (residential) [V for GROUND_HOME_DELIVERY; FEDEX_GROUND [MEM]] |
| 3-day | 12 3 Day Select | FEDEX_EXPRESS_SAVER [V name listed in One Rate list as EXPRESS_SAVER; exact enum FEDEX_EXPRESS_SAVER MEM] |
| 2-day | 02 2nd Day Air; 59 2nd Day Air A.M. | FEDEX_2_DAY; FEDEX_2_DAY_AM [V] |
| Next day | 01 Next Day Air; 13 Next Day Air Saver; 14 Next Day Air Early; | STANDARD_OVERNIGHT, PRIORITY_OVERNIGHT, FIRST_OVERNIGHT [V] |

## 9. Rate limits

- FedEx [V https://developer.fedex.com/api/en-us/guides/ratelimits.html]: per-org daily quota (example 500k/day), default **100K/day per capability per project** (Track's 100K shared across its 6 endpoints), **1,400 txns per 10 s per project**, 429 with "Retry after 10 seconds"/"after 12:00AM GMT". FedEx may lower limits without notice.
- UPS: 429 documented on all endpoints ("Rate Limit Exceeded", "Quota Limit Exceeded" on token) [V specs] but **no numbers published** in the specs [?].

## 10. Production access

**FedEx** [V https://developer.fedex.com/api/en-us/project/certification.html]:
- Register on developer portal, create project (test key + secret, test shipping account), build in sandbox.
- **Ship API (and Open Ship) require Shipping Label Certification** before production. Steps: move project to production (prod secret shown once) -> fill Label Cover Sheet (contact, services, account number, prod key) -> email scanned test labels to label@fedex.com (or mail physical to Collierville TN) -> FedEx Bar Code Analysis group approves/rejects -> prod credentials enabled by email -> swap URLs/creds.
- Labels printed and scanned at **>= 600 DPI**; do NOT send API-generated files; thermal needs the image type matching printer (ZPLII for Zebra); PNG/PDF are for laser only; one sample per service you apply for; multi-piece = one label per package; COD needs the COD return label; Intl Express needs auxiliary AWB.
- **Turnaround 3 business days** (Bar Code Analysis); **approval is per project**. Print quality and scaling are the top two rejection reasons.
- Other FedEx APIs (Rate, Track, Address) need no label cert; the general FAQ mentions "Basic Certification, Label Certification, or no certification" depending on API [V https://developer.fedex.com/api/en-us/integration/faq.html].

**UPS**: create app on developer.ups.com, get Client ID/Secret, associate your UPS account number(s) with the app (needed for ShipperNumber and negotiated rates; 3P says unauthenticated accounts get "not qualified to receive negotiated rates", fix = supply a recent invoice to authenticate account [3P https://docs.shipperhq.com/reauthenticating-your-ups-account-in-shipperhq]). Access-key auth retired; OAuth mandatory after June 2024 [3P]. **Whether UPS requires label certification for REST: I could not verify** — nothing in the specs, no page readable. [?] Treat as unknown until you read the portal's "Get Started" page while logged in.

## 11. Return labels

- **UPS**: same ship call. Presence of `Shipment.ReturnService{Code}` makes it a return shipment [V]. Codes: 2 Print and Mail, 3 RS 1-attempt, 5 RS 3-attempt, 8 Electronic Return Label (email link), **9 Print Return Label (PRL)**, 10 Exchange PRL, 11-20 Pack & Collect. LabelSpecification is **required** for PRL (valid GIF/ZPL/EPL/SPL), and required for ERL when SubVersion >= 1707. Swap Shipper/ShipTo/ShipFrom to customer->lab. Label Recovery endpoint `POST /api/labels/v2409/recovery` retrieves forward/return labels [V].
- **FedEx**: same Create Shipment call can produce a "print return label"; also **email return label** (customer gets a link; cancel via `emailReturnShipment`) and **Return Tag** (`POST /ship/v1/tags`, Express Tag/Ground Call Tag, courier pickup; cancel only before pickup) [V https://developer.fedex.com/api/en-us/catalog/ship/docs.html]. Field names for flagging (`shipmentSpecialServices.specialServiceTypes: RETURN_SHIPMENT_INDICATOR`, `returnShipmentDetail.returnType: PRINT_RETURN_LABEL | EMAIL`) are [MEM], unverified.

## Node packages

No official maintained npm client for either. UPS publishes language SDKs in https://github.com/UPS-API/UPS-SDKs (Node branch; OAuth helpers only per README; no releases/packages, 14 commits — thin) [V]. npm `ups-shipping-api` / `ups-nodejs-sdk` last published 2022-05 (stale, predates OAuth) [V registry]. FedEx: no official; GitHub `WhatArmy/FedexRest` is PHP. Plain fetch + a small token-cache module is the norm. Both vendors' REST+JSON is simple enough.

## Unverified / needs a logged-in portal or sandbox call

1. UPS label certification requirement for production (none found).
2. UPS Track Alert cost/approval; UPS numeric rate limits; UPS void time window; UPS token lifetime currently (1h per notice, confirm via `expires_in`).
3. FedEx exact paths (ship cancel method, rate, address, track), header names, response field names, return-shipment field names, sandbox/prod base hosts from FedEx's own pages.
4. FedEx webhook fees (Order Form).
5. Whether Address Validation needs separate enablement on either portal.
