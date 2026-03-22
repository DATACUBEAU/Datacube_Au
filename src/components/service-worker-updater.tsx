"use client";

import { useEffect } from "react";
import { refreshHealthyServiceWorkers } from "@/lib/pwa/service-worker-client";

export function ServiceWorkerUpdater() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    void refreshHealthyServiceWorkers();
    const interval = window.setInterval(() => {
      void refreshHealthyServiceWorkers();
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
