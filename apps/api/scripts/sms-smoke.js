/**
 * SMS smoke test — run by hand, never in CI (it is not a *.test.js).
 *
 *   pnpm --filter @my-app/api sms:smoke --to "(555) 123-4567"           # Twilio TEST credentials only
 *   pnpm --filter @my-app/api sms:smoke --to "(555) 123-4567" --live    # really sends a text
 *
 * Prints the registry status, then only ok, the masked target and the provider
 * id. Never prints credentials or the message text. Without --live it refuses
 * unless TWILIO_FROM is Twilio's magic test number.
 */
const TEST_FROM = "+15005550006";
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: sms:smoke --to <number> [--live]\nSends one text through the configured provider. Without --live only Twilio test credentials (TWILIO_FROM=+15005550006) are allowed.");
  process.exit(0);
}
const toIdx = args.indexOf("--to");
const to = toIdx >= 0 ? args[toIdx + 1] : null;
if (!to) {
  console.error("Missing --to <number>.");
  process.exit(2);
}
const live = args.includes("--live");

// Loaded after the --help check: importing env validates (and may exit on) the environment.
const { env } = await import("../src/config/env.js");
const { smsRegistry } = await import("../src/modules/sms/sms-registry.js");
const { normalizePhone, maskPhone } = await import("../src/modules/sms/phone.js");

const registry = smsRegistry();
const status = registry.status();
console.log(`provider=${status.provider} ok=${status.ok}${status.reason ? ` reason=${status.reason}` : ""}`);
if (!status.ok) process.exit(1);

if (!live && (status.provider !== "twilio" || env.TWILIO_FROM !== TEST_FROM)) {
  console.error(`Refusing: without --live the provider must be twilio with TWILIO_FROM=${TEST_FROM} (Twilio test credentials).`);
  process.exit(1);
}

const target = normalizePhone(to);
if (!target) {
  console.error("That is not a valid phone number.");
  process.exit(2);
}
const result = await registry.send({ to: target, body: "Smoke test" });
console.log(`ok=${result.ok} to=${maskPhone(target)} providerId=${result.providerId ?? "-"}${result.ok ? "" : ` error=${result.error}`}`);
process.exit(result.ok ? 0 : 1);
