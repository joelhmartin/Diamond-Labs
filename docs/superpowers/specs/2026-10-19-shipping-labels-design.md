# Piece 4: Shipping labels (design)

_2026-10-19 · roadmap: `2026-10-05-own-the-lab-roadmap.md` · builds on piece 2
(lab orders) and piece 3 (invoicing) · carrier facts:
`2026-10-19-carrier-api-research.md`, summarised under "Carrier facts" below_

## Goal

Staff buy and print UPS and FedEx labels from the order screen, and tracking
is recorded on the order. The carriers sit behind one **carrier-adapter
interface**, so adding or swapping a carrier means writing one adapter.
Nothing in the label, tracking or email path carries patient data.

The user asked for direct UPS and FedEx APIs (the lab is opening accounts)
instead of a broker such as EasyPost.

## What exists today (survey 2026-10-19)

- **Lab orders** (piece 2) move `ready_to_ship → shipped`. `shipped` is
  terminal, and `billingFollowUp("shipped")` issues the order's draft invoice
  in a savepoint (piece 3).
- **Ship-to address:**
  - Rx orders: the address comes from the doctor's `doctor_profiles` row
    (`companyName`, `address1/2`, `city`, `state`, `zip`, `phone`,
    `deliveryMethod`, `deliveryNotes`). The Rx form no longer asks for an
    address.
  - Shop orders: the address comes from `orders.shipping` (jsonb), and the
    email from `orders.email`.
- **Invoices** already allow a `shipping` line kind, and the line adds up into
  `shippingCents`. Drafts are editable and issued invoices are immutable.
- **Jobs framework** (`apps/api/src/jobs`): `defineJob` plus a Cloud
  Scheduler trigger at `POST /internal/jobs/:name/run`. AutoPay and the shop
  repair sweep use it.
- **Idempotency:**
  - Server: `withIdempotency` (Redis or Postgres shim).
  - Web: `useAttemptKey`, which keeps one key per attempt.
- **Not present:** no carrier code, no lab street address in code or config,
  and no image library. `pdfkit` is installed, but it cannot embed GIF.
- The lab's name, "Diamond Orthotic Laboratory", is hard-coded in
  `invoice-model.js` and `statement-model.js`.

## Carrier facts that shape the design

These are from the 2026-10-19 research. Unverified items are marked and are
checked in the sandbox before go-live.

- **Auth.** Both carriers use OAuth client credentials.
  - Tokens expire. UPS is moving from 4h to 1h, and FedEx is 1h. Always
    honour `expires_in`.
  - FedEx blocks the token endpoint for 10 minutes above ~1 request/second.
    Tokens must therefore be cached and fetched single-flight.
- **Label formats.**
  - UPS `/ship` returns GIF, ZPL, EPL or SPL. It does not return PDF or PNG,
    and its largest size is 4×6.
  - FedEx returns PDF, PNG, ZPLII or EPL2.
  - The common ground is a 4×6 image (UPS GIF, FedEx PNG) or ZPL.
- **Go-live gate.** FedEx requires **label certification**: scanned test
  labels are emailed to FedEx, with about 3 business days per project. It is
  unverified whether UPS has an equivalent gate for REST.
- **Tracking.**
  - Polling is available on both carriers.
  - Push is harder. UPS Track Alert's cost and approval process are
    unverified. FedEx webhooks need a webhook project and an HTTPS callback,
    and their fees come from an order form.
  - This piece **polls**.
- **Void.** UPS supports void. For FedEx cancel, the exact path is unverified
  (`PUT /ship/v1/shipments/cancel` vs `DELETE …/{trackingNumber}`).
- **Client code.** Neither carrier has an official, maintained Node package,
  so the adapters use plain `fetch`, as `authorizenet.service.js` does.

## Model

Shipping is split into a generic layer and lab glue:
- **Generic layer** (`services/shipping/`, `packages/shared/src/shipping/`):
  knows nothing about lab orders, so another site can reuse it as is.
- **Lab glue** (`services/lab/lab-shipping.service.js`): connects shipments to
  lab orders and invoices.

- **`shipments`** (generic)
  - Keys and carrier: `id`, `carrier` (`ups` | `fedex` | `manual`),
    `serviceCode`, `serviceName`, `carrierShipmentId` (what void needs),
    `trackingNumber`.
  - `status`: `label_created` | `in_transit` | `out_for_delivery` |
    `delivered` | `exception` | `returned` | `voided`. This is a normalised
    vocabulary, and one pure table maps each carrier's codes onto it.
  - Money: `chargeCents` (what the carrier billed us), `currency`.
  - Parcel and addresses:
    - `parcel` (jsonb: preset key, weight oz, dims in).
    - `shipTo` (jsonb snapshot: name, company, phone, address).
    - `shipFrom` (jsonb snapshot).
  - Label:
    - `labelFormat` (`gif` | `png` | `zpl`).
    - `labelData` (base64 text). A label shows the practice or customer
      address and our order numbers, never a patient.
  - Who and when: `createdByUserId`, `purchasedAt`, `shippedAt`,
    `deliveredAt`, `voidedAt`, `lastTrackedAt`, `trackingError`,
    `createdAt`, `updatedAt`.
- **`shipment_events`** (generic, append-only): `shipmentId`, `status`,
  `description`, `location`, `occurredAt`, `source` (`carrier` | `staff`).
  These events drive the timeline.
- **`lab_orders.shipment_id`** (nullable FK): an order has at most one
  current shipment, and one shipment can carry several orders ("ship
  together"). Voiding clears it. History stays in `lab_order_events`, which
  gains the event type `shipment`.

## Carrier adapter interface

Every adapter exports the same shape, validated by one contract test that
runs against every registered adapter:

```
{ id, label,
  configured(env) → { ok, reason? },          // creds + ship-from present
  rate({ shipFrom, shipTo, parcel }) → [RateQuote],
  createLabel({ shipFrom, shipTo, parcel, serviceCode, reference, labelFormat })
      → { trackingNumber, carrierShipmentId, labelFormat, labelData, chargeCents, serviceName },
  voidLabel({ carrierShipmentId, trackingNumber }) → { ok, reason? },
  track([trackingNumber]) → [{ trackingNumber, status, events[], deliveredAt? }] }
```

- **Normalised types** live in `packages/shared/src/shipping/`:
  `Address`, `Parcel`, `RateQuote { carrier, serviceCode, serviceName,
  amountCents, estimatedDelivery? }`, the status list, and the
  tracking-URL builder.
- **`ups.adapter.js` / `fedex.adapter.js`**
  - Pure request builders and response parsers, tested against recorded
    fixtures, plus a thin `fetch` layer.
  - Money comes back in cents; the dollars-to-cents conversion happens once,
    in the parser.
  - `reference` holds our order numbers only.
- **`manual.adapter.js`**: no API. Staff type the carrier name and a
  tracking number (a courier, a hand delivery, or a carrier used outside the
  system).
  - It is always configured.
  - It is what makes the whole flow usable before the UPS and FedEx accounts
    exist.
  - `rate` returns nothing, and `track` returns nothing, so a manual shipment
    is moved by staff.
- **`oauth-token-cache.js`**: one implementation for both carriers. It caches
  per carrier and environment, refreshes 60 seconds before `expires_in`, and
  fetches single-flight so concurrent requests share one token call.
- **`carrier-registry.js`**: maps carrier ids to adapters.
  - `enabledCarriers(env)` lists the carriers that are configured, and the
    reason any carrier is not.
  - A carrier with missing credentials is simply disabled; it never fails at
    boot.
- **Config** (Secret Manager in prod):
  - Carrier credentials: `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`,
    `UPS_ACCOUNT_NUMBER`, `FEDEX_API_KEY`, `FEDEX_SECRET_KEY`,
    `FEDEX_ACCOUNT_NUMBER`.
  - `CARRIER_ENV` = `sandbox` | `production` (default `sandbox`).
  - `LABEL_FORMAT` = `image` | `zpl` (default `image`).
  - The lab's identity (below).

### Lab identity

`config/lab-identity.js` reads `LAB_NAME` (default "Diamond Orthotic
Laboratory"), `LAB_PHONE` and `LAB_ADDRESS_LINE1/2`, `LAB_CITY`,
`LAB_STATE` and `LAB_ZIP`. It is the ship-from address.
`invoice-model.js` and `statement-model.js` switch to it, so the name lives
in one place. UPS and FedEx stay disabled (with the reason "Ship-from address
not configured") until the address is set.

## Flow

### 1. Buy a label (lab or admin)

- On an order at `ready_to_ship`, staff click **Ship**.
- The form lists the client's other `ready_to_ship` orders without a shipment,
  each with a checkbox, so several cases going to one practice share one box.
- Ship-to is prefilled from the doctor profile (Rx) or `orders.shipping`
  (shop) and can be edited for this shipment only. The profile's delivery
  method and notes are shown as a hint.
- Parcel: a preset (a shared constant list) plus a weight. The dimensions can
  be edited.
- **Get rates** asks every enabled carrier in parallel, with a timeout per
  carrier. A carrier that errors shows its error and doesn't hide the others.
  Staff pick a service, or choose **Manual** and type the carrier and
  tracking number.
- **Buy** sends an `Idempotency-Key` (the `useAttemptKey` hook on the web,
  `withIdempotency` on the server), so a double click or retry can't buy two
  labels.
- The server checks every order before calling the carrier:
  - it is at `ready_to_ship`;
  - it has no shipment;
  - all orders belong to one client (a guest shop order ships alone);
  - the caller may act on them.

  A failed check returns 422 with the reason.
- After the label is bought, **one transaction**:
  - inserts the shipment and its first event;
  - sets `shipment_id` on each order and writes a `shipment` lab order event;
  - applies the shipping-charge policy (below) to a draft invoice.

  If that transaction fails, the label is voided at the carrier (best
  effort). If the void also fails, the server logs
  `[SHIP][LABEL_ORPHANED] carrier= tracking=` (ids only) and returns 500.

### 2. Print

- `GET /lab/shipments/:id/label` (lab or admin) returns the stored label:
  - `image`: the GIF or PNG bytes with the right content type. The web print
    view (`/lab/shipments/:id/print`) places the image on a 4×6 page
    (`@page { size: 4in 6in; margin: 0 }`, rotated where the carrier image is
    landscape). This prints on a 4×6 thermal printer through its driver, or
    on a letter page.
  - `zpl`: the raw `.zpl` file, for Zebra direct printing.
- No image conversion happens server-side, so no new dependency is needed.
- Every label view or download is audit-logged.

### 3. Shipped

- A labelled order stays at `ready_to_ship`; the card shows "Label printed".
  It moves to `shipped`, through the existing status path so the invoice is
  issued, at whichever comes first:
  - staff click **Mark shipped**, on one order or **Mark all labelled
    shipped** for the end-of-day hand-off; or
  - the tracking sync sees the first carrier movement (`in_transit` or
    later).
- `shipments.shippedAt` is set at the same time.

### 4. Void

- Allowed while the shipment is `label_created` and every linked order is
  still `ready_to_ship`. The flow:
  1. Call the carrier's void.
  2. Mark the shipment `voided`.
  3. Clear `shipment_id` on each linked order.
  4. Remove the shipping line it added from the draft invoice.
- The first click arms the button and the second commits, as with refunds.
- A shipped order is never "un-shipped". Once it has moved, a mistake is
  corrected with a credit on its invoice (piece 3).

### 5. Tracking

- **Job `shipping-tracking-sync`**, run by Cloud Scheduler roughly every 2
  hours:
  - It polls every shipment that is not terminal (`voided`, `delivered`,
    `returned`), was bought in the last 30 days, and has a carrier with
    `track`. Calls are batched per carrier.
  - It writes a `shipment_event` for each new status, and sets
    `deliveredAt` and `lastTrackedAt`. On first movement it marks the linked
    orders shipped.
  - A carrier error sets `trackingError` and is retried on the next run.
  - It is idempotent; a dry run only counts.
- **Admin › Shipments** has a "Refresh tracking" button on a shipment, which
  runs the same function for that one shipment.

### 6. Doctor-facing

- **My cases** shows the carrier, a tracking link (built by the shared URL
  builder) and the delivered date.
- **Shipped email**:
  - When an order moves to `shipped` and has a carrier shipment, the doctor
    (for Rx) or `orders.email` (for shop) gets: the order number, carrier,
    tracking number and link. **No patient name, device or Rx content.**
  - `SHIPPED_EMAIL_ENABLED`, default `true`.
  - It is sent after commit and never fails the move.
  - A shipment carrying several orders sends **one** email listing their
    order numbers.

## Shipping-charge policy

`SHIPPING_CHARGE_POLICY` sets what goes on the invoice:

| Value | Shipping line added to the draft invoice |
|---|---|
| `none` (default) | nothing |
| `carrier_cost` | the label's `chargeCents` |
| `flat` | `SHIPPING_FLAT_CENTS` |

- The line goes on the draft of the **lowest-numbered** order in the shipment.
  Its description is "Shipping — UPS Ground 1Z…": carrier, service and
  tracking only.
- **When no line is added:**
  - the policy is `none`;
  - every order in the shipment is a remake;
  - that invoice is no longer a draft. In this case a lab order event notes
    it for staff.
- The default is `none` until the lab says how it bills shipping. **This is
  the one business decision in this piece.**

## Admin › Shipments

A list of shipments: date, carrier, service, tracking, status, orders,
charge, and who bought it.
- Filters: status, carrier, and date range.
- Each row has Print, Void (when allowed) and Refresh tracking.
- A "Carriers" panel shows each carrier's enabled or disabled state and the
  reason, for example "UPS: credentials not set".

## Errors and safety

- Carrier HTTP errors are normalised to `{ carrier, code, message }` and shown
  to staff verbatim. They never include our credentials. Request and response
  bodies are not logged; ids, status and carrier error codes are.
- Timeouts:
  - rating: 10s per carrier;
  - label purchase: 30s.

  A purchase timeout is **uncertain**: the label may exist. The attempt keeps
  its idempotency key, the server logs `[SHIP][PURCHASE_UNCERTAIN]`, and staff
  see "Check Admin › Shipments before retrying". Bought labels are never
  silently retried with a new key.
- Every purchase, void, mark-shipped and label download writes an audit entry
  (ids only).
- Money is integer cents end to end, and the carrier's dollars are converted
  once, in the parser.
- `lab` users can buy, print, void and mark shipped. They see
  `chargeCents` only in the shipment form and list, not invoice totals.
- **File limits:** each adapter is split into `*-requests.js` and
  `*-responses.js` (pure) plus the adapter (`fetch`). The lab glue lives in
  its own file, not in `lab-orders.service.js` (418 lines).

## Testing

**Vitest pure tests:**
- each adapter's request builders and response parsers against recorded
  fixtures (rate, label, void, track, and an error body);
- the carrier status → normalised status table;
- the token cache (expiry, refresh window, single-flight);
- the registry's `configured` reasons;
- shippable checks (status, same client, already shipped);
- the charge policy (each value, remakes, a non-draft invoice);
- the tracking sync's state machine (first movement marks shipped; terminal
  states stop polling);
- the tracking-URL builder.

**Contract test:** every registered adapter exports the interface.

**Route tests:** the existing source-inspection pattern; Buy carries an
idempotency key.

**Sandbox smoke script:** `scripts/carrier-sandbox-smoke.js` rates, buys,
tracks and voids one test label per configured carrier. It runs by hand once
sandbox credentials exist, and is never run in CI.

## Go-live checklist (not this piece's code)

1. UPS and FedEx developer apps, and accounts linked to the lab's shipper
   numbers. Credentials go into Secret Manager.
2. The lab's street address and phone go into `LAB_*`.
3. Run the sandbox smoke script for both carriers. Confirm FedEx's cancel
   path and its return-label flag.
4. **FedEx label certification** (about 3 business days). Check whether UPS
   has an equivalent.
5. Set `CARRIER_ENV=production`, plus `LABEL_FORMAT` to match the lab's
   printer.
6. Set up Cloud Scheduler for `shipping-tracking-sync`.
7. Decide `SHIPPING_CHARGE_POLICY`.

## Out of scope

- Return or inbound labels for doctors sending impressions. The adapter
  interface leaves room for a `returnLabel` option.
- Address validation APIs. The carrier rejects a bad address at purchase and
  the error is shown.
- Push tracking (webhooks).
- Multi-package shipments.
- International shipping.
- Pickup scheduling.
- End-of-day manifests. UPS and FedEx REST don't need one for daily-pickup
  accounts.
