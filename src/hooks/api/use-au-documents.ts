import { useState, useEffect, useCallback } from 'react';
import { listDocuments, deleteDocument, type AuDocumentRow } from '@/lib/api/documents';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase-client/client';
import { useNetworkStatus } from '@/components/providers/network-status-provider';

let hasWarnedDocumentsRealtime = false;
let hasWarnedDocumentsFetch = false;

export function useAuDocuments(pollInterval = 0) {
  const [user] = useSupabaseUser();
  const { session, loading: isLoadingAuth } = useSupabaseSession();
  const { isOnline } = useNetworkStatus();
  const [documents, setDocuments] = useState<AuDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<Error | null>(null);
  const { toast } = useToast();

  const fetchDocs = useCallback(async () => {
    if (!user || !session?.access_token) {
      setLoading(false);
      setDocuments([]);
      return;
    }
    if (!isOnline) {
      setLoading(false);
      return;
    }

    try {
      const data = await listDocuments(user);
      setDocuments(data);
      setError(null);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err);
      if (!hasWarnedDocumentsFetch) {
        console.warn('[useAuDocuments] Failed to fetch documents.', err);
        hasWarnedDocumentsFetch = true;
      }
    } finally {
      setLoading(false);
    }
  }, [isOnline, session?.access_token, user]);

  // Real-time subscription
  useEffect(() => {
    if (isLoadingAuth) return;

    if (!user || !session?.access_token) {
      setLoading(false);
      setDocuments([]);
      return;
    }
    if (!isOnline) {
      setLoading(false);
      return;
    }

    // Initial fetch
    fetchDocs();

    const channel = supabase
      .channel('au_documents_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'au_documents',
          // Filter by user_id if possible, but RLS might handle it on the server.
          // For client-side filter, we can check payload.new.user_id === user.id
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setDocuments(prev => [payload.new as AuDocumentRow, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setDocuments(prev => prev.map(d => d.id === payload.new.id ? { ...d, ...payload.new } : d));
          } else if (payload.eventType === 'DELETE') {
            setDocuments(prev => prev.filter(d => d.id !== payload.old.id));
          }
        }
      )
      .subscribe((status) => {
        if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !hasWarnedDocumentsRealtime) {
          console.warn('[useAuDocuments] Realtime unavailable. Falling back to manual refresh/polling.');
          hasWarnedDocumentsRealtime = true;
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchDocs, isLoadingAuth, isOnline, session?.access_token, user]);

  const remove = useCallback(async (id: string) => {
    // 1. Optimistic Update: Immediately remove from UI
    const docToRemove = documents.find(d => d.id === id);
    setDocuments(prev => prev.filter(d => d.id !== id));
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
  }, [user, toast, documents]);

  useEffect(() => {
    if (pollInterval <= 0) return;
    if (!user || !session?.access_token || !isOnline) return;

    const interval = setInterval(fetchDocs, pollInterval);
    return () => clearInterval(interval);
  }, [fetchDocs, isOnline, pollInterval, session?.access_token, user]);

  return { documents, loading, error, refresh: fetchDocs, remove, deletingIds };
}
