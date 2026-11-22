"use client";

// Dev-only: answers the API calls fixture screens make on mount (notifications,
// due reminders, calendar, patient search, saved addresses...) so the style
// guide renders without a database or a signed-in session. Patched at module
// load — before any component effect runs — and only in the browser.
import { isHeldUntilDeliveryDay } from "@/lib/externalDispatchStatus";
import { calendarInstances, updatePreviewHold } from "./_recurringPreview";
import {
  drivers,
  dueReminders,
  notifications,
  patients,
  savedAddresses,
  TODAY,
} from "./_fixtures";

const PATCHED = Symbol.for("beyond.devFetchStub");
const dismissedNotifications = new Set<string>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// New Order with Anchor for a later day: the order POST holds it and answers
// with the dispatch summary (buildExternalDispatchResponse), so the "Anchor
// gets this order about 6 AM..." toast can be seen.
function heldAnchorOrder(body: unknown): Response | null {
  let order: { assignedDriverId?: unknown; scheduledDate?: unknown } | null = null;
  try {
    order = typeof body === "string" ? JSON.parse(body) : null;
  } catch {
    return null;
  }
  const anchor = drivers.find((d) => d.isExternal);
  if (
    !order ||
    order.assignedDriverId !== anchor?.id ||
    typeof order.scheduledDate !== "string" ||
    !isHeldUntilDeliveryDay(order.scheduledDate, TODAY)
  ) {
    return null;
  }
  return json(
    {
      external: true,
      provider: "SPOKE",
      externalReference: null,
      spokePlanId: null,
      spokeStopId: null,
      dispatchId: "x_new",
      status: "SCHEDULED",
    },
    201
  );
}

// Cancel and Retry on an Anchor row answer as the routes do, so the toasts
// can be seen. The failed send (x2) may have reached Anchor, so its cancel
// asks staff to check Anchor's list.
function anchorAction(path: string, method: string): Response | null {
  const match = path.match(/^external-dispatches\/([^/]+)(\/retry)?$/);
  if (!match) return null;
  if (method === "POST" && match[2]) return json({ message: "Sent to Anchor." });
  if (method !== "DELETE" || match[2]) return null;
  return match[1] === "x2"
    ? json({
        message:
          "Cancelled here, but the earlier send may have reached Anchor. Check Anchor's list in Spoke and remove it there if it shows up.",
        needsCheck: true,
      })
    : json({ message: "Cancelled. It was never sent to Anchor." });
}

function labelAssignmentCount(body: unknown) {
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : null;
    return Array.isArray(parsed?.assignments) ? parsed.assignments.length : 0;
  } catch {
    return 0;
  }
}

function answer(url: URL, method: string, body: unknown): Response {
  // /api/<store>/<...rest>
  const [, , ...rest] = url.pathname.split("/").filter(Boolean);
  const path = rest.join("/");
  if (updatePreviewHold(path, method, body)) return json({ ok: true });

  if (method === "POST" && path === "orders") {
    const held = heldAnchorOrder(body);
    return held ?? json({ error: "This preview uses sample data. New orders aren’t saved." }, 400);
  }
  const notificationPatch = path.match(/^notifications\/([^/]+)$/);
  if (method === "PATCH" && notificationPatch) {
    dismissedNotifications.add(notificationPatch[1]);
    return json({ ok: true });
  }
  const action = anchorAction(path, method);
  if (action) return action;
  // Saving the Rearrange labels panel: the route answers with counts, and the
  // panel only takes that reply as saved.
  if (method === "PUT" && path === "recurring/labels/assignments") {
    return json({ updated: labelAssignmentCount(body), missing: 0 });
  }
  if (method !== "GET" && method !== "HEAD") return json({ ok: true });
  if (path === "recurring/labels") {
    return json({ error: "Label PDFs need the real server — the style guide has no database." }, 404);
  }
  if (path === "notifications") {
    return json(notifications.map((item) => ({
      ...item,
      isRead: item.isRead || dismissedNotifications.has(item.id),
    })));
  }
  if (path === "reminders") {
    return url.searchParams.get("scope") === "due" &&
      window.location.pathname === "/dev/reminder-popup"
      ? json(dueReminders)
      : json({ dateKey: TODAY, items: [], outstanding: 0 });
  }
  if (path === "recurring/calendar") {
    const start = url.searchParams.get("start") ?? TODAY;
    const end = url.searchParams.get("end") ?? TODAY;
    return json({ instances: calendarInstances(start, end) });
  }
  if (path === "patients") {
    const q = (url.searchParams.get("search") ?? "").toLowerCase();
    return json(
      patients
        .filter((p) => !q || p.name.toLowerCase().includes(q))
        .map((p) => ({
          ...p,
          matchedAddressId: savedAddresses[p.id]?.[0]?.id ?? null,
          matchedAddress: savedAddresses[p.id]?.[0] ?? null,
        }))
    );
  }
  const addresses = path.match(/^patients\/([^/]+)\/addresses$/);
  if (addresses) return json(savedAddresses[addresses[1]] ?? []);
  const duplicates = path.match(/^patients\/([^/]+)\/duplicates$/);
  if (duplicates) {
    const patient = patients.find((p) => p.id === duplicates[1]);
    return json({
      current: patient
        ? { address: patient.address, city: patient.city, postalCode: patient.postalCode }
        : null,
      duplicates: [],
    });
  }
  if (path.startsWith("places/")) {
    return json({
      suggestions: [],
      unavailable: true,
      message: "Address suggestions aren't available in the style guide",
    });
  }
  return json({});
}

if (typeof window !== "undefined" && !(window as unknown as Record<symbol, boolean>)[PATCHED]) {
  (window as unknown as Record<symbol, boolean>)[PATCHED] = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    if (url.origin === window.location.origin && url.pathname.startsWith("/api/dev/")) {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      return answer(url, method, init?.body);
    }
    return realFetch(input, init);
  };
}

export default function DevFetchStub() {
  return null;
}
