/**
 * Classify one replay difference (an "atom": a code generated but not billed,
 * a code billed but not generated, or a held selection) in the context of its
 * case. Three classes, plus a fallback:
 *
 *   translator bug — the JotForm → portal translation lost or changed an answer
 *   mapping bug    — the portal's rule (or an open ruling) disagrees with what
 *                    the lab consistently bills for the same answers
 *   lab variance   — something the form cannot know: straps, retail add-ons,
 *                    remake parts, a device described only in free text, staff
 *                    adding or dropping a line, data-entry slips
 *
 * The rules below were written from the Aug–Oct 2026 replay (437 cases); each
 * cites the evidence that justified it. They classify — they never change what
 * the portal generates.
 */

// Accessories and retail items the form has no question for.
const LAB_ONLY = {
  straps: { test: (c, n) => /strap/i.test(n), note: "DDSO strap sizes are chosen by the lab; the form has no strap question." },
  threePiece: { test: (c) => c === "2345" || c === "2346", note: "3-piece DDSO lower (with/without attachments): one practice's standing preference, not a form answer (2345 on 10 of 25 DDSO + hooks Rx)." },
  retail: { test: (c) => ["2258", "2272", "2381"].includes(c), note: "Retail/consumable add-on (cleaner, Novadent, Aqualizer) — not on the Rx form." },
  bulbs: { test: (c) => c === "2329", note: "Removable Nylon Bulbs — no form question (with tongue positioners on 3 of 54 Rx)." },
  ddsoBuiltAs: { test: (c) => c === "2539" || c === "2411", note: "DDSO Rx built as Dorsal Pro (2539) or Klauer DDSO (2411) — a practice preference the form does not capture." },
  composite: { test: (c) => ["2311", "2312", "2326"].includes(c), note: "Composite build-ups/onlays/buttons are counted per tooth from free text." },
};

const REMAKE = (name = "") => /remake|warranty reprint/i.test(name);
const LOOP_CODES = new Set(["2300", "2301", "2303"]);
const MODEL_SERVICES = new Set(["2368", "2372", "2371"]);
const STONE_OD = new Set(["OD (PMT)", "Acrylic w/clasps", "Dual-Laminate"]);
const PHYSICAL_RECORDS = new Set(["PVS Impressions", "Stone/Resin Models"]);
const ORTHO_HOLD_CONSEQUENCE =
  "Consequence of a held ortho selection: the appliance/bands sit behind an open ruling, so the portal held the case instead of guessing.";

const result = (cls, note) => ({ cls, note });

/**
 * @param {{kind: "extra"|"missing"|"hold", code?: string, name?: string, key?: string}} a
 * @param {object} r — one replay result row (see run.mjs)
 */
export function classify(a, r) {
  const firstNo = typeof r.firstDevice === "string" && r.firstDevice.startsWith("No");
  const lab = r.actualAll || [];
  const generated = r.generated || [];

  if (a.kind === "hold") {
    if (a.key === "ortho:unspecified")
      return result("lab variance", "No appliance answered on the form (it was described in free text); the portal correctly holds it.");
    if (a.key.startsWith("ortho:"))
      return result("mapping bug", "Open ortho ruling — the resolver holds this selection by design; the lab's billed product is the evidence to rule on.");
    if (a.key.startsWith("guard:"))
      return result("mapping bug", "Open guard ruling (no material / single-arch picker). The lab billed Nylon (2166 / 2176) on most of these.");
    return result("mapping bug", "Held selection with no ruling.");
  }

  const { code, name = "" } = a;

  // Remakes: a "No" first-device answer billed at remake / warranty pricing.
  if (a.kind === "missing" && REMAKE(name) && code !== "2393")
    return firstNo
      ? result("mapping bug", "First device = \"No\" billed at the 25% remake / warranty-reprint SKU; the portal has no remake rule.")
      : result("lab variance", "Remake SKU on a case that answered \"first device: Yes\".");
  if (a.kind === "extra" && firstNo && lab.some((l) => REMAKE(l.name) && l.code !== "2393"))
    return result("mapping bug", "Full-price device generated where the lab billed the remake SKU (first device = \"No\").");

  // A device the form never named (free-text ortho): everything on it is lab variance.
  if (r.open?.includes("ortho:unspecified"))
    return result("lab variance", "Appliance described only in free text; nothing on the form names it.");

  // Model services. Articulation (2368) tracks a stone-model OD (PMT or
  // acrylic) and a Modified Tandem; duplication (2372) tracks a stone-model OD
  // plus a second device; neither tracks the device count as such.
  if (MODEL_SERVICES.has(code)) {
    const stoneOd = STONE_OD.has(r.odMaterial);
    const printedOd = Boolean(r.odMaterial) && !stoneOd;
    const physical = (r.records || []).some((x) => PHYSICAL_RECORDS.has(x));
    const tandem = r.orthoDevice === "Modified Tandem";
    if (code === "2371" && a.kind === "extra")
      return result("mapping bug", "Scan/Digitize Models (proposed) is generated for every PVS/model case; the lab billed it only on two-device cases, where it replaced Model Duplication 2372.");
    if (code === "2368" && a.kind === "missing" && (stoneOd || tandem))
      return result("mapping bug", "Articulate Models is billed whenever the case has an OD in PMT/acrylic (OD alone: 17 of 19) or a Modified Tandem (10 of 17); the portal bills it only for two or more devices.");
    if ((code === "2368" || code === "2372") && a.kind === "extra" && printedOd)
      return result("mapping bug", "An OD in BioFlex / Milled / Printed Nylon with a second device was billed without duplication or articulation (5 of 6); the portal bills both for any two devices.");
    if (code === "2372" && a.kind === "extra" && physical)
      return result("mapping bug", "PVS/model records on a two-device case: the lab billed Scan/Digitize 2371 instead of Model Duplication 2372 (6 of 6).");
    return result("lab variance", "Model service billed differently by staff on this case (no consistent rule behind it).");
  }
  if (code === "2367") {
    if (a.kind === "extra" && r.form === "ortho" && lab.filter((l) => l.code === "2367").length === 1)
      return result("mapping bug", "Ortho on one arch: the lab fabricates only that arch's model; the portal always bills two.");
    if (lab.length === 0) return result("lab variance", "The lab's order carries no lines at all.");
    return result("lab variance", "Model fabrication arch/count entered differently by staff (duplicate arch, or not billed).");
  }

  // Vertical shims ride on every loop / ramp.
  if (code === "2302" && a.kind === "missing")
    return generated.some((l) => LOOP_CODES.has(l.code))
      ? result("mapping bug", "A loop/ramp (ON Loop, BAB Loop, ON Ramp) was billed with Vertical Shims 2302 on 22 of 25 Rx; the portal emits the loop alone.")
      : result("lab variance", "Shims added by staff without a shim/loop answer.");

  // Guard: dual-arch rows double-billed / no-material rows held.
  if (r.deviceKeys?.includes("guard") && ["2176", "2163", "2166", "2165", "2170"].includes(code)) {
    if (a.kind === "extra")
      return result("mapping bug", "Two matrix rows that resolve to the same dual-arch appliance were billed twice.");
    if (r.open.some((k) => k.startsWith("guard:")))
      return result("mapping bug", "Consequence of a held guard row (no material); the lab billed this product.");
  }

  // Ortho.
  if (r.form === "ortho") {
    if (a.kind === "extra" && ["2198", "2199"].includes(code))
      return result("mapping bug", "Band product (2198 vs 2199 with tubes) disagrees with the proposed tube rule.");
    if (a.kind === "missing" && r.open.length) return result("mapping bug", ORTHO_HOLD_CONSEQUENCE);
  }

  if (a.kind === "extra" && code === "2608" && lab.some((l) => l.code === "2539" || l.code === "2411"))
    return result("lab variance", LAB_ONLY.ddsoBuiltAs.note);

  for (const rule of Object.values(LAB_ONLY)) if (rule.test(code, name)) return result("lab variance", rule.note);

  if (a.kind === "missing")
    return result("lab variance", "Billed by the lab with no matching answer on the form (staff addition, or free-text request).");
  return result("lab variance", "Answered on the form but not billed by the lab (staff dropped it, or the order was built differently).");
}
