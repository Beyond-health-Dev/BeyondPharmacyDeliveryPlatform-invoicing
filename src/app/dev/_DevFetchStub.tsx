"use client";

// Dev-only: answers the API calls fixture screens make on mount (notifications,
// due reminders, calendar, patient search, saved addresses...) so the style
// guide renders without a database or a signed-in session. Patched at module
// load — before any component effect runs — and only in the browser.
import {
  calendarInstances,
  dueReminders,
  notifications,
  patients,
  savedAddresses,
  TODAY,
} from "./_fixtures";

const PATCHED = Symbol.for("beyond.devFetchStub");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function answer(url: URL, method: string): Response {
  // /api/<store>/<...rest>
  const [, , ...rest] = url.pathname.split("/").filter(Boolean);
  const path = rest.join("/");

  if (method !== "GET" && method !== "HEAD") return json({ ok: true });
  if (path === "recurring/labels") {
    return json({ error: "Label PDFs need the real server — the style guide has no database." }, 404);
  }
  if (path === "notifications") return json(notifications);
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
    if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      return answer(url, method);
    }
    return realFetch(input, init);
  };
}

export default function DevFetchStub() {
  return null;
}
