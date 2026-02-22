"use client";

import { useEffect } from "react";
import { logEvent } from "@/lib/analytics";
import { logOnce } from "@/lib/log/dedupe";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          logOnce(
            "log",
            "sw:register:success",
            "Service Worker registration successful with scope: ",
            registration.scope
          );
          logEvent("sw_register_success", { scope: registration.scope });
        })
        .catch((err) => {
          logOnce("warn", "sw:register:failed", "Service Worker registration failed: ", err);
          logEvent("sw_register_failed", { message: String(err?.message || err) });
        });
    }
  }, []);

  return null;
}
