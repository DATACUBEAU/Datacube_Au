'use server';

import type {
  GenerateStudyMaterialsOutput,
  GenerateExamPredictionsOutput,
  PracticeQuestion,
  GeneratePracticeExamOutput,
  RagBasedQuestionAnsweringOutput,
} from '@shared/schemas';

import { safeFetch } from '@/lib/api/safe-fetch';

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function functionsBaseUrl(): string {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1`;
}

async function makeFunctionRequest(functionName: string, body: any) {
  const url = `${functionsBaseUrl()}/${functionName}`;
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };

  return safeFetch(url, options);
}

// Re-exporting types for client-side usage
export type { GenerateStudyMaterialsOutput as GenerateKnowledgeOutput };
export type { GenerateExamPredictionsOutput as GeneratePredictionsOutput };
export type { GeneratePracticeExamOutput };
export type { PracticeQuestion };
export type { RagBasedQuestionAnsweringOutput };

// --- Server Actions that call the AU service ---

export async function generateKnowledgeMaterials(
  { documentContent }: { documentContent: string }
): Promise<GenerateStudyMaterialsOutput> {
  return makeFunctionRequest('generate-knowledge', { documentContent });
}

export async function generateExamPredictions(
  { pastQuestionsContent, mainTextbookContent }: { pastQuestionsContent: string, mainTextbookContent?: string }
): Promise<GenerateExamPredictionsOutput> {
  return makeFunctionRequest('generate-exam-predictions', { pastQuestionsContent, mainTextbookContent });
}

export async function generatePracticeExam(
  { documentContent }: { documentContent: string }
): Promise<GeneratePracticeExamOutput> {
  return makeFunctionRequest('generate-practice-exam', { documentContent });
}

export async function ragBasedQuestionAnsweringAction(
    { question, userId, mainTextbookId }: { question: string, userId: string, mainTextbookId: string }
): Promise<RagBasedQuestionAnsweringOutput> {
    return makeFunctionRequest('chat', { question, userId, mainTextbookId });
}

export async function generatePromptStartersAction(
    { documentTitle, documentContent, userIdea }: { documentTitle: string, documentContent?: string, userIdea?: string }
): Promise<{ prompts: string[] }> {
    return makeFunctionRequest('generate-prompt-starters', { documentTitle, documentContent, userIdea });
}
