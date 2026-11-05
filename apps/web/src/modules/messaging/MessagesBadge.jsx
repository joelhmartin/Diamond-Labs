import { useEffect } from "react";
import { useUnreadPoll } from "../notifications/useUnreadPoll.js";
import { fetchUnreadCount, MESSAGES_CHANGED } from "./api.js";

/** A small count pill for a nav item: polls the unread count, refreshes at once after messaging changes, hides at zero. */
export function MessagesBadge({ className = "" }) {
  const { count, refresh } = useUnreadPoll(fetchUnreadCount);
  useEffect(() => {
    window.addEventListener(MESSAGES_CHANGED, refresh);
    return () => window.removeEventListener(MESSAGES_CHANGED, refresh);
  }, [refresh]);
  if (count <= 0) return null;
  return (
    <span aria-label={`${count} unread`} className={`rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white ${className}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
