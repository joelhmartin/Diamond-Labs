/**
 * Carrier SANDBOX smoke test — run by hand, never in CI (it is not a *.test.js).
 *
 * For each configured carrier (or the ones named on the command line): rate,
 * buy ONE test label, track it, void it, and print what each call returned
 * (codes and shapes, never credentials). Refuses to run unless the effective
 * carrier environment is "sandbox".
 *
 *   pnpm --filter @my-app/api carriers:smoke              # every configured carrier
 *   pnpm --filter @my-app/api carriers:smoke fedex        # one carrier
 *   pnpm --filter @my-app/api carriers:smoke --save=/tmp/labels   # also write each label file (FedEx certification)
 *
 * Go-live step 3 (docs/shipping-operations.md): every line must be ✓, and the
 * printed raw status codes must exist in carriers/carrier-status.js.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: carriers:smoke [ups|fedex] [--save=<dir>]\nRates, buys ONE test label, tracks and voids it per configured carrier. Sandbox only (refuses in production).");
  process.exit(0);
}
// Loaded after the --help check: importing env validates (and may exit on) the environment.
const { env } = await import("../src/config/env.js");
const { effectiveCarrierEnv } = await import("../src/config/app-env.js");
const { carrierConfig } = await import("../src/services/shipping/carrier-config.js");
const { createRegistry } = await import("../src/services/shipping/carrier-registry.js");

// UPS's test environment validates street addresses only in NY and CA.
const TEST_SHIP_TO = {
  name: "Smoke Test", company: "Carrier Sandbox", phone: "2125550100",
  address1: "1 Rockefeller Plz", city: "New York", state: "NY", postalCode: "10020", country: "US",
};
const PARCEL = { preset: "small_box", weightOz: 16, lengthIn: 8, widthIn: 6, heightIn: 4 };
const GROUND = { ups: "03", fedex: "FEDEX_GROUND" };

const saveDir = args.find((a) => a.startsWith("--save="))?.slice("--save=".length) ?? null;
const only = args.filter((a) => !a.startsWith("--"));

async function smoke(adapter, config) {
  const quotes = await adapter.rate({ shipFrom: config.shipFrom, shipTo: TEST_SHIP_TO, parcel: PARCEL });
  console.log(`✓ ${adapter.label} rate: ${quotes.length} services (${quotes.map((q) => `${q.serviceCode} ${q.amountCents}¢`).join(", ")})`);
  const pick = quotes.find((q) => q.serviceCode === GROUND[adapter.id]) ?? quotes[0];
  if (!pick) throw new Error("no quotes returned");
  const label = await adapter.createLabel({
    shipFrom: config.shipFrom, shipTo: TEST_SHIP_TO, parcel: PARCEL, serviceCode: pick.serviceCode, reference: "Order SMOKE", labelFormat: config.labelFormat,
  });
  console.log(`✓ ${adapter.label} label: ${label.trackingNumber} ${label.labelFormat} (${label.labelData.length} base64 chars), ${label.chargeCents}¢, void id ${label.carrierShipmentId}`);
  if (saveDir) {
    mkdirSync(saveDir, { recursive: true });
    const file = join(saveDir, `label-${adapter.id}-${label.trackingNumber}.${label.labelFormat}`);
    writeFileSync(file, Buffer.from(label.labelData, "base64"));
    console.log(`  saved ${file}`);
  }
  const [tracked] = await adapter.track([label.trackingNumber]);
  console.log(`✓ ${adapter.label} track: status=${tracked?.status ?? "unmapped"} rawCode=${tracked?.carrierCode ?? "-"}${tracked?.error ? ` error=${tracked.error.code}: ${tracked.error.message}` : ""}`);
  const voided = await adapter.voidLabel(label);
  if (!voided.ok) throw new Error(`void failed: ${voided.reason}`);
  console.log(`✓ ${adapter.label} void`);
}

async function main() {
  if (effectiveCarrierEnv(env) !== "sandbox") {
    console.error("Refusing to run: the carrier environment is production. This script only buys SANDBOX labels.");
    process.exit(1);
  }
  const config = carrierConfig(env);
  const registry = createRegistry({ config });
  let failed = 0;
  let ran = 0;
  for (const adapter of registry.all().filter((a) => a.tracks && (only.length === 0 || only.includes(a.id)))) {
    const ready = adapter.configured();
    if (!ready.ok) {
      console.log(`- ${adapter.label}: skipped (${ready.reason})`);
      continue;
    }
    try {
      ran += 1;
      await smoke(adapter, config);
    } catch (err) {
      failed += 1;
      console.log(`✗ ${adapter.label}: ${err.code ?? "ERROR"} ${err.message}`);
    }
  }
  if (ran === 0 && failed === 0) {
    console.error("No carrier ran: set the sandbox credentials and LAB_* ship-from in apps/api/.env (see docs/shipping-operations.md).");
    process.exit(1);
  }
  process.exit(failed ? 1 : 0);
}

main();
