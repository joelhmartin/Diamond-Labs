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
6. **Tracking job.** Run `shipping-tracking-sync` every 2 hours. This is NOT the AutoPay setup as-is: the existing `diamond-labs-jobs` Cloud Run Job (`docs/autopay-operations.md` §1.3) has fixed args (`autopay --live`) and autopay-only secrets, so pointing a scheduler at it unchanged would run AutoPay, and a sync run there would silently check 0 shipments (no carrier config). Variables below (`$PROJECT_ID`, `$REGION`, `$IMAGE`, `$SQL_INSTANCE`, `$RUNTIME_SA`, `$EXISTING_SECRETS`) are defined in `docs/autopay-operations.md` §1 and §1.1.

   **What the Job needs.** Copy `$EXISTING_SECRETS` (§1.1: the secret references the running API service uses; it already holds `DATABASE_URL`, `JWT_SECRET`, `PHI_ENCRYPTION_KEY` and the mail settings). Make sure it includes the PHI key (shipment rows carry ship-to details) and the mail variables, because the sync also sends the shipped email: `MAILGUN_API_KEY` (secret), `MAILGUN_DOMAIN`, `MAILGUN_API_BASE`, `EMAIL_FROM`, `APP_URL` (must be the real public origin: the email links use it) and `SHIPPED_EMAIL_ENABLED`. Add the carrier and lab settings, as secrets or plain env: `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER`, `FEDEX_API_KEY`, `FEDEX_SECRET_KEY`, `FEDEX_ACCOUNT_NUMBER`, `LAB_NAME`, `LAB_PHONE`, `LAB_ADDRESS_LINE1`, `LAB_ADDRESS_LINE2`, `LAB_CITY`, `LAB_STATE`, `LAB_ZIP`, `CARRIER_ENV`, `LABEL_FORMAT`. Without the carrier settings the sync silently checks 0 shipments. Set `--task-timeout=40m` or more: one run checks up to 150 shipments, and the UPS worst case is 15 s each. Keep `--max-retries=0` (the job takes a per-name lock).

   Choose one:

   **A. A second Job (cleaner).** Same image and service account as §1.3, different args and secrets:

   ```bash
   gcloud run jobs create diamond-labs-shipping-sync \
     --project=$PROJECT_ID --region=$REGION --image=$IMAGE \
     --command=node \
     --args=apps/api/src/jobs/cli.js,shipping-tracking-sync,--live \
     --service-account=$RUNTIME_SA --set-cloudsql-instances=$SQL_INSTANCE \
     --set-secrets="$EXISTING_SECRETS,UPS_CLIENT_ID=ups-client-id:latest,UPS_CLIENT_SECRET=ups-client-secret:latest,UPS_ACCOUNT_NUMBER=ups-account-number:latest,FEDEX_API_KEY=fedex-api-key:latest,FEDEX_SECRET_KEY=fedex-secret-key:latest,FEDEX_ACCOUNT_NUMBER=fedex-account-number:latest" \
     --set-env-vars="CARRIER_ENV=production,LABEL_FORMAT=image,LAB_PHONE=...,LAB_ADDRESS_LINE1=...,LAB_CITY=...,LAB_STATE=...,LAB_ZIP=..." \
     --max-retries=0 --task-timeout=40m
   ```

   (Secret names above are examples: use the ones created in step 1. Add `SHIPPED_EMAIL_ENABLED` to the env vars only if it is not already in `$EXISTING_SECRETS`.) Dry run first, which only counts and writes nothing (omits `--live`):

   ```bash
   gcloud run jobs execute diamond-labs-shipping-sync \
     --project=$PROJECT_ID --region=$REGION \
     --args=apps/api/src/jobs/cli.js,shipping-tracking-sync --wait
   ```

   Then schedule it (invoker binding as in §1.4):

   ```bash
   gcloud scheduler jobs create http shipping-tracking-sync-2h \
     --project=$PROJECT_ID --location=$REGION \
     --schedule="0 */2 * * *" --time-zone="America/Chicago" \
     --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/diamond-labs-shipping-sync:run" \
     --http-method=POST \
     --oauth-service-account-email="autopay-scheduler-invoker@${PROJECT_ID}.iam.gserviceaccount.com"
   ```

   **B. Scheduler overrides on `diamond-labs-jobs`.** Add the carrier, lab and mail settings above to that Job (`gcloud run jobs update`), raise its `--task-timeout` to 40m or more (this also affects AutoPay runs), and have Scheduler override the args per run:

   ```bash
   gcloud scheduler jobs create http shipping-tracking-sync-2h \
     --project=$PROJECT_ID --location=$REGION \
     --schedule="0 */2 * * *" --time-zone="America/Chicago" \
     --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/diamond-labs-jobs:run" \
     --http-method=POST \
     --headers="Content-Type=application/json" \
     --message-body='{"overrides":{"containerOverrides":[{"args":["apps/api/src/jobs/cli.js","shipping-tracking-sync","--live"]}]}}' \
     --oauth-service-account-email="autopay-scheduler-invoker@${PROJECT_ID}.iam.gserviceaccount.com"
   ```

   Dry run for this option: `gcloud run jobs execute diamond-labs-jobs --project=$PROJECT_ID --region=$REGION --args=apps/api/src/jobs/cli.js,shipping-tracking-sync --wait`.
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
