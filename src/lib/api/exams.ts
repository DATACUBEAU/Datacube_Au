import type { GeneratePracticeExamOutput, GenerateExamPredictionsOutput } from '@shared/schemas';
import { createAiIdempotencyKey } from '@/lib/api/ai-idempotency';
import { safeFetch } from '@/lib/api/safe-fetch';
import { toApiRequestError } from '@/lib/api/api-contract';
// invokeEdgeFunction removed — VPS ticket + direct fetch is the sole path.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');

if (!SUPABASE_URL) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not defined in environment variables.");
}

function requireAiAccessToken(accessToken: string | null | undefined): string {
  const token = String(accessToken || '').trim();
  if (!token) {
    throw toApiRequestError({
      code: 'AUTH_REQUIRED',
      message: 'Session expired. Please sign in again.',
      status: 401,
      retryable: false,
    });
  }
  return token;
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
  opts?: { documentId?: string | null; pastQuestionIds?: string[]; accessToken?: string | null },
): Promise<GeneratePracticeExamOutput> {
  const hasDocId = Boolean(opts?.documentId);
  const hasPqIds = Array.isArray(opts?.pastQuestionIds) && opts!.pastQuestionIds.length > 0;
  const idempotencyKey = createAiIdempotencyKey('practice_exam');
  const accessToken = requireAiAccessToken(opts?.accessToken);

  
  const ticketRes = await safeFetch('/api/au/vps-ticket', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-idempotency-key': idempotencyKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      feature: 'generate-practice-exam',
      idempotencyKey,
      documentId: opts?.documentId || undefined,
      pastQuestionIds: hasPqIds ? opts!.pastQuestionIds : undefined,
    })
  });
  if (!ticketRes.ok) throw { message: 'Ticket generation failed', status: ticketRes.status };
  
  const ticketData = await ticketRes.json();
  const { ticket, vpsUrl } = ticketData.data || ticketData;

  const res = await fetch(`${vpsUrl}/generate/practice-exam`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ticket}`,
    },
    body: JSON.stringify({
      idempotencyKey,
      documentContent: hasDocId ? undefined : (documentContent || undefined),
      pastQuestionsContent: hasPqIds ? undefined : (pastQuestionsContent || undefined),
      documentId: opts?.documentId || undefined,
      pastQuestionIds: hasPqIds ? opts!.pastQuestionIds : undefined,
    }),
  });

  let data, error = null;
  if (!res.ok) {
    error = { message: await res.text(), status: res.status };
  } else {
    data = await res.json();
  }
  
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
  opts?: { documentId?: string | null; mainTextbookId?: string | null; pastQuestionIds?: string[]; accessToken?: string | null },
): Promise<GenerateExamPredictionsOutput> {
  const hasTextbookId = Boolean(opts?.mainTextbookId || opts?.documentId);
  const hasPqIds = Array.isArray(opts?.pastQuestionIds) && opts!.pastQuestionIds.length > 0;
  const idempotencyKey = createAiIdempotencyKey('exam_predictions');
  const accessToken = requireAiAccessToken(opts?.accessToken);

  
  const ticketRes = await safeFetch('/api/au/vps-ticket', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-idempotency-key': idempotencyKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      feature: 'generate-exam-predictions',
      idempotencyKey,
      documentId: opts?.documentId || opts?.mainTextbookId || undefined,
      mainTextbookId: opts?.mainTextbookId || undefined,
      pastQuestionIds: hasPqIds ? opts!.pastQuestionIds : undefined,
    })
  });
  if (!ticketRes.ok) throw { message: 'Ticket generation failed', status: ticketRes.status };
  
  const ticketData = await ticketRes.json();
  const { ticket, vpsUrl } = ticketData.data || ticketData;

  const res = await fetch(`${vpsUrl}/generate/exam-predictions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ticket}`,
    },
    body: JSON.stringify({
      idempotencyKey,
      pastQuestionsContent: hasPqIds ? undefined : (pastQuestionsContent || undefined),
      mainTextbookContent: hasTextbookId ? undefined : (documentContent || undefined),
      documentId: opts?.documentId || opts?.mainTextbookId || undefined,
      mainTextbookId: opts?.mainTextbookId || undefined,
      pastQuestionIds: hasPqIds ? opts!.pastQuestionIds : undefined,
    }),
  });

  let data, error = null;
  if (!res.ok) {
    error = { message: await res.text(), status: res.status };
  } else {
    data = await res.json();
  }
  
  if (error) throw error;
  if (!data) throw { message: 'Prediction generation failed', status: 500 };
  return data;
}
