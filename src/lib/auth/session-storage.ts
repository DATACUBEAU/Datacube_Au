import type { Session } from '@supabase/supabase-js';
import { clearUserCache } from '@/lib/cache/user-cache';
import { clearUserLocalWorkingMemory } from '@/lib/memory/working-memory';

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
  if (!userId) return;
  await Promise.allSettled([
    clearUserCache(userId),
    clearUserLocalWorkingMemory(userId),
  ]);
}

