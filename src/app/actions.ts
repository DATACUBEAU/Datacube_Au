'use server';

import type {
  GenerateStudyMaterialsOutput,
  GenerateExamPredictionsOutput,
  PracticeQuestion,
  GeneratePracticeExamOutput,
  RagBasedQuestionAnsweringOutput,
} from '@shared/schemas';

// Re-exporting types for client-side usage
export type { GenerateStudyMaterialsOutput as GenerateKnowledgeOutput };
export type { GenerateExamPredictionsOutput as GeneratePredictionsOutput };
export type { GeneratePracticeExamOutput };
export type { PracticeQuestion };
export type { RagBasedQuestionAnsweringOutput };

// ---------------------------------------------------------------------------
// ⚠️  DEPRECATED SERVER ACTIONS
// ---------------------------------------------------------------------------
// These functions previously called Supabase Edge Functions directly,
// bypassing auth and billing enforcement. The proxy layer (/api/proxy/*)
// was also removed. All runtime callers now use the VPS ticket architecture:
//
//   Client → /api/au/vps-ticket → VPS AI Gateway
//
// The functions are retained only for their **type exports** (above), which
// remain in use by UI components.
// ---------------------------------------------------------------------------

/** @deprecated Use VPS ticket + direct VPS gateway call instead. */
export async function generateKnowledgeMaterials(
  _input: { documentContent: string }
): Promise<GenerateStudyMaterialsOutput> {
  throw new Error(
    'DEPRECATED: generateKnowledgeMaterials server action is removed. ' +
    'Use the VPS ticket architecture (/api/au/vps-ticket → VPS gateway).',
  );
}

/** @deprecated Use VPS ticket + direct VPS gateway call instead. */
export async function generateExamPredictions(
  _input: { pastQuestionsContent: string; mainTextbookContent?: string }
): Promise<GenerateExamPredictionsOutput> {
  throw new Error(
    'DEPRECATED: generateExamPredictions server action is removed. ' +
    'Use the VPS ticket architecture (/api/au/vps-ticket → VPS gateway).',
  );
}

/** @deprecated Use VPS ticket + direct VPS gateway call instead. */
export async function generatePracticeExam(
  _input: { documentContent: string }
): Promise<GeneratePracticeExamOutput> {
  throw new Error(
    'DEPRECATED: generatePracticeExam server action is removed. ' +
    'Use the VPS ticket architecture (/api/au/vps-ticket → VPS gateway).',
  );
}

/** @deprecated Use VPS ticket + direct VPS gateway call instead. */
export async function ragBasedQuestionAnsweringAction(
  _input: { question: string; userId: string; mainTextbookId: string }
): Promise<RagBasedQuestionAnsweringOutput> {
  throw new Error(
    'DEPRECATED: ragBasedQuestionAnsweringAction server action is removed. ' +
    'Use the VPS ticket architecture (/api/au/vps-ticket → VPS gateway).',
  );
}

/** @deprecated Use VPS ticket + direct VPS gateway call instead. */
export async function generatePromptStartersAction(
  _input: { documentTitle: string; documentContent?: string; userIdea?: string }
): Promise<{ prompts: string[] }> {
  throw new Error(
    'DEPRECATED: generatePromptStartersAction server action is removed. ' +
    'Use the VPS ticket architecture (/api/au/vps-ticket → VPS gateway).',
  );
}
