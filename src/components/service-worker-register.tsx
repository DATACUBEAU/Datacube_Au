"use client";

import { useEffect } from "react";
import { logEvent } from "@/lib/analytics";
import { logOnce } from "@/lib/log/dedupe";
import {
  ensureHealthyServiceWorkerRegistration,
  recoverBrokenServiceWorkerRuntime,
} from "@/lib/pwa/service-worker-client";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      ensureHealthyServiceWorkerRegistration()
        .then((registration) => {
          if (!registration) {
            logOnce(
              "warn",
              "sw:register:skipped-broken",
              "Service Worker registration skipped because the fetched script was broken. Existing runtime caches were cleared.",
            );
            logEvent("sw_register_skipped_broken", {});
            return;
          }

          if (registration.waiting) {
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
          }
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
          void recoverBrokenServiceWorkerRuntime().catch(() => undefined);
        });
    }
  }, []);

  return null;
}
