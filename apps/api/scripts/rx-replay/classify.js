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
 * the portal generates. They describe the mapping as it stands after
 * fix/rx-replay-mapping: a difference a mapping rule already covers by its
 * majority evidence is the leftover minority, i.e. lab variance.
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
const GUARD_CODES = new Set(["2176", "2163", "2166", "2165", "2170"]);
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

  // Model services, model fabrication, loop shims and guard defaults now follow
  // the lab's majority rule (catalog-map/lab-services.js, modifications.table.js,
  // resolvers/guard.js). What still differs is the minority the rule's own
  // evidence share leaves over — an exception, not a rule to change.
  if (MODEL_SERVICES.has(code))
    return result("lab variance", "Exception to the stone-model rule (articulation 83–98% by material; duplication with a second device; scan instead of duplicate for printed devices).");
  if (code === "2367") {
    if (lab.length === 0) return result("lab variance", "The lab's order carries no lines at all.");
    if (r.form === "ortho")
      return result("lab variance", "Ortho model arches entered differently (single-arch rule: the appliance's arch only; a free-text or removable appliance can need both).");
    return result("lab variance", "Model fabrication arch/count entered differently by staff (duplicate arch, or not billed).");
  }
  if (code === "2302")
    return result("lab variance", generated.some((l) => LOOP_CODES.has(l.code))
      ? "Exception to loops-imply-shims (billed together on 77–97%)."
      : "Shims added by staff without a shim/loop answer.");
  if (r.deviceKeys?.includes("guard") && GUARD_CODES.has(code) && r.open.some((k) => k.startsWith("guard:")))
    return result("mapping bug", "Consequence of a held guard row; the lab billed this product.");

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
