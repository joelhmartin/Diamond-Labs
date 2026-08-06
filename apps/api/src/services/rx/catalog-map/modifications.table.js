/** Modification / attachment selections → Seazona product codes. */
export const MODIFICATION_ROWS = [
  { mapKey: "mod:tongue-positioners", match: ["Tongue Positioners"],                          code: "2330", name: "Removable Tongue Positioners (Nylon)", status: "confirmed" },
  { mapKey: "mod:hooks-elastics",     match: ["Hooks for Elastics"],                          code: "2319", name: "Hooks For Elastic Retention",          status: "confirmed" },
  { mapKey: "mod:vertical-shims",     match: ["Vertical Shims", "Vertical Shims (Printed Only)"], code: "2302", name: "Vertical Shims (Nylon)",          status: "confirmed" },
  { mapKey: "mod:on-loop",            match: ["ON Loop"],                                     code: "2300", name: "ON LOOP",                              status: "confirmed" },
  { mapKey: "mod:bab-loop",           match: ["BAB Loop"],                                    code: "2303", name: "BAB-LOOP",                             status: "confirmed" },
  { mapKey: "mod:on-ramp",            match: ["ON Ramp"],                                     code: "2301", name: "ON-Ramp ONLY (ON-LOOP W/ Closed Hole)", status: "confirmed" },
  { mapKey: "mod:labial-bow",         match: ["Labial bow"],                                  code: "2184", name: "Labial Bow",                           status: "confirmed" },
  { mapKey: "mod:hooks-lip-seal",     match: ["Hooks for lip-seal"],                          code: "2319", name: "Hooks For Elastic Retention",          status: "proposed" },

  // No catalog product corresponds to these. They are design instructions and
  // must reach the lab as notes, never as a guessed line item.
  { mapKey: "mod:wrap-distal",          match: ["Wrap distal of last molars", "Wrap Distal"],           code: null, name: "Wrap distal of last molars",  status: "open" },
  { mapKey: "mod:molars-uncovered",     match: ["Keep last molars uncovered", "Do not cover last molars"], code: null, name: "Keep last molars uncovered", status: "open" },
  { mapKey: "mod:holes-for-cusps",      match: ["Create holes for cusps (minimum vertical)"],           code: null, name: "Create holes for cusps",      status: "open" },
  { mapKey: "mod:anterior-pad",         match: ["Anterior Pad"],                                        code: null, name: "Anterior Pad",                status: "open" },
  { mapKey: "mod:no-anterior-buildup",  match: ["No anterior buildup on trutaine/essix"],               code: null, name: "No anterior buildup",         status: "open" },
];
