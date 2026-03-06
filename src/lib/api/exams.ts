import type { GeneratePracticeExamOutput, GenerateExamPredictionsOutput } from '@shared/schemas';
import { invokeEdgeFunction } from '@/lib/supabase-client/client';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');

if (!SUPABASE_URL) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not defined in environment variables.");
}

/**
 * Generates a practice exam based on document content.
 */
export async function generatePracticeExam(
  documentContent: string,
  pastQuestionsContent?: string,
  opts?: { documentId?: string | null },
): Promise<GeneratePracticeExamOutput> {
  const { data, error } = await invokeEdgeFunction<GeneratePracticeExamOutput>('exam-generator', {
    method: 'POST',
    requireAuth: true,
    timeoutMs: 120_000,
    silent: true,
    body: {
      documentContent,
      pastQuestionsContent,
      documentId: opts?.documentId || undefined,
    },
  });
  if (error) throw error;
  if (!data) throw { message: 'Exam generation failed', status: 500 };
  return data;
}

/**
 * Generates exam predictions based on past questions and textbook content.
 */
export async function generatePredictions(
  documentContent: string,
  pastQuestionsContent: string,
  opts?: { documentId?: string | null; mainTextbookId?: string | null },
): Promise<GenerateExamPredictionsOutput> {
  const { data, error } = await invokeEdgeFunction<GenerateExamPredictionsOutput>('prediction-engine', {
    method: 'POST',
    requireAuth: true,
    timeoutMs: 120_000,
    silent: true,
    body: {
      pastQuestionsContent,
      mainTextbookContent: documentContent,
      documentId: opts?.documentId || opts?.mainTextbookId || undefined,
      mainTextbookId: opts?.mainTextbookId || undefined,
    },
  });
  if (error) throw error;
  if (!data) throw { message: 'Prediction generation failed', status: 500 };
  return data;
}
