export const USAGE_TRACKING_HEADER = 'x-au-usage-tracked';

export const TRACKED_USAGE_METRIC_KEYS = [
  'max_chats_total',
  'used_chats',
  'messages_count',
  'max_tokens_total',
  'used_tokens',
  'tokens_used',
  'api_calls',
  'max_uploads_total',
  'used_uploads',
  'uploads_count',
  'uploaded_mb',
  'uploaded_bytes',
  'max_exam_predictions',
  'prediction_generations',
  'used_exams',
  'exams_count',
  'max_practice_exams',
  'practice_exam_generations',
  'max_knowledge_hub',
  'knowledge_generations',
  'audio_seconds',
  'image_generations',
] as const;

export type TrackedUsageMetricKey = (typeof TRACKED_USAGE_METRIC_KEYS)[number];

export const USAGE_METRIC_ALIASES: Record<string, string[]> = {
  max_chats_total: ['max_chats_total', 'used_chats', 'messages_count'],
  max_tokens_total: ['max_tokens_total', 'used_tokens', 'tokens_used'],
  max_uploads_total: ['max_uploads_total', 'used_uploads', 'uploads_count'],
  max_exam_predictions: ['max_exam_predictions', 'prediction_generations', 'used_exams', 'exams_count'],
  max_practice_exams: ['max_practice_exams', 'practice_exam_generations'],
  max_knowledge_hub: ['max_knowledge_hub', 'knowledge_generations'],
  api_calls: ['api_calls'],
  audio_seconds: ['audio_seconds'],
  image_generations: ['image_generations'],
  uploaded_mb: ['uploaded_mb'],
  uploaded_bytes: ['uploaded_bytes'],
};

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function flattenUsageText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((entry) => flattenUsageText(entry)).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((entry) => flattenUsageText(entry))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function estimateTokenCountFromText(...parts: Array<string | null | undefined>): number {
  const merged = parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join(' ');
  const chars = merged.trim().length;
  if (chars <= 0) return 1;
  return Math.max(1, Math.ceil(chars / 4));
}

export type ChatUsageEstimateInput = {
  messages?: Array<{ role?: string; content?: unknown }>;
  auGuide?: unknown;
  activeDocIds?: string[] | null;
  sessionId?: string | null;
  appContext?: unknown;
  memoryPack?: unknown;
  documentContext?: unknown;
  recentSnippet?: unknown;
  secondarySnippet?: unknown;
};

export function estimateChatRequestTokens(input: ChatUsageEstimateInput): number {
  const messageText = (input.messages || [])
    .map((entry) => `${safeString(entry?.role || 'user')}: ${flattenUsageText(entry?.content)}`)
    .filter(Boolean)
    .join('\n');
  const contextText = [
    flattenUsageText(input.auGuide),
    flattenUsageText(input.appContext),
    flattenUsageText(input.memoryPack),
    flattenUsageText(input.documentContext),
    flattenUsageText(input.recentSnippet),
    flattenUsageText(input.secondarySnippet),
    Array.isArray(input.activeDocIds) ? input.activeDocIds.map((entry) => safeString(entry)).filter(Boolean).join(',') : '',
    safeString(input.sessionId),
  ]
    .filter(Boolean)
    .join('\n');

  return estimateTokenCountFromText(messageText, contextText);
}

export function normalizeMetricIncrements(input: Record<string, unknown>): Record<string, number> {
  return Object.entries(input).reduce((acc, [key, raw]) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed === 0) return acc;
    acc[key] = parsed;
    return acc;
  }, {} as Record<string, number>);
}

export function buildChatUsageIncrements(estimatedTokens: number): Record<string, number> {
  const safeTokens = Math.max(1, Math.floor(Number.isFinite(estimatedTokens) ? estimatedTokens : 1));
  return {
    max_chats_total: 1,
    used_chats: 1,
    messages_count: 1,
    max_tokens_total: safeTokens,
    used_tokens: safeTokens,
    tokens_used: safeTokens,
    api_calls: 1,
  };
}

export function buildFeatureUsageIncrements(
  feature: 'knowledge_hub' | 'exam_prediction' | 'practice_exam_generation',
): Record<string, number> {
  if (feature === 'knowledge_hub') {
    return {
      max_knowledge_hub: 1,
      knowledge_generations: 1,
      api_calls: 1,
    };
  }

  if (feature === 'exam_prediction') {
    return {
      max_exam_predictions: 1,
      prediction_generations: 1,
      used_exams: 1,
      exams_count: 1,
      api_calls: 1,
    };
  }

  return {
    max_practice_exams: 1,
    practice_exam_generations: 1,
    api_calls: 1,
  };
}

export function buildUploadUsageIncrements(fileSizeBytes: number): Record<string, number> {
  const bytes = Math.max(0, Math.floor(Number.isFinite(fileSizeBytes) ? fileSizeBytes : 0));
  const mb = bytes <= 0 ? 0 : Number((bytes / (1024 * 1024)).toFixed(4));
  return normalizeMetricIncrements({
    max_uploads_total: 1,
    used_uploads: 1,
    uploads_count: 1,
    uploaded_bytes: bytes,
    uploaded_mb: mb,
    api_calls: 1,
  });
}

export function readUsageMetricValue(source: Record<string, unknown> | null | undefined, aliases: string[], fallback = 0): number {
  const snapshot = source || {};
  for (const alias of aliases) {
    const parsed = Number(snapshot[alias]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
