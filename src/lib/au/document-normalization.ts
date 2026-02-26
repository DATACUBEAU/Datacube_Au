import { supabase } from '@/lib/supabase-client/client';
import type { AuDocumentRow, AuDocumentStatus, AuDocumentType } from '@/lib/au/types';

export const FREE_RETENTION_DAYS = 14;
export const PRO_RETENTION_DAYS = 30;

const RETENTION_CACHE_TTL_MS = 5 * 60 * 1000;
const retentionCache = new Map<string, { value: number; ts: number }>();

export function normalizeAuDocumentType(raw: unknown): AuDocumentType {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (
    value === 'past_questions' ||
    value === 'past_question' ||
    value === 'exam_questions' ||
    value === 'exam_question'
  ) {
    return value.startsWith('exam_') ? 'exam_questions' : 'past_questions';
  }

  if (
    value === 'main_textbook' ||
    value === 'main_textbooks' ||
    value === 'textbook' ||
    value === 'textbooks'
  ) {
    return 'main_textbook';
  }

  return 'main_textbook';
}

export function normalizeAuDocumentStatus(raw: unknown): AuDocumentStatus {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'done' || value === 'indexed') return 'completed';
  if (value === 'queued' || value === 'pending_upload') return 'uploading';
  if (value === 'uploaded') return 'processing';
  if (value === 'failed') return 'failed';
  if (value === 'processing') return 'processing';
  if (value === 'completed') return 'completed';
  return 'uploading';
}

export function computeFallbackExpiresAt(createdAt: string | null | undefined, retentionDays: number): string | null {
  if (!createdAt) return null;
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return null;
  const expiresMs = createdMs + retentionDays * 24 * 60 * 60 * 1000;
  return new Date(expiresMs).toISOString();
}

export async function resolveDocumentRetentionDays(userId: string | null | undefined): Promise<number> {
  if (!userId) return FREE_RETENTION_DAYS;

  const cached = retentionCache.get(userId);
  if (cached && Date.now() - cached.ts < RETENTION_CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const now = new Date();
    const [{ data: profile }, { data: billingFlag }, { data: conexConfig }, { data: legacyConfig }] = await Promise.all([
      supabase
        .from('au_user_profiles')
        .select('tier,tier_expires_at')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', 'billing_enabled')
        .maybeSingle(),
      supabase
        .from('au_conex_config')
        .select('billing_enabled')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('au_config')
        .select('billing_enabled')
        .limit(1)
        .maybeSingle(),
    ]);

    const billingEnabled =
      (typeof billingFlag?.enabled === 'boolean' ? billingFlag.enabled : null) ??
      conexConfig?.billing_enabled ??
      legacyConfig?.billing_enabled ??
      true;
    if (!billingEnabled) {
      retentionCache.set(userId, { value: FREE_RETENTION_DAYS, ts: Date.now() });
      return FREE_RETENTION_DAYS;
    }

    const tier = String(profile?.tier || 'free').toLowerCase();
    if (tier !== 'pro') {
      retentionCache.set(userId, { value: FREE_RETENTION_DAYS, ts: Date.now() });
      return FREE_RETENTION_DAYS;
    }

    const tierExpiry = profile?.tier_expires_at ? new Date(profile.tier_expires_at) : null;
    if (!tierExpiry || tierExpiry > now) {
      retentionCache.set(userId, { value: PRO_RETENTION_DAYS, ts: Date.now() });
      return PRO_RETENTION_DAYS;
    }

    const { data: activeSubscription } = await supabase
      .from('au_subscriptions')
      .select('id')
      .eq('owner_id', userId)
      .in('status', ['active', 'non_renewing'])
      .gt('current_period_end', now.toISOString())
      .maybeSingle();

    const retentionDays = activeSubscription ? PRO_RETENTION_DAYS : FREE_RETENTION_DAYS;
    retentionCache.set(userId, { value: retentionDays, ts: Date.now() });
    return retentionDays;
  } catch {
    return FREE_RETENTION_DAYS;
  }
}

export function normalizeAuDocumentRow(row: any, retentionDays: number, fallbackOwnerId?: string | null): AuDocumentRow {
  const ownerId = row?.owner_id ?? row?.user_id ?? fallbackOwnerId ?? null;
  const expiresAt = row?.expires_at || computeFallbackExpiresAt(row?.created_at, retentionDays);

  return {
    ...row,
    owner_id: ownerId,
    user_id: row?.user_id ?? ownerId,
    document_type: normalizeAuDocumentType(row?.document_type),
    status: normalizeAuDocumentStatus(row?.status),
    expires_at: expiresAt,
    parent_id: row?.parent_id ?? null,
    error: row?.error ?? null,
  } as AuDocumentRow;
}
