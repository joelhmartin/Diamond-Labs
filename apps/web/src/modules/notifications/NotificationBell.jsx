import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Loader2 } from "lucide-react";
import { fetchNotifications, fetchUnreadCount, markRead } from "./api.js";
import { useUnreadPoll } from "./useUnreadPoll.js";
import { alertTitle, formatWhen } from "./format.js";

const LATEST = 8;

/**
 * Bell with an unread badge (capped at 99+). Opening it lists the latest alerts;
 * `to` is the "See all" path for the shell it sits in.
 */
export function NotificationBell({ to, timeZone, intervalMs }) {
  const { count, refresh, setCount } = useUnreadPoll(fetchUnreadCount, { intervalMs });
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    refresh();
    fetchNotifications({ limit: LATEST, offset: 0 })
      .then((r) => { if (live) setRows(r.rows ?? []); })
      .catch(() => { if (live) setRows([]); });
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => { live = false; document.removeEventListener("mousedown", away); };
  }, [open, refresh]);

  const openAlert = (n) => {
    setOpen(false);
    if (!n.readAt) markRead({ ids: [n.id] }).then(refresh).catch(() => {});
    if (n.link) navigate(n.link);
  };

  const readAll = async () => {
    await markRead({ all: true });
    setCount(0);
    setRows((list) => list?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? list);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900"
      >
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[1.1rem] text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-gray-900">Alerts</span>
            <button type="button" onClick={readAll} disabled={count === 0} className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-40">
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {rows == null && <li className="flex justify-center p-6"><Loader2 size={16} className="animate-spin text-gray-400" /></li>}
            {rows?.length === 0 && <li className="p-6 text-center text-sm text-gray-500">You are all caught up.</li>}
            {rows?.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openAlert(n)} className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-gray-50">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-brand-500"}`} />
                  <span className="min-w-0">
                    <span className={`block truncate text-sm ${n.readAt ? "text-gray-600" : "font-medium text-gray-900"}`}>{alertTitle(n)}</span>
                    <span className="block text-xs text-gray-400">{formatWhen(n.updatedAt, timeZone)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link to={to} onClick={() => setOpen(false)} className="block border-t border-gray-100 px-4 py-2.5 text-center text-xs font-medium text-brand-600 hover:bg-gray-50">
            See all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
