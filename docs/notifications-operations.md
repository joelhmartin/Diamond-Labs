# Notifications, messaging and texting: operations and go-live

Piece 8 of own-the-lab. Spec: `docs/superpowers/specs/2026-11-05-messaging-notifications-logistics-design.md`.
Module guides: `apps/api/src/modules/{notifications,messaging,sms}/README.md`.

In-app alerts and email work with no setup beyond the normal mail provider.
Texting is off until the steps below are done.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `SMS_PROVIDER` | `off` | `twilio`, `log` (writes a masked line only) or `off` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | none | Secret Manager in prod |
| `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | none | The service SID wins when both are set |
| `STAGING_SMS_TO` | none | Under `APP_ENV=staging` every text goes here; with none set, texts are suppressed |

Alert numbers are not env: staff add them in Admin › Lab alerts, per event.

## Twilio and A2P 10DLC go-live checklist (needs the user's yes)

Enabling Twilio is a recurring commitment: US texting requires an A2P 10DLC
brand and campaign registration, with one-time and monthly fees. Do not start
it without the user's explicit yes. A BAA is only needed if texts ever carry
PHI; they must not (titles and texts are built from numbers and ids only).

Cloud Scheduler is not used by this piece. External channels send inline from
`notify()` after the commit, with no outbox or retry job, so a failed send is
logged and recorded rather than retried.

- [ ] User approves the Twilio account and the A2P 10DLC fees.
- [ ] Brand and campaign registered and approved.
- [ ] Credentials stored in Secret Manager (`diamond-labs-prod`) and wired as env vars; set `SMS_PROVIDER=twilio`.
- [ ] Smoke with Twilio test credentials (see below).
- [ ] One live smoke to the lab's own number.
- [ ] Add the GCP log alert on `[NOTIFY][SEND_FAILED]` (below).
- [ ] Add the lab's alert numbers in Admin › Lab alerts and use "Send test" on each.

## Smoke command

```bash
pnpm --filter @my-app/api sms:smoke -- --to <number>           # test credentials only
pnpm --filter @my-app/api sms:smoke -- --to <number> --live    # sends a real text
```

Without `--live` it refuses unless the provider is `log`, or Twilio test
credentials with From `+15005550006` and no messaging service SID. It prints
only `ok`, the masked number and the provider id.

## Log alert

Create a GCP log-based alert on the line `[NOTIFY][SEND_FAILED]` (it carries
the event key, channel, a reason and the masked target, never the body).
Related lines that are not alerts: `[NOTIFY][FAILED]` (a recipient or event
failed), `[NOTIFY][UNKNOWN_EVENT]` and `[NOTIFY][BAD_DATA]` (a caller emitted
an unregistered event or unsafe `data`; fix the caller). A provider that is
off, an unconfigured mail provider and the staging rule record `skipped` or
`suppressed` deliveries and do not log `SEND_FAILED`.

Every attempt is recorded in `notification_deliveries` (Admin › Lab alerts ›
deliveries); rows older than 90 days are pruned opportunistically.

## Adding a lab alert number

Admin › Lab alerts › the event › add the number (local format; it is stored as
E.164) › "Send test". Only events defined with `sms: true` are offered:
`message.received`, `lab.order_received` and `lab.pickup_requested`. Pause a
number rather than deleting it to keep its history. Nothing is sent until
`SMS_PROVIDER` is on.

## Adding an event

1. Append one definition to `labEventDefs()` in `apps/api/src/services/lab/lab-notifications.js`: `key` (`area.thing`), `label`, `kinds`, `defaults`, `sms`, and `title`/`link` built only from `data`. Keep `data` to numbers, dates and ids.
2. Emit it after the transaction commits through `services/notify-seam.js`: `notify(db, { event, recordType, recordId, audience, data })`.
3. `apps/api/src/services/lab/notify-callers.test.js` fails if a `notify()` caller emits a key that is not registered.
4. Never put names, message text, notes or reasons in `data`, a title or a text.

## Messages and attachments

Message subjects and bodies are sealed at rest. Attachments are stored through
the `record-files` module under the record type for messages and are served
only by signed link after the thread's read check; each issued link is audit
logged by file and thread id.
