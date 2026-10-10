/**
 * Rx case labels, shared by the case queue and the case page so a status
 * reads the same everywhere. `released` = on the production board (own-the-
 * lab piece 2). `pushed` and the `seazonaPushStatus` tags are legacy: cases
 * sent to Seazona before the lab moved to the portal.
 */
export const CASE_STATUS_LABELS = {
  new: "New",
  in_review: "In review",
  awaiting_doctor: "Awaiting doctor",
  released: "Released to lab",
  pushed: "Sent to Seazona (legacy)",
  failed: "Push failed (legacy)",
  cancelled: "Cancelled",
};

export function caseStatusLabel(s) {
  return CASE_STATUS_LABELS[s] || s;
}

/** How a legacy case reached Seazona: pushed by us, or typed in by hand. */
export function resolutionLabel(seazonaPushStatus) {
  if (seazonaPushStatus === "pushed") return "Sent to Seazona (legacy)";
  if (seazonaPushStatus === "manual") return "Added to Seazona by hand (legacy)";
  return null;
}
