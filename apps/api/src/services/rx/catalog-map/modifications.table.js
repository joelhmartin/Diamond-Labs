/**
 * Modification / attachment selections → Seazona product codes.
 *
 * `match` holds EVERY form literal that resolves to a row — the consolidated Rx
 * form's wording AND the older wizard's (apps/web/src/data/rx-devices.js:
 * COMMON_MODIFICATIONS and the per-device lists). The wizard at /app/cases/new
 * is live and is the only producer that populates rx_cases.deviceKey /
 * deviceOptions, so a literal it can emit must resolve here or the order fails
 * the ok gate. Several wizard literals ("Anterior ramp", "Posterior pads",
 * "Soft liner", "Lingual bar", "Relief over bony prominences", "Trim to
 * gumline", …) have NO catalog equivalent — they are deliberately left
 * unmatched so they surface as `unmapped` rather than resolving to a guess.
 */
export const MODIFICATION_ROWS = [
  { mapKey: "mod:tongue-positioners", match: ["Tongue Positioners"],                          code: "2330", name: "Removable Tongue Positioners (Nylon)", status: "confirmed" },
  { mapKey: "mod:hooks-elastics",     match: ["Hooks for Elastics"],                          code: "2319", name: "Hooks For Elastic Retention",          status: "confirmed" },
  { mapKey: "mod:vertical-shims",     match: ["Vertical Shims", "Vertical Shims (Printed Only)"], code: "2302", name: "Vertical Shims (Nylon)",          status: "confirmed" },
  { mapKey: "mod:on-loop",            match: ["ON Loop"],                                     code: "2300", name: "ON LOOP",                              status: "confirmed" },
  { mapKey: "mod:bab-loop",           match: ["BAB Loop"],                                    code: "2303", name: "BAB-LOOP",                             status: "confirmed" },
  { mapKey: "mod:on-ramp",            match: ["ON Ramp"],                                     code: "2301", name: "ON-Ramp ONLY (ON-LOOP W/ Closed Hole)", status: "confirmed" },
  { mapKey: "mod:labial-bow",         match: ["Labial bow"],                                  code: "2184", name: "Labial Bow",                           status: "confirmed" },
  { mapKey: "mod:hooks-lip-seal",     match: ["Hooks for lip-seal"],                          code: "2319", name: "Hooks For Elastic Retention",          status: "proposed" },
  // Carried over from the retired device-seazona-map, where it was the one
  // ortho modification recorded WITHOUT a "TODO verify" marker. 2307 re-verified
  // against the live catalog 2026-08-06 — one product, exact name "Buccal Tubes".
  // The literal is still offered by both producers (digital-rx.form.js
  // addToMaxillary/addToMandibular, and the wizard's ORTHO_OPTIONS).
  { mapKey: "mod:buccal-tubes-bands", match: ["Buccal tubes to bands"],                       code: "2307", name: "Buccal Tubes",                         status: "confirmed" },

  // No catalog product corresponds to these. They are design instructions and
  // must reach the lab as notes, never as a guessed line item.
  { mapKey: "mod:wrap-distal",          match: ["Wrap distal of last molars", "Wrap Distal"],           code: null, name: "Wrap distal of last molars",  status: "open", reason: "No catalog product matches this. Should it be a priced add-on, or a build instruction only?" },
  { mapKey: "mod:molars-uncovered",     match: ["Keep last molars uncovered", "Do not cover last molars"], code: null, name: "Keep last molars uncovered", status: "open", reason: "No catalog product matches this. Should it be a priced add-on, or a build instruction only?" },
  { mapKey: "mod:holes-for-cusps",      match: ["Create holes for cusps (minimum vertical)"],           code: null, name: "Create holes for cusps",      status: "open", reason: "No catalog product matches this. Should it be a priced add-on, or a build instruction only?" },
  { mapKey: "mod:anterior-pad",         match: ["Anterior Pad"],                                        code: null, name: "Anterior Pad",                status: "open", reason: "No catalog product matches this. Should it be a priced add-on, or a build instruction only?" },
  { mapKey: "mod:no-anterior-buildup",  match: ["No anterior buildup on trutaine/essix"],               code: null, name: "No anterior buildup",         status: "open", reason: "No catalog product matches this. Should it be a priced add-on, or a build instruction only?" },
];
