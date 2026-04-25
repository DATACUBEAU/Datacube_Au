/// <reference path="../deno.d.ts" />
// @ts-ignore: Deno modules
import { getCorsHeaders, callAUMessages, callAUStreamMessages, requireUser, emitEvent, generateEmbedding } from "../_shared/au.ts";
import { getApiKey } from "../_shared/getApiKey.ts";
import { searchQdrant, upsertPoints } from "../_shared/qdrant.ts";
import { AuChatSchema } from "../_shared/validation.ts";
import { rateLimitOrThrow } from "../_shared/rate-limit.ts";
import {
  LimitExceededError,
  enforceLimitOrThrow,
  getEffectiveLimitsForUser,
  getLimitsFlags,
  incrementUsageCounters,
  readLimit,
  readUsageValue,
  touchUserActivity,
} from "../_shared/limits.ts";
import {
  classifyDocumentIntent,
  hasDocumentScopedReference,
  mergeDocumentContext,
  normalizeDocumentContext,
  resolveDocumentReference,
} from "../../../../shared/document-chat-context.ts";
import { usageTrackingHandledByProxy } from "../_shared/usage-tracking.ts";
import {
  buildLayeredPrompt,
  normalizeConversationTurns,
  trimPromptText,
} from "../_shared/prompt-layering.ts";

function estimateTokensFromText(...values: Array<string | null | undefined>): number {
  const text = values.filter((value): value is string => typeof value === "string").join(" ");
  const chars = text.trim().length;
  if (chars <= 0) return 1;
  return Math.max(1, Math.ceil(chars / 4));
}

function asTrimmedString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((entry) => stringifyUnknown(entry)).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((entry) => stringifyUnknown(entry))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function previewText(value: string, maxChars = 900): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trim()}...`;
}

function extractHeadings(chunks: Array<{ text?: string | null }>): string[] {
  const headings = new Set<string>();
  for (const chunk of chunks) {
    const lines = String(chunk?.text || "").split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim().replace(/\s+/g, " ");
      if (!line || line.length > 80) continue;
      if (/^[A-Z][A-Z0-9 ,:()/-]{3,}$/.test(line) || /^(\d+(\.\d+)*)\s+[A-Z]/.test(line)) {
        headings.add(line);
      }
      if (headings.size >= 10) break;
    }
    if (headings.size >= 10) break;
  }
  return Array.from(headings).slice(0, 8);
}

function toBulletList(items: string[], limit = 5): string[] {
  return items
    .map((item) => item.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeGuideInput(raw: any): {
  tone: string;
  verbosity: string;
  citations: boolean | null;
  answerScope: string;
  language: string;
  safety: string;
  instructions: string;
} {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw
      : {};

  return {
    tone: asTrimmedString(source.tone),
    verbosity: asTrimmedString(source.verbosity),
    citations: typeof source.citations === "boolean" ? source.citations : null,
    answerScope: asTrimmedString(source.answer_scope || source.answerScope),
    language: asTrimmedString(source.language),
    safety: asTrimmedString(source.safety),
    instructions: trimPromptText(asTrimmedString(source.instructions), 1200),
  };
}

async function recordChatUsage(input: {
  supabaseAdmin: any;
  userId?: string | null;
  effectiveLimits: any;
  limitsFlags: any;
  isExamLikeAction: boolean;
  examAction?: "prediction" | "cbt" | null;
  promptText: string;
  answerText: string;
  usageAlreadyTracked?: boolean;
}): Promise<void> {
  if (!input.userId) return;
  if (input.usageAlreadyTracked) {
    await touchUserActivity(input.supabaseAdmin, input.userId, "activity");
    return;
  }

  const estimatedTokens = estimateTokensFromText(input.promptText, input.answerText);
  const tokensUsed = readUsageValue(input.effectiveLimits?.usage?.total as any, ["used_tokens", "tokens_used"], 0);
  const maxTokensTotal = readLimit(input.effectiveLimits?.limits || {}, "max_tokens_total", 2500000);
  const resetAt = input.effectiveLimits?.reset_at || input.effectiveLimits?.usage?.reset_at || null;

  enforceLimitOrThrow({
    enforcementEnabled: input.limitsFlags?.enforcementEnabled !== false,
    limitKey: "max_tokens_total",
    current: tokensUsed,
    increment: estimatedTokens,
    max: maxTokensTotal,
    resetAt,
  });

  const increments: Record<string, number> = {
    used_chats: 1,
    messages_count: 1,
    used_tokens: estimatedTokens,
    tokens_used: estimatedTokens,
  };

  if (input.isExamLikeAction) {
    if (input.examAction === "cbt") {
      increments.max_practice_exams = 1;
      increments.practice_exam_generations = 1;
    } else {
      increments.max_exam_predictions = 1;
      increments.prediction_generations = 1;
      increments.used_exams = 1;
      increments.exams_count = 1;
    }
  }

  await incrementUsageCounters(input.supabaseAdmin, input.userId, increments);
  await touchUserActivity(input.supabaseAdmin, input.userId, "activity");
}

function toDoneStreamResponse(payload: Record<string, unknown>, corsHeaders: Record<string, string>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", ...payload })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

type DocumentBundle = {
  id: string;
  fileName: string;
  documentType: string;
  status: string;
  createdAt: string | null;
  parentId: string | null;
  summary: string;
  keyPoints: string[];
  headings: string[];
  firstChunkPreview: string;
  firstSourceIds: string[];
};

type DocumentScopeEntry = {
  id: string;
  fileName: string;
  createdAt: string | null;
  status: string;
  documentType: string;
  parentId: string | null;
};

type DocumentScopeSnapshot = {
  count: number;
  successfulCount: number;
  documents: DocumentScopeEntry[];
};

type RetrievalChunkHit = {
  pointId: string;
  score: number;
  documentId: string;
  chunkId: string;
  chunkIndex: number;
  text: string;
  textSource: "qdrant" | "supabase";
};

const SUCCESSFUL_DOCUMENT_STATUSES = new Set(["completed", "done", "indexed"]);
const PAST_QUESTION_TYPES = new Set(["past_questions", "exam_questions"]);
const MAIN_TEXTBOOK_TYPES = new Set(["main_textbook"]);
const FALLBACK_QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "does",
  "explain",
  "extract",
  "for",
  "from",
  "give",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "of",
  "on",
  "please",
  "show",
  "summarize",
  "summarise",
  "tell",
  "the",
  "this",
  "to",
  "topics",
  "what",
]);

const AU_IDENTITY_RESPONSE =
  "Datacube AU is an AI-powered learning and document intelligence platform developed and operated by Zahed Investment Ltd, a registered company in Nigeria (RC 8127949).";

function normalizeStatus(value: unknown): string {
  return asTrimmedString(value).toLowerCase();
}

function normalizeDocType(value: unknown): string {
  return asTrimmedString(value).toLowerCase();
}

function isSuccessfulDocumentStatus(value: unknown): boolean {
  return SUCCESSFUL_DOCUMENT_STATUSES.has(normalizeStatus(value));
}

function isPastQuestionType(value: unknown): boolean {
  return PAST_QUESTION_TYPES.has(normalizeDocType(value));
}

function isMainTextbookType(value: unknown): boolean {
  return MAIN_TEXTBOOK_TYPES.has(normalizeDocType(value));
}

function isIdentityQuestion(message: string): boolean {
  const normalized = String(message || "").trim().toLowerCase();
  if (!normalized) return false;
  return [
    /\bwho built you\b/,
    /\bwho created you\b/,
    /\bwho made you\b/,
    /\bwho operates (this|datacube au|the system)\b/,
    /\bwho owns (this|datacube au|the platform)\b/,
    /\bwho built datacube au\b/,
    /\bwho created datacube au\b/,
    /\bwhat are you\b/,
    /\bwho are you\b/,
    /\bwhat is datacube au\b/,
  ].some((pattern) => pattern.test(normalized));
}

function inferDocumentPreference(message: string): "past_questions" | "main_textbook" | "any" {
  const normalized = String(message || "").trim().toLowerCase();
  if (!normalized) return "any";

  if (
    /\bpast question\b/.test(normalized) ||
    /\bpast questions\b/.test(normalized) ||
    /\bexam question\b/.test(normalized)
  ) {
    return "past_questions";
  }

  if (
    /\bmain textbook\b/.test(normalized) ||
    /\btextbook\b/.test(normalized) ||
    /\bthe uploaded file\b/.test(normalized) ||
    /\bthis document\b/.test(normalized) ||
    /\bthe document\b/.test(normalized)
  ) {
    return "main_textbook";
  }

  return "any";
}

function resolveFallbackDocumentId(input: {
  message: string;
  context: ReturnType<typeof normalizeDocumentContext>;
  snapshot: DocumentScopeSnapshot | null;
}): string | null {
  const successful = (input.snapshot?.documents || []).filter((doc) => isSuccessfulDocumentStatus(doc.status));
  if (successful.length === 0) return null;

  const successfulById = new Set(successful.map((doc) => doc.id));
  const preferredFromContext = [
    asTrimmedString(input.context.active_document_id),
    asTrimmedString(input.context.last_uploaded_document_id),
    asTrimmedString(input.context.last_retrieved_document_id),
  ].find((id) => !!id && successfulById.has(String(id)));
  if (preferredFromContext) return preferredFromContext;

  const preference = inferDocumentPreference(input.message);
  if (preference === "past_questions") {
    const match = successful.find((doc) => isPastQuestionType(doc.documentType));
    if (match) return match.id;
  }
  if (preference === "main_textbook") {
    const match = successful.find((doc) => isMainTextbookType(doc.documentType));
    if (match) return match.id;
  }

  return successful[0]?.id || null;
}

async function loadRelatedDocumentIds(
  supabaseAdmin: any,
  documentId: string,
): Promise<string[]> {
  const relatedIds = new Set<string>();
  const normalizedId = asTrimmedString(documentId);
  if (!normalizedId) return [];
  relatedIds.add(normalizedId);

  const { data: selectedDoc } = await supabaseAdmin
    .from("au_documents")
    .select("id,document_type,parent_id,status")
    .eq("id", normalizedId)
    .maybeSingle();

  if (!selectedDoc) return Array.from(relatedIds);

  const selectedParentId = asTrimmedString((selectedDoc as any)?.parent_id);
  if (selectedParentId) {
    const { data: parentDoc } = await supabaseAdmin
      .from("au_documents")
      .select("id,status")
      .eq("id", selectedParentId)
      .maybeSingle();
    if (parentDoc && isSuccessfulDocumentStatus((parentDoc as any)?.status)) {
      const parentId = asTrimmedString((parentDoc as any)?.id);
      if (parentId) relatedIds.add(parentId);
    }
  }

  if (isMainTextbookType((selectedDoc as any)?.document_type)) {
    const { data: children } = await supabaseAdmin
      .from("au_documents")
      .select("id")
      .eq("parent_id", normalizedId)
      .in("document_type", ["past_questions", "exam_questions"])
      .in("status", ["completed", "done", "indexed"])
      .order("created_at", { ascending: false })
      .limit(6);

    for (const child of children || []) {
      const childId = asTrimmedString((child as any)?.id);
      if (childId) relatedIds.add(childId);
    }
  }

  return Array.from(relatedIds);
}

function validChunkText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^0+$/.test(trimmed)) return null;
  return text;
}

async function hydrateHitsWithCanonicalChunkText(
  supabaseAdmin: any,
  hits: RetrievalChunkHit[],
): Promise<RetrievalChunkHit[]> {
  const chunkIds = Array.from(new Set(hits.map((hit) => hit.chunkId).filter(Boolean)));
  if (chunkIds.length === 0) return hits;

  const { data, error } = await supabaseAdmin
    .from("au_document_chunks")
    .select("id,document_id,chunk_index,text")
    .in("id", chunkIds);

  if (error || !Array.isArray(data)) {
    if (error) {
      console.warn("[au-chat] canonical chunk hydration failed:", error.message);
    }
    return hits;
  }

  const byId = new Map<string, any>();
  for (const row of data) {
    const rowId = asTrimmedString((row as any)?.id);
    if (!rowId) continue;
    byId.set(rowId, row);
  }

  return hits.map((hit) => {
    const row = byId.get(hit.chunkId);
    if (!row) return hit;

    const rowText = validChunkText((row as any)?.text);
    const rowDocumentId = asTrimmedString((row as any)?.document_id);
    const rowChunkIndex = Number((row as any)?.chunk_index);
    if (!rowText) return hit;
    if (rowDocumentId && rowDocumentId !== hit.documentId) return hit;
    if (Number.isFinite(rowChunkIndex) && rowChunkIndex !== hit.chunkIndex) return hit;

    return {
      ...hit,
      text: rowText,
      textSource: "supabase",
    };
  });
}

async function loadDocumentScopeSnapshot(
  supabaseAdmin: any,
  ownershipFilter: Record<string, unknown>,
  limit = 5,
): Promise<DocumentScopeSnapshot> {
  const { data, error, count } = await supabaseAdmin
    .from("au_documents")
    .select("id,file_name,created_at,status,document_type,parent_id", { count: "exact" })
    .match(ownershipFilter)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { count: 0, successfulCount: 0, documents: [] };
  }

  const documents = (Array.isArray(data) ? data : []).map((row: any) => ({
    id: asTrimmedString(row?.id),
    fileName: asTrimmedString(row?.file_name) || "Document",
    createdAt: typeof row?.created_at === "string" ? row.created_at : null,
    status: normalizeStatus(row?.status || "unknown"),
    documentType: normalizeDocType(row?.document_type || "document"),
    parentId: asTrimmedString(row?.parent_id) || null,
  })).filter((row: any) => row.id);
  const successfulCount = documents.filter((row: any) => isSuccessfulDocumentStatus(row.status)).length;

  return {
    count: Number.isFinite(count) ? Number(count) : documents.length,
    successfulCount,
    documents,
  };
}

async function loadDocumentBundle(supabaseAdmin: any, userId: string, documentId: string): Promise<DocumentBundle | null> {
  const { data: docRow, error: docError } = await supabaseAdmin
    .from("au_documents")
    .select("id,file_name,document_type,status,parent_id,created_at,metadata")
    .eq("id", documentId)
    .maybeSingle();

  if (docError || !docRow) return null;

  const { data: chunkRows } = await supabaseAdmin
    .from("au_document_chunks")
    .select("id,text,chunk_index")
    .eq("document_id", documentId)
    .order("chunk_index", { ascending: true })
    .limit(8);

  const chunks = Array.isArray(chunkRows) ? chunkRows : [];
  const headings = extractHeadings(chunks as Array<{ text?: string | null }>);
  const firstChunkPreview = previewText(chunks.map((chunk: any) => asTrimmedString(chunk?.text)).filter(Boolean).join("\n\n"), 1500);
  const firstSourceIds = chunks.map((chunk: any) => asTrimmedString(chunk?.id)).filter(Boolean).slice(0, 6);

  let summary = "";
  let keyPoints: string[] = [];

  try {
    const { data: versionRow } = await supabaseAdmin
      .from("au_document_versions")
      .select("id")
      .eq("document_id", documentId)
      .eq("is_active", true)
      .maybeSingle();

    const versionId = asTrimmedString(versionRow?.id);
    if (versionId) {
      const { data: featureRow } = await supabaseAdmin
        .from("au_feature_outputs")
        .select("output,status")
        .eq("user_id", userId)
        .eq("doc_version_id", versionId)
        .eq("feature", "knowledge_hub")
        .maybeSingle();

      const output = featureRow?.output || {};
      summary = asTrimmedString((output as any)?.summary || stringifyUnknown((output as any)?.overview));
      const rawKeyPoints = stringifyUnknown((output as any)?.keyPoints || (output as any)?.key_points);
      keyPoints = toBulletList(rawKeyPoints.split("\n"));
    }
  } catch {
    // Best-effort cache read only.
  }

  return {
    id: asTrimmedString(docRow.id),
    fileName: asTrimmedString(docRow.file_name) || "Document",
    documentType: asTrimmedString(docRow.document_type) || "document",
    status: asTrimmedString(docRow.status) || "unknown",
    createdAt: typeof docRow.created_at === "string" ? docRow.created_at : null,
    parentId: asTrimmedString(docRow.parent_id) || null,
    summary,
    keyPoints,
    headings,
    firstChunkPreview,
    firstSourceIds,
  };
}

async function loadDocumentNameMap(
  supabaseAdmin: any,
  documentIds: string[],
): Promise<Map<string, string>> {
  const normalizedIds = Array.from(new Set(documentIds.map((id) => asTrimmedString(id)).filter(Boolean)));
  const fileNameByDocId = new Map<string, string>();
  if (normalizedIds.length === 0) return fileNameByDocId;

  const { data, error } = await supabaseAdmin
    .from("au_documents")
    .select("id,file_name")
    .in("id", normalizedIds);

  if (error || !Array.isArray(data)) {
    if (error) {
      console.warn("[au-chat] failed to load document names:", error.message);
    }
    return fileNameByDocId;
  }

  for (const row of data) {
    const id = asTrimmedString((row as any)?.id);
    if (!id) continue;
    fileNameByDocId.set(id, asTrimmedString((row as any)?.file_name) || "Unknown Document");
  }

  return fileNameByDocId;
}

function tokenizeFallbackQuery(message: string): string[] {
  const normalized = asTrimmedString(message).toLowerCase();
  if (!normalized) return [];

  return Array.from(
    new Set(
      normalized
        .split(/[^a-z0-9]+/g)
        .map((part) => part.trim())
        .filter((part) => part.length >= 3 && !FALLBACK_QUERY_STOP_WORDS.has(part)),
    ),
  ).slice(0, 10);
}

async function loadSupabaseFallbackHits(input: {
  supabaseAdmin: any;
  documentIds: string[];
  latestMessage: string;
  preferredDocumentId?: string | null;
  maxRows?: number;
  maxHits?: number;
}): Promise<RetrievalChunkHit[]> {
  const documentIds = Array.from(new Set(input.documentIds.map((id) => asTrimmedString(id)).filter(Boolean)));
  if (documentIds.length === 0) return [];

  const { data, error } = await input.supabaseAdmin
    .from("au_document_chunks")
    .select("id,document_id,chunk_index,text")
    .in("document_id", documentIds)
    .order("chunk_index", { ascending: true })
    .limit(Math.max(20, Math.min(Number(input.maxRows || 120), 240)));

  if (error || !Array.isArray(data)) {
    if (error) {
      console.warn("[au-chat] Supabase chunk fallback failed:", error.message);
    }
    return [];
  }

  const fullQuery = asTrimmedString(input.latestMessage).toLowerCase();
  const searchTerms = tokenizeFallbackQuery(input.latestMessage);
  const preferredDocumentId = asTrimmedString(input.preferredDocumentId || "");

  const hits = data
    .map((row: any) => {
      const text = validChunkText(row?.text);
      const documentId = asTrimmedString(row?.document_id);
      const chunkId = asTrimmedString(row?.id);
      const chunkIndex = Number(row?.chunk_index);
      if (!text || !documentId || !chunkId || !Number.isFinite(chunkIndex)) {
        return null;
      }

      const loweredText = text.toLowerCase();
      let score = 0;

      if (fullQuery.length >= 8 && loweredText.includes(fullQuery)) {
        score += 12;
      }

      for (const term of searchTerms) {
        if (loweredText.includes(term)) {
          score += 3;
        }
      }

      if (preferredDocumentId && documentId === preferredDocumentId) {
        score += 0.5;
      }

      return {
        pointId: chunkId,
        score,
        documentId,
        chunkId,
        chunkIndex,
        text,
        textSource: "supabase" as const,
      };
    })
    .filter((row: RetrievalChunkHit | null): row is RetrievalChunkHit => Boolean(row))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (preferredDocumentId && a.documentId !== b.documentId) {
        if (a.documentId === preferredDocumentId) return -1;
        if (b.documentId === preferredDocumentId) return 1;
      }
      return a.chunkIndex - b.chunkIndex;
    })
    .slice(0, Math.max(1, Math.min(Number(input.maxHits || 5), 8)));

  return hits;
}

function buildDocumentIntentAnswer(intent: string, bundle: DocumentBundle): string {
  const createdAtLine = bundle.createdAt ? `Uploaded: ${bundle.createdAt}` : null;

  if (intent === "document_metadata") {
    return [
      `Document: ${bundle.fileName}`,
      `Type: ${bundle.documentType}`,
      `Status: ${bundle.status}`,
      createdAtLine,
      bundle.headings.length > 0 ? `Headings detected: ${bundle.headings.slice(0, 4).join("; ")}` : null,
    ].filter(Boolean).join("\n");
  }

  if (intent === "document_contents") {
    if (bundle.headings.length > 0) {
      return [`Contents for ${bundle.fileName}:`, ...bundle.headings.map((heading) => `- ${heading}`)].join("\n");
    }
    return `I could not detect clear headings yet. Here is the opening content:\n${bundle.firstChunkPreview}`;
  }

  if (intent === "document_key_points") {
    if (bundle.keyPoints.length > 0) {
      return [`Key points from ${bundle.fileName}:`, ...bundle.keyPoints.map((point) => `- ${point}`)].join("\n");
    }
    return bundle.summary || `Here is the opening content from ${bundle.fileName}:\n${bundle.firstChunkPreview}`;
  }

  if (intent === "document_summary" || intent === "document_overview") {
    if (bundle.summary) {
      return bundle.summary;
    }
    if (bundle.keyPoints.length > 0) {
      return [`Overview of ${bundle.fileName}:`, ...bundle.keyPoints.map((point) => `- ${point}`)].join("\n");
    }
    return `Overview of ${bundle.fileName}:\n${bundle.firstChunkPreview}`;
  }

  return "";
}

const MAX_VALIDATION_SNIPPET_TURNS = 10;
const MAX_VALIDATION_SNIPPET_CHARS = 300;
const MAX_VALIDATION_SUMMARY_CHARS = 600;

function sanitizeRecentSnippetForValidation(value: any): any {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const next: Record<string, unknown> = {
    ...value,
  };

  if (typeof next.summary === "string") {
    next.summary = next.summary.slice(0, MAX_VALIDATION_SUMMARY_CHARS);
  }

  if (Array.isArray(next.turns)) {
    next.turns = next.turns
      .slice(-MAX_VALIDATION_SNIPPET_TURNS)
      .map((turn: any) => ({
        ...turn,
        content: typeof turn?.content === "string"
          ? turn.content.slice(0, MAX_VALIDATION_SNIPPET_CHARS)
          : "",
      }));
  }

  return next;
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  let corsHeaders: any = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-upsert, tus-resumable, upload-length, upload-metadata, upload-offset",
  };

  try {
    corsHeaders = getCorsHeaders(req);
  } catch (e) {
    console.warn("Failed to generate CORS headers", e);
  }

  // 1. Handle OPTIONS -> return 204
  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    body.recent_snippet = sanitizeRecentSnippetForValidation(body?.recent_snippet);
    body.secondary_snippet = sanitizeRecentSnippetForValidation(body?.secondary_snippet);
    const usageAlreadyTracked = usageTrackingHandledByProxy(req);
    
    const auth = await requireUser(req, body);
    const { userId, ownershipFilter, supabaseAdmin } = auth;

    // --- SECURITY: Rate Limiting ---
    const ip = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown";
    
    // Config: 20 req/min/user
    await rateLimitOrThrow(req, {
        endpoint: 'au-chat',
        ownerId: userId || undefined,
        windowSeconds: 60,
        limit: 20
    });

    // --- STRICT ISOLATION: AU CHAT = RAG ONLY ---
    // Remove browsingMode, force useRAG=true
    const { messages, sessionId, guide, summaryMode, currentPath, action, selectedDocId, clientMessageId } = body;
    const requestGuide = normalizeGuideInput(body?.auGuide || guide);
    const useRAG = true; // Forced
    const browsingMode = false; // Forced OFF for AU Chat
    
    // NOTE: We no longer store sessions/messages in Supabase for AU Chat.
    
    // We strictly use RAG here.
    
    // Enforce server-side action validation
    const ALLOWED_ACTIONS = ['chat', 'summary', 'prediction', 'cbt', 'get_models', 'scan_and_greet'];
    const requestedAction = action || 'chat'; // Default to chat

    if (!ALLOWED_ACTIONS.includes(requestedAction)) {
            return new Response(JSON.stringify({ 
                error: "Invalid action", 
                details: `Action '${requestedAction}' is not supported.`,
                requestId 
            }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isExamLikeAction = requestedAction === 'prediction' || requestedAction === 'cbt';

    let effectiveLimits: Awaited<ReturnType<typeof getEffectiveLimitsForUser>> | null = null;
    let limitsFlags: Awaited<ReturnType<typeof getLimitsFlags>> | null = null;

    if (requestedAction !== 'get_models' && userId) {
      [effectiveLimits, limitsFlags] = await Promise.all([
        getEffectiveLimitsForUser(supabaseAdmin, userId),
        getLimitsFlags(supabaseAdmin),
      ]);

      const usageTotal = effectiveLimits.usage?.total || {};
      const resetAt = effectiveLimits.reset_at || effectiveLimits.usage?.reset_at || null;
      const chatsUsed = readUsageValue(usageTotal as any, ["used_chats", "messages_count"], 0);
      const maxChatsTotal = readLimit(effectiveLimits.limits, "max_chats_total", 1000);

      enforceLimitOrThrow({
        enforcementEnabled: limitsFlags.enforcementEnabled,
        limitKey: "max_chats_total",
        current: chatsUsed,
        increment: 1,
        max: maxChatsTotal,
        resetAt,
      });

      if (isExamLikeAction) {
        const isPracticeExamAction = requestedAction === "cbt";
        const examsUsed = isPracticeExamAction
          ? readUsageValue(usageTotal as any, ["max_practice_exams", "practice_exam_generations"], 0)
          : readUsageValue(usageTotal as any, ["max_exam_predictions", "prediction_generations", "used_exams", "exams_count"], 0);
        const examLimitKey = isPracticeExamAction ? "max_practice_exams" : "max_exam_predictions";
        const maxExamsTotal = readLimit(effectiveLimits.limits, examLimitKey, 120);
        enforceLimitOrThrow({
          enforcementEnabled: limitsFlags.enforcementEnabled,
          limitKey: examLimitKey,
          current: examsUsed,
          increment: 1,
          max: maxExamsTotal,
          resetAt,
        });
      }
    }

    // --- SECURITY: Input Validation ---
    // Only validate chat payload if action is NOT special (like get_models)
    if (!body.action || body.action === 'chat') {
         const inferredDocId = typeof body.doc_id === "string"
           ? body.doc_id
           : (typeof selectedDocId === "string" ? selectedDocId : "");
         const inferredUserInput = typeof body.user_input === "string"
           ? body.user_input
           : (Array.isArray(messages) && messages.length
             ? String((messages[messages.length - 1] as any)?.content ?? "")
             : "");
         const validation = AuChatSchema.safeParse({
           ...body,
           chat_type: "au_rag",
           thread_id: body.thread_id ?? sessionId,
           doc_id: inferredDocId,
           user_input: inferredUserInput,
         });
         if (!validation.success) {
             return new Response(JSON.stringify({ 
                 error: "Invalid input schema", 
                 details: validation.error.format(),
                 requestId 
             }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
         }
    }

    // If no ownership filter, we might still proceed but with no data access if RLS was on.
    // Since user wants RLS disabled, we'll allow it but logs/RAG will be empty or limited.
    const effectiveFilter = (ownershipFilter || {}) as any;
    
    // action, selectedDocId are already used in Quota Check block
    
    // --- SPECIAL ACTION: GET MODELS ---
    if (action === 'get_models') {
       const { getServicePolicy } = await import("../_shared/gating.ts");
       const policy = userId ? await getServicePolicy(supabaseAdmin, userId) : { tier: 'free', allowed_models: [] as string[] };

       const { data: conexConfig } = await supabaseAdmin
         .from('au_conex_config')
         .select('billing_enabled,premium_models_enabled,premium_models_paid_only,paid_mode_enabled')
         .eq('id', 1)
         .maybeSingle();

       const billingEnabled = conexConfig?.billing_enabled === true;
       const premiumModelsEnabled = conexConfig?.premium_models_enabled !== false;
       const premiumModelsPaidOnly = conexConfig?.premium_models_paid_only !== false;
       const paidModeEnabled = conexConfig?.paid_mode_enabled === true;

       const useProRegistry =
         premiumModelsEnabled &&
         (
           !premiumModelsPaidOnly ||
           policy.tier === 'pro' ||
           !billingEnabled ||
           paidModeEnabled
         );

       const table = useProRegistry ? 'au_pro_models_registry' : 'au_models_registry';

       let query = supabaseAdmin
         .from(table)
         .select('model_id,display_name,is_active,is_free,type')
         .eq('is_active', true);

       if (table === 'au_models_registry') {
         query = query.eq('type', 'chat');
       }

       const { data: rows, error: modelsError } = await query;
       if (modelsError) {
         console.error('[au-chat:get_models] failed to query registry:', modelsError.message);
       }

       const rawModels = (rows || []).map((m: any) => ({
         id: m.model_id,
         model_id: m.model_id,
         display_name: m.display_name || m.model_id,
         is_free: m.is_free ?? !useProRegistry,
       }));

       const allowedSet = new Set((policy.allowed_models || []).filter((id: string) => typeof id === 'string'));
       const filtered = allowedSet.size > 0
         ? rawModels.filter((m: any) => allowedSet.has(m.id))
         : rawModels;

       const models = filtered.length > 0 ? filtered : rawModels;
       return new Response(JSON.stringify({ 
         ok: true, 
         models,
         requestId 
       }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    // --- SPECIAL ACTION: GREET & SCAN ---
    if (action === 'scan_and_greet') {
        if (!selectedDocId) {
             return new Response(JSON.stringify({ error: "selectedDocId required for greeting" }), { status: 400, headers: corsHeaders });
        }

        // Fetch larger context for a "whole document" feel (limit 20 chunks)
        const { data: chunks } = await supabaseAdmin
            .from('au_document_chunks')
            .select('text')
            .eq('document_id', selectedDocId)
            .order('chunk_index', { ascending: true })
            .limit(20);
            
        const docContext = chunks?.map((c: any) => c.text).join("\n") || "";
        
        // Fetch document name
        const { data: docInfo } = await supabaseAdmin.from('au_documents').select('file_name').eq('id', selectedDocId).single();
        const docName = docInfo?.file_name || "Document";

        const systemPrompt = `You are AU, the Intelligent Study Orchestrator for Datacube AU.
        Datacube AU is built and operated by Zahed Investment Ltd (RC 8127949, Nigeria).
        Your goal is to provide a BOLD, comprehensive **Startup Guide & Study Roadmap** for the student's new document.
        
        TASK:
        1. Analyze the provided document text (First 20 chunks scanned).
        2. Generate a **Study Roadmap** that breaks the content into logical phases or modules.
        3. Be BOLD, DIRECT, and ENCOURAGING. Do NOT use "AI", refer to yourself as "AU".
        
        OUTPUT FORMAT (JSON):
        {
          "thought": "I have scanned the document. It covers X, Y, Z. I will outline a 3-step roadmap.",
          "answer": "Greeting message..."
        }
        
        GREETING TEMPLATE (Markdown):
        "# 🚀 Welcome to your Study Space for **${docName}**!
        
        I've scanned your document and generated a custom **Study Roadmap** to get you started:
        
        ### 📍 Phase 1: Core Concepts
        [Brief list of key topics found]
        
        ### 📍 Phase 2: Deep Dive
        [Advanced topics or details found]
        
        ### 📍 Phase 3: Mastery & Testing
        [Suggestions for Practice Exams/Predictions]
        
        **Ready to begin?** Pick a phase or ask me anything!"
        `;

        const warmupModelOverride =
          (typeof body?.model === "string" && body.model.trim().length > 0 ? body.model.trim() : "") ||
          (req.headers.get("x-au-model") || "").trim() ||
          undefined;
        const warmupRoutedApiKey = (req.headers.get("x-au-openrouter-key") || "").trim() || undefined;
        const responseText = await callAU(
          supabaseAdmin,
          systemPrompt,
          `Document Content (Start):\n${docContext}`,
          0.5,
          true,
          warmupModelOverride,
          { userId: userId || undefined, ownershipFilter, feature: "au-chat", sessionId, routedApiKey: warmupRoutedApiKey },
          "chat"
        );
        let finalResponse = { answer: responseText, thought: "" };
        try {
            const cleaned = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            finalResponse = JSON.parse(cleaned);
        } catch {
             finalResponse = { answer: responseText, thought: "Generated greeting." };
        }

        await recordChatUsage({
          supabaseAdmin,
          userId,
          effectiveLimits,
          limitsFlags,
          isExamLikeAction,
          examAction: isExamLikeAction ? (requestedAction as "prediction" | "cbt") : null,
          promptText: String(docContext || ""),
          answerText: String(finalResponse.answer || ""),
          usageAlreadyTracked,
        });
        
        return new Response(JSON.stringify({ 
            ok: true, 
            answer: finalResponse.answer, 
            thought: finalResponse.thought,
            requestId 
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- NORMAL CHAT ---
    
    const resolvedMessages = Array.isArray(messages) && messages.length > 0
      ? messages
      : (typeof body?.user_input === "string" && body.user_input
        ? [{ role: "user", content: body.user_input }]
        : []);

    if (resolvedMessages.length === 0) {
      return new Response(JSON.stringify({
        error: "Missing user input",
        details: "Provide user_input or a non-empty messages array",
        requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const latestMessage = resolvedMessages[resolvedMessages.length - 1]?.content;
    if (!latestMessage) {
      return new Response(JSON.stringify({ 
        error: "Latest message content is empty",
        details: "The content of the latest message cannot be empty",
        requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const wantsStreamEarly =
      body?.stream === true ||
      (req.headers.get("accept") || "").toLowerCase().includes("text/event-stream");

    const inputDocumentContext = mergeDocumentContext(
      normalizeDocumentContext(body?.document_context || {}),
      {
        active_document_id: asTrimmedString(selectedDocId || body?.doc_id) || null,
      },
    );

    if (isIdentityQuestion(latestMessage)) {
      const payload = {
        ok: true,
        answer: AU_IDENTITY_RESPONSE,
        thought: "",
        citations: [],
        document_context: mergeDocumentContext(inputDocumentContext, {
          last_resolved_reference_at: new Date().toISOString(),
        }),
        sessionId,
        requestId,
      };

      await recordChatUsage({
        supabaseAdmin,
        userId,
        effectiveLimits,
        limitsFlags,
        isExamLikeAction,
        examAction: isExamLikeAction ? (requestedAction as "prediction" | "cbt") : null,
        promptText: latestMessage,
        answerText: AU_IDENTITY_RESPONSE,
        usageAlreadyTracked,
      });

      return wantsStreamEarly
        ? toDoneStreamResponse(payload, corsHeaders)
        : new Response(JSON.stringify(payload), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
    }

    const documentIntent = classifyDocumentIntent(latestMessage);
    const wantsDocScope = documentIntent !== "document_qa" || hasDocumentScopedReference(latestMessage);
    let snapshot: DocumentScopeSnapshot | null = null;
    const shouldFetchSnapshot =
      wantsDocScope &&
      (inputDocumentContext.document_count_in_scope == null ||
        (!inputDocumentContext.active_document_id && !inputDocumentContext.last_uploaded_document_id) ||
        !inputDocumentContext.active_document_name);

    if (shouldFetchSnapshot) {
      snapshot = await loadDocumentScopeSnapshot(supabaseAdmin, effectiveFilter, 25);
    }

    const successfulDocs = (snapshot?.documents || []).filter((doc) => isSuccessfulDocumentStatus(doc.status));
    const latestSuccessful = successfulDocs[0] || null;
    const latestUploaded = snapshot?.documents?.[0] || null;
    const activeDocName =
      inputDocumentContext.active_document_name ||
      snapshot?.documents?.find((doc) => doc.id === inputDocumentContext.active_document_id)?.fileName ||
      null;

    const hydratedContext = mergeDocumentContext(inputDocumentContext, {
      active_document_name: activeDocName,
      last_uploaded_document_id:
        inputDocumentContext.last_uploaded_document_id ||
        latestSuccessful?.id ||
        latestUploaded?.id ||
        null,
      document_count_in_scope:
        inputDocumentContext.document_count_in_scope ??
        (snapshot ? snapshot.successfulCount || snapshot.count : inputDocumentContext.document_count_in_scope ?? null),
    });

    const referenceResolution = resolveDocumentReference({
      message: latestMessage,
      context: hydratedContext,
      availableDocumentNames: snapshot?.documents?.map((doc) => doc.fileName),
    });
    let resolvedDocId = asTrimmedString(referenceResolution.documentId || selectedDocId || body?.doc_id);
    if (!resolvedDocId && referenceResolution.strategy === "single_document_scope" && successfulDocs.length === 1) {
      resolvedDocId = successfulDocs[0].id;
    }

    if (!resolvedDocId) {
      resolvedDocId = resolveFallbackDocumentId({
        message: latestMessage,
        context: hydratedContext,
        snapshot,
      });
    }
    const baseDocumentContext = mergeDocumentContext(
      mergeDocumentContext(hydratedContext, referenceResolution.context),
      {
        active_document_id: resolvedDocId || hydratedContext.active_document_id || null,
        last_uploaded_document_id:
          hydratedContext.last_uploaded_document_id ||
          latestSuccessful?.id ||
          null,
        document_count_in_scope:
          hydratedContext.document_count_in_scope ??
          (snapshot ? snapshot.successfulCount || snapshot.count : null),
      },
    );

    const assistantClientMessageId = typeof clientMessageId === "string" && clientMessageId
      ? `${clientMessageId}:assistant`
      : null;

    // NOTE: Removed Supabase message existence check/replay logic. 
    // We rely on the client to handle local state.
    // If the client retries, we re-generate. (Stateless Backend)

    if ((referenceResolution.needsClarification || referenceResolution.missingDocument) && !resolvedDocId) {
      const hasContextDocument =
        Boolean(baseDocumentContext.active_document_id) ||
        Boolean(baseDocumentContext.last_uploaded_document_id) ||
        Boolean(baseDocumentContext.last_retrieved_document_id);
      const noDocuments = snapshot
        ? Number(snapshot.count || 0) <= 0
        : !hasContextDocument;
      const noSuccessfulDocuments = snapshot
        ? (!noDocuments && Number(snapshot.successfulCount || 0) <= 0)
        : false;
      const fallbackAnswer = noDocuments
        ? "No uploaded documents were found. Upload a textbook or past-question file first."
        : noSuccessfulDocuments
          ? "Your documents are still processing or previously failed ingestion. Wait for completion or retry failed uploads."
          : (referenceResolution.answer || "Which document should I use?");
      const payload = {
        ok: true,
        answer: fallbackAnswer,
        thought: "",
        citations: [],
        document_context: baseDocumentContext,
        sessionId,
        requestId,
      };

      await recordChatUsage({
        supabaseAdmin,
        userId,
        effectiveLimits,
        limitsFlags,
        isExamLikeAction,
        examAction: isExamLikeAction ? (requestedAction as "prediction" | "cbt") : null,
        promptText: latestMessage,
        answerText: String(payload.answer || ""),
        usageAlreadyTracked,
      });

      return wantsStreamEarly
        ? toDoneStreamResponse(payload, corsHeaders)
        : new Response(JSON.stringify(payload), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
    }

    if (resolvedDocId && documentIntent !== "document_qa") {
      const bundle = await loadDocumentBundle(supabaseAdmin, userId || "", resolvedDocId);
      if (bundle) {
        const answer = buildDocumentIntentAnswer(documentIntent, bundle);
        if (answer) {
          const payload = {
            ok: true,
            answer,
            thought: "",
            citations: [{ documentId: bundle.id, fileName: bundle.fileName }],
            document_context: mergeDocumentContext(baseDocumentContext, {
              active_document_id: resolvedDocId,
              active_document_name: bundle.fileName,
              last_retrieved_document_id: resolvedDocId,
              last_retrieved_source_ids: bundle.firstSourceIds,
              last_resolved_reference_at: new Date().toISOString(),
            }),
            sessionId,
            requestId,
          };

          await recordChatUsage({
            supabaseAdmin,
            userId,
            effectiveLimits,
            limitsFlags,
            isExamLikeAction,
            examAction: isExamLikeAction ? (requestedAction as "prediction" | "cbt") : null,
            promptText: latestMessage,
            answerText: String(answer || ""),
            usageAlreadyTracked,
          });

          return wantsStreamEarly
            ? toDoneStreamResponse(payload, corsHeaders)
            : new Response(JSON.stringify(payload), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
        }
      }
    }

    // 1. Fetch Context (RAG + Logs + Path)
    let context = "";
    let citations: any[] = [];
    
    // Fetch recent logs for context using explicit ownership filter
    const { data: logs } = await supabaseAdmin
      .from('au_upload_jobs')
      .select('file_name, status, created_at')
      .match(effectiveFilter)
      .order('created_at', { ascending: false })
      .limit(3);
    
    let logContext = "";
    if (logs && logs.length > 0) {
      logContext = "\nRecent Activity:\n" + logs.map((l: any) => `- ${l.file_name}: ${l.status} (${new Date(l.created_at).toLocaleDateString()})`).join("\n");
    }

    let docIdsToSearch: string[] = [];
    if (resolvedDocId) {
      try {
        docIdsToSearch = await loadRelatedDocumentIds(supabaseAdmin, resolvedDocId);
      } catch (error) {
        console.warn("[au-chat] Failed to resolve related document scope:", error);
        docIdsToSearch = [resolvedDocId];
      }
    }

    // 2. RAG Step (Strictly Enforced for AU Chat)
    // We always attempt RAG for AU Chat.
    let queryEmbedding: number[] | null = null;
    
    // Log for Audit
    console.log(`[au-chat] qdrant_search owner_id=${effectiveFilter.user_id || 'unknown'} request_id=${requestId}`);

    if (useRAG) {
      try {
        queryEmbedding = await generateEmbedding(supabaseAdmin, latestMessage);

        // --- OPTIMIZATION: SEMANTIC CACHE (NAMESPACED) ---
        const CACHE_COLLECTION = "au_rag_cache"; // Namespaced for RAG
        try {
           const cacheResults = await searchQdrant(queryEmbedding!, {
               limit: 1,
                score_threshold: 0.95,
                filter: {
                    must: [
                        effectiveFilter.user_id ? { key: "user_id", match: { value: effectiveFilter.user_id } } : null,
                        resolvedDocId ? { key: "document_id", match: { value: resolvedDocId } } : null,
                    ].filter(Boolean)
                }
            }, CACHE_COLLECTION);
           
           if (cacheResults && cacheResults.length > 0) {
               console.log("[au-chat] Semantic Cache HIT");
               const cached = cacheResults[0].payload;
                return new Response(JSON.stringify({ 
                    ok: true,
                    answer: cached.answer, 
                    thought: cached.thought || "Cache Hit",
                    citations: [],
                    document_context: mergeDocumentContext(baseDocumentContext, {
                      active_document_id: resolvedDocId || null,
                      last_retrieved_document_id: resolvedDocId || null,
                      last_retrieved_source_ids: [],
                      last_resolved_reference_at: new Date().toISOString(),
                    }),
                    sessionId,
                    requestId
                }), {
                   headers: { ...corsHeaders, "Content-Type": "application/json" },
               });
           }
        } catch (e) {
           // Cache miss or error (collection might not exist), proceed.
        }
        // ------------------------------------

        // Build Qdrant filter
        const qdrantFilter: any = {
          must: [],
        };

        // Enforce Multi-tenancy (RLS)
        if (effectiveFilter.user_id) {
          qdrantFilter.must.push({ key: "user_id", match: { value: effectiveFilter.user_id } });
        }

        // Handle specific document targeting (active + related textbook/past-question docs)
        if (docIdsToSearch.length > 0) {
          // If specific docs are targeted, constrain search to that relationship scope.
          qdrantFilter.must.push({
            should: docIdsToSearch.map(id => ({ key: "document_id", match: { value: id } }))
          });
        }

        // 3. Search Qdrant
        console.log(`[au-chat] Searching Qdrant... Target Docs: ${docIdsToSearch.join(', ') || 'All'}`);
        const qdrantResults = await searchQdrant(queryEmbedding!, {
          limit: 5, // OPTIMIZATION: Reduced from 10
          score_threshold: 0.70, // OPTIMIZATION: Increased from 0.65
          filter: qdrantFilter
        });

        if (qdrantResults && qdrantResults.length > 0) {
          const rawHits: RetrievalChunkHit[] = qdrantResults
            .map((res: any) => {
              const payload = res?.payload || {};
              const text = validChunkText(payload?.text);
              const documentId = asTrimmedString(payload?.document_id);
              const chunkId = asTrimmedString(payload?.chunk_id || res?.id);
              const chunkIndex = Number(payload?.chunk_index);
              const score = Number(res?.score || 0);

              if (!text || !documentId || !chunkId || !Number.isFinite(chunkIndex)) {
                return null;
              }

              return {
                pointId: asTrimmedString(res?.id) || chunkId,
                score,
                documentId,
                chunkId,
                chunkIndex,
                text,
                textSource: "qdrant" as const,
              };
            })
            .filter((hit: RetrievalChunkHit | null): hit is RetrievalChunkHit => Boolean(hit))
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

          const hits = await hydrateHitsWithCanonicalChunkText(supabaseAdmin, rawHits);
          context = hits.map((hit) => hit.text).join("\n\n");

          // OPTIMIZATION: Context Trimming
          if (context.length > 6000) {
            context = context.substring(0, 6000) + "... [truncated for token optimization]";
          }

          const uniqueDocs = Array.from(new Set(hits.map((hit) => hit.documentId)));
          const fileNameByDocId = await loadDocumentNameMap(supabaseAdmin, uniqueDocs);

          citations = hits.map((hit) => ({
            documentId: hit.documentId,
            chunkId: hit.chunkId,
            score: hit.score,
            fileName: fileNameByDocId.get(hit.documentId) || "Unknown Document",
          }));

          const canonicalCount = hits.filter((hit) => hit.textSource === "supabase").length;
          console.log(`[au-chat] Retrieved ${qdrantResults.length} chunks, using ${hits.length} top hits (${canonicalCount} canonical from Supabase).`);
        } else {
          console.log(`[au-chat] No relevant chunks found in Qdrant.`);
        }
      } catch (ragError) {
        console.warn("[au-chat] RAG step failed (continuing without context):", ragError);
      }
    }

    if (!context && docIdsToSearch.length > 0) {
      const fallbackHits = await loadSupabaseFallbackHits({
        supabaseAdmin,
        documentIds: docIdsToSearch,
        latestMessage,
        preferredDocumentId: resolvedDocId || null,
      });

      if (fallbackHits.length > 0) {
        context = fallbackHits.map((hit) => hit.text).join("\n\n");
        if (context.length > 6000) {
          context = context.substring(0, 6000) + "... [truncated for token optimization]";
        }

        const fileNameByDocId = await loadDocumentNameMap(
          supabaseAdmin,
          fallbackHits.map((hit) => hit.documentId),
        );

        citations = fallbackHits.map((hit) => ({
          documentId: hit.documentId,
          chunkId: hit.chunkId,
          score: hit.score,
          fileName: fileNameByDocId.get(hit.documentId) || "Unknown Document",
        }));

        console.log(`[au-chat] Supabase chunk fallback recovered ${fallbackHits.length} hits.`);
      }
    }

    // 3. Generate Answer
    const wantsStream =
      body?.stream === true ||
      (req.headers.get("accept") || "").toLowerCase().includes("text/event-stream");
    const systemPrompt = `You are Datacube AU Chat (RAG-only): you answer using ONLY the user’s retrieved document context.
 
PRIMARY PURPOSE 
- Answer questions about the user’s own uploaded documents. 
- Use retrieved chunks as the source of truth. 
- Resolve follow-up references like “this document” using the active document context. 
- Do not ask the user to re-specify the document if context is available. 
- If the answer is not supported by the retrieved context, say you can’t find it in their documents. 
 
 STRICT RULES 
 - No internet/trends/general browsing. 
 - Do NOT use global system/user profile memory except minimal “activity hints” if provided. 
 - Do NOT hallucinate missing details. 
 - If the user asks something outside their documents, recommend they use Global Chat. 
 - Identity fact: Datacube AU is built and operated by Zahed Investment Ltd (Nigeria, RC 8127949).
 
 CONTEXT YOU RECEIVE 
 - retrieved_context: text snippets from the user’s documents (already filtered by owner_id) 
 - doc_metadata: document title/id and chunk refs 
 - recent_snippet: last few turns for continuity (AU chat only) 
 
 HOW TO ANSWER 
 1) Use retrieved_context first. 
 2) Cite the chunk refs (or titles) if available. 
 3) If not found: say “Not found in your documents” and suggest what to search or upload. 
 4) If user wants broad explanation/trends: “Use Global Chat for broader info.” 
 
 LOW TOKEN STYLE 
 - Short answers. 
 - Bullets for steps. 
 - Avoid repeating large context. 
 - Ask at most 1 clarifying question. 
 
 HANDOFF MESSAGE (STANDARD) 
 If the question is outside their docs, end with: 
 “Open Global Chat for broader guidance (outside your documents).”
 
    CURRENT CONTEXT:
    - Current Path: ${currentPath || 'Dashboard'}
    - Mode: AU RAG (Strict Document Context)
    ${logContext}

    ${summaryMode ? `SUMMARY MODE: You are in ${summaryMode.toUpperCase()} mode.` : ""}

    DOCUMENT CONTEXT (RAG):
    The following text snippets are from the user's uploaded documents. You MUST use this information to answer the question.
    ${context ? `"""\n${context}\n"""` : ""}

    OUTPUT FORMAT (Strict JSON):
    {
      "thought": "Internal monologue...",
      "answer": "Markdown answer..."
    }`;

    const recentSnippet = body?.recent_snippet;
    let userPrompt = `CURRENT QUESTION:\n${latestMessage}`;
    if (recentSnippet?.mode === 'summary' && typeof recentSnippet.summary === 'string' && recentSnippet.summary) {
      userPrompt = `PREVIOUS CHAT SUMMARY:\n${String(recentSnippet.summary).substring(0, 900)}\n\nCURRENT QUESTION:\n${latestMessage}`;
    } else if (recentSnippet?.mode === 'turns' && Array.isArray(recentSnippet.turns) && recentSnippet.turns.length > 0) {
      const turns = recentSnippet.turns.slice(-8).map((t: any) => `${String(t.role || '').toUpperCase()}: ${String(t.content || '').substring(0, 500)}`).join("\n");
      userPrompt = `RECENT CHAT HISTORY:\n${turns}\n\nCURRENT QUESTION:\n${latestMessage}`;
    } else if (resolvedMessages.length > 1) {
      const recentHistory = resolvedMessages.slice(-6, -1).map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
      if (recentHistory) {
        userPrompt = `RECENT CHAT HISTORY:\n${recentHistory}\n\nCURRENT QUESTION:\n${latestMessage}`;
      }
    }

    const routedModel =
      (typeof body?.model === "string" && body.model.trim().length > 0 ? body.model.trim() : "") ||
      (req.headers.get("x-au-model") || "").trim() ||
      undefined;
    const routedApiKey = (req.headers.get("x-au-openrouter-key") || "").trim() || undefined;
    const modelOverride = routedModel;
    const responseDocumentContext = mergeDocumentContext(baseDocumentContext, {
      active_document_id: resolvedDocId || null,
      active_document_name: baseDocumentContext.active_document_name || null,
      last_retrieved_document_id:
        asTrimmedString(citations[0]?.documentId) || resolvedDocId || null,
      last_retrieved_source_ids: citations
        .map((citation: any) => asTrimmedString(citation?.chunkId || citation?.documentId))
        .filter(Boolean)
        .slice(0, 6),
      last_resolved_reference_at: new Date().toISOString(),
    });

    if (!context) {
      const hasContextDocument =
        Boolean(resolvedDocId) ||
        Boolean(baseDocumentContext.active_document_id) ||
        Boolean(baseDocumentContext.last_uploaded_document_id);
      const noDocuments = snapshot
        ? Number(snapshot.count || 0) <= 0
        : !hasContextDocument;
      const noSuccessfulDocuments = snapshot
        ? (!noDocuments && Number(snapshot.successfulCount || 0) <= 0)
        : false;
      const fallbackAnswer = noDocuments
        ? "No uploaded documents were found. Upload a textbook or past-question file first."
        : noSuccessfulDocuments
          ? "Your documents are not ready yet because ingestion failed or is still processing. Retry failed uploads or wait for completion."
          : "Not found in your documents. Try naming a chapter/topic, or ask AU to search your textbook and linked past-question files.";

      const payload = {
        ok: true,
        answer: fallbackAnswer,
        thought: "",
        citations: [],
        document_context: responseDocumentContext,
        sessionId,
        requestId,
      };

      await recordChatUsage({
        supabaseAdmin,
        userId,
        effectiveLimits,
        limitsFlags,
        isExamLikeAction,
        examAction: isExamLikeAction ? (requestedAction as "prediction" | "cbt") : null,
        promptText: latestMessage,
        answerText: fallbackAnswer,
        usageAlreadyTracked,
      });

      return wantsStream
        ? toDoneStreamResponse(payload, corsHeaders)
        : new Response(JSON.stringify(payload), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
    }

    if (wantsStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start: async (controller) => {
          const write = (obj: any) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          };

          try {
            const { response } = await callAUStream(
              supabaseAdmin,
              systemPrompt,
              userPrompt,
              0.5,
              false,
              modelOverride,
              { userId: userId || undefined, ownershipFilter, feature: "au-chat", sessionId, routedApiKey },
              "chat",
              requestId
            );

            const bodyStream = response.body;
            if (!bodyStream) {
              write({ type: "error", error: "Missing upstream stream", requestId });
              controller.close();
              return;
            }

            const reader = bodyStream.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let fullText = "";

            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const data = trimmed.slice(5).trim();
                if (!data) continue;
                if (data === "[DONE]") {
                  buffer = "";
                  break;
                }
                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed?.choices?.[0]?.delta?.content;
                  if (typeof delta === "string" && delta) {
                    fullText += delta;
                    write({ type: "delta", text: delta });
                  }
                } catch {
                }
              }
            }

            let donePayload: any = { type: "done", requestId, citations };
            try {
              const cleaned = fullText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
              const parsed = JSON.parse(cleaned);
              donePayload = {
                type: "done",
                requestId,
                citations,
                answer: parsed?.answer || fullText,
                thought: parsed?.thought || "",
                document_context: responseDocumentContext,
              };
            } catch {
              donePayload = {
                type: "done",
                requestId,
                citations,
                answer: fullText,
                thought: "",
                document_context: responseDocumentContext,
              };
            }

            await recordChatUsage({
              supabaseAdmin,
              userId,
              effectiveLimits,
              limitsFlags,
              isExamLikeAction,
              examAction: isExamLikeAction ? (requestedAction as "prediction" | "cbt") : null,
              promptText: String(latestMessage || ""),
              answerText: String(donePayload.answer || ""),
              usageAlreadyTracked,
            });

            write(donePayload);

            await emitEvent(supabaseAdmin, {
              event_type: 'chat_completed',
              entity_id: sessionId || 'rag-session',
              user_id: userId,
              metadata: {
                messageCount: resolvedMessages.length,
                hasContext: !!context,
                citationCount: citations.length,
                mode: 'au_rag',
                streamed: true
              }
            });

            if (useRAG && donePayload.answer && queryEmbedding) {
              try {
                const CACHE_COLLECTION = "au_rag_cache";
                const cachePoint = {
                  id: crypto.randomUUID(),
                  vector: queryEmbedding,
                  payload: {
                    answer: donePayload.answer,
                    thought: donePayload.thought || "",
                    user_id: effectiveFilter.user_id,
                    document_id: resolvedDocId || null,
                    created_at: Math.floor(Date.now() / 1000)
                  }
                };
                await upsertPoints([cachePoint], CACHE_COLLECTION);
              } catch {
              }
            }

            controller.close();
          } catch (e: any) {
            if (e instanceof LimitExceededError || e?.name === "LimitExceededError") {
              write({
                type: "error",
                requestId,
                error: "limit_exceeded",
                code: "LIMIT_EXCEEDED",
                status: typeof e?.status === "number" ? e.status : 429,
                details: e?.payload || {},
                isThrottled: false,
              });
              controller.close();
              return;
            }

            write({
              type: "error",
              requestId,
              error: e?.message || "Streaming failed",
              details: e?.details,
              isThrottled: e?.isThrottled || false,
            });
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    const responseText = await callAU(
      supabaseAdmin,
      systemPrompt,
      userPrompt,
      0.5,
      false, // Disable JSON mode to avoid 400 errors with some free models
      modelOverride,
      { userId: userId || undefined, ownershipFilter, feature: "au-chat", sessionId, routedApiKey },
      "chat"
    );

    let finalResponse = { answer: responseText, thought: "", citations, document_context: responseDocumentContext };
    try {
      // Clean up potential markdown code blocks
      const cleaned = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      finalResponse = { 
        answer: parsed.answer || responseText, 
        thought: parsed.thought || "",
        citations,
        document_context: responseDocumentContext,
      };
    } catch (e) {
      // Fallback if AU doesn't return valid JSON
      finalResponse = { answer: responseText, thought: "Analyzing...", citations, document_context: responseDocumentContext };
    }

    // NOTE: Removed DB Upsert (au_messages)
    await recordChatUsage({
      supabaseAdmin,
      userId,
      effectiveLimits,
      limitsFlags,
      isExamLikeAction,
      examAction: isExamLikeAction ? (requestedAction as "prediction" | "cbt") : null,
      promptText: String(latestMessage || ""),
      answerText: String(finalResponse.answer || ""),
      usageAlreadyTracked,
    });

    // 5. Emit Sync Event
    await emitEvent(supabaseAdmin, {
      event_type: 'chat_completed',
      entity_id: sessionId || 'rag-session',
      user_id: userId,
      metadata: { 
        messageCount: resolvedMessages.length,
        hasContext: !!context,
        citationCount: citations.length,
        mode: 'au_rag'
      }
    });

    // --- OPTIMIZATION: UPDATE SEMANTIC CACHE ---
    if (useRAG && finalResponse.answer && queryEmbedding) {
         try {
             const CACHE_COLLECTION = "au_rag_cache"; // Namespaced
             const cachePoint = {
                 id: crypto.randomUUID(),
                 vector: queryEmbedding,
                 payload: {
                     answer: finalResponse.answer,
                     thought: finalResponse.thought,
                     user_id: effectiveFilter.user_id,
                     document_id: resolvedDocId || null,
                     created_at: Math.floor(Date.now() / 1000)
                  }
             };
             // Ensure collection exists? Qdrant auto-creates on upsert if configured, 
             // but via REST we might need to create it. 
             // For performance, we assume it exists or we catch the error.
             await upsertPoints([cachePoint], CACHE_COLLECTION);
         } catch (e) {
             console.warn("Failed to update cache", e);
         }
    }

    return new Response(JSON.stringify({ 
      ok: true,
      answer: finalResponse.answer, 
      thought: finalResponse.thought,
      citations,
      document_context: responseDocumentContext,
      sessionId,
      requestId,
      delivered: true,
      messageIds: [] // No DB IDs anymore
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error(`[au-chat] Error [${requestId}]:`, error);
    const status = typeof error?.status === "number" ? error.status : 500;
    
    // Handle Limit Exceeded Error
    if (error instanceof LimitExceededError || error?.name === "LimitExceededError") {
        return new Response(JSON.stringify({
          code: "LIMIT_EXCEEDED",
          ...(error?.payload || {}),
        }), {
            status: typeof error?.status === "number" ? error.status : 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
    }

    // Handle Rate Limit Error specially
    if (error?.errorType === "rate_limit") {
        return new Response(JSON.stringify({
            error: error.message,
            isThrottled: true,
            requestId
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rawMessage = error.message || String(error);
    const safeMessage =
      status === 401 || status === 403
        ? "Unauthorized"
        : (rawMessage.includes("All AI models") ? rawMessage : "Study assistant temporarily unavailable. Please try again later.");
        
    return new Response(JSON.stringify({ 
      error: safeMessage,
      details: error.details || error.message || String(error),
      isThrottled: error.isThrottled || false,
      requestId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });
  }
});
