import { useState, useEffect, useCallback } from 'react';
import { listDocuments, deleteDocument, type AuDocumentRow } from '@/lib/api/documents';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase/client';

export function useAuDocuments(pollInterval = 0) {
  const [user] = useSupabaseUser();
  const [documents, setDocuments] = useState<AuDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<Error | null>(null);
  const { toast } = useToast();

  const fetchDocs = useCallback(async () => {
    try {
      const data = await listDocuments(user);
      setDocuments(data);
      setError(null);
    } catch (err: any) {
      setError(err);
      console.error('[useAuDocuments] Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Real-time subscription
  useEffect(() => {
    if (!user) return;

    // Initial fetch
    fetchDocs();

    // Set up Realtime Subscription
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchDocs]);

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
        description: 'The document and all its data have been deleted. Reloading...' 
      });
      
      // Force reload to clean up all related state (chat, embeddings, etc) and prevent UI freezing
      setTimeout(() => {
          window.location.reload();
      }, 500);

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
    // Only use polling if explicitly requested (e.g., for guest sessions or if realtime fails)
    if (pollInterval > 0) {
      const interval = setInterval(fetchDocs, pollInterval);
      return () => clearInterval(interval);
    }
  }, [fetchDocs, pollInterval]);

  return { documents, loading, error, refresh: fetchDocs, remove, deletingIds };
}
