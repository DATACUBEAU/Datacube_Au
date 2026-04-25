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
// These functions call Supabase Edge Functions DIRECTLY, bypassing the Next.js
// proxy layer entirely.  That means:
//   - No auth validation
//   - No subscription / limit enforcement
//   - No VPS routing
//   - No payload hydration & trimming
//
// All runtime callers should use the proxy routes instead:
//   Client → /api/proxy/{functionName} → VPS → AI
//
// The functions are retained only for their **type exports** (above), which
// remain in use by UI components.
// ---------------------------------------------------------------------------

/** @deprecated Use /api/proxy/generate-knowledge instead. */
export async function generateKnowledgeMaterials(
  _input: { documentContent: string }
): Promise<GenerateStudyMaterialsOutput> {
  throw new Error(
    'DEPRECATED: generateKnowledgeMaterials server action bypasses proxy enforcement. ' +
    'Use the /api/proxy/generate-knowledge route instead.',
  );
}

/** @deprecated Use /api/proxy/generate-exam-predictions instead. */
export async function generateExamPredictions(
  _input: { pastQuestionsContent: string; mainTextbookContent?: string }
): Promise<GenerateExamPredictionsOutput> {
  throw new Error(
    'DEPRECATED: generateExamPredictions server action bypasses proxy enforcement. ' +
    'Use the /api/proxy/prediction-engine route instead.',
  );
}

/** @deprecated Use /api/proxy/generate-practice-exam instead. */
export async function generatePracticeExam(
  _input: { documentContent: string }
): Promise<GeneratePracticeExamOutput> {
  throw new Error(
    'DEPRECATED: generatePracticeExam server action bypasses proxy enforcement. ' +
    'Use the /api/proxy/exam-generator route instead.',
  );
}

/** @deprecated Use /api/proxy/chat instead. */
export async function ragBasedQuestionAnsweringAction(
  _input: { question: string; userId: string; mainTextbookId: string }
): Promise<RagBasedQuestionAnsweringOutput> {
  throw new Error(
    'DEPRECATED: ragBasedQuestionAnsweringAction server action bypasses proxy enforcement. ' +
    'Use the /api/proxy/chat route instead.',
  );
}

/** @deprecated Use /api/proxy/generate-prompt-starters instead. */
export async function generatePromptStartersAction(
  _input: { documentTitle: string; documentContent?: string; userIdea?: string }
): Promise<{ prompts: string[] }> {
  throw new Error(
    'DEPRECATED: generatePromptStartersAction server action bypasses proxy enforcement. ' +
    'Use the /api/proxy/generate-prompt-starters route instead.',
  );
}
