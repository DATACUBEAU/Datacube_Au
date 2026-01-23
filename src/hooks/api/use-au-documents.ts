import { useState, useEffect, useCallback } from 'react';
import { listDocuments, deleteDocument, type AuDocumentRow } from '@/lib/api/documents';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';

export function useAuDocuments(pollInterval = 10000) {
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
    fetchDocs();
    if (pollInterval > 0) {
      const interval = setInterval(fetchDocs, pollInterval);
      return () => clearInterval(interval);
    }
  }, [fetchDocs, pollInterval]);

  return { documents, loading, error, refresh: fetchDocs, remove, deletingIds };
}
