/**
 * Sync Worker Plugin
 *
 * This module provides utilities for registering Background Sync
 * with the service worker and handling the sync event on the client side.
 *
 * It does NOT modify the auto-generated sw.js directly (which is owned
 * by next-pwa / Workbox). Instead, it uses the BackgroundSync API
 * at the application layer and falls back to online/visibility-based
 * sync when BackgroundSync is unavailable.
 */

const SYNC_TAG = 'dcau-write-sync';

/**
 * Register a one-shot Background Sync with the service worker.
 *
 * Called after enqueueing a write so the browser can wake the SW
 * when connectivity returns — even if the tab is closed.
 *
 * Falls back silently if Background Sync is not supported.
 */
export async function requestBackgroundSync(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    // Background Sync API (Chrome, Edge, Opera)
    if ('sync' in registration) {
      await (registration as any).sync.register(SYNC_TAG);
      return true;
    }

    // Periodic Background Sync API (experimental, mainly Chrome)
    if ('periodicSync' in registration) {
      try {
        const status = await navigator.permissions.query({
          name: 'periodic-background-sync' as PermissionName,
        });
        if (status.state === 'granted') {
          await (registration as any).periodicSync.register(SYNC_TAG, {
            minInterval: 60 * 60 * 1000, // 1 hour
          });
          return true;
        }
      } catch {
        // Periodic sync not available – fall through to false
      }
    }

    return false;
  } catch (err) {
    console.warn('[sync-worker-plugin] Could not register background sync:', err);
    return false;
  }
}

/**
 * Listen for SW messages related to sync.
 *
 * The service worker may post a message when a Background Sync
 * event fires, telling the client to process the queue.
 */
export function listenForSyncMessages(
  onSyncRequested: () => void,
): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => {};
  }

  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'DCAU_SYNC_REQUESTED') {
      onSyncRequested();
    }
  };

  navigator.serviceWorker.addEventListener('message', handler);
  return () => {
    navigator.serviceWorker.removeEventListener('message', handler);
  };
}

/**
 * Post a message to the active service worker.
 */
export async function postToServiceWorker(
  message: Record<string, unknown>,
): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage(message);
  } catch {
    // Ignore – SW may not be active
  }
}
