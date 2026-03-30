import { useState, useEffect, useCallback, useRef } from 'react';
import { listDocuments, deleteDocument, type AuDocumentRow } from '@/lib/api/documents';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase-client/client';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { readUserCache, writeUserCache } from '@/lib/cache/user-cache';
import { useSmartAuth } from '@/hooks/use-smart-auth';

let hasWarnedDocumentsRealtime = false;
let hasWarnedDocumentsFetch = false;
const DOCS_CACHE_ROUTE = '/dashboard/documents';
const DOCS_CACHE_SOURCE = 'au_documents';
const DOCS_CACHE_ENDPOINT = 'list';
const DOCS_CACHE_SCHEMA = 2;
const DOCS_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;
const DOCS_MEMORY_TTL_MS = 30_000;
const DOCS_MIN_FETCH_INTERVAL_MS = 4_000;
const DOCS_REALTIME_DEBOUNCE_MS = 500;
const docsMemoryCache = new Map<string, { data: AuDocumentRow[]; cachedAt: number }>();
const docsInflightRequests = new Map<string, Promise<AuDocumentRow[]>>();

function isAbortLikeError(error: unknown): boolean {
  const name = String((error as any)?.name || '');
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    name === 'AbortError' ||
    message.includes('aborterror') ||
    message.includes('signal is aborted') ||
    message.includes('aborted without reason')
  );
}

export function useAuDocuments(pollInterval = 0) {
  const [user] = useSupabaseUser();
  const { session, loading: isLoadingAuth } = useSupabaseSession();
  const { isOnline } = useNetworkStatus();
  const { isAuthLocked, isRestoringAuth } = useSmartAuth();
  const [documents, setDocuments] = useState<AuDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUsingCachedData, setIsUsingCachedData] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<Error | null>(null);
  const [isRealtimeDegraded, setIsRealtimeDegraded] = useState(false);
  const { toast } = useToast();
  const lastFetchedAtRef = useRef(0);
  const realtimeRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyRows = useCallback((rows: AuDocumentRow[], options?: {
    fromCache?: boolean;
    cachedAt?: number | null;
  }) => {
    setDocuments(rows);
    setIsUsingCachedData(Boolean(options?.fromCache));
    setCachedAt(options?.cachedAt ?? Date.now());
    setError(null);
    setLoading(false);
  }, []);

  const readCachedDocuments = useCallback(async () => {
    if (!user?.id) return { data: null as AuDocumentRow[] | null, cachedAt: null as number | null };
    const memoryKey = user.id;
    const memoryCached = docsMemoryCache.get(memoryKey);
    if (memoryCached && Date.now() - memoryCached.cachedAt < DOCS_MEMORY_TTL_MS) {
      return { data: memoryCached.data, cachedAt: memoryCached.cachedAt };
    }
    const cached = await readUserCache<AuDocumentRow[]>({
      userId: user.id,
      route: DOCS_CACHE_ROUTE,
      source: DOCS_CACHE_SOURCE,
      endpoint: DOCS_CACHE_ENDPOINT,
      query: { pollInterval },
      schemaVersion: DOCS_CACHE_SCHEMA,
      maxAgeMs: DOCS_CACHE_MAX_AGE_MS,
    });
    if (Array.isArray(cached.data)) {
      docsMemoryCache.set(memoryKey, {
        data: cached.data,
        cachedAt: cached.cachedAt ?? Date.now(),
      });
    }
    return cached;
  }, [pollInterval, user?.id]);

  const writeCachedDocuments = useCallback(
    async (rows: AuDocumentRow[]) => {
      if (!user?.id) return;
      docsMemoryCache.set(user.id, { data: rows, cachedAt: Date.now() });
      await writeUserCache({
        userId: user.id,
        route: DOCS_CACHE_ROUTE,
        source: DOCS_CACHE_SOURCE,
        endpoint: DOCS_CACHE_ENDPOINT,
        query: { pollInterval },
        schemaVersion: DOCS_CACHE_SCHEMA,
        data: rows,
        ttlMs: DOCS_CACHE_MAX_AGE_MS,
      });
    },
    [pollInterval, user?.id],
  );

  const fetchDocs = useCallback(async (opts?: { force?: boolean }) => {
    if (isRestoringAuth) return;
    if (!user || !session?.access_token) {
      setLoading(false);
      setDocuments([]);
      setIsUsingCachedData(false);
      setCachedAt(null);
      return;
    }
    if (isAuthLocked) {
      setLoading(false);
      return;
    }
    if (!isOnline) {
      const cached = await readCachedDocuments();
      if (cached.data) {
        applyRows(cached.data, { fromCache: true, cachedAt: cached.cachedAt });
      }
      setLoading(false);
      return;
    }

    const memoryKey = user.id;
    const now = Date.now();
    const memoryCached = docsMemoryCache.get(memoryKey);
    if (
      !opts?.force &&
      memoryCached &&
      now - memoryCached.cachedAt < DOCS_MEMORY_TTL_MS
    ) {
      applyRows(memoryCached.data, { fromCache: true, cachedAt: memoryCached.cachedAt });
      return;
    }

    if (
      !opts?.force &&
      lastFetchedAtRef.current > 0 &&
      now - lastFetchedAtRef.current < DOCS_MIN_FETCH_INTERVAL_MS
    ) {
      setLoading(false);
      return;
    }

    const existingRequest = docsInflightRequests.get(memoryKey);
    if (existingRequest) {
      try {
        const data = await existingRequest;
        applyRows(data, { fromCache: false, cachedAt: Date.now() });
        return;
      } catch (error) {
        // Fall through to the normal cached fallback path below.
      }
    }

    try {
      const request = listDocuments(user).finally(() => {
        docsInflightRequests.delete(memoryKey);
      });
      docsInflightRequests.set(memoryKey, request);
      const data = await request;
      lastFetchedAtRef.current = Date.now();
      applyRows(data, { fromCache: false, cachedAt: lastFetchedAtRef.current });
      void writeCachedDocuments(data);
    } catch (err: any) {
      if (isAbortLikeError(err)) return;

      const cached = await readCachedDocuments();
      if (cached.data) {
        applyRows(cached.data, { fromCache: true, cachedAt: cached.cachedAt });
      } else {
        setError(err);
        if (!hasWarnedDocumentsFetch) {
          console.warn('[useAuDocuments] Failed to fetch documents.', err);
          hasWarnedDocumentsFetch = true;
        }
      }
    } finally {
      setLoading(false);
    }
  }, [applyRows, isAuthLocked, isOnline, isRestoringAuth, readCachedDocuments, session?.access_token, user, writeCachedDocuments]);

  useEffect(() => {
    if (isRestoringAuth) return;
    if (isLoadingAuth) return;
    if (!user?.id) {
      setDocuments([]);
      setLoading(false);
      setIsUsingCachedData(false);
      setCachedAt(null);
      return;
    }

    let canceled = false;
    void readCachedDocuments().then((cached) => {
      if (canceled) return;
      if (cached.data) {
        applyRows(cached.data, { fromCache: true, cachedAt: cached.cachedAt });
      } else if (!isOnline) {
        setLoading(false);
      }
    });

    return () => {
      canceled = true;
    };
  }, [applyRows, isLoadingAuth, isOnline, isRestoringAuth, readCachedDocuments, user?.id]);

  // Real-time subscription
  useEffect(() => {
    if (isRestoringAuth) return;
    if (isLoadingAuth) return;

    if (!user || !session?.access_token) {
      setLoading(false);
      setDocuments([]);
      setIsUsingCachedData(false);
      setCachedAt(null);
      return;
    }
    if (isAuthLocked) {
      setLoading(false);
      return;
    }
    if (!isOnline) {
      setLoading(false);
      return;
    }

    // Initial fetch
    void fetchDocs({ force: true });
    setIsRealtimeDegraded(false);

    const channel = supabase
      .channel('au_documents_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'au_documents',
        },
        (payload) => {
          const row = (payload as any).new || (payload as any).old || null;
          const ownerId = row?.owner_id || row?.user_id || null;
          if (ownerId !== user.id) return;
          if (realtimeRefreshTimeoutRef.current) return;
          realtimeRefreshTimeoutRef.current = setTimeout(() => {
            realtimeRefreshTimeoutRef.current = null;
            void fetchDocs({ force: true });
          }, DOCS_REALTIME_DEBOUNCE_MS);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsRealtimeDegraded(false);
        }
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !hasWarnedDocumentsRealtime) {
          console.warn('[useAuDocuments] Realtime unavailable. Falling back to manual refresh/polling.');
          hasWarnedDocumentsRealtime = true;
          setIsRealtimeDegraded(true);
        }
      });

    return () => {
      if (realtimeRefreshTimeoutRef.current) {
        clearTimeout(realtimeRefreshTimeoutRef.current);
        realtimeRefreshTimeoutRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [fetchDocs, isAuthLocked, isLoadingAuth, isOnline, isRestoringAuth, session?.access_token, user]);

  const remove = useCallback(async (id: string) => {
    // 1. Optimistic Update: Immediately remove from UI
    const docToRemove = documents.find(d => d.id === id);
    const nextDocuments = documents.filter(d => d.id !== id);
    setDocuments(nextDocuments);
    void writeCachedDocuments(nextDocuments);
    setDeletingIds(prev => new Set(prev).add(id));

    try {
      // 2. Background deletion via Edge Function
      await deleteDocument(user, id);
      
      toast({ 
        title: 'Document removed', 
        description: 'The document and all its data have been deleted.' 
      });
    } catch (err: any) {
      // 3. Rollback on failure
      if (docToRemove) {
        setDocuments(prev => [...prev, docToRemove]);
        void writeCachedDocuments([...documents.filter(d => d.id !== id), docToRemove]);
      }
      
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: err.body?.error || err.message || 'An unexpected error occurred'
      });
    } finally {
      // 4. Cleanup deleting state
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [user, toast, documents, writeCachedDocuments]);

  useEffect(() => {
    if (pollInterval <= 0) return;
    if (!isRealtimeDegraded) return;
    if (!user || !session?.access_token || !isOnline || isAuthLocked || isRestoringAuth) return;

    const interval = setInterval(() => void fetchDocs({ force: true }), pollInterval);
    return () => clearInterval(interval);
  }, [fetchDocs, isAuthLocked, isOnline, isRealtimeDegraded, isRestoringAuth, pollInterval, session?.access_token, user]);

  return {
    documents,
    loading,
    error,
    refresh: fetchDocs,
    remove,
    deletingIds,
    isUsingCachedData,
    cachedAt,
  };
}
