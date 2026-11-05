# sms

Sends one text message through a swappable provider. Off until configured. It
knows nothing about the app: callers pass `{ to, body }`.

## Use

```js
import { smsRegistry } from "./modules/sms/sms-registry.js";
const result = await smsRegistry().send({ to: "(555) 123-4567", body: "Hello" });
// { ok, providerId?, error?, suppressed? }  never throws
smsRegistry().status(); // { provider, ok, reason? }
```

`suppressed: true` means nothing was attempted (provider off, credentials
missing, or staging without a redirect number).

## Adapter contract

```js
{ id, label, configured() → { ok, reason? }, send({ to, body }) → Promise<{ ok, providerId?, error? }> }
```

`reason` names unset environment variables, never their values. Results never
contain credentials. `adapters/adapter-contract.test.js` checks every adapter.

## Add a provider

1. Write `adapters/<name>.adapter.js` exporting `create<Name>Adapter({ config, fetchImpl })`.
2. Add one line to `FACTORIES` in `sms-registry.js`, and its credentials to `smsConfig`
   and `SMS_PROVIDER` in `config/env.js`.

## Environment (all optional)

| Variable | Meaning |
| --- | --- |
| `SMS_PROVIDER` | `twilio`, `log` (writes a masked line only) or `off` (default) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio credentials |
| `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | Sender; the service SID wins when both are set |
| `STAGING_SMS_TO` | Staging redirect number |

## Staging rule

Under `APP_ENV=staging` (the same signal as email) every text goes to
`STAGING_SMS_TO` with the body prefixed `[STAGING → •••1234]` (the original
number, masked). With no redirect number set, the text is suppressed.

## Smoke

```
pnpm --filter @my-app/api sms:smoke --to "(555) 123-4567"          # Twilio test credentials only (TWILIO_FROM=+15005550006)
pnpm --filter @my-app/api sms:smoke --to "(555) 123-4567" --live   # sends a real text
```

Prints only `ok`, the masked number and the provider id.
