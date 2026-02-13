
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

export type MemoryPack = {
  profile?: {
    tier?: 'free' | 'weekly' | 'monthly';
    study_level?: string;
    exam_type?: string;
    country?: string;
    language?: string;
    tone?: 'short' | 'friendly' | 'strict';
  };
  preferences?: {
    answer_style?: 'bullets' | 'step_by_step' | 'concise';
    difficulty?: 'easy' | 'normal' | 'hard';
    reminders?: boolean;
  };
  goals?: {
    primary_goal?: string;
    target_exam_date_iso?: string;
  };
  global_digest?: string;
  au_activity_summary?: {
    last_active_at_iso?: string;
    last_doc_title?: string;
    last_doc_id?: string;
    last_feature?: string;
  };
};

export type AppContext = {
  current_page?: string;
  last_pages?: string[];
  session_flags?: {
    is_guest?: boolean;
    free_pressure_mode_enabled?: boolean;
  };
  timestamps?: {
    client_time_iso?: string;
  };
};

export type RecentSnippet = {
  mode: 'turns' | 'summary';
  turns?: { role: 'user' | 'assistant'; content: string }[];
  summary?: string;
};

export type ChatRequest = {
  // Common
  user_input?: string; // New field preferred
  messages?: ChatMessage[]; // Legacy support
  
  // Global Chat Specific
  chat_type?: 'global';
  thread_id?: string;
  app_context?: AppContext;
  memory_pack?: MemoryPack;
  recent_snippet?: RecentSnippet;

  // AU Chat Specific
  chat_type_au?: 'au_rag'; // Alternative to 'chat_type' if needed to disambiguate types
  doc_id?: string;
  retrieval?: { top_k?: number; min_score?: number };
  au_handoff_hint?: { allow_suggest_global_chat?: boolean };

  // Legacy/Shared
  selectedDocId?: string;
  guide?: string;
  summaryMode?: 'short' | 'mid' | 'detailed' | null;
  action?: 'scan_and_greet' | 'chat' | 'get_models';
  browsingMode?: boolean;
  model?: string;
  clientMessageId?: string;
  policyVersion?: string;
  memory?: any; // Legacy simple memory
};

const DEFAULT_MODEL_IDS: string[] = []; 

/**
 * Sends a chat request to the au-chat Edge Function.
 */
export async function sendChatMessage(
  request: ChatRequest,
  accessToken?: string,
  opts?: { signal?: AbortSignal; clientMessageId?: string }
): Promise<RagBasedQuestionAnsweringOutput & { thought?: string }> {
  // ROUTING LOGIC:
  // 1. Global Chat -> 'global-chat' endpoint
  // 2. AU Chat (RAG) -> 'au-chat' endpoint
  
  let endpoint = 'au-chat'; 
  const isGlobal = request.selectedDocId === 'global' || request.chat_type === 'global';
  
  if (isGlobal) {
      endpoint = 'global-chat';
  }

  // Construct Payload based on Endpoint
  let payload: any = {};

  if (isGlobal) {
      // Global Chat Payload
      payload = {
          chat_type: 'global',
          thread_id: request.thread_id || 'global',
          user_input: request.user_input || (request.messages ? request.messages[request.messages.length - 1].content : ""),
          app_context: request.app_context,
          memory_pack: request.memory_pack,
          recent_snippet: request.recent_snippet,
          // Legacy Fallback
          messages: request.messages 
      };
  } else {
      // AU Chat Payload
      payload = {
          chat_type: 'au_rag',
          thread_id: request.thread_id,
          doc_id: request.doc_id || request.selectedDocId,
          user_input: request.user_input || (request.messages ? request.messages[request.messages.length - 1].content : ""),
          retrieval: request.retrieval,
          recent_snippet: request.recent_snippet,
          au_handoff_hint: request.au_handoff_hint,
          // Legacy fields for backward compat
          messages: request.messages,
          selectedDocId: request.selectedDocId,
          action: request.action,
          summaryMode: request.summaryMode,
          guide: request.guide
      };
  }

  return safeFetch(`${SUPABASE_URL}/functions/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    signal: opts?.signal,
    body: JSON.stringify(payload),
  }, { timeoutMs: 120_000, retries: 3 });
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
  }, { timeoutMs: 30_000, retries: 1, silent: true });
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
