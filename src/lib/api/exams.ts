import { safeFetch } from '@/lib/api/safe-fetch';
import { supabase } from '@/lib/supabase/client';
import type { GeneratePracticeExamOutput, GenerateExamPredictionsOutput } from '@shared/schemas';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');

if (!SUPABASE_URL) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not defined in environment variables.");
}

/**
 * Generates a practice exam based on document content.
 */
export async function generatePracticeExam(
  documentId: string,
  documentContent: string,
  pastQuestionsContent?: string,
  accessToken?: string
): Promise<GeneratePracticeExamOutput> {
  return safeFetch(`${SUPABASE_URL}/functions/v1/exam-generator`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ documentId, documentContent, pastQuestionsContent }),
  });
}

/**
 * Generates exam predictions based on past questions and textbook content.
 */
export async function generatePredictions(
  documentId: string,
  documentContent: string,
  pastQuestionsContent: string,
  accessToken?: string
): Promise<GenerateExamPredictionsOutput> {
  return safeFetch(`${SUPABASE_URL}/functions/v1/generate-exam-predictions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ documentId, documentContent, pastQuestionsContent }),
  });
}

/**
 * Fetches the latest practice exam for a document from Supabase.
 */
export async function fetchLatestExam(documentId: string): Promise<GeneratePracticeExamOutput | null> {
  const { data, error } = await supabase
    .from('au_exams')
    .select('content')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching exam:', error);
    return null;
  }

  return data?.content as GeneratePracticeExamOutput || null;
}

/**
 * Fetches the latest exam predictions for a document from Supabase.
 */
export async function fetchLatestPredictions(documentId: string): Promise<GenerateExamPredictionsOutput | null> {
  const { data, error } = await supabase
    .from('au_predictions')
    .select('content')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching predictions:', error);
    return null;
  }

  return data?.content as GenerateExamPredictionsOutput || null;
}
