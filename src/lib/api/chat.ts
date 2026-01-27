import { safeFetch } from '@/lib/api/safe-fetch';
import type { RagBasedQuestionAnsweringOutput } from '@shared/schemas';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');

if (!SUPABASE_URL) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not defined in environment variables.");
}

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thought?: string;
  citations?: string[];
  isLoading?: boolean;
  isSystem?: boolean;
  isError?: boolean;
};

export type ChatRequest = {
  messages: ChatMessage[];
  selectedDocId: string;
  guide?: string;
  summaryMode?: 'short' | 'mid' | 'detailed' | null;
  action?: 'scan_and_greet' | 'chat';
  browsingMode?: boolean;
  model?: string;
  signal?: AbortSignal;
};

/**
 * Sends a chat request to the au-chat Edge Function.
 */
export async function sendChatMessage(
  request: ChatRequest,
  accessToken?: string
): Promise<RagBasedQuestionAnsweringOutput & { thought?: string; model?: string }> {
  return safeFetch(`/api/chat/fallback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    signal: request.signal,
    body: JSON.stringify({
      messages: request.messages,
      sessionId: request.selectedDocId,
      selectedDocId: request.selectedDocId,
      useRAG: true,
      guide: request.guide,
      summaryMode: request.summaryMode,
      action: request.action,
      browsingMode: request.browsingMode,
      currentPath: typeof window !== 'undefined' ? window.location.pathname : '',
      model: request.model,
    }),
  });
}

/**
 * Generates prompt starters for a given document.
 */
export async function generatePromptStarters(
  documentTitle: string,
  documentContent: string,
  userIdea?: string,
  accessToken?: string
): Promise<string[]> {
  const result = await safeFetch(`${SUPABASE_URL}/functions/v1/generate-prompt-starters`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ documentTitle, documentContent: documentContent.substring(0, 10000), userIdea }),
  });
  return result.prompts || [];
}

/**
 * Fetches chat history for a document.
 */
export async function getChatHistory(
  docId: string,
  accessToken?: string
): Promise<ChatMessage[]> {
  const result = await safeFetch(`/api/chat/history?docId=${docId}`, {
    method: 'GET',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
  return result.history || [];
}
