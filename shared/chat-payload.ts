import { z } from 'zod';

export const ChatRoleSchema = z.enum(['system', 'user', 'assistant']);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const ChatMessageSchema = z.object({
  role: ChatRoleSchema,
  content: z.string().min(1),
});
export type ChatMessageInput = z.infer<typeof ChatMessageSchema>;

export const AuGuideSchema = z.object({
  tone: z.enum(['friendly', 'professional', 'strict']).optional(),
  verbosity: z.enum(['short', 'medium', 'deep']).optional(),
  citations: z.boolean().optional(),
  answer_scope: z.enum(['docs_only', 'docs_preferred', 'general_allowed']).optional(),
  language: z.string().min(2).max(64).optional(),
  safety: z.enum(['standard', 'strict']).optional(),
  instructions: z.string().max(2000).optional(),
}).partial();
export type AuGuideInput = z.infer<typeof AuGuideSchema>;

export const DocumentContextSchema = z.object({
  active_document_id: z.string().min(1).nullable().optional(),
  active_document_name: z.string().min(1).nullable().optional(),
  last_uploaded_document_id: z.string().min(1).nullable().optional(),
  last_retrieved_document_id: z.string().min(1).nullable().optional(),
  last_retrieved_source_ids: z.array(z.string().min(1)).max(12).optional(),
  document_count_in_scope: z.number().int().min(0).optional(),
  last_resolved_reference_at: z.string().min(1).nullable().optional(),
}).partial();
export type DocumentContextInput = z.infer<typeof DocumentContextSchema>;

export const CanonicalChatPayloadSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  userId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  feature: z.string().min(1),
  activeDocIds: z.array(z.string().min(1)).optional(),
  auGuide: AuGuideSchema.optional(),
  documentContext: DocumentContextSchema.optional(),
  idempotencyKey: z.string().min(8).max(200),
  correlationId: z.string().min(1).optional(),
});
export type CanonicalChatPayload = z.infer<typeof CanonicalChatPayloadSchema>;

export type ChatPayloadIssue = {
  code: string;
  message: string;
  path: string;
};

function compatUuid(prefix: string): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function coerceMessageRole(value: unknown): ChatRole {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'system' || role === 'assistant') return role;
  return 'user';
}

function coerceMessageContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (typeof value === 'object') {
    const maybeContent = (value as any).text ?? (value as any).value ?? '';
    return typeof maybeContent === 'string' ? maybeContent.trim() : '';
  }
  return '';
}

function normalizeMessages(raw: any): ChatMessageInput[] {
  const rawMessages = Array.isArray(raw?.messages)
    ? raw.messages
    : [];
  const normalized = rawMessages
    .map((entry: any) => ({
      role: coerceMessageRole(entry?.role),
      content: coerceMessageContent(entry?.content),
    }))
    .filter((entry: ChatMessageInput) => entry.content.length > 0);

  if (normalized.length > 0) return normalized;

  const singleMessageCandidates = [
    raw?.message,
    raw?.user_input,
    raw?.prompt,
    raw?.query,
    raw?.input,
    raw?.text,
    raw?.content,
    raw?.question,
  ];
  for (const candidate of singleMessageCandidates) {
    const content = coerceMessageContent(candidate);
    if (!content) continue;
    return [{ role: 'user', content }];
  }

  return [];
}

function normalizeFeature(raw: any, activeDocIds: string[]): string {
  const explicit = typeof raw?.feature === 'string' ? raw.feature.trim() : '';
  if (explicit) return explicit;

  const chatType = String(raw?.chat_type || '').trim().toLowerCase();
  if (chatType === 'global') return 'global_chat';
  if (chatType === 'au_rag') return 'doc_chat';

  if (activeDocIds.length > 0) return 'doc_chat';
  if (String(raw?.selectedDocId || '').trim().toLowerCase() === 'global') return 'global_chat';

  return 'global_chat';
}

function normalizeActiveDocIds(raw: any): string[] {
  const fromArray = Array.isArray(raw?.activeDocIds)
    ? raw.activeDocIds
        .map((value: unknown) => String(value || '').trim())
        .filter((value: string) => value.length > 0 && value.toLowerCase() !== 'global')
    : [];
  if (fromArray.length > 0) return Array.from(new Set(fromArray));

  const legacyCandidates = [raw?.doc_id, raw?.selectedDocId];
  const inferred = legacyCandidates
    .map((value) => String(value || '').trim())
    .filter((value) => value.length > 0 && value.toLowerCase() !== 'global');
  return Array.from(new Set(inferred));
}

function normalizeAuGuide(raw: any): AuGuideInput | undefined {
  if (raw?.auGuide && typeof raw.auGuide === 'object' && !Array.isArray(raw.auGuide)) {
    return raw.auGuide as AuGuideInput;
  }

  if (raw?.guide && typeof raw.guide === 'object' && !Array.isArray(raw.guide)) {
    return raw.guide as AuGuideInput;
  }

  if (typeof raw?.guide === 'string' && raw.guide.trim().length > 0) {
    return { instructions: raw.guide.trim() };
  }

  return undefined;
}

function normalizeDocumentContext(raw: any): DocumentContextInput | undefined {
  const source =
    raw?.documentContext && typeof raw.documentContext === 'object' && !Array.isArray(raw.documentContext)
      ? raw.documentContext
      : raw?.document_context && typeof raw.document_context === 'object' && !Array.isArray(raw.document_context)
        ? raw.document_context
        : null;

  if (!source) return undefined;

  const next: DocumentContextInput = {};
  const assignString = (key: keyof DocumentContextInput) => {
    const value = source[key as string];
    if (typeof value === 'string' && value.trim()) {
      (next as any)[key] = value.trim();
    } else if (value === null) {
      (next as any)[key] = null;
    }
  };

  assignString('active_document_id');
  assignString('active_document_name');
  assignString('last_uploaded_document_id');
  assignString('last_retrieved_document_id');
  assignString('last_resolved_reference_at');

  if (Array.isArray(source.last_retrieved_source_ids)) {
    next.last_retrieved_source_ids = Array.from(
      new Set(
        source.last_retrieved_source_ids
          .map((value: unknown) => (typeof value === 'string' ? value.trim() : ''))
          .filter(Boolean),
      ),
    );
  }

  const count = Number(source.document_count_in_scope);
  if (Number.isFinite(count) && count >= 0) {
    next.document_count_in_scope = Math.floor(count);
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function normalizeChatPayload(input: unknown): CanonicalChatPayload {
  const raw = input && typeof input === 'object' ? input : {};
  const activeDocIds = normalizeActiveDocIds(raw);
  const fallbackIdempotencyKey =
    typeof (raw as any)?.clientMessageId === 'string'
      ? (raw as any).clientMessageId.trim()
      : typeof (raw as any)?.client_message_id === 'string'
        ? (raw as any).client_message_id.trim()
        : typeof (raw as any)?.requestId === 'string'
          ? (raw as any).requestId.trim()
          : typeof (raw as any)?.request_id === 'string'
            ? (raw as any).request_id.trim()
            : typeof (raw as any)?.correlationId === 'string'
              ? (raw as any).correlationId.trim()
              : typeof (raw as any)?.correlation_id === 'string'
                ? (raw as any).correlation_id.trim()
                : compatUuid('chat');
  const payload: CanonicalChatPayload = {
    messages: normalizeMessages(raw),
    userId: typeof (raw as any)?.userId === 'string'
      ? (raw as any).userId.trim() || undefined
      : typeof (raw as any)?.user_id === 'string'
        ? (raw as any).user_id.trim() || undefined
        : undefined,
    sessionId: typeof (raw as any)?.sessionId === 'string'
      ? (raw as any).sessionId.trim() || undefined
      : typeof (raw as any)?.session_id === 'string'
        ? (raw as any).session_id.trim() || undefined
        : typeof (raw as any)?.thread_id === 'string'
          ? (raw as any).thread_id.trim() || undefined
          : undefined,
    feature: normalizeFeature(raw, activeDocIds),
    activeDocIds: activeDocIds.length > 0 ? activeDocIds : undefined,
    auGuide: normalizeAuGuide(raw),
    documentContext: normalizeDocumentContext(raw),
    idempotencyKey: typeof (raw as any)?.idempotencyKey === 'string'
      ? (raw as any).idempotencyKey.trim() || undefined
      : typeof (raw as any)?.idempotency_key === 'string'
        ? (raw as any).idempotency_key.trim() || undefined
        : fallbackIdempotencyKey || undefined,
    correlationId: typeof (raw as any)?.correlationId === 'string'
      ? (raw as any).correlationId.trim() || undefined
      : typeof (raw as any)?.correlation_id === 'string'
        ? (raw as any).correlation_id.trim() || undefined
        : compatUuid('corr'),
  };

  return payload;
}

export function validateAndNormalizeChatPayload(input: unknown):
  | { success: true; data: CanonicalChatPayload }
  | { success: false; issues: ChatPayloadIssue[]; normalized: CanonicalChatPayload } {
  const normalized = normalizeChatPayload(input);
  const parsed = CanonicalChatPayloadSchema.safeParse(normalized);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }

  const issues: ChatPayloadIssue[] = parsed.error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.join('.') || 'payload',
  }));
  return {
    success: false,
    issues,
    normalized,
  };
}

function latestUserMessage(messages: ChatMessageInput[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return messages[messages.length - 1]?.content || '';
}

export function toLegacyEdgePayload(
  payload: CanonicalChatPayload,
  mode: 'global' | 'doc',
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    messages: payload.messages,
    user_input: latestUserMessage(payload.messages),
    feature: payload.feature,
    activeDocIds: payload.activeDocIds,
    auGuide: payload.auGuide,
    document_context: payload.documentContext,
    idempotencyKey: payload.idempotencyKey,
    correlation_id: payload.correlationId,
    ...(extras || {}),
  };

  if (payload.sessionId) {
    base.thread_id = payload.sessionId;
    base.sessionId = payload.sessionId;
  }

  if (mode === 'global') {
    base.chat_type = 'global';
  } else {
    base.chat_type = 'au_rag';
    const firstDoc = payload.activeDocIds?.[0];
    if (firstDoc) {
      base.doc_id = firstDoc;
      base.selectedDocId = firstDoc;
    }
  }

  return base;
}

export function redactChatPayloadForLog(payload: CanonicalChatPayload): Record<string, unknown> {
  return {
    ...payload,
    messages: payload.messages.map((message) => ({
      role: message.role,
      content_preview: message.content.slice(0, 160),
      content_length: message.content.length,
    })),
    auGuide: payload.auGuide
      ? {
          ...payload.auGuide,
          instructions: payload.auGuide.instructions
            ? `${payload.auGuide.instructions.slice(0, 120)}${payload.auGuide.instructions.length > 120 ? '...' : ''}`
            : undefined,
        }
      : undefined,
    documentContext: payload.documentContext,
  };
}
