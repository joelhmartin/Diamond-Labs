# Shipping labels — operations and go-live

Piece 4 of own-the-lab. Spec: `docs/superpowers/specs/2026-10-19-shipping-labels-design.md`.
Plan: `docs/superpowers/plans/2026-10-19-shipping-labels.md`.

## What works with no carrier accounts

**Manual** shipments are always enabled. In the Ship form, pick "Manual", type
the carrier (a courier, hand delivery, USPS bought elsewhere) and, if there is
one, the tracking number. This works from day one. UPS and FedEx appear in
Admin › Shipments › Carriers as disabled, and the panel says why.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `LAB_NAME` | Diamond Orthotic Laboratory | Invoices, statements, the shipped email |
| `LAB_PHONE`, `LAB_ADDRESS_LINE1`, `LAB_ADDRESS_LINE2`, `LAB_CITY`, `LAB_STATE`, `LAB_ZIP` | — | The ship-from. UPS/FedEx stay disabled until all but LINE2 are set |
| `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER` | — | Secret Manager in prod |
| `FEDEX_API_KEY`, `FEDEX_SECRET_KEY`, `FEDEX_ACCOUNT_NUMBER` | — | Secret Manager in prod |
| `CARRIER_ENV` | `sandbox` | `production` only after step 5. Staging is always sandbox |
| `LABEL_FORMAT` | `image` | `zpl` for a Zebra thermal printer |
| `SHIPPING_CHARGE_POLICY` | `none` | `carrier_cost` or `flat`; the lab's decision |
| `SHIPPING_FLAT_CENTS` | `0` | Used by `flat` |
| `SHIPPED_EMAIL_ENABLED` | `true` | One email per shipment: order numbers, carrier, tracking |

## Go-live checklist

1. **Accounts.** Create the UPS and FedEx developer apps and link the lab's shipper numbers. Put the credentials into Secret Manager (`diamond-labs-prod`) and wire them as env vars on the service.
2. **Ship-from.** Set the lab's street address and phone (`LAB_*`).
3. **Sandbox smoke.** With sandbox credentials in `apps/api/.env`, run `pnpm --filter @my-app/api carriers:smoke`. Every line must be ✓.
   - **FedEx cancel path:** if void fails with a 404 or 405, switch `FEDEX_CANCEL_METHOD` and `fedexPaths.cancel` in `services/shipping/carriers/fedex-requests.js` to `DELETE /ship/v1/shipments/{trackingNumber}`, and rerun.
   - **Status codes:** every `rawCode=` printed must appear in `services/shipping/carriers/carrier-status.js`. Add any missing code.
   - **Field names:** if a field name differs from a fixture under `apps/api/test-fixtures/carriers/`, replace that fixture with the real (sandbox) body and fix the parser in the same commit.
4. **FedEx label certification** (about 3 business days per project).
   - Run the smoke with `--save=<dir>`, print each service's label on the lab's real printer, and scan at ≥ 600 DPI.
   - Email the scans with the Label Cover Sheet to label@fedex.com.
   - Check whether UPS has an equivalent gate on the developer portal (unverified).
5. **Production.** Set `CARRIER_ENV=production` and the `LABEL_FORMAT` that matches the printer.
6. **Tracking job.** Run `shipping-tracking-sync` every 2 hours. This is NOT the AutoPay setup as-is: the existing `diamond-labs-jobs` Cloud Run Job (`docs/autopay-operations.md` §1.3) has fixed args (`autopay --live`) and autopay-only secrets, so pointing a scheduler at it unchanged would run AutoPay, and a sync run there would silently check 0 shipments (no carrier config). Use one of:
   - **A second Job** (cleaner): create `diamond-labs-shipping-sync` from the same image with `--args=apps/api/src/jobs/cli.js,shipping-tracking-sync,--live`; or
   - **Scheduler overrides** on `diamond-labs-jobs`: the Scheduler HTTP body for `:run` carries `{"overrides":{"containerOverrides":[{"args":["apps/api/src/jobs/cli.js","shipping-tracking-sync","--live"]}]}}`.

   Either way that Job needs, besides the database/JWT secrets it already has: `UPS_*`, `FEDEX_*`, `LAB_*`, `CARRIER_ENV`, `LABEL_FORMAT` (env or Secret Manager), and the `PHI_ENCRYPTION_KEY` secret (shipment rows carry ship-to details). Set `--task-timeout` to at least **40m**: one run checks up to 150 shipments, and the UPS worst case is 15 s each. Keep `--max-retries=0` (the job takes a per-name lock). Create a separate Scheduler job (`0 */2 * * *`) and invoker binding as in §1.4-1.5. Do one dry run first (omit `--live`), then live.
7. **Billing.** The lab chooses `SHIPPING_CHARGE_POLICY`.

## Alerts (Cloud Logging)

| Line | Meaning | Action |
|---|---|---|
| `[SHIP][PURCHASE_UNCERTAIN] carrier= code=` | A purchase timed out or failed ambiguously; the label may exist | Check the carrier's portal for the label. If it exists, void it there. The attempt's key stays locked for 24 h |
| `[SHIP][LABEL_ORPHANED] carrier= tracking=` | A label was bought, our DB write failed, and the void failed too | Void that tracking number in the carrier's portal |
| `[SHIP][VOID_UNRECORDED] shipment= carrier=` | The carrier voided the label but our DB write failed | The shipment still reads "Label created": void it again (the carrier will say it's already void) or fix the row |
| `[SHIP][UNKNOWN_STATUS] carrier= code=` | The tracking sync saw a code we don't map | Add it to `carrier-status.js` |
| `[SHIP][MARK_SHIPPED_FAILED] shipment=` | A moving shipment's orders couldn't be marked shipped | Retried on the next sync. Persistent: open the order |
| `[SHIP][EMAIL_FAILED] shipment=` | The shipped email failed | Nothing to retry automatically. Tell the doctor if needed |

## Rules worth knowing

- A labelled order can only move to Shipped. To change anything else, void the label first.
- "Mark shipped" ships every order in the box and sends one email.
- Void is possible only while the label is unused (not shipped, not moving).
- Shipping is never "un-shipped". Correct the bill with a credit on the invoice.
