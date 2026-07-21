import type { Session } from '@supabase/supabase-js';
import { clearPersistedAccountSnapshotSync } from '@/lib/account/account-snapshot-cache';
import { clearUserCache } from '@/lib/cache/user-cache';
import { clearUserLocalWorkingMemory } from '@/lib/memory/working-memory';
import { clearAllPrivateQueuedWrites, clearQueuedWritesForUser } from '@/lib/offline/write-queue';

type SessionContainer =
  | Session
  | { currentSession?: Session | null; session?: Session | null; data?: { session?: Session | null } }
  | [Session | null, unknown];

function projectRefFromSupabaseUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (!host.endsWith('.supabase.co')) return null;
    return host.replace('.supabase.co', '');
  } catch {
    return null;
  }
}

function decodeMaybeBase64(value: string): string {
  if (!value.startsWith('base64-')) return value;
  const raw = value.slice('base64-'.length);
  try {
    return atob(raw);
  } catch {
    return value;
  }
}

function parseRawSession(raw: string): Session | null {
  try {
    const decoded = decodeURIComponent(raw);
    const normalized = decodeMaybeBase64(decoded);
    const parsed = JSON.parse(normalized) as SessionContainer;

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (Array.isArray(parsed)) {
      const first = parsed[0];
      return first && typeof first === 'object' && typeof (first as any).access_token === 'string'
        ? (first as Session)
        : null;
    }

    const direct = parsed as Session;
    if (typeof direct.access_token === 'string' && direct.user?.id) {
      return direct;
    }

    const currentSession = (parsed as any).currentSession || (parsed as any).session || (parsed as any).data?.session;
    if (currentSession && typeof currentSession === 'object' && typeof currentSession.access_token === 'string' && currentSession.user?.id) {
      return currentSession as Session;
    }
  } catch {
    return null;
  }
  return null;
}

export function readPersistedSupabaseSession(): Session | null {
  if (typeof window === 'undefined') return null;

  const projectRef = projectRefFromSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const preferredPrefix = projectRef ? `sb-${projectRef}` : null;

  const candidates: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (!key.includes('auth-token')) continue;
    if (preferredPrefix && key.startsWith(preferredPrefix)) {
      candidates.unshift(key);
      continue;
    }
    candidates.push(key);
  }

  for (const key of candidates) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const session = parseRawSession(raw);
    if (session?.user?.id) {
      return session;
    }
  }

  return null;
}

export async function clearUserScopedClientCaches(userId: string | null | undefined): Promise<void> {
  clearUserScopedLocalStorageArtifacts();
  if (userId) {
    clearPersistedAccountSnapshotSync(userId);
    notifyUserScopedCachesCleared(userId);
    await Promise.allSettled([
      clearUserCache(userId),
      clearUserLocalWorkingMemory(userId),
      clearQueuedWritesForUser(userId),
      purgeEmergencyPwaCaches(),
    ]);
    return;
  }
  await clearAllPrivateQueuedWrites();
  await purgeEmergencyPwaCaches();
}

function clearUserScopedLocalStorageArtifacts(): void {
  if (typeof window === 'undefined') return;
  const prefixes = [
    'au_answer_cache_',
    'knowledge_history_user_',
    'practice_exam_history_',
    'prediction_history_',
  ];
  const exact = new Set(['au-app-storage']);
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      if (exact.has(key) || prefixes.some((prefix) => key.startsWith(prefix))) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures.
  }
}

function notifyUserScopedCachesCleared(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('dcau:user-scoped-caches-cleared', { detail: { userId } }));
  } catch {
    // Ignore event dispatch failures.
  }
}

const AUTH_STORAGE_EXACT_KEYS = new Set<string>([
  'conex_admin_token',
  'conex_session_id',
  'conex_auth_step',
  'dcau:auth-actions-disabled',
]);

function shouldClearAuthStorageKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (AUTH_STORAGE_EXACT_KEYS.has(key)) return true;
  if (lower.includes('auth-token')) return true;
  if (lower === 'sb-access-token' || lower.startsWith('sb-access-token.')) return true;
  if (lower.startsWith('sb-') && lower.includes('-auth-token')) return true;
  if (lower.includes('supabase') && lower.includes('auth')) return true;
  return false;
}

function removeMatchingStorageKeys(store: Storage): void {
  const toRemove: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (!key) continue;
    if (!shouldClearAuthStorageKey(key)) continue;
    toRemove.push(key);
  }

  for (const key of toRemove) {
    try {
      store.removeItem(key);
    } catch {
      // Ignore per-key storage failures.
    }
  }
}

export async function purgeEmergencyPwaCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const reg of registrations) {
      await reg.unregister();
    }
  } catch {
    // Ignore PWA purge failures
  }
}

export function clearClientAuthStorageArtifacts(): void {
  if (typeof window === 'undefined') return;
  try {
    removeMatchingStorageKeys(window.localStorage);
  } catch {
    // Ignore localStorage failures.
  }
  try {
    removeMatchingStorageKeys(window.sessionStorage);
  } catch {
    // Ignore sessionStorage failures.
  }
}
