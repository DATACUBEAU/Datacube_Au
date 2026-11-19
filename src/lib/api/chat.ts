import type { RagBasedQuestionAnsweringOutput } from '@shared/schemas';
import type { AuGuideInput } from '@shared/chat-payload';
import type { ChatDocumentContext } from '@shared/document-chat-context';
import type { GlobalChatNavAction } from '@shared/global-chat-routing';
import { throwMobileAppRequired } from '@/lib/api/mobile-app-required';

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

export async function sendChatMessage(
  _request: ChatRequest,
  _opts?: { signal?: AbortSignal; clientMessageId?: string; accessToken?: string | null }
): Promise<ChatResponse> {
  return throwMobileAppRequired('AU Chat');
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
export type ChatStreamErrorEvent = {
  type: 'error';
  error: unknown;
  details?: any;
  isThrottled?: boolean;
  requestId?: string;
};
export type ChatStreamEvent = ChatStreamDeltaEvent | ChatStreamDoneEvent | ChatStreamErrorEvent;

export async function sendChatMessageStream(
  _request: ChatRequest,
  _handlers: { onEvent: (event: ChatStreamEvent) => void },
  _opts?: { signal?: AbortSignal; accessToken?: string | null }
): Promise<ChatStreamDoneEvent> {
  return throwMobileAppRequired('AU Chat');
}

export async function generatePromptStarters(
  _documentTitle: string,
  _documentContent: string,
  _userIdea?: string,
  _opts?: { documentId?: string | null; accessToken?: string | null }
): Promise<string[]> {
  return throwMobileAppRequired('AI prompt starters');
}

/**
 * Browser-side model discovery is retired with the web product workspace.
 * Native Android obtains the model configuration through its server-backed
 * inference policy; no browser gateway URL or ticket is issued here.
 */
export async function getAvailableModels(): Promise<string[]> {
  return [];
}
