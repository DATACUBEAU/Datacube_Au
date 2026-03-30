
import {
  extractApiError,
  extractApiErrorMessage,
  toApiRequestError,
  unwrapApiSuccess,
  type ApiErrorShape,
} from '@/lib/api/api-contract';
import type { RagBasedQuestionAnsweringOutput } from '@shared/schemas';
import { fetchEdgeFunctionResponse, invokeEdgeFunction } from '@/lib/supabase-client/client';
import {
  validateAndNormalizeChatPayload,
  toLegacyEdgePayload,
  type AuGuideInput,
  type CanonicalChatPayload,
} from '@shared/chat-payload';
import type { ChatDocumentContext } from '@shared/document-chat-context';
import type { GlobalChatNavAction } from '@shared/global-chat-routing';
import { normalizeAssistantCitations } from '@/lib/chat/assistant-response';
import { classifyAuthFailure } from '@/lib/auth/auth-error-classification';

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
  navAction?: GlobalChatNavAction | null;
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
  userId?: string;
  sessionId?: string;
  feature?: string;
  activeDocIds?: string[];
  auGuide?: AuGuideInput;
  idempotencyKey?: string;
  correlationId?: string;
  
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
  document_context?: ChatDocumentContext;

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

type ChatResponse = RagBasedQuestionAnsweringOutput & {
  thought?: string;
  navAction?: GlobalChatNavAction | null;
  documentContext?: ChatDocumentContext | null;
};

const DEFAULT_MODEL_IDS: string[] = []; 
const AVAILABLE_MODELS_CACHE_TTL_MS = 10 * 60 * 1000;
const AVAILABLE_MODELS_ERROR_TTL_MS = 60 * 1000;
const PROMPT_STARTER_DOCUMENT_BUDGET = 6000;
let availableModelsCache: { models: string[]; expiresAt: number } | null = null;
let availableModelsInFlight: Promise<string[]> | null = null;

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

function shouldFallbackToLegacyAuChat(error: EdgeErrorLike | null | undefined): boolean {
  if (classifyAuthFailure(error)) {
    return false;
  }

  const status = Number(error?.status || 0);
  const message = String(error?.message || '').toLowerCase();
  const details =
    typeof error?.details === 'string'
      ? error.details.toLowerCase()
      : JSON.stringify(error?.details || {}).toLowerCase();

  return (
    status === 404 ||
    status === 408 ||
    status >= 500 ||
    message.includes('internal_server_error') ||
    details.includes('internal_server_error') ||
    message.includes('upstream_timeout') ||
    details.includes('upstream_timeout')
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

function buildAuGuide(request: ChatRequest): AuGuideInput | undefined {
  if (request.auGuide) return request.auGuide;
  const guide = typeof request.guide === 'string' ? request.guide.trim() : '';
  if (!guide) return undefined;
  return { instructions: guide };
}

function buildCorrelationId(request: ChatRequest): string {
  const existing = typeof request.correlationId === 'string' ? request.correlationId.trim() : '';
  if (existing) return existing;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `corr_${Date.now()}`;
}

function buildIdempotencyKey(request: ChatRequest, opts?: { clientMessageId?: string }): string {
  const existing = typeof request.idempotencyKey === 'string' ? request.idempotencyKey.trim() : '';
  if (existing) return existing;
  const fromClientMessageId = typeof opts?.clientMessageId === 'string' ? opts.clientMessageId.trim() : '';
  if (fromClientMessageId) return fromClientMessageId;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `chat_${crypto.randomUUID()}`;
  }
  return `chat_${Date.now()}`;
}

function buildCanonicalPayload(
  request: ChatRequest,
  isGlobal: boolean,
  opts?: { clientMessageId?: string },
): { canonical: CanonicalChatPayload; legacyPayload: Record<string, unknown>; correlationId: string } {
  const candidateDocIds = Array.isArray(request.activeDocIds)
    ? request.activeDocIds
    : [request.doc_id || request.selectedDocId].filter(Boolean) as string[];
  const activeDocIds = candidateDocIds.filter((value) => String(value || '').trim().toLowerCase() !== 'global');
  const correlationId = buildCorrelationId(request);
  const rawPayload: Record<string, unknown> = {
    messages: request.messages,
    message: request.user_input,
    userId: request.userId,
    sessionId: request.sessionId || request.thread_id,
    feature: request.feature || (isGlobal ? 'global_chat' : 'doc_chat'),
    activeDocIds,
    auGuide: buildAuGuide(request),
    idempotencyKey: buildIdempotencyKey(request, opts),
    correlationId,
  };

  const validated = validateAndNormalizeChatPayload(rawPayload);
  if (!validated.success) {
    throw toApiRequestError({
      status: 400,
      code: 'INVALID_REQUEST_PAYLOAD',
      message: 'Invalid request payload.',
      details: {
        issues: validated.issues,
        correlation_id: correlationId,
      },
      retryable: false,
    });
  }

  const extras: Record<string, unknown> = {
    action: request.action,
    summaryMode: request.summaryMode,
    browsingMode: request.browsingMode,
    app_context: request.app_context,
    memory_pack: request.memory_pack,
    document_context: request.document_context,
    recent_snippet: request.recent_snippet,
    secondary_snippet: request.secondary_snippet,
    retrieval: request.retrieval,
    au_handoff_hint: request.au_handoff_hint,
    model: request.model,
    clientMessageId: opts?.clientMessageId || request.clientMessageId,
    policyVersion: request.policyVersion,
    memory: request.memory,
    correlation_id: correlationId,
  };

  const legacyPayload = toLegacyEdgePayload(
    validated.data,
    isGlobal ? 'global' : 'doc',
    extras,
  );

  return {
    canonical: validated.data,
    legacyPayload,
    correlationId,
  };
}

async function invokeLegacyAuChatFallback(
  request: ChatRequest,
): Promise<ChatResponse> {
  const question = extractLatestUserInput(request);
  if (!question) {
    throw toApiRequestError({
      code: 'INVALID_REQUEST_PAYLOAD',
      message: 'Missing user input for fallback chat request.',
      status: 400,
      retryable: false,
    });
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
  if (!data) {
    throw toApiRequestError({
      code: 'FALLBACK_CHAT_FAILED',
      message: 'Fallback chat request failed.',
      status: 500,
      retryable: true,
    });
  }

  return {
    answer: String(data.answer || ''),
    thought: typeof data.thought === 'string' ? data.thought : undefined,
    citations: normalizeAssistantCitations(data.citations),
  } as ChatResponse;
}

function normalizeChatResponse(data: any): ChatResponse {
  const payload = unwrapApiSuccess(data);
  return {
    answer: String(payload?.answer || ''),
    thought: typeof payload?.thought === 'string' ? payload.thought : undefined,
    citations: normalizeAssistantCitations(payload?.citations),
    navAction:
      payload?.nav_action && typeof payload.nav_action === 'object'
        ? (payload.nav_action as GlobalChatNavAction)
        : payload?.navAction && typeof payload.navAction === 'object'
          ? (payload.navAction as GlobalChatNavAction)
          : null,
    documentContext:
      payload?.document_context && typeof payload.document_context === 'object'
        ? (payload.document_context as ChatDocumentContext)
        : payload?.documentContext && typeof payload.documentContext === 'object'
          ? (payload.documentContext as ChatDocumentContext)
          : null,
  };
}

function normalizeThrownChatError(error: unknown, fallbackMessage = 'Chat request failed'): ApiErrorShape {
  return extractApiError(error, fallbackMessage);
}

/**
 * Sends a chat request to the au-chat Edge Function.
 */
export async function sendChatMessage(
  request: ChatRequest,
  opts?: { signal?: AbortSignal; clientMessageId?: string }
): Promise<ChatResponse> {
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

  const { legacyPayload, correlationId } = buildCanonicalPayload(request, isGlobal, {
    clientMessageId: opts?.clientMessageId,
  });

  const { data, error } = await invokeEdgeFunction<any>(endpoint, {
    method: 'POST',
    requireAuth: true,
    timeoutMs: 120_000,
    silent: true,
    body: legacyPayload,
    headers: {
      'x-correlation-id': correlationId,
    },
  });

  if (error) {
    if (!isGlobal && isProviderSchemaOutage(error)) {
      markAuChatSchemaOutage();
      console.warn('[chat] AU chat routing schema mismatch detected; falling back to legacy chat endpoint.');
      return invokeLegacyAuChatFallback(request);
    }
    if (!isGlobal && shouldFallbackToLegacyAuChat(error)) {
      console.warn('[chat] AU chat request failed; falling back to legacy chat endpoint.', {
        status: error?.status ?? null,
        message: error?.message ?? null,
      });
      return invokeLegacyAuChatFallback(request);
    }
    throw error;
  }
  if (!isGlobal && endpoint === 'au-chat') {
    clearAuChatSchemaOutage();
  }
  if (!data) {
    throw toApiRequestError({
      code: 'CHAT_REQUEST_FAILED',
      message: 'Chat request failed.',
      status: 500,
      retryable: true,
    });
  }
  return normalizeChatResponse(data);
}

export type ChatStreamDeltaEvent = { type: 'delta'; text: string };
export type ChatStreamDoneEvent = {
  type: 'done';
  answer: string;
  thought?: string;
  citations?: any[];
  requestId?: string;
  navAction?: GlobalChatNavAction | null;
  documentContext?: ChatDocumentContext | null;
};
export type ChatStreamErrorEvent = { type: 'error'; error: unknown; details?: any; isThrottled?: boolean; requestId?: string };
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

  const { legacyPayload, correlationId } = buildCanonicalPayload(request, isGlobal, {
    clientMessageId: request.clientMessageId,
  });
  const payload: Record<string, unknown> = {
    ...legacyPayload,
    stream: true,
  };

  const res = await fetchEdgeFunctionResponse(endpoint, {
    method: 'POST',
    requireAuth: true,
    timeoutMs: 120_000,
    silent: true,
    body: payload,
    headers: {
      Accept: 'text/event-stream',
      'x-correlation-id': correlationId,
    },
    authIntent: 'interactive',
    signal: opts?.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const retryAfter = res.headers.get('retry-after');
    let details: any = text;
    try {
      details = JSON.parse(text);
    } catch {
      // keep raw text
    }

    const normalizedError = normalizeThrownChatError(
      details && typeof details === 'object'
        ? { ...(details as Record<string, unknown>), status: res.status, retryAfter }
        : { message: text || res.statusText || 'Chat stream failed', status: res.status, retryAfter, details },
      res.statusText || 'Chat stream failed',
    );
    const message = normalizedError.message;

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

    if (!isGlobal && endpoint === 'au-chat' && shouldFallbackToLegacyAuChat({ status: res.status, message, details })) {
      console.warn('[chat-stream] AU chat stream failed; falling back to non-stream legacy chat endpoint.', {
        status: res.status,
        message,
      });
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

    throw toApiRequestError(
      {
        ...normalizedError,
        status: res.status,
        details,
        retryAfter,
      },
      message,
    );
  }

  const responseContentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (!responseContentType.includes('text/event-stream')) {
    const json = await res.json().catch(() => null);
    if (!json) {
      throw toApiRequestError({
        code: 'INVALID_CHAT_RESPONSE',
        message: 'Chat stream returned an unexpected non-stream response.',
        status: res.status,
        retryable: false,
      });
    }
    const normalized = normalizeChatResponse(json);
    const doneEvent: ChatStreamDoneEvent = {
      type: 'done',
      answer: normalized.answer,
      thought: normalized.thought,
      citations: normalized.citations,
      navAction: normalized.navAction,
      documentContext: normalized.documentContext,
    };
    handlers.onEvent(doneEvent);
    return doneEvent;
  }

  if (!res.body) {
    throw toApiRequestError({
      code: 'MISSING_RESPONSE_BODY',
      message: 'Chat stream response body was empty.',
      status: res.status,
      retryable: true,
    });
  }
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

      if (evt.type === 'done') {
        const normalized = normalizeChatResponse(evt as any);
        evt = {
          type: 'done',
          answer: normalized.answer,
          thought: normalized.thought,
          citations: normalized.citations,
          requestId: (evt as any).requestId,
          navAction: normalized.navAction,
          documentContext: normalized.documentContext,
        };
      }

      handlers.onEvent(evt);

      if (evt.type === 'error') {
        throw toApiRequestError(
          {
            ...(typeof evt === 'object' && evt ? (evt as Record<string, unknown>) : {}),
            message: extractApiErrorMessage(evt, 'Chat stream error'),
            details: (evt as ChatStreamErrorEvent).details,
            isThrottled: (evt as ChatStreamErrorEvent).isThrottled,
            requestId: (evt as ChatStreamErrorEvent).requestId,
          },
          'Chat stream error',
        );
      }

      if (evt.type === 'done') {
        finalDone = evt;
      }
    }
  }

  if (!finalDone) {
    throw toApiRequestError({
      code: 'CHAT_STREAM_INCOMPLETE',
      message: 'Chat stream ended before a completion event was received.',
      retryable: true,
    });
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
      documentContent: documentContent.substring(0, PROMPT_STARTER_DOCUMENT_BUDGET),
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
  if (availableModelsCache && Date.now() < availableModelsCache.expiresAt) {
    return availableModelsCache.models;
  }
  if (availableModelsInFlight) {
    return availableModelsInFlight;
  }

  availableModelsInFlight = (async () => {
    try {
      const { data, error } = await invokeEdgeFunction<any>('au-chat', {
        method: 'POST',
        requireAuth: true,
        silent: true,
        body: { action: 'get_models' },
        authIntent: 'background',
        reauthOnAuthFailure: false,
      });
      if (error) {
        availableModelsCache = {
          models: DEFAULT_MODEL_IDS,
          expiresAt: Date.now() + AVAILABLE_MODELS_ERROR_TTL_MS,
        };
        return DEFAULT_MODEL_IDS;
      }

      const models = (data as any)?.models;
      const normalizedModels = Array.isArray(models)
        ? models.every((m) => typeof m === 'string')
          ? models
          : models.every((m) => m && typeof m === 'object' && typeof (m as any).id === 'string')
            ? models.map((m) => (m as any).id)
            : models.every((m) => m && typeof m === 'object' && typeof (m as any).model_id === 'string')
              ? models.map((m) => (m as any).model_id)
              : DEFAULT_MODEL_IDS
        : DEFAULT_MODEL_IDS;

      availableModelsCache = {
        models: normalizedModels,
        expiresAt: Date.now() + AVAILABLE_MODELS_CACHE_TTL_MS,
      };
      return normalizedModels;
    } catch {
      availableModelsCache = {
        models: DEFAULT_MODEL_IDS,
        expiresAt: Date.now() + AVAILABLE_MODELS_ERROR_TTL_MS,
      };
      return DEFAULT_MODEL_IDS;
    } finally {
      availableModelsInFlight = null;
    }
  })();

  return availableModelsInFlight;
}
