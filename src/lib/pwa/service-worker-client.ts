'use client';

import {
  PWA_RUNTIME_CACHE_BASE_NAMES,
  PWA_RUNTIME_CACHE_VERSION,
  isCurrentPwaRuntimeCacheName,
  isKnownPwaRuntimeCacheName,
  shouldDeleteStalePwaCacheName,
} from '../../../shared/pwa-runtime.js';

const BROKEN_SW_GLOBAL = '_pwacachepolicy';

function hasDefinedServiceWorkerGlobal(scriptText: string): boolean {
  const source = String(scriptText || '');
  return (
    /\b(?:const|let|var)\s+_pwacachepolicy\b/.test(source) ||
    /\bself\._pwacachepolicy\s*=/.test(source) ||
    /\bglobalThis\._pwacachepolicy\s*=/.test(source)
  );
}

export function extractImportedServiceWorkerScriptUrls(scriptText: string): string[] {
  const source = String(scriptText || '');
  const urls = new Set<string>();
  const importScriptsCalls = source.matchAll(/importScripts\(([^)]*)\)/g);

  for (const call of importScriptsCalls) {
    const args = call[1] ?? '';
    for (const literal of args.matchAll(/["']([^"']+)["']/g)) {
      const url = literal[1]?.trim();
      if (!url) continue;
      urls.add(url);
    }
  }

  return Array.from(urls);
}

export function isBrokenServiceWorkerScript(
  scriptText: string,
  importedScriptTexts: string[] = [],
): boolean {
  const source = String(scriptText || '');
  if (!source.includes(BROKEN_SW_GLOBAL)) return false;
  if (hasDefinedServiceWorkerGlobal(source)) return false;
  return !importedScriptTexts.some((text) => hasDefinedServiceWorkerGlobal(text));
}

export async function fetchServiceWorkerScript(
  scriptUrl = '/sw.js',
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(`${scriptUrl}?ts=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Cache-Control': 'no-store' },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchImportedServiceWorkerScripts(
  parentScriptText: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const importedUrls = extractImportedServiceWorkerScriptUrls(parentScriptText);
  const texts: string[] = [];

  for (const url of importedUrls) {
    try {
      const separator = url.includes('?') ? '&' : '?';
      const response = await fetchImpl(`${url}${separator}ts=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Cache-Control': 'no-store' },
      });
      if (!response.ok) continue;
      texts.push(await response.text());
    } catch {
      // Ignore per-script fetch failures and rely on the main registration path.
    }
  }

  return texts;
}

export async function deletePwaRuntimeCaches(options?: {
  includeCurrentVersion?: boolean;
  cacheNames?: string[];
}): Promise<string[]> {
  if (typeof window === 'undefined' || typeof caches === 'undefined') return [];

  const names = options?.cacheNames ?? await caches.keys();
  const removed: string[] = [];

  for (const name of names) {
    const shouldDelete = options?.includeCurrentVersion
      ? isKnownPwaRuntimeCacheName(name)
      : shouldDeleteStalePwaCacheName(name);

    if (!shouldDelete) continue;
    if (await caches.delete(name)) {
      removed.push(name);
    }
  }

  return removed;
}

export async function recoverBrokenServiceWorkerRuntime(): Promise<{
  unregistered: string[];
  deletedCaches: string[];
}> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return { unregistered: [], deletedCaches: [] };
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  const unregistered: string[] = [];

  for (const registration of registrations) {
    const scriptUrl =
      registration.active?.scriptURL ||
      registration.waiting?.scriptURL ||
      registration.installing?.scriptURL ||
      '';

    if (!scriptUrl) continue;
    if (!scriptUrl.startsWith(window.location.origin)) continue;

    const didUnregister = await registration.unregister().catch(() => false);
    if (didUnregister) {
      unregistered.push(scriptUrl);
    }
  }

  const deletedCaches = await deletePwaRuntimeCaches({ includeCurrentVersion: true });
  return { unregistered, deletedCaches };
}

type ServiceWorkerHealthcheckResult = {
  ok?: boolean;
  version?: string;
  hasPolicyShim?: boolean;
};

async function pingServiceWorker(
  worker: ServiceWorker | null | undefined,
  timeoutMs = 1500,
): Promise<ServiceWorkerHealthcheckResult | null> {
  if (!worker) return null;

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;

    const finish = (result: ServiceWorkerHealthcheckResult | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      channel.port1.onmessage = null;
      resolve(result);
    };

    const timeoutId = window.setTimeout(() => finish(null), timeoutMs);

    channel.port1.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') {
        finish(null);
        return;
      }
      finish(data as ServiceWorkerHealthcheckResult);
    };

    try {
      worker.postMessage({ type: 'PWA_RUNTIME_HEALTHCHECK' }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

async function hasHealthyExistingServiceWorker(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return true;

  const registrations = await navigator.serviceWorker.getRegistrations();
  const workers: Array<ServiceWorker | null | undefined> = [
    navigator.serviceWorker.controller,
    ...registrations.flatMap((registration) => [
      registration.active,
      registration.waiting,
      registration.installing,
    ]),
  ];

  const seen = new Set<ServiceWorker>();
  for (const worker of workers) {
    if (!worker || seen.has(worker)) continue;
    seen.add(worker);

    const result = await pingServiceWorker(worker);
    if (!result?.ok) return false;
    if (result.version !== PWA_RUNTIME_CACHE_VERSION) return false;
    if (result.hasPolicyShim !== true) return false;
  }

  return true;
}

export async function ensureHealthyServiceWorkerRegistration(options?: {
  scriptUrl?: string;
  registrationOptions?: RegistrationOptions;
  fetchImpl?: typeof fetch;
}): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;

  const scriptUrl = options?.scriptUrl ?? '/sw.js';
  const scriptText = await fetchServiceWorkerScript(scriptUrl, options?.fetchImpl ?? fetch);
  const importedScriptTexts = scriptText
    ? await fetchImportedServiceWorkerScripts(scriptText, options?.fetchImpl ?? fetch)
    : [];

  if (scriptText && isBrokenServiceWorkerScript(scriptText, importedScriptTexts)) {
    await recoverBrokenServiceWorkerRuntime();
    return null;
  }

  if (!(await hasHealthyExistingServiceWorker())) {
    await recoverBrokenServiceWorkerRuntime();
  }

  return navigator.serviceWorker.register(scriptUrl, {
    scope: '/',
    updateViaCache: 'none',
    ...(options?.registrationOptions ?? {}),
  });
}

export async function refreshHealthyServiceWorkers(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  const scriptText = await fetchServiceWorkerScript('/sw.js');
  const importedScriptTexts = scriptText
    ? await fetchImportedServiceWorkerScripts(scriptText)
    : [];
  if (scriptText && isBrokenServiceWorkerScript(scriptText, importedScriptTexts)) {
    await recoverBrokenServiceWorkerRuntime();
    return;
  }

  if (!(await hasHealthyExistingServiceWorker())) {
    await recoverBrokenServiceWorkerRuntime();
    await ensureHealthyServiceWorkerRegistration();
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  if (registrations.length === 0) {
    await ensureHealthyServiceWorkerRegistration();
    return;
  }

  for (const registration of registrations) {
    try {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      await registration.update();
    } catch {
      // Best effort refresh.
    }
  }
}

export function describeCurrentPwaRuntimeCaches(cacheNames: string[]) {
  return cacheNames.map((name) => ({
    name,
    baseNames: PWA_RUNTIME_CACHE_BASE_NAMES.filter(
      (baseName) => name === baseName || name.startsWith(`${baseName}-v`),
    ),
    isCurrentVersion: isCurrentPwaRuntimeCacheName(name, PWA_RUNTIME_CACHE_VERSION),
  }));
}
