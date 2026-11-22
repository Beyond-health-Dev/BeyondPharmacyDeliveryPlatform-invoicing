"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { card, cn, emptyState, sectionTitle, tintedLinkButton } from "@/lib/portalStyles";
import { notificationStyle, notificationTitle, toneBadgeClasses } from "@/lib/statusTheme";

interface Notification {
  id: string;
  orderId: string | null;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export default function NotificationPanel({ storeSlug }: { storeSlug: string }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    const res = await fetch(`/api/${storeSlug}/notifications`);
    if (res.ok) {
      const data = await res.json();
      setNotifications(data);
    }
    setLoading(false);
  }, [storeSlug]);

  useEffect(() => {
    const initial = setTimeout(fetchNotifications, 0);
    // Poll every 30 seconds
    const interval = setInterval(fetchNotifications, 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    await fetch(`/api/${storeSlug}/notifications/${id}`, { method: "PATCH" });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
    router.refresh();
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  if (loading) return null;

  return (
    <div className={card}>
      <div className="px-6 py-4 border-b border-hairline flex items-center justify-between">
        <h2 className={sectionTitle}>Notifications</h2>
        {unreadCount > 0 && (
          <span className={toneBadgeClasses("blush")}>
            {unreadCount} new
          </span>
        )}
      </div>
      {notifications.length === 0 ? (
        <div className={cn(emptyState, "m-4")}>
          No <span className="text-navy">notifications</span>
        </div>
      ) : (
        <div className="divide-y divide-hairline max-h-96 overflow-y-auto">
          {notifications.map((n) => {
            const style = notificationStyle(n.type);
            // New notifications sit on a pastel fill, where all text is navy.
            return (
              <div
                key={n.id}
                className={`px-6 py-3 ${
                  !n.isRead ? style.unread : ""
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${style.marker}`}
                      />
                      <span className={n.isRead ? style.badge : toneBadgeClasses("white")}>
                        {notificationTitle(n.type)}
                      </span>
                    </div>
                    <p className={cn("text-sm mt-2", n.isRead ? "text-ink" : "text-navy")}>{n.message}</p>
                    <p className={cn("text-xs mt-1 tabular-nums", n.isRead ? "text-muted" : "text-navy")}>
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {!n.isRead && (
                    <button
                      onClick={() => markAsRead(n.id)}
                      className={cn(tintedLinkButton, "ml-3 whitespace-nowrap text-xs")}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
