
import { safeFetch } from '@/lib/api/safe-fetch';
import type { RagBasedQuestionAnsweringOutput } from '@shared/schemas';
import { getSupabaseAccessToken, invokeEdgeFunction, supabase } from '@/lib/supabase-client/client';

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
  recent_snippet?: RecentSnippet; // Primary memory (Global or Doc)
  secondary_snippet?: RecentSnippet; // Secondary memory (e.g. Doc memory when in Global)

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
          secondary_snippet: request.secondary_snippet,
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

  const { data, error } = await invokeEdgeFunction<RagBasedQuestionAnsweringOutput & { thought?: string }>(endpoint, {
    method: 'POST',
    requireAuth: true,
    timeoutMs: 120_000,
    silent: true,
    body: payload,
    headers: opts?.signal ? {} : {},
  });

  if (error) throw error;
  if (!data) throw { message: 'Chat request failed', status: 500 };
  return data;
}

export type ChatStreamDeltaEvent = { type: 'delta'; text: string };
export type ChatStreamDoneEvent = { type: 'done'; answer: string; thought?: string; citations?: any[]; requestId?: string };
export type ChatStreamErrorEvent = { type: 'error'; error: string; details?: any; isThrottled?: boolean; requestId?: string };
export type ChatStreamEvent = ChatStreamDeltaEvent | ChatStreamDoneEvent | ChatStreamErrorEvent;

export async function sendChatMessageStream(
  request: ChatRequest,
  handlers: {
    onEvent: (event: ChatStreamEvent) => void;
  },
  opts?: { signal?: AbortSignal }
): Promise<ChatStreamDoneEvent> {
  const isGlobal = request.selectedDocId === 'global' || request.chat_type === 'global';
  const endpoint = isGlobal ? 'global-chat' : 'au-chat';

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let payload: any = {};

  if (isGlobal) {
    payload = {
      chat_type: 'global',
      thread_id: request.thread_id || 'global',
      user_input: request.user_input || '',
      app_context: request.app_context,
      memory_pack: request.memory_pack,
      recent_snippet: request.recent_snippet,
      secondary_snippet: request.secondary_snippet,
      model: request.model,
      stream: true,
    };
  } else {
    payload = {
      chat_type: 'au_rag',
      thread_id: request.thread_id,
      doc_id: request.doc_id || request.selectedDocId,
      user_input: request.user_input || '',
      retrieval: request.retrieval,
      recent_snippet: request.recent_snippet,
      au_handoff_hint: request.au_handoff_hint,
      guide: request.guide,
      summaryMode: request.summaryMode,
      action: request.action,
      model: request.model,
      stream: true,
    };
  }

  const doRequest = async (token: string | null) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (anonKey) headers.apikey = anonKey;

    return await safeFetch(`/api/proxy/${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      credentials: 'include',
      signal: opts?.signal,
      timeout: 120_000,
      silent: true,
    });
  };

  let accessToken = await getSupabaseAccessToken();
  let res = await doRequest(accessToken);

  if (res.status === 401) {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (!error) {
        accessToken = data.session?.access_token ?? null;
      }
    } catch {
      // Keep the original unauthorized response.
    }

    if (accessToken) {
      res = await doRequest(accessToken);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let details: any = text;
    try {
      details = JSON.parse(text);
    } catch {
      // keep raw text
    }

    const message =
      (details && typeof details === 'object'
        ? (details as any).message || (details as any).error
        : null) ||
      res.statusText ||
      'Chat stream failed';

    throw {
      message,
      status: res.status,
      details,
    };
  }

  if (!res.body) throw new Error('Missing response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalDone: ChatStreamDoneEvent | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const raw = trimmed.slice(5).trim();
      if (!raw) continue;
      let evt: ChatStreamEvent | null = null;
      try {
        evt = JSON.parse(raw) as ChatStreamEvent;
      } catch {
        continue;
      }

      handlers.onEvent(evt);

      if (evt.type === 'error') {
        throw new Error(evt.error || 'Chat stream error');
      }

      if (evt.type === 'done') {
        finalDone = evt;
      }
    }
  }

  if (!finalDone) {
    throw new Error('Stream ended without done event');
  }

  return finalDone;
}

/**
 * Generates prompt starters for a given document.
 */
export async function generatePromptStarters(
  documentTitle: string,
  documentContent: string,
  userIdea?: string
): Promise<string[]> {
  const { data, error } = await invokeEdgeFunction<any>('generate-prompt-starters', {
    method: 'POST',
    requireAuth: true,
    timeoutMs: 30_000,
    silent: true,
    body: {
      documentTitle,
      documentContent: documentContent.substring(0, 10000),
      userIdea,
    },
  });

  if (error) throw error;
  return (data as any)?.prompts || [];
}

/**
 * Fetches the list of available models from the backend.
 */
export async function getAvailableModels(): Promise<string[]> {
  if (!SUPABASE_URL) return DEFAULT_MODEL_IDS;

  try {
    const { data, error } = await invokeEdgeFunction<any>('au-chat', {
      method: 'POST',
      requireAuth: true,
      silent: true,
      body: { action: 'get_models' },
    });
    if (error) return DEFAULT_MODEL_IDS;

    const models = (data as any)?.models;
    if (Array.isArray(models)) {
      if (models.every((m) => typeof m === 'string')) return models;
      if (models.every((m) => m && typeof m === 'object' && typeof (m as any).id === 'string')) {
        return models.map((m) => (m as any).id);
      }
      if (models.every((m) => m && typeof m === 'object' && typeof (m as any).model_id === 'string')) {
        return models.map((m) => (m as any).model_id);
      }
    }
  } catch {
  }

  return DEFAULT_MODEL_IDS;
}
