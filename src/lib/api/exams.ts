import type { GeneratePracticeExamOutput, GenerateExamPredictionsOutput } from '@shared/schemas';
import { invokeEdgeFunction } from '@/lib/supabase-client/client';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');

if (!SUPABASE_URL) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not defined in environment variables.");
}

/**
 * Generates a practice exam based on document content.
 *
 * Payload optimization: when documentId / pastQuestionIds are supplied the proxy
 * hydrates the full text server-side via `hydrateFeaturePayload()`, so we only
 * send raw content as a fallback when no IDs are available.
 */
export async function generatePracticeExam(
  documentContent: string,
  pastQuestionsContent?: string,
  opts?: { documentId?: string | null; pastQuestionIds?: string[] },
): Promise<GeneratePracticeExamOutput> {
  const hasDocId = Boolean(opts?.documentId);
  const hasPqIds = Array.isArray(opts?.pastQuestionIds) && opts!.pastQuestionIds.length > 0;

  const { data, error } = await invokeEdgeFunction<GeneratePracticeExamOutput>('exam-generator', {
    method: 'POST',
    requireAuth: true,
    timeoutMs: 120_000,
    silent: true,
    body: {
      // Only send raw text when no ID is available — proxy hydrates from IDs.
      documentContent: hasDocId ? undefined : (documentContent || undefined),
      pastQuestionsContent: hasPqIds ? undefined : (pastQuestionsContent || undefined),
      documentId: opts?.documentId || undefined,
      pastQuestionIds: hasPqIds ? opts!.pastQuestionIds : undefined,
    },
  });
  if (error) throw error;
  if (!data) throw { message: 'Exam generation failed', status: 500 };
  return data;
}

/**
 * Generates exam predictions based on past questions and textbook content.
 *
 * Payload optimization: when mainTextbookId / pastQuestionIds are supplied the
 * proxy hydrates the full text server-side, so we skip sending raw content.
 */
export async function generatePredictions(
  documentContent: string,
  pastQuestionsContent: string,
  opts?: { documentId?: string | null; mainTextbookId?: string | null; pastQuestionIds?: string[] },
): Promise<GenerateExamPredictionsOutput> {
  const hasTextbookId = Boolean(opts?.mainTextbookId || opts?.documentId);
  const hasPqIds = Array.isArray(opts?.pastQuestionIds) && opts!.pastQuestionIds.length > 0;

  const { data, error } = await invokeEdgeFunction<GenerateExamPredictionsOutput>('prediction-engine', {
    method: 'POST',
    requireAuth: true,
    timeoutMs: 120_000,
    silent: true,
    body: {
      // Only send raw text when no ID is available — proxy hydrates from IDs.
      pastQuestionsContent: hasPqIds ? undefined : (pastQuestionsContent || undefined),
      mainTextbookContent: hasTextbookId ? undefined : (documentContent || undefined),
      documentId: opts?.documentId || opts?.mainTextbookId || undefined,
      mainTextbookId: opts?.mainTextbookId || undefined,
      pastQuestionIds: hasPqIds ? opts!.pastQuestionIds : undefined,
    },
  });
  if (error) throw error;
  if (!data) throw { message: 'Prediction generation failed', status: 500 };
  return data;
}
