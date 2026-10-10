/** The lab-access toggle on Admin › Users (mirrors lib/staff-roles.js on the API). */
export function roleToggle(user, currentUserId) {
  if (user.id === currentUserId) return null;
  if (user.role === "user") return { role: "lab", label: "Make lab staff" };
  if (user.role === "lab") return { role: "user", label: "Remove lab access" };
  return null;
}

export const SOURCE_LABELS = { rx_case: "Rx case", shop_order: "Shop order" };
export const sourceLabel = (source) => SOURCE_LABELS[source] ?? source;
