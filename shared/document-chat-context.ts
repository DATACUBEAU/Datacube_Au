export type ChatDocumentContext = {
  active_document_id?: string | null;
  active_document_name?: string | null;
  last_uploaded_document_id?: string | null;
  last_retrieved_document_id?: string | null;
  last_retrieved_source_ids?: string[];
  document_count_in_scope?: number | null;
  last_resolved_reference_at?: string | null;
};

export type DocumentIntent =
  | 'document_overview'
  | 'document_summary'
  | 'document_contents'
  | 'document_key_points'
  | 'document_metadata'
  | 'document_qa';

export type DocumentReferenceStrategy =
  | 'active_document'
  | 'last_uploaded_document'
  | 'last_retrieved_document'
  | 'latest_successful_document'
  | 'single_document_scope'
  | 'none';

export type DocumentReferenceResolution = {
  intent: DocumentIntent;
  documentId: string | null;
  strategy: DocumentReferenceStrategy;
  requiresDocumentContext: boolean;
  needsClarification: boolean;
  missingDocument: boolean;
  answer?: string;
  context: ChatDocumentContext;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => cleanString(entry))
        .filter((entry): entry is string => Boolean(entry)),
    ),
  );
}

export function normalizeDocumentContext(input: unknown): ChatDocumentContext {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const count = Number(source.document_count_in_scope);

  return {
    active_document_id: cleanString(source.active_document_id),
    active_document_name: cleanString(source.active_document_name),
    last_uploaded_document_id: cleanString(source.last_uploaded_document_id),
    last_retrieved_document_id: cleanString(source.last_retrieved_document_id),
    last_retrieved_source_ids: cleanStringArray(source.last_retrieved_source_ids),
    document_count_in_scope: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null,
    last_resolved_reference_at: cleanString(source.last_resolved_reference_at),
  };
}

export function mergeDocumentContext(
  base: ChatDocumentContext | null | undefined,
  updates: Partial<ChatDocumentContext> | null | undefined,
): ChatDocumentContext {
  const current = normalizeDocumentContext(base || {});
  const next = normalizeDocumentContext({ ...current, ...(updates || {}) });
  return {
    ...current,
    ...next,
    last_retrieved_source_ids:
      next.last_retrieved_source_ids && next.last_retrieved_source_ids.length > 0
        ? next.last_retrieved_source_ids
        : current.last_retrieved_source_ids || [],
  };
}

export function classifyDocumentIntent(message: string): DocumentIntent {
  const normalized = String(message || '').trim().toLowerCase();

  if (/\b(metadata|file name|filename|document details?|about the file)\b/.test(normalized)) {
    return 'document_metadata';
  }

  if (/\b(key points?|main points?|takeaways?|highlights?)\b/.test(normalized)) {
    return 'document_key_points';
  }

  if (/\b(contents?|table of contents?|what is in this document|what is in this file)\b/.test(normalized)) {
    return 'document_contents';
  }

  if (
    /\b(summary|summarize|summarise)\b/.test(normalized) ||
    /\bsummarize this\b/.test(normalized) ||
    /\bsummarise this\b/.test(normalized) ||
    /\bwhat is (this|the) (document|file) about\b/.test(normalized) ||
    /\bwhat's (this|the) (document|file) about\b/.test(normalized)
  ) {
    return 'document_summary';
  }

  if (
    /\b(overview|overview of|give me an overview)\b/.test(normalized) ||
    /\bgive me an overview of this\b/.test(normalized) ||
    /\bwhat is the content of (this|the) (document|file)\b/.test(normalized) ||
    /\bwhat's the content of (this|the) (document|file)\b/.test(normalized)
  ) {
    return 'document_overview';
  }

  return 'document_qa';
}

export function hasDocumentScopedReference(message: string): boolean {
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) return false;

  return [
    /\bthis document\b/,
    /\bthis file\b/,
    /\bthis pdf\b/,
    /\bthe document\b/,
    /\bthe file\b/,
    /\bthe uploaded file\b/,
    /\buploaded file\b/,
    /\bthe pdf\b/,
    /\bthis textbook\b/,
    /\bthe textbook\b/,
    /\bthis past question\b/,
    /\bthe past question\b/,
    /\bpast questions\b/,
    /\bsummarize this\b/,
    /\bsummarise this\b/,
    /\boverview of this\b/,
    /\bcontent of this\b/,
    /\bwhat is this about\b/,
    /\bwhat's this about\b/,
    /\bwhat is this document about\b/,
    /\bwhat's this document about\b/,
    /\bwhat is the content of this document\b/,
    /\bwhat's the content of this document\b/,
    /\bgive me an overview of this document\b/,
    /\bwhat is in this file\b/,
    /\bwhat's in this file\b/,
    /\bthis\b/,
  ].some((pattern) => pattern.test(normalized));
}

function requiresDocumentContext(intent: DocumentIntent, message: string): boolean {
  if (intent !== 'document_qa') return true;
  return hasDocumentScopedReference(message);
}

function buildNoDocumentAnswer(): string {
  return 'Please upload a document so I can help.';
}

function buildClarificationAnswer(docs: string[] = []): string {
  if (docs.length > 0) {
    const list = docs.length > 3 ? `${docs.slice(0, 3).join(', ')} and others` : docs.join(', ');
    return `Which document should I use? ${list}.`;
  }
  return 'Which document should I use?';
}

export function resolveDocumentReference(input: {
  message: string;
  context: ChatDocumentContext | null | undefined;
  now?: Date;
  availableDocumentNames?: string[];
}): DocumentReferenceResolution {
  const intent = classifyDocumentIntent(input.message);
  const context = normalizeDocumentContext(input.context || {});
  const needsContext = requiresDocumentContext(intent, input.message);
  const nowIso = (input.now || new Date()).toISOString();

  // Resolution priority:
  // 1. explicitly selected/open document in UI
  // 2. most recently uploaded document
  // 3. most recently retrieved document in chat
  // 4. if exactly one document exists, auto-bind to it

  const resolvedDocId = 
    context.active_document_id || 
    context.last_uploaded_document_id || 
    context.last_retrieved_document_id;

  if (resolvedDocId) {
    return {
      intent,
      documentId: resolvedDocId,
      strategy: context.active_document_id 
        ? 'active_document' 
        : context.last_uploaded_document_id 
          ? 'last_uploaded_document' 
          : 'last_retrieved_document',
      requiresDocumentContext: needsContext,
      needsClarification: false,
      missingDocument: false,
      context: {
        ...context,
        last_resolved_reference_at: nowIso,
      },
    };
  }

  // Case B: no active doc, but exactly one uploaded document exists
  if ((context.document_count_in_scope || 0) === 1) {
    return {
      intent,
      documentId: null, // We don't have the ID yet, but we know it's a single doc case
      strategy: 'single_document_scope',
      requiresDocumentContext: true,
      needsClarification: false,
      missingDocument: false,
      context: {
        ...context,
        last_resolved_reference_at: nowIso,
      },
    };
  }

  // Case C: multiple documents exist and no clear active doc
  if ((context.document_count_in_scope || 0) > 1) {
    return {
      intent,
      documentId: null,
      strategy: 'none',
      requiresDocumentContext: true,
      needsClarification: true,
      missingDocument: false,
      answer: buildClarificationAnswer(input.availableDocumentNames),
      context,
    };
  }

  // Case D: no documents exist
  return {
    intent,
    documentId: null,
    strategy: 'none',
    requiresDocumentContext: true,
    needsClarification: false,
    missingDocument: true,
    answer: buildNoDocumentAnswer(),
    context,
  };
}
