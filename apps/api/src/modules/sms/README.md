# sms

## Purpose

Sends one text message through a swappable provider. Off until configured. It
knows nothing about the app: callers pass `{ to, body }`.

## Public interface

```js
import { smsRegistry } from "./modules/sms/sms-registry.js";
const result = await smsRegistry().send({ to: "(555) 123-4567", body: "Hello" });
// { ok, providerId?, error?, suppressed? }  never throws
smsRegistry().status(); // { provider, ok, reason? }
```

`suppressed: true` means nothing was attempted (provider off, credentials
missing, or staging without a redirect number).

### Adapter contract

```js
{ id, label, configured() → { ok, reason? }, send({ to, body }) → Promise<{ ok, providerId?, error? }> }
```

`reason` names unset environment variables, never their values. Results never
contain credentials. `adapters/adapter-contract.test.js` checks every adapter.

### Add a provider

1. Write `adapters/<name>.adapter.js` exporting `create<Name>Adapter({ config, fetchImpl })`.
2. Add one line to `FACTORIES` in `sms-registry.js`, and its credentials to `smsConfig`
   and `SMS_PROVIDER` in `config/env.js`.

## Configuration

All optional.

| Variable | Meaning |
| --- | --- |
| `SMS_PROVIDER` | `twilio`, `log` (writes a masked line only) or `off` (default) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio credentials |
| `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | Sender; the service SID wins when both are set |
| `STAGING_SMS_TO` | Staging redirect number |

### Staging rule

Under `APP_ENV=staging` (the same signal as email) every text goes to
`STAGING_SMS_TO` with the body prefixed `[STAGING → •••1234]` (the original
number, masked). With no redirect number set, the text is suppressed.

### Smoke

```
pnpm --filter @my-app/api sms:smoke --to "(555) 123-4567"          # Twilio test credentials only (TWILIO_FROM=+15005550006)
pnpm --filter @my-app/api sms:smoke --to "(555) 123-4567" --live   # sends a real text
```

Prints only `ok`, the masked number and the provider id. Without `--live` it
refuses unless the provider is `log`, or Twilio with the test sender and no
messaging service SID.

## Data model

None. The module stores nothing: no tables, no queue. A caller that wants a
record of each attempt writes it itself (the notifications module logs every
text it sends in `notification_deliveries`, with the number masked).

## Wiring it into another app

1. Copy this directory and add the `SMS_PROVIDER` / Twilio / `STAGING_SMS_TO`
   variables to the app's env loader (here `config/env.js` builds `smsConfig`).
2. Call `smsRegistry()` wherever a text is sent and treat the result as
   advisory: it never throws, and `suppressed` means nothing was attempted.
3. To let the notifications module send texts, pass the registry as its `sms`
   channel when building the notifier. This repo does that in
   `services/app-modules.js` (`createNotifier({ ..., channels })`), which is
   the worked example.
