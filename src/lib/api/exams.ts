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
  const response = await safeFetch(`${SUPABASE_URL}/functions/v1/exam-generator`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ documentContent, pastQuestionsContent }),
  });

  if (!response.ok) {
      throw new Error(`Exam generation failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Generates exam predictions based on past questions and textbook content.
 */
export async function generatePredictions(
  documentContent: string,
  pastQuestionsContent: string,
  accessToken?: string
): Promise<GenerateExamPredictionsOutput> {
  // Updated to point to the correct 'prediction-engine' function
  const response = await safeFetch(`${SUPABASE_URL}/functions/v1/prediction-engine`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ pastQuestionsContent, mainTextbookContent: documentContent }),
  });

  if (!response.ok) {
      throw new Error(`Prediction generation failed: ${response.statusText}`);
  }

  return response.json();
}
