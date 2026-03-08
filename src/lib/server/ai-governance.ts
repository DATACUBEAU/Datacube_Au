import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getFeatureFlagsSnapshot } from '@/lib/server/feature-flags';
import { matchGlobalChatTemplate, type ChatTemplateResponse } from '@shared/global-chat-routing';
import { classifyDocumentIntent, hasDocumentScopedReference } from '@shared/document-chat-context';

export type IdempotencyRecord = {
  statusCode: number;
  response: any;
  createdAt: string | null;
};

export type AnswerCacheRecord = {
  response: any;
  model: string | null;
  tokens: number;
  costUsd: number | null;
  createdAt: string | null;
  expiresAt: string | null;
};

export type FeatureOutputRecord = {
  output: any;
  status: string;
  model: string | null;
  tokens: number;
  costUsd: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type FeatureOutputReservation =
  | { state: 'ready'; record: FeatureOutputRecord }
  | { state: 'running'; record: FeatureOutputRecord | null }
  | { state: 'failed'; record: FeatureOutputRecord }
  | { state: 'reserved'; record: FeatureOutputRecord | null };

export type FeatureGateDecision = {
  enabled: boolean;
  proRequired: boolean;
  reason: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isSchemaDriftError(error: any): boolean {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    message.includes('does not exist') ||
    details.includes('does not exist')
  );
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(String(input || ''), 'utf8').digest('hex');
}

export function buildIdempotencyStorageKey(userId: string, feature: string, idempotencyKey: string): string {
  return `${userId}:${feature}:${idempotencyKey}`;
}

export function normalizeQuestion(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildAnswerCacheKey(input: {
  userId: string;
  question: string;
  activeDocScope: string;
  settingsHash: string;
  feature: string;
}): string {
  return sha256Hex([
    input.userId,
    input.feature,
    normalizeQuestion(input.question),
    input.activeDocScope,
    input.settingsHash,
  ].join('|'));
}

export async function readIdempotencyRecord(input: {
  supabase: SupabaseClient;
  key: string;
}): Promise<IdempotencyRecord | null> {
  const { data, error } = await input.supabase
    .from('au_idempotency')
    .select('status_code,response,created_at,expires_at')
    .eq('key', input.key)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    if (isSchemaDriftError(error)) return null;
    throw error;
  }

  if (!data) return null;
  return {
    statusCode: Number((data as any)?.status_code || 200),
    response: (data as any)?.response ?? null,
    createdAt: typeof (data as any)?.created_at === 'string' ? (data as any).created_at : null,
  };
}

export async function writeIdempotencyRecord(input: {
  supabase: SupabaseClient;
  key: string;
  userId: string;
  feature: string;
  requestHash?: string | null;
  response: any;
  statusCode?: number;
  correlationId?: string | null;
  ttlSeconds?: number;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + Math.max(5, Number(input.ttlSeconds || 60)) * 1000).toISOString();
  const { error } = await input.supabase
    .from('au_idempotency')
    .upsert(
      {
        key: input.key,
        user_id: input.userId,
        feature: input.feature,
        request_hash: safeString(input.requestHash) || null,
        response: input.response ?? {},
        status_code: Number(input.statusCode || 200) || 200,
        expires_at: expiresAt,
        correlation_id: safeString(input.correlationId) || null,
      },
      { onConflict: 'key' },
    );

  if (error && !isSchemaDriftError(error)) {
    throw error;
  }
}

export async function readAnswerCache(input: {
  supabase: SupabaseClient;
  cacheKey: string;
}): Promise<AnswerCacheRecord | null> {
  const { data, error } = await input.supabase
    .from('au_answer_cache')
    .select('response,model,tokens,cost_usd,created_at,expires_at')
    .eq('cache_key', input.cacheKey)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    if (isSchemaDriftError(error)) return null;
    throw error;
  }

  if (!data) return null;

  return {
    response: (data as any)?.response ?? null,
    model: safeString((data as any)?.model) || null,
    tokens: Number((data as any)?.tokens || 0) || 0,
    costUsd: Number.isFinite(Number((data as any)?.cost_usd)) ? Number((data as any).cost_usd) : null,
    createdAt: typeof (data as any)?.created_at === 'string' ? (data as any).created_at : null,
    expiresAt: typeof (data as any)?.expires_at === 'string' ? (data as any).expires_at : null,
  };
}

export async function writeAnswerCache(input: {
  supabase: SupabaseClient;
  cacheKey: string;
  userId: string;
  feature: string;
  normalizedQuestion: string;
  activeDocScope: string;
  settingsHash: string;
  response: any;
  model?: string | null;
  tokens?: number | null;
  costUsd?: number | null;
  ttlDays?: number;
}): Promise<void> {
  const ttlDays = Math.max(1, Number(input.ttlDays || 7));
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await input.supabase
    .from('au_answer_cache')
    .upsert(
      {
        cache_key: input.cacheKey,
        user_id: input.userId,
        feature: input.feature,
        normalized_question: input.normalizedQuestion,
        active_doc_scope: input.activeDocScope,
        settings_hash: input.settingsHash,
        response: input.response ?? {},
        model: safeString(input.model) || null,
        tokens: Number(input.tokens || 0) || 0,
        cost_usd: Number.isFinite(Number(input.costUsd)) ? Number(input.costUsd) : null,
        expires_at: expiresAt,
        last_hit_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' },
    );

  if (error && !isSchemaDriftError(error)) {
    throw error;
  }
}

export async function touchAnswerCacheHit(input: {
  supabase: SupabaseClient;
  cacheKey: string;
}): Promise<void> {
  const { data: existing, error: readError } = await input.supabase
    .from('au_answer_cache')
    .select('hit_count')
    .eq('cache_key', input.cacheKey)
    .maybeSingle();

  if (readError && !isSchemaDriftError(readError)) {
    throw readError;
  }

  const { error } = await input.supabase
    .from('au_answer_cache')
    .update({
      last_hit_at: new Date().toISOString(),
      hit_count: Math.max(1, Number((existing as any)?.hit_count || 0) + 1),
    })
    .eq('cache_key', input.cacheKey);

  if (error && !isSchemaDriftError(error)) {
    throw error;
  }
}

export async function resolveDocumentVersion(input: {
  supabase: SupabaseClient;
  userId: string;
  documentId?: string | null;
  sourceText?: string | null;
  fallbackTexts?: Array<string | null | undefined>;
}): Promise<{ documentId: string | null; versionId: string | null; contentHash: string | null }> {
  const userId = safeString(input.userId);
  const documentId = safeString(input.documentId);
  if (!userId || !documentId) {
    return { documentId: null, versionId: null, contentHash: null };
  }

  const documentRes = await input.supabase
    .from('au_documents')
    .select('id,user_id,owner_id,content_hash')
    .eq('id', documentId)
    .maybeSingle();

  if (documentRes.error) {
    if (isSchemaDriftError(documentRes.error)) return { documentId, versionId: null, contentHash: null };
    throw documentRes.error;
  }

  const row = documentRes.data as any;
  const ownerId = safeString(row?.owner_id || row?.user_id);
  if (!row?.id || !ownerId || ownerId !== userId) {
    return { documentId: null, versionId: null, contentHash: null };
  }

  let contentHash = safeString(row?.content_hash);
  if (!contentHash) {
    const explicit = safeString(input.sourceText);
    const fallback = (input.fallbackTexts || []).map((entry) => safeString(entry)).filter(Boolean).join('\n\n');
    const material = explicit || fallback;
    if (material) {
      contentHash = sha256Hex(material);
    }
  }

  if (!contentHash) {
    const chunkRes = await input.supabase
      .from('au_document_chunks')
      .select('text')
      .eq('document_id', documentId)
      .order('chunk_index', { ascending: true })
      .limit(120);
    if (!chunkRes.error) {
      const chunkBlob = (chunkRes.data || []).map((entry: any) => safeString(entry?.text)).filter(Boolean).join('\n\n');
      if (chunkBlob) {
        contentHash = sha256Hex(chunkBlob);
      }
    }
  }

  if (!contentHash) {
    return { documentId, versionId: null, contentHash: null };
  }

  await input.supabase
    .from('au_documents')
    .update({ content_hash: contentHash })
    .eq('id', documentId);

  const versionRes = await input.supabase
    .from('au_document_versions')
    .upsert(
      {
        document_id: documentId,
        content_hash: contentHash,
        is_active: true,
      },
      { onConflict: 'document_id,content_hash' },
    )
    .select('id')
    .maybeSingle();

  if (versionRes.error) {
    if (isSchemaDriftError(versionRes.error)) return { documentId, versionId: null, contentHash };
    throw versionRes.error;
  }

  const versionId = safeString(versionRes.data?.id);
  if (versionId) {
    await input.supabase
      .from('au_document_versions')
      .update({ is_active: false })
      .eq('document_id', documentId)
      .neq('id', versionId);
  }

  return {
    documentId,
    versionId: versionId || null,
    contentHash,
  };
}

export async function readFeatureOutput(input: {
  supabase: SupabaseClient;
  userId: string;
  docVersionId?: string | null;
  feature: string;
}): Promise<FeatureOutputRecord | null> {
  const docVersionId = safeString(input.docVersionId);
  if (!docVersionId) return null;

  const { data, error } = await input.supabase
    .from('au_feature_outputs')
    .select('output,status,model,tokens,cost_usd,created_at,updated_at')
    .eq('user_id', input.userId)
    .eq('doc_version_id', docVersionId)
    .eq('feature', input.feature)
    .maybeSingle();

  if (error) {
    if (isSchemaDriftError(error)) return null;
    throw error;
  }

  if (!data) return null;
  return {
    output: (data as any)?.output ?? null,
    status: safeString((data as any)?.status) || 'ready',
    model: safeString((data as any)?.model) || null,
    tokens: Number((data as any)?.tokens || 0) || 0,
    costUsd: Number.isFinite(Number((data as any)?.cost_usd)) ? Number((data as any).cost_usd) : null,
    createdAt: typeof (data as any)?.created_at === 'string' ? (data as any).created_at : null,
    updatedAt: typeof (data as any)?.updated_at === 'string' ? (data as any).updated_at : null,
  };
}

export async function writeFeatureOutput(input: {
  supabase: SupabaseClient;
  userId: string;
  docVersionId?: string | null;
  feature: string;
  output: any;
  model?: string | null;
  tokens?: number | null;
  costUsd?: number | null;
  status?: string | null;
}): Promise<void> {
  const docVersionId = safeString(input.docVersionId);
  if (!docVersionId) return;

  const { error } = await input.supabase
    .from('au_feature_outputs')
    .upsert(
      {
        user_id: input.userId,
        doc_version_id: docVersionId,
        feature: input.feature,
        output: input.output ?? {},
        status: safeString(input.status) || 'ready',
        model: safeString(input.model) || null,
        tokens: Number(input.tokens || 0) || 0,
        cost_usd: Number.isFinite(Number(input.costUsd)) ? Number(input.costUsd) : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,doc_version_id,feature' },
    );

  if (error && !isSchemaDriftError(error)) {
    throw error;
  }
}

export async function prepareFeatureOutputGeneration(input: {
  supabase: SupabaseClient;
  userId: string;
  docVersionId?: string | null;
  feature: string;
}): Promise<FeatureOutputReservation> {
  const docVersionId = safeString(input.docVersionId);
  if (!docVersionId) {
    return { state: 'reserved', record: null };
  }

  const existing = await readFeatureOutput({
    supabase: input.supabase,
    userId: input.userId,
    docVersionId,
    feature: input.feature,
  });

  if (existing?.status === 'ready') {
    return { state: 'ready', record: existing };
  }

  if (existing?.status === 'running') {
    return { state: 'running', record: existing };
  }

  if (existing?.status === 'failed') {
    return { state: 'failed', record: existing };
  }

  const now = new Date().toISOString();
  const { error } = await input.supabase.from('au_feature_outputs').insert({
    user_id: input.userId,
    doc_version_id: docVersionId,
    feature: input.feature,
    status: 'running',
    output: {},
    updated_at: now,
  });

  if (!error) {
    return { state: 'reserved', record: null };
  }

  if (isSchemaDriftError(error)) {
    return { state: 'reserved', record: null };
  }

  if (String((error as any)?.code || '').trim() === '23505') {
    const collided = await readFeatureOutput({
      supabase: input.supabase,
      userId: input.userId,
      docVersionId,
      feature: input.feature,
    });

    if (collided?.status === 'ready') {
      return { state: 'ready', record: collided };
    }
    if (collided?.status === 'failed') {
      return { state: 'failed', record: collided };
    }
    return { state: 'running', record: collided };
  }

  throw error;
}

export async function markFeatureOutputReady(input: {
  supabase: SupabaseClient;
  userId: string;
  docVersionId?: string | null;
  feature: string;
  output: any;
  model?: string | null;
  tokens?: number | null;
  costUsd?: number | null;
}): Promise<void> {
  await writeFeatureOutput({
    supabase: input.supabase,
    userId: input.userId,
    docVersionId: input.docVersionId,
    feature: input.feature,
    output: input.output,
    model: input.model,
    tokens: input.tokens,
    costUsd: input.costUsd,
    status: 'ready',
  });
}

export async function markFeatureOutputFailed(input: {
  supabase: SupabaseClient;
  userId: string;
  docVersionId?: string | null;
  feature: string;
  error: unknown;
}): Promise<void> {
  const message =
    typeof input.error === 'string'
      ? input.error
      : String((input.error as any)?.message || 'Generation failed');

  await writeFeatureOutput({
    supabase: input.supabase,
    userId: input.userId,
    docVersionId: input.docVersionId,
    feature: input.feature,
    output: {
      error: {
        message,
        code: safeString((input.error as any)?.code) || null,
        failed_at: new Date().toISOString(),
      },
    },
    status: 'failed',
  });
}

export async function clearFeatureOutput(input: {
  supabase: SupabaseClient;
  userId?: string | null;
  docVersionId?: string | null;
  feature?: string | null;
}): Promise<number> {
  const userId = safeString(input.userId);
  const docVersionId = safeString(input.docVersionId);
  const feature = safeString(input.feature);

  let countQuery = input.supabase.from('au_feature_outputs').select('id', { count: 'exact', head: true });
  let deleteQuery = input.supabase.from('au_feature_outputs').delete();

  if (userId) {
    countQuery = countQuery.eq('user_id', userId);
    deleteQuery = deleteQuery.eq('user_id', userId);
  }
  if (docVersionId) {
    countQuery = countQuery.eq('doc_version_id', docVersionId);
    deleteQuery = deleteQuery.eq('doc_version_id', docVersionId);
  }
  if (feature) {
    countQuery = countQuery.eq('feature', feature);
    deleteQuery = deleteQuery.eq('feature', feature);
  }

  const { error: countError, count } = await countQuery;
  if (countError) {
    if (isSchemaDriftError(countError)) return 0;
    throw countError;
  }

  if (!count) return 0;

  const { error: deleteError } = await deleteQuery;
  if (deleteError) {
    if (isSchemaDriftError(deleteError)) return 0;
    throw deleteError;
  }

  return Number(count || 0) || 0;
}

export async function getOrCreateFeatureOutput<T>(input: {
  supabase: SupabaseClient;
  userId: string;
  docVersionId?: string | null;
  feature: string;
  generateFn: () => Promise<{ output: T; model?: string | null; tokens?: number | null; costUsd?: number | null }>;
}): Promise<{ output: T; fromCache: boolean; status: 'ready' | 'running' | 'failed' }> {
  const prepared = await prepareFeatureOutputGeneration(input);
  if (prepared.state === 'ready') {
    return { output: prepared.record.output as T, fromCache: true, status: 'ready' };
  }
  if (prepared.state === 'running') {
    return { output: (prepared.record?.output ?? null) as T, fromCache: true, status: 'running' };
  }
  if (prepared.state === 'failed') {
    return { output: prepared.record.output as T, fromCache: true, status: 'failed' };
  }

  try {
    const generated = await input.generateFn();
    await markFeatureOutputReady({
      supabase: input.supabase,
      userId: input.userId,
      docVersionId: input.docVersionId,
      feature: input.feature,
      output: generated.output,
      model: generated.model,
      tokens: generated.tokens,
      costUsd: generated.costUsd,
    });
    return { output: generated.output, fromCache: false, status: 'ready' };
  } catch (error) {
    await markFeatureOutputFailed({
      supabase: input.supabase,
      userId: input.userId,
      docVersionId: input.docVersionId,
      feature: input.feature,
      error,
    });
    throw error;
  }
}

export async function recordSyntheticUsage(input: {
  supabase: SupabaseClient;
  userId: string;
  feature: string;
  model: string;
  requestId: string;
  correlationId: string;
  cacheHit: boolean;
  savedTokens?: number | null;
  metadata?: Record<string, unknown>;
  success?: boolean;
}): Promise<void> {
  const payload = {
    user_id: input.userId,
    feature: input.feature,
    provider: 'proxy',
    model: input.model,
    model_id: input.model,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    success: input.success !== false,
    latency_ms: 0,
    request_id: input.requestId,
    correlation_id: input.correlationId,
    metadata: {
      cache_hit: input.cacheHit,
      saved_tokens: Number(input.savedTokens || 0) || 0,
      source: 'next_proxy',
      ...(input.metadata || {}),
    },
  };

  const { error } = await input.supabase.from('au_model_usage').insert(payload);
  if (error && !isSchemaDriftError(error)) {
    throw error;
  }
}

function matchesLoosePattern(input: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(input));
}

export function classifyTemplateResponse(message: string, context: 'doc' | 'global'): ChatTemplateResponse | null {
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) return null;

  const greetingPatterns = [
    /^(hi|hello|hey|yo|howdy|good morning|good afternoon|good evening)[!. ]*$/i,
    /^[\p{Extended_Pictographic}\s!?.,]+$/u,
  ];
  const thanksPatterns = [
    /^(thanks|thank you|thx|ty|tysm|appreciate it)[!. ]*$/i,
    /^(ok|okay|cool|nice)[!. ]*thanks[!. ]*$/i,
  ];

  if (context === 'global') {
    return matchGlobalChatTemplate(normalized);
  }

  if (matchesLoosePattern(normalized, greetingPatterns)) {
    return {
      answer: 'Hello. Ask about the selected document and I will stay grounded in it.',
      navAction: null,
    };
  }

  if (matchesLoosePattern(normalized, thanksPatterns)) {
    return { answer: "You're welcome.", navAction: null };
  }

  // Handle document-scoped intents with deterministic templates if possible
  // For now, we just ensure the intent is classified so the backend can use it.
  // But we can add short fallbacks here if we detect missing context.

  return null;
}

export function buildDocScope(activeDocIds: string[] | undefined): string {
  const values = Array.isArray(activeDocIds)
    ? activeDocIds.map((value) => safeString(value)).filter(Boolean)
    : [];
  return values.sort((a, b) => a.localeCompare(b)).join(',');
}

export function buildSettingsHash(settings: unknown): string {
  return sha256Hex(JSON.stringify(settings || {}));
}

export async function getFeatureGateDecision(
  supabase: SupabaseClient,
  feature: 'knowledge_hub' | 'exam_prediction' | 'practice_exam_generation',
): Promise<FeatureGateDecision> {
  const flags = await getFeatureFlagsSnapshot(supabase).catch(() => new Map());

  if (feature === 'knowledge_hub') {
    return {
      enabled: flags.get('enable_knowledge_hub')?.enabled !== false,
      proRequired: flags.get('pro_required_knowledge_hub')?.enabled !== false,
      reason: null,
    };
  }

  if (feature === 'exam_prediction') {
    return {
      enabled: flags.get('enable_exam_prediction')?.enabled !== false,
      proRequired: flags.get('pro_required_exam_prediction')?.enabled !== false,
      reason: null,
    };
  }

  return {
    enabled: flags.get('enable_practice_exam_generation')?.enabled !== false,
    proRequired: false,
    reason: null,
  };
}
