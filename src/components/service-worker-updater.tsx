"use client";

import { useEffect } from "react";

async function refreshServiceWorkers(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const registration of registrations) {
    try {
      // Ask waiting worker to activate immediately when available.
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      await registration.update();
    } catch {
      // Best effort.
    }
  }
}

export function ServiceWorkerUpdater() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    void refreshServiceWorkers();
    const interval = window.setInterval(() => {
      void refreshServiceWorkers();
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return null;
}

