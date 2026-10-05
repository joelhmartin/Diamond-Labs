/**
 * How a resolved Rx case got resolved. `status` collapses "we sent it to
 * Seazona" and "staff entered it in Seazona by hand" to the same terminal
 * `pushed` value — `seazonaPushStatus` is the field that keeps them visually
 * distinguishable.
 *
 * Shared by the case detail page and the case queue list page so the tag
 * reads identically in both places. Lives here — not in either page — so
 * neither page has to import it from the other.
 *
 * @param {string|null|undefined} seazonaPushStatus
 * @returns {string|null}
 */
export function resolutionLabel(seazonaPushStatus) {
  if (seazonaPushStatus === "pushed") return "Sent to Seazona";
  if (seazonaPushStatus === "manual") return "Added manually";
  return null;
}
