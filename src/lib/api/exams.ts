import type { GeneratePracticeExamOutput, GenerateExamPredictionsOutput } from '@shared/schemas';
// invokeEdgeFunction removed — VPS ticket + direct fetch is the sole path.

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

  
  const ticketRes = await fetch('/api/au/vps-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature: 'generate-practice-exam' })
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
  opts?: { documentId?: string | null; mainTextbookId?: string | null; pastQuestionIds?: string[] },
): Promise<GenerateExamPredictionsOutput> {
  const hasTextbookId = Boolean(opts?.mainTextbookId || opts?.documentId);
  const hasPqIds = Array.isArray(opts?.pastQuestionIds) && opts!.pastQuestionIds.length > 0;

  
  const ticketRes = await fetch('/api/au/vps-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature: 'generate-exam-predictions' })
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
