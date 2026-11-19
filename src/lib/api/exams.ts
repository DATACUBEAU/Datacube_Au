import type {
  GeneratePracticeExamOutput,
  GenerateExamPredictionsOutput,
} from '@shared/schemas';
import { throwMobileAppRequired } from '@/lib/api/mobile-app-required';

export async function generatePracticeExam(
  _documentContent: string,
  _pastQuestionsContent?: string,
  _opts?: {
    documentId?: string | null;
    pastQuestionIds?: string[];
    accessToken?: string | null;
  },
): Promise<GeneratePracticeExamOutput> {
  return throwMobileAppRequired('Practice exam generation');
}

export async function generatePredictions(
  _documentContent: string,
  _pastQuestionsContent: string,
  _opts?: {
    documentId?: string | null;
    mainTextbookId?: string | null;
    pastQuestionIds?: string[];
    accessToken?: string | null;
  },
): Promise<GenerateExamPredictionsOutput> {
  return throwMobileAppRequired('Exam predictions');
}
