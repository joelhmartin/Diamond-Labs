#!/usr/bin/env node
/**
 * Rx replay harness — replays real JotForm prescriptions through the portal's
 * mapping and measures how closely the generated orders match what the lab
 * actually billed in Seazona.
 *
 *   node apps/api/scripts/rx-replay/run.mjs <cases.json> [--out report.md] [--overrides overrides.json] [--dump cases-out.json]
 *
 * <cases.json> is an array of { form: "rx"|"ortho", answers, actual: [{code, name, arch}] }.
 * It holds real (de-identified) prescriptions — keep it OUT of the repo, and
 * keep --out / --dump outside the repo too.
 *
 * Per case: JotForm answers → jotformToPortalAnswers → buildFormDevices
 * (packages/shared) → linesForDevices with the case's form answers (exactly
 * what POST /rx/form-submissions seeds) → compared with `actual`.
 *
 * No database: overrides default to none (the static mapping tables only).
 * Pass --overrides with a { mapKey: { code, name, noteOnly } } JSON to replay
 * against a snapshot of rx_code_overrides.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// case-lines.service.js reaches config/env.js (which exits without these) and
// creates a lazy postgres client — no connection is ever opened. Same
// placeholders as apps/api/vitest.config.js.
process.env.DATABASE_URL ||= "postgresql://replay:replay@localhost:5432/replay";
process.env.JWT_SECRET ||= "replay-harness-placeholder-not-a-real-secret";

const { buildFormDevices } = await import("@my-app/shared");
const { linesForDevices } = await import("../../src/services/rx/case-lines.service.js");
const { canRelease } = await import("../../src/services/rx/case-gates.js");
const { jotformToPortalAnswers, portalFormType } = await import("./translate.js");
const { compareLines } = await import("./compare.js");
const { renderReport } = await import("./report.js");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const input = process.argv[2];
if (!input || input.startsWith("--")) {
  console.error("usage: node apps/api/scripts/rx-replay/run.mjs <cases.json> [--out report.md] [--overrides overrides.json] [--dump cases-out.json]");
  process.exit(2);
}

const cases = JSON.parse(await readFile(resolve(input), "utf8"));
const overrides = arg("--overrides") ? JSON.parse(await readFile(resolve(arg("--overrides")), "utf8")) : {};

const results = cases.map((c, index) => {
  const warnings = [];
  const formData = jotformToPortalAnswers(c.form, c.answers, { onWarning: (w) => warnings.push(w) });
  const devices = buildFormDevices(portalFormType(c.form), formData);
  const lines = linesForDevices(devices, { overrides, formData });
  const gate = canRelease(lines);
  return {
    index,
    form: c.form,
    family: devices.map((d) => d.deviceKey).sort().join(" + ") || "(no device)",
    deviceKeys: devices.map((d) => d.deviceKey),
    // Option strings only (never free text) — classify.js reads them for context.
    firstDevice: formData.firstDevice ?? null,
    odMaterial: formData.odMaterial ?? null,
    records: [].concat(formData.records ?? []),
    orthoDevice: c.form === "ortho" ? (formData.selectDevice ?? null) : null,
    actualAll: (c.actual || []).map((l) => ({ code: String(l.code), name: l.name ?? null })),
    warnings,
    pushable: gate.ok,
    holdReason: gate.ok ? null : gate.reason,
    ...compareLines(lines, c.actual || []),
  };
});

const report = renderReport(results, { input, overrides: Object.keys(overrides).length });
process.stdout.write(report);
if (arg("--out")) await writeFile(resolve(arg("--out")), report);
if (arg("--dump")) await writeFile(resolve(arg("--dump")), JSON.stringify(results, null, 2));
