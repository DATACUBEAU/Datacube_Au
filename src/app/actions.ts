'use server';

import type {
  GenerateStudyMaterialsOutput,
  GenerateExamPredictionsOutput,
  PracticeQuestion,
  GeneratePracticeExamOutput,
  RagBasedQuestionAnsweringOutput,
} from '@shared/schemas';
import { throwMobileAppRequired } from '@/lib/api/mobile-app-required';

// Preserve shared output types for native-app and shared UI consumers.
export type { GenerateStudyMaterialsOutput as GenerateKnowledgeOutput };
export type { GenerateExamPredictionsOutput as GeneratePredictionsOutput };
export type { GeneratePracticeExamOutput };
export type { PracticeQuestion };
export type { RagBasedQuestionAnsweringOutput };

/**
 * Browser-side AI generation has been retired. These compatibility server
 * actions remain only so older imports fail with a stable, actionable error.
 * All document processing and AI study workflows run inside the native app.
 */

export async function generateKnowledgeMaterials(
  _input: { documentContent: string },
): Promise<GenerateStudyMaterialsOutput> {
  return throwMobileAppRequired('Knowledge generation');
}

export async function generateExamPredictions(
  _input: { pastQuestionsContent: string; mainTextbookContent?: string },
): Promise<GenerateExamPredictionsOutput> {
  return throwMobileAppRequired('Exam predictions');
}

export async function generatePracticeExam(
  _input: { documentContent: string },
): Promise<GeneratePracticeExamOutput> {
  return throwMobileAppRequired('Practice exam generation');
}

export async function ragBasedQuestionAnsweringAction(
  _input: { question: string; userId: string; mainTextbookId: string },
): Promise<RagBasedQuestionAnsweringOutput> {
  return throwMobileAppRequired('Document question answering');
}

export async function generatePromptStartersAction(
  _input: { documentTitle: string; documentContent?: string; userIdea?: string },
): Promise<{ prompts: string[] }> {
  return throwMobileAppRequired('AI prompt starters');
}
