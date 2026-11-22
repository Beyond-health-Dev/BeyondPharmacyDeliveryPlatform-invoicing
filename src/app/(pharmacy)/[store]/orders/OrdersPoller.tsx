"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OrdersPoller() {
  const router = useRouter();

  useEffect(() => {
    // A hidden tab (the dashboard is where staff land after signing in)
    // shouldn't keep asking the server for fresh pages. Catch up once when
    // it's shown again.
    const hidden = () => document.visibilityState === "hidden";
    let missed = false;
    const interval = setInterval(() => {
      if (hidden()) {
        missed = true;
        return;
      }
      router.refresh();
    }, 15000);
    const onVisibilityChange = () => {
      if (hidden() || !missed) return;
      missed = false;
      router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}
