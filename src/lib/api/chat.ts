
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
  model?: string; // Add model parameter
};

const DEFAULT_MODEL_IDS: string[] = [
  "google/gemini-2.0-flash-exp:free",
  "google/gemini-2.0-pro-exp-02-05:free",
  "deepseek/deepseek-r1:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "google/gemini-2.0-flash-lite-preview-02-05:free",
  "deepseek/deepseek-r1-distill-llama-70b:free",
  "mistralai/mistral-7b-instruct:free",
];

/**
 * Sends a chat request to the au-chat Edge Function.
 */
export async function sendChatMessage(
  request: ChatRequest,
  accessToken?: string
): Promise<RagBasedQuestionAnsweringOutput & { thought?: string }> {
  return safeFetch(`${SUPABASE_URL}/functions/v1/au-chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      messages: request.messages,
      sessionId: request.selectedDocId, // Using docId as sessionId for context stability
      selectedDocId: request.selectedDocId, // Explicitly pass for filtering
      useRAG: true,
      guide: request.guide,
      summaryMode: request.summaryMode,
      action: request.action,
      browsingMode: request.browsingMode,
      currentPath: typeof window !== 'undefined' ? window.location.pathname : '',
      model: request.model, // Pass model to backend
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
    body: JSON.stringify({
      documentTitle,
      documentContent: documentContent.substring(0, 10000), // Efficiency limit
      userIdea,
    }),
  });
  return result.prompts || [];
}

/**
 * Fetches the list of available models from the backend.
 */
export async function getAvailableModels(accessToken?: string): Promise<string[]> {
  if (!SUPABASE_URL) return DEFAULT_MODEL_IDS;

  if (!accessToken) {
    return DEFAULT_MODEL_IDS;
  }

  try {
    const result = await safeFetch(`${SUPABASE_URL}/functions/v1/au-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ action: 'get_models' }),
    }, { silent: true });

    const models = (result as any)?.models;
    if (Array.isArray(models)) {
      if (models.every((m) => typeof m === 'string')) return models;
      if (models.every((m) => m && typeof m === 'object' && typeof (m as any).id === 'string')) {
        return models.map((m) => (m as any).id);
      }
    }
  } catch {
  }

  return DEFAULT_MODEL_IDS;
}
