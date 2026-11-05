import api from "../../config/api.js";

// Thin wrappers over the notifications routes (/notifications, /admin/notifications).
// Every call unwraps the { data } envelope.
const data = (res) => res.data.data;

export const fetchNotifications = async ({ limit, offset, unread, event } = {}) => {
  const params = { limit, offset };
  if (unread) params.unread = "true";
  if (event) params.event = event;
  return data(await api.get("/notifications", { params })); // { rows, total }
};
export const fetchUnreadCount = async () => data(await api.get("/notifications/unread-count")).count;
export const markRead = async (target) => data(await api.post("/notifications/read", target)); // { ids } | { all: true }

/** The read route takes at most 200 ids per call. */
export const READ_BATCH = 200;
export async function markReadMany(ids) {
  for (let i = 0; i < ids.length; i += READ_BATCH) await markRead({ ids: ids.slice(i, i + READ_BATCH) });
}
export const markUnread = async (id) => data(await api.post(`/notifications/${encodeURIComponent(id)}/unread`));
export const dismissNotification = async (id) => data(await api.delete(`/notifications/${encodeURIComponent(id)}`));

export const fetchPreferences = async () => data(await api.get("/notifications/preferences")); // [{ event, label, channels: { in_app, email } }]
export const savePreference = async ({ event, channel, enabled }) => data(await api.put("/notifications/preferences", { event, channel, enabled }));

export const fetchRecipients = async (event) => data(await api.get("/admin/notifications/recipients", { params: event ? { event } : {} }));
export const addRecipient = async (body) => data(await api.post("/admin/notifications/recipients", body));
export const setRecipientActive = async (id, active) => data(await api.patch(`/admin/notifications/recipients/${encodeURIComponent(id)}`, { active }));
export const removeRecipient = async (id) => data(await api.delete(`/admin/notifications/recipients/${encodeURIComponent(id)}`));
export const sendRecipientTest = async (id) => data(await api.post(`/admin/notifications/recipients/${encodeURIComponent(id)}/test`));
export const fetchDeliveries = async (params) => data(await api.get("/admin/notifications/deliveries", { params })); // { rows, total }
export const fetchEvents = async () => data(await api.get("/admin/notifications/events")); // [{ key, label, sms }]
export const fetchChannels = async () => data(await api.get("/admin/notifications/channels")); // { sms: { provider, ok, reason? }, email: { configured } }
