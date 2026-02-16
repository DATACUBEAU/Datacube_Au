import { supabase } from '@/lib/supabase-client/client';

export type MemorySummaryScope = 'global' | 'doc';

export type MemorySummaryRow = {
  id: string;
  user_id: string;
  scope: MemorySummaryScope;
  doc_id: string | null;
  summary: string;
  pinned_facts: any;
  created_at: string;
  updated_at: string;
};

export async function getMemorySummary(args: { scope: MemorySummaryScope; docId?: string }): Promise<Pick<MemorySummaryRow, 'summary' | 'pinned_facts' | 'updated_at'> | null> {
  const scope = args.scope;
  const docId = args.docId ?? null;

  const q = supabase
    .from('memory_summaries')
    .select('summary,pinned_facts,updated_at')
    .eq('scope', scope)
    .limit(1);

  const res = scope === 'doc' ? q.eq('doc_id', docId) : q.is('doc_id', null);
  const { data, error } = await res.maybeSingle();
  if (error) return null;
  if (!data) return null;
  return data as any;
}

export async function upsertMemorySummary(args: { scope: MemorySummaryScope; summary: string; pinnedFacts?: any; docId?: string }): Promise<boolean> {
  const scope = args.scope;
  const docId = args.docId ?? null;
  const pinnedFacts = args.pinnedFacts ?? [];

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const userId = authData?.user?.id ?? null;
  if (authError || !userId) return false;

  const { error } = await supabase
    .from('memory_summaries')
    .upsert(
      {
        user_id: userId,
        scope,
        doc_id: scope === 'doc' ? docId : null,
        summary: args.summary,
        pinned_facts: args.pinnedFacts,
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: 'user_id,scope,doc_id' }
    );

  return !error;
}

export async function deleteMemorySummary(args: { scope: MemorySummaryScope; docId?: string }): Promise<boolean> {
  const scope = args.scope;
  const docId = args.docId ?? null;

  const q = supabase.from('memory_summaries').delete().eq('scope', scope);
  const res = scope === 'doc' ? q.eq('doc_id', docId) : q.is('doc_id', null);
  const { error } = await res;
  return !error;
}
