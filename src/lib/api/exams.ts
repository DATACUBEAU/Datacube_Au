import { safeFetch } from '@/lib/api/safe-fetch';
import type { GeneratePracticeExamOutput, GenerateExamPredictionsOutput } from '@shared/schemas';

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
  accessToken?: string
): Promise<GeneratePracticeExamOutput> {
  return safeFetch(`${SUPABASE_URL}/functions/v1/exam-generator`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ documentContent, pastQuestionsContent }),
  });
}

/**
 * Generates exam predictions based on past questions and textbook content.
 */
export async function generatePredictions(
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
    body: JSON.stringify({ documentContent, pastQuestionsContent }),
  });
}
