"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { notificationMarker, notificationTitle } from "@/lib/statusTheme";

interface Notification {
  id: string;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

const timeFormat = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Vancouver",
});

export default function NotificationPanel({ storeSlug }: { storeSlug: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [dismissError, setDismissError] = useState(false);
  const [pendingIds, setPendingIds] = useState(() => new Set<string>());
  const acknowledged = useRef(new Set<string>());
  const heading = useRef<HTMLHeadingElement>(null);
  const endpoint = "/api/" + storeSlug + "/notifications";

  const fetchNotifications = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      if (!response.ok) throw new Error();
      const items: Notification[] = await response.json();
      if (signal?.aborted) return;
      setNotifications(items.map((item) =>
        acknowledged.current.has(item.id) ? { ...item, isRead: true } : item
      ));
      setLoadState("ready");
    } catch {
      if (!signal?.aborted) setLoadState("error");
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    const poll = () => void fetchNotifications(controller.signal);
    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchNotifications]);

  async function markAsRead(id: string, trigger: HTMLButtonElement) {
    if (pendingIds.has(id)) return;
    setPendingIds((previous) => new Set(previous).add(id));
    setDismissError(false);
    try {
      const response = await fetch(endpoint + "/" + id, { method: "PATCH" });
      if (!response.ok) throw new Error();
      acknowledged.current.add(id);
      if (document.activeElement === trigger) heading.current?.focus({ preventScroll: true });
      setNotifications((previous) => previous.map((item) =>
        item.id === id ? { ...item, isRead: true } : item
      ));
    } catch {
      setDismissError(true);
    } finally {
      setPendingIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }

  const unreadCount = notifications.filter((item) => !item.isRead).length;

  return (
    <section className="delivery-panel delivery-activity" id="delivery-activity" aria-labelledby="delivery-activity-title" tabIndex={-1}>
      <div className="delivery-panel-heading">
        <h2 id="delivery-activity-title" ref={heading} tabIndex={-1}><Bell size={19} strokeWidth={1.8} aria-hidden="true" /> Activity</h2>
        <span className={unreadCount > 0 ? "delivery-unread-count" : "sr-only"} aria-live="polite">
          {unreadCount > 0 ? unreadCount + " new" : "No new notifications"}
        </span>
      </div>
      {loadState === "error" && (
        <div className="delivery-activity-message">
          <p role="status">Couldn’t load activity.</p>
          <button type="button" className="delivery-text-link" onClick={() => void fetchNotifications()}>
            Retry
          </button>
        </div>
      )}
      {dismissError && (
        <p className="delivery-activity-message" role="status">Couldn’t dismiss the notification. Try again.</p>
      )}
      {loadState === "loading" && <p className="delivery-activity-message" role="status">Loading activity…</p>}
      {loadState === "ready" && notifications.length === 0 && (
        <p className="delivery-activity-message">No recent activity.</p>
      )}
      {notifications.length > 0 && (
        <ul className="delivery-activity-list" aria-label="Latest activity" tabIndex={0}>
          {notifications.map((notification) => {
            const title = notificationTitle(notification.type);
            const pending = pendingIds.has(notification.id);
            return (
              <li key={notification.id} className="delivery-activity-item" data-unread={!notification.isRead}>
                <span className={"delivery-activity-dot " + notificationMarker(notification.type)} aria-hidden="true" />
                <div>
                  <h3>{title}{!notification.isRead && <span className="sr-only"> (new)</span>}</h3>
                  <p>{notification.message}</p>
                  <time dateTime={notification.createdAt}>{timeFormat.format(new Date(notification.createdAt))}</time>
                </div>
                {!notification.isRead && (
                  <button
                    type="button"
                    className="delivery-dismiss"
                    aria-disabled={pending}
                    aria-busy={pending}
                    onClick={(event) => void markAsRead(notification.id, event.currentTarget)}
                    title="Dismiss notification"
                    aria-label={"Dismiss notification: " + title}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
