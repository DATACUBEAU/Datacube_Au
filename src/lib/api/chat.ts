
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
    billing_enabled?: boolean;
    promo_enabled?: boolean;
    limits_alerts_enabled?: boolean;
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

type EdgeErrorLike = {
  status?: number | null;
  message?: string | null;
  details?: any;
};

const AU_CHAT_SCHEMA_OUTAGE_TTL_MS = 5 * 60 * 1000;
let auChatSchemaOutageUntil = 0;

function extractLatestUserInput(request: ChatRequest): string {
  if (typeof request.user_input === 'string' && request.user_input.trim()) {
    return request.user_input.trim();
  }
  if (Array.isArray(request.messages) && request.messages.length > 0) {
    const latest = request.messages[request.messages.length - 1];
    const content = typeof latest?.content === 'string' ? latest.content.trim() : '';
    if (content) return content;
  }
  return '';
}

function isProviderSchemaOutage(error: EdgeErrorLike | null | undefined): boolean {
  const message = String(error?.message || '').toLowerCase();
  const details =
    typeof error?.details === 'string'
      ? error.details.toLowerCase()
      : JSON.stringify(error?.details || {}).toLowerCase();

  return (
    message.includes('ai_provider_keys') ||
    details.includes('ai_provider_keys') ||
    (message.includes('schema cache') && message.includes('provider')) ||
    (details.includes('schema cache') && details.includes('provider'))
  );
}

function markAuChatSchemaOutage(): void {
  auChatSchemaOutageUntil = Date.now() + AU_CHAT_SCHEMA_OUTAGE_TTL_MS;
}

function clearAuChatSchemaOutage(): void {
  auChatSchemaOutageUntil = 0;
}

function shouldBypassAuChatForSchemaOutage(): boolean {
  return Date.now() < auChatSchemaOutageUntil;
}

async function invokeLegacyAuChatFallback(
  request: ChatRequest,
): Promise<RagBasedQuestionAnsweringOutput & { thought?: string }> {
  const question = extractLatestUserInput(request);
  if (!question) {
    throw {
      message: 'Missing user input for fallback chat request.',
      status: 400,
    };
  }

  const { data, error } = await invokeEdgeFunction<any>('chat', {
    method: 'POST',
    requireAuth: true,
    timeoutMs: 120_000,
    silent: true,
    body: {
      question,
    },
  });

  if (error) throw error;
  if (!data) throw { message: 'Fallback chat request failed', status: 500 };

  return {
    answer: String(data.answer || ''),
    thought: typeof data.thought === 'string' ? data.thought : undefined,
    citations: Array.isArray(data.citations) ? data.citations : [],
  } as RagBasedQuestionAnsweringOutput & { thought?: string };
}

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

  if (!isGlobal && shouldBypassAuChatForSchemaOutage()) {
    return invokeLegacyAuChatFallback(request);
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

  if (error) {
    if (!isGlobal && isProviderSchemaOutage(error)) {
      markAuChatSchemaOutage();
      console.warn('[chat] AU chat routing schema mismatch detected; falling back to legacy chat endpoint.');
      return invokeLegacyAuChatFallback(request);
    }
    throw error;
  }
  if (!isGlobal && endpoint === 'au-chat') {
    clearAuChatSchemaOutage();
  }
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

  if (!isGlobal && shouldBypassAuChatForSchemaOutage()) {
    const fallback = await invokeLegacyAuChatFallback(request);
    const doneEvent: ChatStreamDoneEvent = {
      type: 'done',
      answer: String((fallback as any)?.answer || ''),
      thought: typeof (fallback as any)?.thought === 'string' ? (fallback as any).thought : undefined,
      citations: Array.isArray((fallback as any)?.citations) ? (fallback as any).citations : [],
    };
    handlers.onEvent(doneEvent);
    return doneEvent;
  }

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
    const retryAfter = res.headers.get('retry-after');
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

    if (!isGlobal && endpoint === 'au-chat' && isProviderSchemaOutage({ status: res.status, message, details })) {
      markAuChatSchemaOutage();
      console.warn('[chat-stream] AU chat routing schema mismatch detected; falling back to non-stream legacy chat endpoint.');
      const fallback = await invokeLegacyAuChatFallback(request);
      const doneEvent: ChatStreamDoneEvent = {
        type: 'done',
        answer: String((fallback as any)?.answer || ''),
        thought: typeof (fallback as any)?.thought === 'string' ? (fallback as any).thought : undefined,
        citations: Array.isArray((fallback as any)?.citations) ? (fallback as any).citations : [],
      };
      handlers.onEvent(doneEvent);
      return doneEvent;
    }

    throw {
      message,
      status: res.status,
      details,
      retryAfter,
    };
  }

  if (!res.body) throw new Error('Missing response body');
  if (!isGlobal && endpoint === 'au-chat') {
    clearAuChatSchemaOutage();
  }

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
