#!/usr/bin/env node
/**
 * scripts/rx-dryrun.mjs  —  Task 8.2: Dry-run harness
 *
 * Generates Seazona order payloads from fixture Rx cases and diffs them against
 * real hand-made orders pulled from the live Seazona API.
 *
 * READ-ONLY: only calls listProducts(), getOrders(), getOrder().
 * Never calls createOrder(), createPayment(), or any POST endpoint.
 *
 * Run:
 *   node --env-file=.env scripts/rx-dryrun.mjs
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─── Service imports ────────────────────────────────────────────────────────
// seazona.service.js → env.js (Zod) → project.config.js (all resolve fine
// relative to their own file locations when run from repo root with --env-file)
import {
  listProducts,
  getOrders,
  getOrder,
} from "../apps/api/src/services/seazona.service.js";

import { buildSeazonaOrderPayload } from "../apps/api/src/services/rx/build-order-payload.js";
import { resolveLineItems } from "../apps/api/src/services/rx/device-seazona-map.js";
import { diffOrderLines } from "../apps/api/src/services/rx/order-diff.js";

// ─── Config ─────────────────────────────────────────────────────────────────
const FIXTURE_DIR = join(ROOT, "apps/api/test-fixtures/rx-cases");
const FIXTURES = ["ddso.json", "olmos-day.json", "ortho-expander.json"];

// Productive date anchors: getOrders() returns orders from the given date onward.
// We work newest-first, stopping once we have enough for the sample cap.
const PRODUCTIVE_DATES = ["2025-10-01", "2025-07-01", "2025-04-01", "2024-10-01"];
const ORDER_SAMPLE_CAP = 40; // max getOrder(id) fetches (limits API round-trips)
const RETRY_COUNT = 3;
const RETRY_BASE_MS = 800;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Retry wrapper — backs off linearly on failure. Never throws if retries exhaust:
 *  instead returns null so callers can degrade gracefully. */
async function withRetry(label, fn) {
  for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === RETRY_COUNT) {
        console.warn(`  [WARN] ${label} failed after ${RETRY_COUNT + 1} attempts: ${err.message}`);
        return null;
      }
      const wait = RETRY_BASE_MS * (attempt + 1);
      console.warn(`  [WARN] ${label} attempt ${attempt + 1} failed, retrying in ${wait}ms…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

function hr(char = "─", width = 70) {
  return char.repeat(width);
}

function pad(s, n, right = false) {
  const str = String(s);
  return right ? str.padStart(n) : str.padEnd(n);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(hr("="));
  console.log("  RX DRY-RUN HARNESS  —  READ-ONLY against Seazona");
  console.log(hr("="));
  console.log();

  // ── Step 1: Build codeToId map from live Seazona product catalog ──────────
  let codeToId = {};
  let catalogReachable = false;
  let catalogProductCount = 0;

  console.log("Step 1 — Fetching Seazona product catalog...");
  const products = await withRetry("listProducts", () => listProducts());
  if (products && products.length > 0) {
    catalogReachable = true;
    catalogProductCount = products.length;
    for (const p of products) {
      const code = p.code != null ? String(p.code) : null;
      if (code) codeToId[code] = String(p.id);
    }
    console.log(
      `  OK — ${catalogProductCount} products; ${Object.keys(codeToId).length} have codes mapped.`
    );
  } else {
    console.warn(
      "  [WARN] Seazona catalog unreachable or empty — coverage will show all codes as unmapped."
    );
  }
  console.log();

  // ── Step 2: Collect real order details (bounded sample) ───────────────────
  let orderDetails = [];
  let orderFetchError = null;
  let totalOrderListEntries = 0;

  console.log(`Step 2 — Fetching real Seazona order details (cap ${ORDER_SAMPLE_CAP} fetches)...`);

  // Accumulate unique order ids from multiple date anchors.
  const seenIds = new Map(); // id → order summary object
  for (const date of PRODUCTIVE_DATES) {
    if (seenIds.size >= ORDER_SAMPLE_CAP) break;
    const orders = await withRetry(`getOrders("${date}")`, () => getOrders(date));
    if (!orders) {
      orderFetchError = `getOrders("${date}") failed`;
      break;
    }
    totalOrderListEntries += orders.length;
    for (const o of orders) {
      const id = o.id != null ? String(o.id) : null;
      if (id && !seenIds.has(id)) {
        seenIds.set(id, o);
        if (seenIds.size >= ORDER_SAMPLE_CAP) break;
      }
    }
    console.log(`  getOrders("${date}") → ${orders.length} orders (pool now ${seenIds.size} unique)`);
  }

  // Fetch order details for the sampled ids.
  const idsToFetch = [...seenIds.keys()].slice(0, ORDER_SAMPLE_CAP);
  console.log(`  Fetching ${idsToFetch.length} order details...`);
  let detailFetchErrors = 0;
  for (const id of idsToFetch) {
    const detail = await withRetry(`getOrder(${id})`, () => getOrder(id));
    if (detail && Array.isArray(detail.products)) {
      orderDetails.push(detail);
    } else {
      detailFetchErrors++;
    }
  }
  console.log(
    `  ${orderDetails.length} orders with product lists loaded` +
      (detailFetchErrors ? `; ${detailFetchErrors} detail fetches returned empty/error` : "") +
      "."
  );
  if (orderFetchError) {
    console.warn(`  [WARN] Order fetch stopped early: ${orderFetchError}`);
  }
  console.log();

  // ── Step 3: Per-fixture analysis ──────────────────────────────────────────
  const summaryRows = [];

  for (const fixtureName of FIXTURES) {
    console.log(hr("─"));
    const fixturePath = join(FIXTURE_DIR, fixtureName);
    let fixture;
    try {
      fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    } catch (err) {
      console.error(`  [ERROR] Could not read fixture ${fixtureName}: ${err.message}`);
      summaryRows.push({ fixture: fixtureName, error: err.message });
      continue;
    }

    console.log(`FIXTURE: ${fixtureName}  [deviceKey=${fixture.deviceKey}]`);
    console.log(hr("─"));

    // Resolve line items (name + code; no catalog needed here)
    const { items: lineItems, unmapped: selectionUnmapped } = resolveLineItems(fixture);

    // Build Seazona payload (uses codeToId to map code → id)
    const { payload, warnings, unmapped: payloadUnmapped } = buildSeazonaOrderPayload(fixture, {
      codeToId,
      userId: "DRYRUN",
    });

    const generatedNames = lineItems.map((li) => li.name);
    const resolvedToId = payload.items.length;
    const unresolvedCodes = lineItems.filter((li) => !codeToId[li.code]).map((li) => li.code);

    console.log();
    console.log(`Generated line items (${lineItems.length}):`);
    for (const li of lineItems) {
      const id = codeToId[li.code] ? `id=${codeToId[li.code]}` : "(no catalog id)";
      const archLabel = li.arch != null ? `arch=${li.arch}` : "arch=null";
      console.log(
        `  [${pad(li.source, 18)}] ${li.name}`
      );
      console.log(
        `    code=${li.code}  ${id}  ${archLabel}`
      );
    }

    if (warnings.length) {
      console.log();
      console.log("Warnings:");
      for (const w of warnings) console.log(`  ! ${w}`);
    }

    console.log();
    console.log("Compiled notes preview:");
    const notesPreview = payload.notes
      ? (payload.notes.length > 120 ? payload.notes.slice(0, 117) + "..." : payload.notes)
      : "(none)";
    console.log(`  ${notesPreview}`);

    // Find best-matching real order: first order whose products[] contain the
    // fixture's primary product name as a case-insensitive substring.
    const primaryName = generatedNames[0];
    let bestMatch = null;
    if (primaryName) {
      const needle = primaryName.toLowerCase();
      bestMatch =
        orderDetails.find((od) =>
          od.products.some((p) => typeof p.name === "string" && p.name.toLowerCase().includes(needle))
        ) || null;
    }

    console.log();
    if (bestMatch) {
      const orderId = bestMatch.invoiceNumber || bestMatch.id || "(unknown)";
      const realProductNames = bestMatch.products.map((p) => p.name || "");
      console.log(`Matched real order: ${orderId}`);
      console.log(`  Real products (${realProductNames.length}):`);
      for (const n of realProductNames) console.log(`    • ${n}`);

      const { matched, missingFromOurs, extraInOurs } = diffOrderLines(
        generatedNames,
        bestMatch.products
      );
      console.log();
      console.log("  Diff against real order:");
      if (matched.length) {
        console.log(`    MATCHED       (${matched.length}): ${matched.join(" | ")}`);
      }
      if (missingFromOurs.length) {
        console.log(`    MISSING-OURS  (${missingFromOurs.length}): ${missingFromOurs.join(" | ")}`);
        console.log(
          "      (products in the real order that our builder did not generate — may need mapping)"
        );
      }
      if (extraInOurs.length) {
        console.log(`    EXTRA-IN-OURS (${extraInOurs.length}): ${extraInOurs.join(" | ")}`);
        console.log(
          "      (products our builder generates that the real order does not have)"
        );
      }
      if (!matched.length && !missingFromOurs.length && !extraInOurs.length) {
        console.log("    (nothing to diff — empty line items on both sides)");
      }
    } else {
      console.log("No comparable real order found in sample.");
      if (!primaryName) console.log("  (primary product could not be resolved — check device mapping)");
      else console.log(`  (searched for "${primaryName}" in ${orderDetails.length} fetched orders)`);
    }

    summaryRows.push({
      fixture: fixtureName,
      deviceKey: fixture.deviceKey,
      generatedLines: lineItems.length,
      resolvedToId,
      unresolvedCodes,
      selectionUnmapped,
      warnings: warnings.length,
      realOrderFound: !!bestMatch,
      matchedOrderId: bestMatch ? (bestMatch.invoiceNumber || bestMatch.id) : null,
    });

    console.log();
  }

  // ── Step 4: Summary ───────────────────────────────────────────────────────
  console.log(hr("="));
  console.log("COVERAGE SUMMARY");
  console.log(hr("="));
  console.log();
  console.log(
    `${"Fixture".padEnd(24)} ${"Lines".padStart(5)} ${"→Id".padStart(4)} ${"Unresolved".padStart(10)} ${"Real Order".padStart(10)}`
  );
  console.log(hr("-", 60));

  let comparablesFound = 0;
  for (const r of summaryRows) {
    if (r.error) {
      console.log(`${r.fixture.padEnd(24)} ERROR: ${r.error}`);
      continue;
    }
    const found = r.realOrderFound ? "found" : "none";
    console.log(
      `${r.fixture.padEnd(24)} ${pad(r.generatedLines, 5, true)} ${pad(r.resolvedToId, 4, true)} ${pad(r.unresolvedCodes.length, 10, true)}  ${found}`
    );
    if (r.unresolvedCodes.length) {
      console.log(`  codes without catalog id: ${r.unresolvedCodes.join(", ")}`);
    }
    if (r.selectionUnmapped.length) {
      console.log(`  unmapped selections (no code at all): ${r.selectionUnmapped.join(", ")}`);
    }
    if (r.matchedOrderId) {
      console.log(`  matched real order: ${r.matchedOrderId}`);
    }
    if (r.realOrderFound) comparablesFound++;
  }

  console.log();
  console.log(`Catalog reachable:           ${catalogReachable ? `yes (${catalogProductCount} products)` : "no — all codes unresolved"}`);
  console.log(`Real orders fetched:         ${orderDetails.length} (from ${totalOrderListEntries} list entries across ${PRODUCTIVE_DATES.length} date anchors)`);
  console.log(`Fixtures with real match:    ${comparablesFound}/${FIXTURES.length}`);
  if (orderFetchError) {
    console.log(`Order fetch warning:         ${orderFetchError}`);
  }
  console.log();
  console.log("DONE — zero writes made to Seazona (listProducts/getOrders/getOrder only).");
  console.log(hr("="));
}

main().catch((err) => {
  console.error("rx-dryrun fatal error:", err);
  process.exit(1);
});
