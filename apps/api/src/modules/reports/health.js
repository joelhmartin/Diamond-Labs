/**
 * Activity health: is an entity's recent activity holding up against its own
 * baseline? Pure; the host supplies the counts and the thresholds.
 *
 *   recent    activity count in the recent window
 *   baseline  typical count for a window of the same length (already averaged)
 *   lastAt    most recent activity (Date | ISO string | null)
 *
 * Bands, checked in sequence: inactive (nothing within inactiveDays), declining
 * (ratio < declining), stable (ratio < stable), healthy. With no baseline but
 * recent activity the entity is healthy and flagged isNew.
 */
const DAY_MS = 86400000;
const asTime = (v) => (v == null ? null : new Date(v).getTime());

export function activityHealth({ recent, baseline, lastAt, asOf }, { inactiveDays, declining, stable }) {
  const now = asTime(asOf);
  if (now == null || Number.isNaN(now)) throw new Error("activityHealth requires a valid asOf date");
  const last = asTime(lastAt);
  const idleDays = last == null ? Infinity : (now - last) / DAY_MS;
  if (idleDays > inactiveDays) return { band: "inactive", trend: null, isNew: false };

  if (!(baseline > 0)) {
    // Active inside the window but no history to compare against.
    return recent >= 1
      ? { band: "healthy", trend: null, isNew: true }
      : { band: "stable", trend: null, isNew: false };
  }
  const trend = recent / baseline;
  const band = trend < declining ? "declining" : trend < stable ? "stable" : "healthy";
  return { band, trend, isNew: false };
}
