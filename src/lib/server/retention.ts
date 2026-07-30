import type { User } from '@supabase/supabase-js';
import { createSupabaseAdminClient, firstEnv } from '@/lib/server/supabase-admin';
import {
  computeDocumentDeletionEligibility,
  deriveRetentionLifecycleState,
  FILE_CLEANUP_INACTIVITY_DAYS,
  getFileCleanupDueAt,
  getRetentionPolicySnapshot,
  isStorageMissingError,
  resolveLastSeenAt,
  scopePriority,
  shouldSkipAutomaticRetry,
  type RetentionActionStatus,
  type RetentionLifecycleState,
  type RetentionScope,
  type RetentionTargetType,
} from '@/lib/server/retention-policy';
import { isProtectedOwnerUserId } from '@/lib/admin/protected-owner';

const DEFAULT_BUCKET = firstEnv('BUCKET', 'NEXT_PUBLIC_SUPABASE_BUCKET') || 'documents';
const DEFAULT_PREVIEW_LIMIT = 50;
const RETENTION_LOCAL_LEASE_TTL_MS = 15 * 60 * 1000;

let localRetentionLease: { workerId: string; expiresAtMs: number } | null = null;

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

type UserProfileRow = {
  user_id: string;
  full_name: string | null;
  tier: string | null;
  last_activity_at: string | null;
};

type UserActivityRow = {
  user_id: string;
  last_active_at: string | null;
};

type DocumentRow = {
  id: string;
  owner_id: string | null;
  user_id: string | null;
  file_name: string | null;
  file_path: string | null;
  status: string | null;
  expires_at: string | null;
  retention_expires_at?: string | null;
  retention_tier?: string | null;
  retention_days?: number | null;
  retention_policy_version?: string | null;
  created_at: string | null;
  updated_at: string | null;
  cleanup_attempts?: number | null;
  cleanup_last_error?: string | null;
  cleanup_last_attempt_at?: string | null;
  cleanup_pending?: boolean | null;
  storage_deleted_at?: string | null;
  source_deleted_at?: string | null;
  source_cleanup_result?: string | null;
};

type RetentionActionRow = {
  id: string;
  scope: RetentionScope;
  target_type: RetentionTargetType;
  target_id: string;
  owner_id: string | null;
  email_snapshot: string | null;
  status: RetentionActionStatus;
  reason: string | null;
  attempts: number | null;
  first_detected_at: string | null;
  last_seen_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
};

type RetentionRunRow = {
  id: number;
  mode: 'preview' | 'execute';
  trigger_source: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  summary: Record<string, unknown> | null;
  error_message: string | null;
};

type UserSnapshot = {
  userId: string;
  email: string | null;
  fullName: string | null;
  tier: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  lastActivityAt: string | null;
  lastActiveAt: string | null;
  lastSeenAt: string | null;
  fileCleanupDueAt: string | null;
  fullDeletionDueAt: string | null;
  documents: DocumentRow[];
  lifecycleState: RetentionLifecycleState;
  latestAction: RetentionActionRow | null;
};

type DocumentCandidate = {
  documentId: string;
  ownerId: string;
  email: string | null;
  fileName: string | null;
  filePath: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  dueAt: string | null;
  scope: RetentionScope;
  reason: string;
  row: DocumentRow;
};

export type RetentionUserPreview = {
  userId: string;
  email: string | null;
  fullName: string | null;
  tier: string | null;
  lastSeenAt: string | null;
  fileCleanupDueAt: string | null;
  fullDeletionDueAt: string | null;
  documentsCount: number;
  lifecycleState: RetentionLifecycleState;
  latestActionStatus: string | null;
  latestActionScope: string | null;
  latestActionError: string | null;
};

export type RetentionDocumentPreview = {
  documentId: string;
  ownerId: string;
  email: string | null;
  fileName: string | null;
  filePath: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  dueAt: string | null;
  scope: RetentionScope;
  reason: string;
};

export type RetentionActionPreview = {
  id: string;
  scope: RetentionScope;
  targetType: RetentionTargetType;
  targetId: string;
  ownerId: string | null;
  email: string | null;
  status: RetentionActionStatus;
  reason: string | null;
  attempts: number;
  firstDetectedAt: string | null;
  lastSeenAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
};

export type RetentionRunPreview = {
  id: number;
  mode: 'preview' | 'execute';
  triggerSource: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  summary: Record<string, unknown>;
  errorMessage: string | null;
};

export type RetentionOverview = {
  generatedAt: string;
  policy: {
    version: string;
    signedOutDocumentCleanupDays: number;
    freeDocumentExpirationDays: number;
    promoDocumentExpirationDays: number;
    paidProDocumentExpirationDays: number;
    fileCleanupInactivityDays: number;
    accountDeletionInactivityDays: number | null;
  };
  summary: {
    activeUsers: number;
    scheduledFileDeletionUsers: number;
    filesDeletedUsers: number;
    scheduledFullDeletionUsers: number;
    fullyDeletedUsers: number;
    failedActions: number;
    documentsQueuedForDeletion: number;
  };
  users: RetentionUserPreview[];
  documents: RetentionDocumentPreview[];
  recentActions: RetentionActionPreview[];
  recentRuns: RetentionRunPreview[];
};

export type RetentionRunResult = RetentionOverview & {
  ok: true;
  dryRun: boolean;
  locked: boolean;
  runId: number | null;
  execution: {
    processedDocuments: number;
    processedUsers: number;
    failedDocuments: number;
    failedUsers: number;
    skippedDocuments: number;
    skippedUsers: number;
  };
};

export type ImmediateDocumentDeleteResult =
  | {
      ok: true;
      documentId: string;
      ownerId: string;
      fileName: string | null;
      sourceCleanupResult: 'deleted' | 'missing' | 'already_deleted' | 'no_source';
      vectorCleanup: 'deleted_directly' | 'deferred_to_worker';
      artifactResults: Array<{ table: string; status: 'deleted' | 'skipped' | 'failed'; message?: string }>;
    }
  | {
      ok: false;
      status: number;
      message: string;
      details?: Record<string, unknown>;
    };

type RunRetentionOptions = {
  dryRun: boolean;
  triggerSource: string;
  initiatedBy?: string | null;
  previewLimit?: number;
  force?: boolean;
  supabase?: SupabaseAdmin;
};

type TableDeleteSpec = {
  table: string;
  columns: string[];
  ownerColumns?: string[];
  treatReadOnlyAsSkipped?: boolean;
};

type TableDeleteResult = {
  table: string;
  status: 'deleted' | 'skipped' | 'failed';
  message?: string;
};

function logRetention(scope: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV !== 'production') {
    console.info(`[retention:${scope}]`, details);
  }
}

function isMissingRelationError(error: unknown): boolean {
  const code = String((error as any)?.code || '').trim().toUpperCase();
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (message.includes('relation') && message.includes('does not exist')) ||
    message.includes('could not find the table')
  );
}

function isMissingColumnError(error: unknown): boolean {
  const code = String((error as any)?.code || '').trim().toUpperCase();
  const message = String((error as any)?.message || '').toLowerCase();
  const details = String((error as any)?.details || '').toLowerCase();
  return (
    code === '42703' ||
    (message.includes('column') && message.includes('does not exist')) ||
    (details.includes('column') && details.includes('does not exist'))
  );
}

function isMissingFunctionError(error: unknown): boolean {
  const code = String((error as any)?.code || '').trim().toUpperCase();
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    code === '42883' ||
    code === 'PGRST202' ||
    (message.includes('function') && message.includes('does not exist')) ||
    message.includes('could not find the function') ||
    message.includes('could not find the public.try_claim_retention_lease') ||
    message.includes('could not find the public.release_retention_lease')
  );
}

function isReadOnlyRelationError(error: unknown): boolean {
  const code = String((error as any)?.code || '').trim().toUpperCase();
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    code === '55000' ||
    code === '25006' ||
    message.includes('cannot delete from view') ||
    message.includes('cannot update view') ||
    message.includes('not automatically updatable') ||
    message.includes('read-only')
  );
}

function claimLocalRetentionLease(workerId: string): boolean {
  const nowMs = Date.now();
  if (localRetentionLease && localRetentionLease.expiresAtMs > nowMs) {
    return localRetentionLease.workerId === workerId;
  }

  localRetentionLease = {
    workerId,
    expiresAtMs: nowMs + RETENTION_LOCAL_LEASE_TTL_MS,
  };
  return true;
}

function releaseLocalRetentionLease(workerId: string): void {
  if (localRetentionLease?.workerId === workerId) {
    localRetentionLease = null;
  }
}

function isAuthUserMissingError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('user not found') || message.includes('not found');
}

function chunk<T>(items: T[], size = 500): T[][] {
  const safeSize = Math.max(1, Math.floor(size));
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += safeSize) {
    result.push(items.slice(index, index + safeSize));
  }
  return result;
}

function resolveOwnerId(row: DocumentRow): string | null {
  const ownerId = String(row.owner_id || row.user_id || '').trim();
  return ownerId || null;
}

function toActionPreview(row: RetentionActionRow): RetentionActionPreview {
  return {
    id: row.id,
    scope: row.scope,
    targetType: row.target_type,
    targetId: row.target_id,
    ownerId: row.owner_id,
    email: row.email_snapshot,
    status: row.status,
    reason: row.reason,
    attempts: Math.max(0, Number(row.attempts || 0)),
    firstDetectedAt: row.first_detected_at,
    lastSeenAt: row.last_seen_at,
    completedAt: row.completed_at,
    lastError: row.last_error,
    metadata: row.metadata || {},
  };
}

function toRunPreview(row: RetentionRunRow): RetentionRunPreview {
  return {
    id: row.id,
    mode: row.mode,
    triggerSource: row.trigger_source,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    summary: row.summary || {},
    errorMessage: row.error_message,
  };
}

async function listAllAuthUsers(supabase: SupabaseAdmin): Promise<User[]> {
  const perPage = 200;
  const rows: User[] = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`list_users_failed: ${error.message}`);
    }
    const batch = data?.users || [];
    rows.push(...batch);
    if (batch.length < perPage || rows.length >= 5000) {
      break;
    }
    page += 1;
  }

  return rows;
}

async function fetchProfilesMap(
  supabase: SupabaseAdmin,
  userIds: string[],
): Promise<Map<string, UserProfileRow>> {
  const rows = new Map<string, UserProfileRow>();
  for (const batch of chunk(userIds)) {
    const { data, error } = await supabase
      .from('au_user_profiles')
      .select('user_id,full_name,tier,last_activity_at')
      .in('user_id', batch);

    if (error) {
      if (isMissingRelationError(error)) return rows;
      throw error;
    }

    for (const row of (data || []) as UserProfileRow[]) {
      rows.set(row.user_id, row);
    }
  }
  return rows;
}

async function fetchActivityMap(
  supabase: SupabaseAdmin,
  userIds: string[],
): Promise<Map<string, UserActivityRow>> {
  const rows = new Map<string, UserActivityRow>();
  for (const batch of chunk(userIds)) {
    const { data, error } = await supabase
      .from('au_user_activity')
      .select('user_id,last_active_at')
      .in('user_id', batch);

    if (error) {
      if (isMissingRelationError(error)) return rows;
      throw error;
    }

    for (const row of (data || []) as UserActivityRow[]) {
      rows.set(row.user_id, row);
    }
  }
  return rows;
}

async function listAllDocuments(supabase: SupabaseAdmin): Promise<DocumentRow[]> {
  const rows: DocumentRow[] = [];
  const pageSize = 1000;

  for (let start = 0; start < 50000; start += pageSize) {
    const end = start + pageSize - 1;
    const { data, error } = await supabase
      .from('au_documents')
      .select(
        'id,owner_id,user_id,file_name,file_path,status,expires_at,retention_expires_at,retention_tier,retention_days,retention_policy_version,created_at,updated_at,cleanup_attempts,cleanup_last_error,cleanup_last_attempt_at,cleanup_pending,storage_deleted_at,source_deleted_at,source_cleanup_result',
      )
      .order('created_at', { ascending: false })
      .range(start, end);

    if (error) {
      throw error;
    }

    const batch = (data || []) as DocumentRow[];
    rows.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
  }

  return rows;
}

async function fetchDocumentById(
  supabase: SupabaseAdmin,
  documentId: string,
): Promise<DocumentRow | null> {
  const { data, error } = await supabase
    .from('au_documents')
    .select(
      'id,owner_id,user_id,file_name,file_path,status,expires_at,retention_expires_at,retention_tier,retention_days,retention_policy_version,created_at,updated_at,cleanup_attempts,cleanup_last_error,cleanup_last_attempt_at,cleanup_pending,storage_deleted_at,source_deleted_at,source_cleanup_result',
    )
    .eq('id', documentId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      return null;
    }
    throw error;
  }

  return (data || null) as DocumentRow | null;
}

async function fetchRecentActions(supabase: SupabaseAdmin, limit = 100): Promise<RetentionActionRow[]> {
  const { data, error } = await supabase
    .from('au_retention_actions')
    .select(
      'id,scope,target_type,target_id,owner_id,email_snapshot,status,reason,attempts,first_detected_at,last_seen_at,completed_at,last_error,metadata',
    )
    .order('last_seen_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }

  return (data || []) as RetentionActionRow[];
}

async function fetchRecentRuns(supabase: SupabaseAdmin, limit = 20): Promise<RetentionRunRow[]> {
  const { data, error } = await supabase
    .from('au_retention_runs')
    .select('id,mode,trigger_source,status,started_at,completed_at,summary,error_message')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }

  return (data || []) as RetentionRunRow[];
}

async function fetchOwnerActionMap(
  supabase: SupabaseAdmin,
  ownerIds: string[],
): Promise<Map<string, RetentionActionRow>> {
  const map = new Map<string, RetentionActionRow>();
  if (ownerIds.length === 0) return map;

  for (const batch of chunk(ownerIds)) {
    const { data, error } = await supabase
      .from('au_retention_actions')
      .select(
        'id,scope,target_type,target_id,owner_id,email_snapshot,status,reason,attempts,first_detected_at,last_seen_at,completed_at,last_error,metadata',
      )
      .in('owner_id', batch)
      .order('last_seen_at', { ascending: false })
      .limit(5000);

    if (error) {
      if (isMissingRelationError(error)) return map;
      throw error;
    }

    for (const row of (data || []) as RetentionActionRow[]) {
      if (!row.owner_id || map.has(row.owner_id)) continue;
      map.set(row.owner_id, row);
    }
  }
  return map;
}

async function fetchActionMapByTarget(
  supabase: SupabaseAdmin,
  targetType: RetentionTargetType,
  targetIds: string[],
): Promise<Map<string, RetentionActionRow>> {
  const map = new Map<string, RetentionActionRow>();
  if (targetIds.length === 0) return map;

  for (const batch of chunk(targetIds)) {
    const { data, error } = await supabase
      .from('au_retention_actions')
      .select(
        'id,scope,target_type,target_id,owner_id,email_snapshot,status,reason,attempts,first_detected_at,last_seen_at,completed_at,last_error,metadata',
      )
      .eq('target_type', targetType)
      .in('target_id', batch)
      .order('last_seen_at', { ascending: false })
      .limit(5000);

    if (error) {
      if (isMissingRelationError(error)) return map;
      throw error;
    }

    for (const row of (data || []) as RetentionActionRow[]) {
      if (map.has(row.target_id)) continue;
      map.set(row.target_id, row);
    }
  }

  return map;
}

async function countRetentionActions(
  supabase: SupabaseAdmin,
  filters: {
    targetType?: RetentionTargetType;
    scope?: RetentionScope;
    status?: RetentionActionStatus;
  },
): Promise<number> {
  let query = supabase.from('au_retention_actions').select('id', { count: 'exact', head: true });
  if (filters.targetType) query = query.eq('target_type', filters.targetType);
  if (filters.scope) query = query.eq('scope', filters.scope);
  if (filters.status) query = query.eq('status', filters.status);
  const { count, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) return 0;
    throw error;
  }
  return Number(count || 0);
}

async function createRunRecord(
  supabase: SupabaseAdmin,
  input: { mode: 'preview' | 'execute'; triggerSource: string; initiatedBy?: string | null },
): Promise<number | null> {
  const { data, error } = await supabase
    .from('au_retention_runs')
    .insert({
      mode: input.mode,
      trigger_source: input.triggerSource,
      initiated_by: input.initiatedBy || null,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }

  return Number((data as any)?.id || 0) || null;
}

async function finishRunRecord(
  supabase: SupabaseAdmin,
  runId: number | null,
  input: { status: string; summary?: Record<string, unknown>; errorMessage?: string | null },
) {
  if (!runId) return;
  await supabase
    .from('au_retention_runs')
    .update({
      status: input.status,
      completed_at: new Date().toISOString(),
      summary: input.summary || {},
      error_message: input.errorMessage || null,
    })
    .eq('id', runId);
}

async function claimLease(supabase: SupabaseAdmin, workerId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('try_claim_retention_lease', {
    p_lease_key: 'retention_cleanup',
    p_worker_id: workerId,
    p_ttl_seconds: 900,
  });
  if (error) {
    if (isMissingFunctionError(error)) {
      logRetention('lease-fallback', { reason: 'db_lease_rpc_missing' });
      return claimLocalRetentionLease(workerId);
    }
    throw error;
  }
  if (typeof data === 'boolean') {
    return data;
  }
  return Boolean((data as any)?.claimed);
}

async function releaseLease(supabase: SupabaseAdmin, workerId: string): Promise<void> {
  const { error } = await supabase.rpc('release_retention_lease', {
    p_lease_key: 'retention_cleanup',
    p_worker_id: workerId,
  });
  if (error && isMissingFunctionError(error)) {
    releaseLocalRetentionLease(workerId);
    return;
  }
  if (error && !isMissingRelationError(error)) {
    throw error;
  }
  releaseLocalRetentionLease(workerId);
}

function buildUserSnapshots(
  authUsers: User[],
  profilesMap: Map<string, UserProfileRow>,
  activityMap: Map<string, UserActivityRow>,
  documents: DocumentRow[],
  ownerActionMap: Map<string, RetentionActionRow>,
): UserSnapshot[] {
  const documentsByOwner = new Map<string, DocumentRow[]>();
  for (const row of documents) {
    const ownerId = resolveOwnerId(row);
    if (!ownerId) continue;
    const bucket = documentsByOwner.get(ownerId) || [];
    bucket.push(row);
    documentsByOwner.set(ownerId, bucket);
  }

  return authUsers.map((user) => {
    const profile = profilesMap.get(user.id);
    const activity = activityMap.get(user.id);
    const userDocuments = documentsByOwner.get(user.id) || [];
    const latestAction = ownerActionMap.get(user.id) || null;
    const lastSeenAt = resolveLastSeenAt([
      profile?.last_activity_at,
      activity?.last_active_at,
      user.last_sign_in_at,
      user.created_at,
    ]);
    const lifecycleState = isProtectedOwnerUserId(user.id)
      ? 'active'
      : deriveRetentionLifecycleState({
          lastSeenAt,
          documentsRemaining: userDocuments.length,
          latestActionStatus: latestAction?.status || null,
          latestActionScope: latestAction?.scope || null,
          latestActionError: latestAction?.last_error || null,
        });

    return {
      userId: user.id,
      email: user.email || null,
      fullName: profile?.full_name || null,
      tier: profile?.tier || null,
      createdAt: user.created_at || null,
      lastSignInAt: user.last_sign_in_at || null,
      lastActivityAt: profile?.last_activity_at || null,
      lastActiveAt: activity?.last_active_at || null,
      lastSeenAt,
      fileCleanupDueAt: getFileCleanupDueAt(lastSeenAt),
      fullDeletionDueAt: null,
      documents: userDocuments,
      lifecycleState,
      latestAction,
    };
  });
}

function sortUsersForPreview(users: UserSnapshot[]): UserSnapshot[] {
  const priority = new Map<RetentionLifecycleState, number>([
    ['deletion_failed', 5],
    ['scheduled_full_deletion', 4],
    ['scheduled_file_deletion', 3],
    ['files_deleted', 2],
    ['fully_deleted', 1],
    ['active', 0],
  ]);

  return users.slice().sort((left, right) => {
    const priorityDelta =
      (priority.get(right.lifecycleState) || 0) - (priority.get(left.lifecycleState) || 0);
    if (priorityDelta !== 0) return priorityDelta;
    const leftDue = new Date(left.fileCleanupDueAt || left.lastSeenAt || 0).getTime();
    const rightDue = new Date(right.fileCleanupDueAt || right.lastSeenAt || 0).getTime();
    return leftDue - rightDue;
  });
}

function buildDocumentCandidates(users: UserSnapshot[]): DocumentCandidate[] {
  const map = new Map<string, DocumentCandidate>();

  const upsertCandidate = (
    row: DocumentRow,
    ownerId: string,
    email: string | null,
    lastSeenAt: string | null,
    scope: RetentionScope,
    reason: string,
    dueAt: string | null,
  ) => {
    const current = map.get(row.id);
    if (current) {
      const currentDueMs = new Date(current.dueAt || current.expiresAt || current.lastSeenAt || current.createdAt || 0).getTime();
      const nextDueMs = new Date(dueAt || row.expires_at || lastSeenAt || row.created_at || 0).getTime();
      const currentIsEarlier = Number.isFinite(currentDueMs) && Number.isFinite(nextDueMs)
        ? currentDueMs <= nextDueMs
        : scopePriority(current.scope) >= scopePriority(scope);
      if (currentIsEarlier) {
        return;
      }
    }

    if (scope === 'inactive_account') {
      return;
    }

    map.set(row.id, {
      documentId: row.id,
      ownerId,
      email,
      fileName: row.file_name || null,
      filePath: row.file_path || null,
      expiresAt: row.expires_at || null,
      createdAt: row.created_at || null,
      lastSeenAt,
      dueAt,
      scope,
      reason,
      row,
    });
  };

  const nowMs = Date.now();
  for (const user of users) {
    if (isProtectedOwnerUserId(user.userId)) continue;
    for (const document of user.documents) {
      const eligibility = computeDocumentDeletionEligibility({
        createdAt: document.created_at,
        expiresAt: document.retention_expires_at || document.expires_at,
        lastSeenAt: user.lastSeenAt,
        plan: document.retention_tier || user.tier,
        now: new Date(nowMs),
      });
      if (eligibility.eligible && eligibility.scope) {
        upsertCandidate(
          document,
          user.userId,
          user.email,
          user.lastSeenAt,
          eligibility.scope,
          eligibility.reason || 'Document is eligible for retention cleanup.',
          eligibility.deleteAfter,
        );
      }
    }
  }

  return [...map.values()].sort((left, right) => {
    const priorityDelta = scopePriority(right.scope) - scopePriority(left.scope);
    if (priorityDelta !== 0) return priorityDelta;
    const leftTime = new Date(left.dueAt || left.expiresAt || left.lastSeenAt || left.createdAt || 0).getTime();
    const rightTime = new Date(right.dueAt || right.expiresAt || right.lastSeenAt || right.createdAt || 0).getTime();
    return leftTime - rightTime;
  });
}

async function buildOverview(
  supabase: SupabaseAdmin,
  previewLimit = DEFAULT_PREVIEW_LIMIT,
): Promise<RetentionOverview & { userSnapshots: UserSnapshot[]; documentCandidates: DocumentCandidate[] }> {
  const authUsers = await listAllAuthUsers(supabase);
  const userIds = authUsers.map((user) => user.id);
  const [profilesMap, activityMap, documents, recentActions, recentRuns, ownerActionMap] =
    await Promise.all([
      fetchProfilesMap(supabase, userIds),
      fetchActivityMap(supabase, userIds),
      listAllDocuments(supabase),
      fetchRecentActions(supabase, 100),
      fetchRecentRuns(supabase, 20),
      fetchOwnerActionMap(supabase, userIds),
    ]);

  const userSnapshots = buildUserSnapshots(authUsers, profilesMap, activityMap, documents, ownerActionMap);
  const documentCandidates = buildDocumentCandidates(userSnapshots);
  const previewUsers = sortUsersForPreview(
    userSnapshots.filter((row) => row.lifecycleState !== 'active' || Boolean(row.latestAction)),
  );

  const [fullyDeletedUsers, failedActions] = await Promise.all([
    countRetentionActions(supabase, {
      targetType: 'user',
      scope: 'inactive_account',
      status: 'deleted',
    }),
    countRetentionActions(supabase, { status: 'failed' }),
  ]);

  const summary = {
    activeUsers: userSnapshots.filter((row) => row.lifecycleState === 'active').length,
    scheduledFileDeletionUsers: userSnapshots.filter((row) => row.lifecycleState === 'scheduled_file_deletion').length,
    filesDeletedUsers: userSnapshots.filter((row) => row.lifecycleState === 'files_deleted').length,
    scheduledFullDeletionUsers: 0,
    fullyDeletedUsers,
    failedActions,
    documentsQueuedForDeletion: documentCandidates.length,
  };

  logRetention('overview', {
    authUsers: authUsers.length,
    documents: documents.length,
    previewUsers: previewUsers.length,
    queuedDocuments: documentCandidates.length,
    failedActions,
    fullyDeletedUsers,
  });

  const policySnapshot = getRetentionPolicySnapshot();
  return {
    generatedAt: new Date().toISOString(),
    policy: {
      ...policySnapshot,
      fileCleanupInactivityDays: FILE_CLEANUP_INACTIVITY_DAYS,
    },
    summary,
    users: previewUsers.slice(0, previewLimit).map((row) => ({
      userId: row.userId,
      email: row.email,
      fullName: row.fullName,
      tier: row.tier,
      lastSeenAt: row.lastSeenAt,
      fileCleanupDueAt: row.fileCleanupDueAt,
      fullDeletionDueAt: row.fullDeletionDueAt,
      documentsCount: row.documents.length,
      lifecycleState: row.lifecycleState,
      latestActionStatus: row.latestAction?.status || null,
      latestActionScope: row.latestAction?.scope || null,
      latestActionError: row.latestAction?.last_error || null,
    })),
    documents: documentCandidates.slice(0, previewLimit).map((row) => ({
      documentId: row.documentId,
      ownerId: row.ownerId,
      email: row.email,
      fileName: row.fileName,
      filePath: row.filePath,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      dueAt: row.dueAt,
      scope: row.scope,
      reason: row.reason,
    })),
    recentActions: recentActions.map(toActionPreview),
    recentRuns: recentRuns.map(toRunPreview),
    userSnapshots,
    documentCandidates,
  };
}

async function upsertAction(
  supabase: SupabaseAdmin,
  input: {
    scope: RetentionScope;
    targetType: RetentionTargetType;
    targetId: string;
    ownerId: string;
    email: string | null;
    status: RetentionActionStatus;
    reason: string;
    attempts: number;
    lastError?: string | null;
    metadata?: Record<string, unknown>;
    completedAt?: string | null;
    runId?: number | null;
    firstDetectedAt?: string | null;
  },
) {
  const nowIso = new Date().toISOString();
  const payload = {
    scope: input.scope,
    target_type: input.targetType,
    target_id: input.targetId,
    owner_id: input.ownerId,
    email_snapshot: null,
    status: input.status,
    reason: input.reason,
    attempts: input.attempts,
    first_detected_at: input.firstDetectedAt || nowIso,
    last_seen_at: nowIso,
    completed_at: input.completedAt || null,
    last_error: input.lastError || null,
    last_run_id: input.runId || null,
    metadata: input.metadata || {},
  };

  const { error } = await supabase
    .from('au_retention_actions')
    .upsert(payload, { onConflict: 'scope,target_type,target_id' });
  if (error) {
    if (isMissingRelationError(error)) {
      logRetention('action-log-skipped', { reason: 'retention_actions_table_missing' });
      return;
    }
    throw error;
  }
}

async function markDocumentCleanupState(
  supabase: SupabaseAdmin,
  row: DocumentRow,
  input: {
    success: boolean;
    sourceCleanupResult: string;
    lastError?: string | null;
  },
) {
  const attempts = Math.max(0, Number(row.cleanup_attempts || 0)) + 1;
  const payload: Record<string, unknown> = {
    cleanup_attempts: attempts,
    cleanup_last_attempt_at: new Date().toISOString(),
    cleanup_last_error: input.success ? null : input.lastError || 'cleanup_failed',
    cleanup_pending: !input.success,
    source_cleanup_result: input.sourceCleanupResult,
  };

  if (input.success) {
    payload.storage_deleted_at = new Date().toISOString();
    payload.source_deleted_at = new Date().toISOString();
  }

  const ownerId = resolveOwnerId(row);
  const ownedUpdate = ownerId
    ? supabase
        .from('au_documents')
        .update(payload)
        .eq('id', row.id)
        .or(`owner_id.eq.${ownerId},user_id.eq.${ownerId}`)
    : supabase.from('au_documents').update(payload).eq('id', row.id);
  const { error } = await ownedUpdate;
  if (error) {
    throw error;
  }
}

async function deleteStorageObject(
  supabase: SupabaseAdmin,
  row: DocumentRow,
): Promise<{ ok: boolean; result: 'deleted' | 'missing' | 'already_deleted' | 'no_source'; error?: string }> {
  if (!row.file_path) {
    return { ok: true, result: 'no_source' };
  }
  if (row.source_deleted_at || row.storage_deleted_at) {
    return { ok: true, result: 'already_deleted' };
  }

  const { error } = await supabase.storage.from(DEFAULT_BUCKET).remove([row.file_path]);
  if (!error) {
    return { ok: true, result: 'deleted' };
  }
  if (isStorageMissingError(error)) {
    return { ok: true, result: 'missing' };
  }
  return { ok: false, result: 'missing', error: String(error.message || error) };
}

async function deleteRowsForValue(
  supabase: SupabaseAdmin,
  value: string,
  specs: TableDeleteSpec[],
  ownerId?: string | null,
): Promise<TableDeleteResult[]> {
  return deleteRowsForValues(supabase, [value], specs, ownerId);
}

async function deleteRowsForValues(
  supabase: SupabaseAdmin,
  values: string[],
  specs: TableDeleteSpec[],
  ownerId?: string | null,
): Promise<TableDeleteResult[]> {
  const targets = Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
  if (targets.length === 0) return [];
  const normalizedOwnerId = String(ownerId || '').trim();

  const results: TableDeleteResult[] = [];

  for (const spec of specs) {
    let handled = false;
    let lastError: unknown = null;
    const ownerColumns = spec.ownerColumns || [];
    if (ownerColumns.length > 0 && !normalizedOwnerId) {
      results.push({
        table: spec.table,
        status: 'skipped',
        message: 'owner_filter_required',
      });
      continue;
    }

    for (const column of spec.columns) {
      const ownerColumnCandidates = ownerColumns.length > 0 ? ownerColumns : [null];

      for (const ownerColumn of ownerColumnCandidates) {
        let error: unknown = null;
        for (const batch of chunk(targets)) {
          let query = supabase.from(spec.table).delete().in(column, batch);
          if (ownerColumn) {
            query = query.eq(ownerColumn, normalizedOwnerId);
          }
          const response = await query;
          if (response.error) {
            error = response.error;
            break;
          }
        }

        if (!error) {
          results.push({ table: spec.table, status: 'deleted' });
          handled = true;
          break;
        }
        if (isMissingRelationError(error) || isMissingColumnError(error)) {
          lastError = error;
          continue;
        }
        if (spec.treatReadOnlyAsSkipped && isReadOnlyRelationError(error)) {
          results.push({
            table: spec.table,
            status: 'skipped',
            message: String((error as any)?.message || error),
          });
          handled = true;
          break;
        }
        lastError = error;
        results.push({
          table: spec.table,
          status: 'failed',
          message: String((error as any)?.message || error),
        });
        handled = true;
        break;
      }

      if (handled) break;
    }

    if (!handled) {
      results.push({
        table: spec.table,
        status: 'skipped',
        message: lastError ? String((lastError as any)?.message || lastError) : 'no_matching_column',
      });
    }
  }

  return results;
}

async function countRowsForValues(
  supabase: SupabaseAdmin,
  values: string[],
  specs: TableDeleteSpec[],
  ownerId?: string | null,
): Promise<Array<{ table: string; count: number }>> {
  const targets = Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
  if (targets.length === 0) return [];
  const normalizedOwnerId = String(ownerId || '').trim();

  const counts: Array<{ table: string; count: number }> = [];
  for (const spec of specs) {
    let counted = false;
    let total = 0;
    const ownerColumns = spec.ownerColumns || [];
    if (ownerColumns.length > 0 && !normalizedOwnerId) {
      continue;
    }

    for (const column of spec.columns) {
      const ownerColumnCandidates = ownerColumns.length > 0 ? ownerColumns : [null];

      for (const ownerColumn of ownerColumnCandidates) {
        let columnCount = 0;
        let failed = false;
        for (const batch of chunk(targets)) {
          let query = supabase
            .from(spec.table)
            .select(column, { count: 'exact', head: true })
            .in(column, batch);
          if (ownerColumn) {
            query = query.eq(ownerColumn, normalizedOwnerId);
          }
          const { count, error } = await query;

          if (error) {
            if (isMissingRelationError(error) || isMissingColumnError(error)) {
              failed = true;
              break;
            }
            throw error;
          }

          columnCount += Number(count || 0);
        }

        if (!failed) {
          total = columnCount;
          counted = true;
          break;
        }

        if (failed) continue;
      }

      if (counted) break;
    }

    if (counted) {
      counts.push({ table: spec.table, count: total });
    }
  }

  return counts;
}

async function listDocumentVersionIds(supabase: SupabaseAdmin, documentId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('au_document_versions')
    .select('id')
    .eq('document_id', documentId)
    .limit(500);

  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) {
      return [];
    }
    throw error;
  }

  return Array.from(
    new Set(
      (data || [])
        .map((row: any) => String(row?.id || '').trim())
        .filter(Boolean),
    ),
  );
}

async function cleanupDocumentArtifacts(
  supabase: SupabaseAdmin,
  documentId: string,
  ownerId: string,
): Promise<{ results: TableDeleteResult[]; verification: Array<{ table: string; count: number }> }> {
  const versionIds = await listDocumentVersionIds(supabase, documentId);
  const results: TableDeleteResult[] = [];

  if (versionIds.length > 0) {
    results.push(
      ...(await deleteRowsForValues(supabase, versionIds, [
        { table: 'au_feature_outputs', columns: ['doc_version_id'], ownerColumns: ['user_id', 'owner_id'] },
        { table: 'au_practice_attempts', columns: ['doc_version_id'], ownerColumns: ['user_id', 'owner_id'] },
      ], ownerId)),
    );
  }

  results.push(
    ...(await deleteRowsForValue(supabase, documentId, [
      { table: 'memory_summaries', columns: ['doc_id'], ownerColumns: ['user_id', 'owner_id'] },
      { table: 'au_document_embeddings', columns: ['document_id'], ownerColumns: ['owner_id', 'user_id'] },
      { table: 'au_document_chunks', columns: ['document_id'], ownerColumns: ['owner_id', 'user_id'] },
      { table: 'au_worker_jobs', columns: ['document_id'], ownerColumns: ['owner_id', 'user_id'] },
      { table: 'au_upload_jobs', columns: ['document_id'], ownerColumns: ['owner_id', 'user_id'], treatReadOnlyAsSkipped: true },
      { table: 'au_upload_audit_log', columns: ['document_id'], ownerColumns: ['owner_id', 'user_id'] },
    ], ownerId)),
  );

  const verification = [
    ...(await countRowsForValues(supabase, [documentId], [
      { table: 'memory_summaries', columns: ['doc_id'], ownerColumns: ['user_id', 'owner_id'] },
      { table: 'au_document_embeddings', columns: ['document_id'], ownerColumns: ['owner_id', 'user_id'] },
      { table: 'au_document_chunks', columns: ['document_id'], ownerColumns: ['owner_id', 'user_id'] },
      { table: 'au_worker_jobs', columns: ['document_id'], ownerColumns: ['owner_id', 'user_id'] },
      { table: 'au_upload_audit_log', columns: ['document_id'], ownerColumns: ['owner_id', 'user_id'] },
    ], ownerId)),
    ...(versionIds.length > 0
      ? await countRowsForValues(supabase, versionIds, [
          { table: 'au_feature_outputs', columns: ['doc_version_id'], ownerColumns: ['user_id', 'owner_id'] },
          { table: 'au_practice_attempts', columns: ['doc_version_id'], ownerColumns: ['user_id', 'owner_id'] },
        ], ownerId)
      : []),
  ].filter((row) => row.count > 0);

  return { results, verification };
}

async function scrubRetentionActionPii(supabase: SupabaseAdmin, userId: string): Promise<void> {
  const updates = [
    supabase.from('au_retention_actions').update({ email_snapshot: null }).eq('owner_id', userId),
    supabase
      .from('au_retention_actions')
      .update({ email_snapshot: null })
      .eq('target_type', 'user')
      .eq('target_id', userId),
  ];

  for (const operation of updates) {
    const { error } = await operation;
    if (error && !isMissingRelationError(error) && !isMissingColumnError(error)) {
      throw error;
    }
  }
}

async function listStoragePathsRecursively(
  supabase: SupabaseAdmin,
  bucket: string,
  prefix: string,
  maxItems = 2000,
): Promise<string[]> {
  const queue = [prefix.replace(/^\/+|\/+$/g, '')].filter(Boolean);
  const paths: string[] = [];

  while (queue.length > 0 && paths.length < maxItems) {
    const folder = queue.shift() as string;
    const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 100 });
    if (error) {
      if (isStorageMissingError(error)) {
        continue;
      }
      throw error;
    }

    for (const entry of data || []) {
      const name = String((entry as any)?.name || '').trim();
      if (!name) continue;
      const nextPath = `${folder}/${name}`.replace(/^\/+/, '');
      const metadata = (entry as any)?.metadata;
      if (metadata && typeof metadata === 'object') {
        paths.push(nextPath);
      } else {
        queue.push(nextPath);
      }
      if (paths.length >= maxItems) {
        break;
      }
    }
  }

  return Array.from(new Set(paths));
}

async function deleteUserStorageAssets(
  supabase: SupabaseAdmin,
  userId: string,
  filePaths: string[],
): Promise<{ removed: number; missing: number }> {
  const recursivePaths = await listStoragePathsRecursively(supabase, DEFAULT_BUCKET, userId).catch(() => []);
  const targets = Array.from(new Set([...filePaths.filter(Boolean), ...recursivePaths]));
  if (targets.length === 0) {
    return { removed: 0, missing: 0 };
  }

  let removed = 0;
  let missing = 0;
  for (const batch of chunk(targets, 100)) {
    const { error } = await supabase.storage.from(DEFAULT_BUCKET).remove(batch);
    if (!error) {
      removed += batch.length;
      continue;
    }
    if (isStorageMissingError(error)) {
      missing += batch.length;
      continue;
    }
    throw error;
  }

  return { removed, missing };
}

async function markDeletionLogsProcessed(supabase: SupabaseAdmin, documentId: string) {
  const { error } = await supabase
    .from('au_deletion_log')
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq('document_id', documentId)
    .eq('processed', false);
  if (error && !isMissingRelationError(error)) {
    throw error;
  }
}

async function deleteVectorsDirect(documentId: string, ownerId: string): Promise<boolean> {
  const qdrantUrl = firstEnv('QDRANT_URL');
  if (!qdrantUrl) return false;
  const collection = firstEnv('QDRANT_COLLECTION') || 'au_chunks';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const qdrantApiKey = firstEnv('QDRANT_API_KEY');
  if (qdrantApiKey) {
    headers['api-key'] = qdrantApiKey;
  }

  const deleteForOwnerPayloadKey = async (key: 'owner_id' | 'user_id'): Promise<void> => {
    const response = await fetch(
      `${qdrantUrl.replace(/\/$/, '')}/collections/${encodeURIComponent(collection)}/points/delete?wait=true`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: {
            must: [
              { key: 'document_id', match: { value: documentId } },
              { key, match: { value: ownerId } },
            ],
          },
        }),
      },
    );

    if (response.status === 404) return;
    if (!response.ok) {
      throw new Error(`qdrant_delete_failed:${response.status}`);
    }
  };

  for (const key of ['user_id', 'owner_id'] as const) {
    await deleteForOwnerPayloadKey(key);
  }
  return true;
}

async function countRemainingDocumentsForUser(
  supabase: SupabaseAdmin,
  userId: string,
): Promise<number> {
  let query = supabase
    .from('au_documents')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId);
  let result = await query;
  if (result.error && isMissingColumnError(result.error)) {
    result = await supabase
      .from('au_documents')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
  }
  if (result.error) {
    throw result.error;
  }
  return Number(result.count || 0);
}

async function processDocumentCandidate(
  supabase: SupabaseAdmin,
  candidate: DocumentCandidate,
  existingAction: RetentionActionRow | undefined,
  runId: number | null,
  force: boolean,
): Promise<'processed' | 'failed' | 'skipped'> {
  if (!force && existingAction?.status === 'failed' && shouldSkipAutomaticRetry(existingAction.attempts)) {
    await upsertAction(supabase, {
      scope: candidate.scope,
      targetType: 'document',
      targetId: candidate.documentId,
      ownerId: candidate.ownerId,
      email: candidate.email,
      status: 'skipped',
      reason: candidate.reason,
      attempts: Math.max(0, Number(existingAction.attempts || 0)),
      lastError: existingAction.last_error || 'max_attempts_reached',
      metadata: {
        skipped_reason: 'max_attempts_reached',
        scope: candidate.scope,
      },
      runId,
      firstDetectedAt: existingAction?.first_detected_at || null,
    });
    return 'skipped';
  }

  const attempts = Math.max(0, Number(existingAction?.attempts || 0)) + 1;
  await upsertAction(supabase, {
    scope: candidate.scope,
    targetType: 'document',
    targetId: candidate.documentId,
    ownerId: candidate.ownerId,
    email: candidate.email,
    status: 'in_progress',
    reason: candidate.reason,
    attempts,
    metadata: {
      scope: candidate.scope,
      expires_at: candidate.expiresAt,
      due_at: candidate.dueAt,
      has_source_file: Boolean(candidate.filePath),
    },
    runId,
    firstDetectedAt: existingAction?.first_detected_at || null,
  });

  const storageResult = await deleteStorageObject(supabase, candidate.row);
  if (!storageResult.ok) {
    await markDocumentCleanupState(supabase, candidate.row, {
      success: false,
      sourceCleanupResult: 'failed',
      lastError: storageResult.error,
    });
    await upsertAction(supabase, {
      scope: candidate.scope,
      targetType: 'document',
      targetId: candidate.documentId,
      ownerId: candidate.ownerId,
      email: candidate.email,
      status: 'failed',
      reason: candidate.reason,
      attempts,
      lastError: storageResult.error || 'storage_delete_failed',
      metadata: {
        scope: candidate.scope,
        due_at: candidate.dueAt,
        has_source_file: Boolean(candidate.filePath),
      },
      runId,
      firstDetectedAt: existingAction?.first_detected_at || null,
    });
    return 'failed';
  }

  await markDocumentCleanupState(supabase, candidate.row, {
    success: true,
    sourceCleanupResult: storageResult.result,
  });

  const artifactCleanup = await cleanupDocumentArtifacts(supabase, candidate.documentId, candidate.ownerId);
  const failedArtifacts = artifactCleanup.results.filter((row) => row.status === 'failed');
  if (failedArtifacts.length > 0 || artifactCleanup.verification.length > 0) {
    const artifactError = [
      ...failedArtifacts.map((row) => `${row.table}: ${row.message || row.status}`),
      ...artifactCleanup.verification.map((row) => `${row.table}: ${row.count} remaining`),
    ].join('; ');
    await markDocumentCleanupState(supabase, candidate.row, {
      success: false,
      sourceCleanupResult: storageResult.result,
      lastError: artifactError || 'artifact_cleanup_failed',
    });
    await upsertAction(supabase, {
      scope: candidate.scope,
      targetType: 'document',
      targetId: candidate.documentId,
      ownerId: candidate.ownerId,
      email: candidate.email,
      status: 'failed',
      reason: candidate.reason,
      attempts,
      lastError: artifactError || 'artifact_cleanup_failed',
      metadata: {
        scope: candidate.scope,
        due_at: candidate.dueAt,
        artifact_results: artifactCleanup.results,
        artifact_verification: artifactCleanup.verification,
      },
      runId,
      firstDetectedAt: existingAction?.first_detected_at || null,
    });
    return 'failed';
  }

  let vectorCleanup: 'deleted_directly' | 'deferred_to_worker' = 'deferred_to_worker';
  try {
    const deleted = await deleteVectorsDirect(candidate.documentId, candidate.ownerId);
    if (deleted) {
      vectorCleanup = 'deleted_directly';
    }
  } catch (error) {
    const message = String((error as any)?.message || error || 'vector_delete_failed');
    await markDocumentCleanupState(supabase, candidate.row, {
      success: false,
      sourceCleanupResult: storageResult.result,
      lastError: message,
    });
    await upsertAction(supabase, {
      scope: candidate.scope,
      targetType: 'document',
      targetId: candidate.documentId,
      ownerId: candidate.ownerId,
      email: candidate.email,
      status: 'failed',
      reason: candidate.reason,
      attempts,
      lastError: message,
      metadata: {
        scope: candidate.scope,
        due_at: candidate.dueAt,
        artifact_results: artifactCleanup.results,
        vector_cleanup: 'failed',
      },
      runId,
      firstDetectedAt: existingAction?.first_detected_at || null,
    });
    return 'failed';
  }

  const { error: deleteError } = await supabase
    .from('au_documents')
    .delete()
    .eq('id', candidate.documentId)
    .or(`owner_id.eq.${candidate.ownerId},user_id.eq.${candidate.ownerId}`);
  if (deleteError) {
    await markDocumentCleanupState(supabase, candidate.row, {
      success: false,
      sourceCleanupResult: storageResult.result,
      lastError: deleteError.message,
    });
    await upsertAction(supabase, {
      scope: candidate.scope,
      targetType: 'document',
      targetId: candidate.documentId,
      ownerId: candidate.ownerId,
      email: candidate.email,
      status: 'failed',
      reason: candidate.reason,
      attempts,
      lastError: deleteError.message,
      metadata: {
        scope: candidate.scope,
        due_at: candidate.dueAt,
      },
      runId,
      firstDetectedAt: existingAction?.first_detected_at || null,
    });
    return 'failed';
  }

  if (vectorCleanup === 'deleted_directly') {
    await markDeletionLogsProcessed(supabase, candidate.documentId);
  }

  await upsertAction(supabase, {
    scope: candidate.scope,
    targetType: 'document',
    targetId: candidate.documentId,
    ownerId: candidate.ownerId,
    email: candidate.email,
    status: 'deleted',
    reason: candidate.reason,
    attempts,
    completedAt: new Date().toISOString(),
    metadata: {
      scope: candidate.scope,
      due_at: candidate.dueAt,
      has_source_file: Boolean(candidate.filePath),
      source_cleanup_result: storageResult.result,
      artifact_results: artifactCleanup.results,
      vector_cleanup: vectorCleanup,
    },
    runId,
    firstDetectedAt: existingAction?.first_detected_at || null,
  });

  return 'processed';
}

async function processUserDeletion(
  supabase: SupabaseAdmin,
  user: UserSnapshot,
  documentCandidates: DocumentCandidate[],
  existingAction: RetentionActionRow | undefined,
  runId: number | null,
  force: boolean,
  reason = 'Owner has been inactive long enough for full account deletion.',
): Promise<'processed' | 'failed' | 'skipped'> {
  if (!force && existingAction?.status === 'failed' && shouldSkipAutomaticRetry(existingAction.attempts)) {
    await upsertAction(supabase, {
      scope: 'inactive_account',
      targetType: 'user',
      targetId: user.userId,
      ownerId: user.userId,
      email: user.email,
      status: 'skipped',
      reason,
      attempts: Math.max(0, Number(existingAction.attempts || 0)),
      lastError: existingAction.last_error || 'max_attempts_reached',
      metadata: { skipped_reason: 'max_attempts_reached' },
      runId,
      firstDetectedAt: existingAction?.first_detected_at || null,
    });
    return 'skipped';
  }

  const attempts = Math.max(0, Number(existingAction?.attempts || 0)) + 1;
  await upsertAction(supabase, {
    scope: 'inactive_account',
    targetType: 'user',
    targetId: user.userId,
    ownerId: user.userId,
    email: user.email,
    status: 'in_progress',
    reason,
    attempts,
    metadata: {
      documents_count: user.documents.length,
      last_seen_at: user.lastSeenAt,
      full_deletion_due_at: user.fullDeletionDueAt,
    },
    runId,
    firstDetectedAt: existingAction?.first_detected_at || null,
  });

  const remainingDocuments = await countRemainingDocumentsForUser(supabase, user.userId);
  if (remainingDocuments > 0) {
    await upsertAction(supabase, {
      scope: 'inactive_account',
      targetType: 'user',
      targetId: user.userId,
      ownerId: user.userId,
      email: user.email,
      status: 'failed',
      reason,
      attempts,
      lastError: `documents_remaining:${remainingDocuments}`,
      metadata: {
        documents_remaining: remainingDocuments,
      },
      runId,
      firstDetectedAt: existingAction?.first_detected_at || null,
    });
    return 'failed';
  }

  const storagePaths = Array.from(
    new Set(
      documentCandidates
        .filter((row) => row.ownerId === user.userId)
        .map((row) => row.filePath)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const userCleanupSpecs: TableDeleteSpec[] = [
    { table: 'au_upload_jobs', columns: ['owner_id', 'user_id'], treatReadOnlyAsSkipped: true },
    { table: 'au_worker_jobs', columns: ['owner_id', 'user_id'] },
    { table: 'au_upload_audit_log', columns: ['owner_id'] },
    { table: 'au_feature_outputs', columns: ['user_id'] },
    { table: 'au_practice_attempts', columns: ['user_id'] },
    { table: 'au_answer_cache', columns: ['user_id'] },
    { table: 'au_messages', columns: ['user_id'] },
    { table: 'au_direct_messages', columns: ['user_id'] },
    { table: 'au_sessions', columns: ['user_id'] },
    { table: 'au_user_feedback', columns: ['user_id'] },
    { table: 'au_feedback', columns: ['user_id'] },
    { table: 'au_events', columns: ['user_id'] },
    { table: 'au_user_activity', columns: ['user_id'] },
    { table: 'au_user_preferences', columns: ['user_id'] },
    { table: 'au_idempotency', columns: ['user_id'] },
    { table: 'au_request_idempotency', columns: ['user_id'] },
    { table: 'au_quota_windows', columns: ['user_id'] },
    { table: 'au_model_usage', columns: ['user_id'] },
    { table: 'ai_routing_audit', columns: ['user_id'] },
    { table: 'billing_cancellation_feedback', columns: ['user_id'] },
    { table: 'billing_webhook_events', columns: ['user_id'] },
    { table: 'au_subscriptions', columns: ['user_id', 'owner_id'] },
    { table: 'au_manual_payments', columns: ['user_id'] },
    { table: 'au_weekly_feature_usage', columns: ['owner_id'] },
    { table: 'au_usage_daily', columns: ['owner_id', 'user_id'] },
    { table: 'memory_summaries', columns: ['user_id'] },
    { table: 'admin_access_logs', columns: ['user_id'] },
    { table: 'usage_counters', columns: ['user_id'] },
    { table: 'usage_totals', columns: ['user_id'] },
    { table: 'au_user_entitlements', columns: ['user_id'] },
    { table: 'entitlement_grants', columns: ['user_id'] },
    { table: 'entitlement_audit', columns: ['user_id'] },
    { table: 'au_plan_transitions', columns: ['user_id'] },
    { table: 'billing_subscriptions', columns: ['user_id'] },
    { table: 'billing_customers', columns: ['user_id'] },
    { table: 'billing_transactions', columns: ['user_id'] },
    { table: 'au_user_profiles', columns: ['user_id'] },
    { table: 'au_users', columns: ['id'] },
  ];

  const tableResults = await deleteRowsForValue(supabase, user.userId, userCleanupSpecs);

  const failedTables = tableResults.filter((row) => row.status === 'failed');
  let storageSummary: { removed: number; missing: number } | null = null;

  try {
    storageSummary = await deleteUserStorageAssets(supabase, user.userId, storagePaths);
  } catch (error) {
    failedTables.push({
      table: 'storage',
      status: 'failed',
      message: String((error as any)?.message || error),
    });
  }

  if (failedTables.length > 0) {
    await upsertAction(supabase, {
      scope: 'inactive_account',
      targetType: 'user',
      targetId: user.userId,
      ownerId: user.userId,
      email: user.email,
      status: 'failed',
      reason,
      attempts,
      lastError: failedTables.map((row) => `${row.table}: ${row.message}`).join('; '),
      metadata: { failed_tables: failedTables },
      runId,
      firstDetectedAt: existingAction?.first_detected_at || null,
    });
    return 'failed';
  }

  try {
    await scrubRetentionActionPii(supabase, user.userId);
  } catch (error) {
    await upsertAction(supabase, {
      scope: 'inactive_account',
      targetType: 'user',
      targetId: user.userId,
      ownerId: user.userId,
      email: null,
      status: 'failed',
      reason,
      attempts,
      lastError: String((error as any)?.message || error || 'retention_action_scrub_failed'),
      metadata: { pii_scrub_failed: true },
      runId,
      firstDetectedAt: existingAction?.first_detected_at || null,
    });
    return 'failed';
  }

  const { error: authError } = await supabase.auth.admin.deleteUser(user.userId);
  if (authError && !isAuthUserMissingError(authError)) {
    await upsertAction(supabase, {
      scope: 'inactive_account',
      targetType: 'user',
      targetId: user.userId,
      ownerId: user.userId,
      email: null,
      status: 'failed',
      reason,
      attempts,
      lastError: authError.message,
      metadata: { auth_delete_failed: true },
      runId,
      firstDetectedAt: existingAction?.first_detected_at || null,
    });
    return 'failed';
  }

  await upsertAction(supabase, {
    scope: 'inactive_account',
    targetType: 'user',
    targetId: user.userId,
    ownerId: user.userId,
    email: null,
    status: 'deleted',
    reason,
    attempts,
    completedAt: new Date().toISOString(),
    metadata: {
      deleted_email: Boolean(user.email),
      email_scrubbed: true,
      documents_deleted: user.documents.length,
      storage_summary: storageSummary,
      table_results: tableResults,
    },
    runId,
    firstDetectedAt: existingAction?.first_detected_at || null,
  });
  return 'processed';
}

export async function deleteOwnedDocumentNow(input: {
  userId: string;
  documentId: string;
  supabase?: SupabaseAdmin;
}): Promise<ImmediateDocumentDeleteResult> {
  const userId = String(input.userId || '').trim();
  const documentId = String(input.documentId || '').trim();
  if (!userId || !documentId) {
    return {
      ok: false,
      status: 400,
      message: 'invalid_document_delete_request',
    };
  }

  const supabase = input.supabase || createSupabaseAdminClient();
  const row = await fetchDocumentById(supabase, documentId);
  const ownerId = row ? resolveOwnerId(row) : null;

  if (!row || !ownerId || ownerId !== userId) {
    return {
      ok: false,
      status: 404,
      message: 'document_not_found',
    };
  }

  const storageResult = await deleteStorageObject(supabase, row);
  if (!storageResult.ok) {
    return {
      ok: false,
      status: 500,
      message: 'storage_delete_failed',
      details: {
        documentId,
        filePath: row.file_path || null,
        error: storageResult.error || null,
      },
    };
  }

  const artifactCleanup = await cleanupDocumentArtifacts(supabase, documentId, ownerId);
  const failedArtifacts = artifactCleanup.results.filter((entry) => entry.status === 'failed');
  if (failedArtifacts.length > 0 || artifactCleanup.verification.length > 0) {
    return {
      ok: false,
      status: 500,
      message: 'artifact_cleanup_failed',
      details: {
        documentId,
        failedArtifacts,
        verification: artifactCleanup.verification,
      },
    };
  }

  let vectorCleanup: 'deleted_directly' | 'deferred_to_worker' = 'deferred_to_worker';
  try {
    const deleted = await deleteVectorsDirect(documentId, ownerId);
    if (deleted) {
      vectorCleanup = 'deleted_directly';
    }
  } catch (error) {
    return {
      ok: false,
      status: 500,
      message: 'vector_delete_failed',
      details: {
        documentId,
        ownerId,
        error: String((error as any)?.message || error || ''),
      },
    };
  }

  const { error: deleteError } = await supabase
    .from('au_documents')
    .delete()
    .eq('id', documentId)
    .or(`owner_id.eq.${ownerId},user_id.eq.${ownerId}`);
  if (deleteError) {
    const code = String((deleteError as any)?.code || '').trim();
    return {
      ok: false,
      status: code === '23503' ? 409 : 500,
      message: code === '23503' ? 'document_has_dependents' : 'document_delete_failed',
      details: {
        documentId,
        code: code || null,
        error: deleteError.message,
      },
    };
  }

  if (vectorCleanup === 'deleted_directly') {
    await markDeletionLogsProcessed(supabase, documentId);
  }

  try {
    await supabase.from('au_events').insert({
      event_type: 'document_deleted',
      entity_id: documentId,
      user_id: userId,
      metadata: {
        file_name: row.file_name || null,
        file_path: row.file_path || null,
        source_cleanup_result: storageResult.result,
        vector_cleanup: vectorCleanup,
      },
    });
  } catch {
    // Event logging is best-effort and should not block deletion success.
  }

  return {
    ok: true,
    documentId,
    ownerId,
    fileName: row.file_name || null,
    sourceCleanupResult: storageResult.result,
    vectorCleanup,
    artifactResults: artifactCleanup.results,
  };
}

export async function getRetentionOverview(
  previewLimit = DEFAULT_PREVIEW_LIMIT,
  supabase = createSupabaseAdminClient(),
): Promise<RetentionOverview> {
  const overview = await buildOverview(supabase, previewLimit);
  return {
    generatedAt: overview.generatedAt,
    policy: overview.policy,
    summary: overview.summary,
    users: overview.users,
    documents: overview.documents,
    recentActions: overview.recentActions,
    recentRuns: overview.recentRuns,
  };
}

export async function runRetentionCleanup(options: RunRetentionOptions): Promise<RetentionRunResult> {
  const supabase = options.supabase || createSupabaseAdminClient();
  const previewLimit = Math.max(1, Math.floor(options.previewLimit || DEFAULT_PREVIEW_LIMIT));
  const workerId = `retention-${options.triggerSource}-${crypto.randomUUID()}`;
  let runId: number | null = null;
  let leaseClaimed = false;

  if (!options.dryRun) {
    leaseClaimed = await claimLease(supabase, workerId);
    if (!leaseClaimed) {
      const overview = await buildOverview(supabase, previewLimit);
      return {
        ok: true,
        dryRun: false,
        locked: true,
        runId: null,
        execution: {
          processedDocuments: 0,
          processedUsers: 0,
          failedDocuments: 0,
          failedUsers: 0,
          skippedDocuments: 0,
          skippedUsers: 0,
        },
        generatedAt: overview.generatedAt,
        policy: overview.policy,
        summary: overview.summary,
        users: overview.users,
        documents: overview.documents,
        recentActions: overview.recentActions,
        recentRuns: overview.recentRuns,
      };
    }
  }

  try {
    runId = await createRunRecord(supabase, {
      mode: options.dryRun ? 'preview' : 'execute',
      triggerSource: options.triggerSource,
      initiatedBy: options.initiatedBy,
    });

    const overview = await buildOverview(supabase, previewLimit);
    if (options.dryRun) {
      await finishRunRecord(supabase, runId, {
        status: 'completed',
        summary: {
          documents_queued: overview.documentCandidates.length,
          users_at_risk: overview.users.length,
          dry_run: true,
        },
      });
      return {
        ok: true,
        dryRun: true,
        locked: false,
        runId,
        execution: {
          processedDocuments: 0,
          processedUsers: 0,
          failedDocuments: 0,
          failedUsers: 0,
          skippedDocuments: 0,
          skippedUsers: 0,
        },
        generatedAt: overview.generatedAt,
        policy: overview.policy,
        summary: overview.summary,
        users: overview.users,
        documents: overview.documents,
        recentActions: overview.recentActions,
        recentRuns: overview.recentRuns,
      };
    }

    const documentActionMap = await fetchActionMapByTarget(
      supabase,
      'document',
      overview.documentCandidates.map((row) => row.documentId),
    );

    let processedDocuments = 0;
    let failedDocuments = 0;
    let skippedDocuments = 0;

    for (const candidate of overview.documentCandidates) {
      const result = await processDocumentCandidate(
        supabase,
        candidate,
        documentActionMap.get(candidate.documentId),
        runId,
        Boolean(options.force),
      );
      if (result === 'processed') processedDocuments += 1;
      if (result === 'failed') failedDocuments += 1;
      if (result === 'skipped') skippedDocuments += 1;
    }

    const processedUsers = 0;
    const failedUsers = 0;
    const skippedUsers = 0;

    const refreshedOverview = await buildOverview(supabase, previewLimit);
    const runSummary = {
      processed_documents: processedDocuments,
      processed_users: processedUsers,
      failed_documents: failedDocuments,
      failed_users: failedUsers,
      skipped_documents: skippedDocuments,
      skipped_users: skippedUsers,
      queued_documents: overview.documentCandidates.length,
    };

    logRetention('execution', {
      triggerSource: options.triggerSource,
      runId,
      processedDocuments,
      processedUsers,
      failedDocuments,
      failedUsers,
      skippedDocuments,
      skippedUsers,
    });

    await finishRunRecord(supabase, runId, {
      status: failedDocuments > 0 ? 'completed_with_errors' : 'completed',
      summary: runSummary,
    });

    return {
      ok: true,
      dryRun: false,
      locked: false,
      runId,
      execution: {
        processedDocuments,
        processedUsers,
        failedDocuments,
        failedUsers,
        skippedDocuments,
        skippedUsers,
      },
      generatedAt: refreshedOverview.generatedAt,
      policy: refreshedOverview.policy,
      summary: refreshedOverview.summary,
      users: refreshedOverview.users,
      documents: refreshedOverview.documents,
      recentActions: refreshedOverview.recentActions,
      recentRuns: refreshedOverview.recentRuns,
    };
  } catch (error) {
    await finishRunRecord(supabase, runId, {
      status: 'failed',
      errorMessage: String((error as any)?.message || error),
    });
    throw error;
  } finally {
    if (leaseClaimed) {
      await releaseLease(supabase, workerId).catch((error) => {
        logRetention('lease', { message: String((error as any)?.message || error) });
      });
    }
  }
}

export async function deleteUserAccountWithRetention(
  userId: string,
  input?: { email?: string | null; initiatedBy?: string | null; supabase?: SupabaseAdmin },
): Promise<void> {
  if (isProtectedOwnerUserId(userId)) {
    throw new Error('protected_owner_account_cannot_be_deleted');
  }

  const supabase = input?.supabase || createSupabaseAdminClient();
  const overview = await buildOverview(supabase, 10);
  const existingUser = overview.userSnapshots.find((row) => row.userId === userId) || null;
  const allDocuments = existingUser
    ? existingUser.documents
    : (await listAllDocuments(supabase)).filter((row) => resolveOwnerId(row) === userId);
  const targetUser =
    existingUser ||
    ({
      userId,
      email: input?.email || null,
      fullName: null,
      tier: null,
      createdAt: null,
      lastSignInAt: null,
      lastActivityAt: null,
      lastActiveAt: null,
      lastSeenAt: null,
      fileCleanupDueAt: null,
      fullDeletionDueAt: null,
      documents: allDocuments,
      lifecycleState: 'scheduled_full_deletion',
      latestAction: null,
    } as UserSnapshot);

  const userActionMap = await fetchActionMapByTarget(supabase, 'user', [userId]);
  const runId = await createRunRecord(supabase, {
    mode: 'execute',
    triggerSource: 'admin_manual_delete',
    initiatedBy: input?.initiatedBy,
  });

  try {
    const manualReason = 'Manual admin account deletion requested.';
    const documentCandidates = targetUser.documents.map((row) => ({
      documentId: row.id,
      ownerId: userId,
      email: targetUser.email,
      fileName: row.file_name || null,
      filePath: row.file_path || null,
      expiresAt: row.expires_at || null,
      createdAt: row.created_at || null,
      lastSeenAt: targetUser.lastSeenAt,
      dueAt: new Date().toISOString(),
      scope: 'inactive_account' as const,
      reason: manualReason,
      row,
    }));
    const documentActionMap = await fetchActionMapByTarget(
      supabase,
      'document',
      documentCandidates.map((row) => row.documentId),
    );

    for (const candidate of documentCandidates) {
      const result = await processDocumentCandidate(
        supabase,
        candidate,
        documentActionMap.get(candidate.documentId),
        runId,
        true,
      );
      if (result !== 'processed') {
        throw new Error(`manual_delete_document_cleanup_failed:${candidate.documentId}`);
      }
    }

    const result = await processUserDeletion(
      supabase,
      targetUser,
      documentCandidates,
      userActionMap.get(userId),
      runId,
      true,
      manualReason,
    );
    await finishRunRecord(supabase, runId, {
      status: result === 'processed' ? 'completed' : result === 'skipped' ? 'completed_with_errors' : 'failed',
      summary: {
        processed_user: result === 'processed',
        processed_documents: documentCandidates.length,
      },
      errorMessage: result === 'failed' ? 'manual_delete_failed' : null,
    });
    if (result !== 'processed') {
      throw new Error('manual_delete_failed');
    }
  } catch (error) {
    await finishRunRecord(supabase, runId, {
      status: 'failed',
      errorMessage: String((error as any)?.message || error),
    });
    throw error;
  }
}
