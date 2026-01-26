import { supabase } from '@/lib/supabase/client';
import type { GenerateKnowledgeOutput } from '@/app/actions';

export async function fetchLatestKnowledge(documentId: string): Promise<GenerateKnowledgeOutput | null> {
  const { data, error } = await supabase
    .from('au_knowledge')
    .select('content')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching knowledge:', error);
    return null;
  }

  return data?.content as GenerateKnowledgeOutput || null;
}
