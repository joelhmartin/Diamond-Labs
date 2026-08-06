/**
 * Orthodontic appliance resolver.
 *
 * The catalog carries ~36 distinct ortho products (expanders, tandems, twin
 * blocks) selected by retention, screw type, clasp and base material. The form
 * captures those selections but the lab has not yet ruled on which combination
 * maps to which SKU — see the sign-off document (Task 12).
 *
 * Until then every selection is reported as UNMAPPED so it reaches the lab as a
 * flagged item and a note, rather than being dropped or guessed.
 */
export function resolveOrtho(deviceOptions = {}) {
  const unmapped = [];
  for (const key of ["applianceType", "upperArchRetention", "lowerArchRetention", "upperExpansionType", "lowerExpansionType"]) {
    const v = deviceOptions[key];
    if (v) unmapped.push(`ortho:${key}:${v}`);
  }
  if (unmapped.length === 0) unmapped.push("ortho:unspecified");
  return { items: [], unmapped };
}
