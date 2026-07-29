'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { getSupabaseAccessToken } from '@/lib/supabase-client/client';

type RetentionLifecycleState =
  | 'active'
  | 'scheduled_file_deletion'
  | 'files_deleted'
  | 'scheduled_full_deletion'
  | 'fully_deleted'
  | 'deletion_failed';

type RetentionScope = 'plan_expiry' | 'inactive_files' | 'inactive_account';
type RetentionActionStatus = 'eligible' | 'in_progress' | 'deleted' | 'failed' | 'skipped';

type RetentionOverview = {
  generatedAt: string;
  policy: {
    version?: string;
    signedOutDocumentCleanupDays?: number;
    freeDocumentExpirationDays?: number;
    promoDocumentExpirationDays?: number;
    paidProDocumentExpirationDays?: number;
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
  users: Array<{
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
  }>;
  documents: Array<{
    documentId: string;
    ownerId: string;
    email: string | null;
    fileName: string | null;
    filePath: string | null;
    expiresAt: string | null;
    createdAt: string | null;
    lastSeenAt: string | null;
    scope: RetentionScope;
    reason: string;
  }>;
  recentActions: Array<{
    id: string;
    scope: RetentionScope;
    targetType: 'document' | 'user';
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
  }>;
  recentRuns: Array<{
    id: number;
    mode: 'preview' | 'execute';
    triggerSource: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    summary: Record<string, unknown>;
    errorMessage: string | null;
  }>;
};

type RetentionRunResult = RetentionOverview & {
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

async function authedFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = await getSupabaseAccessToken();
  if (!token) {
    throw new Error('Session expired. Sign in again.');
  }

  const headers = new Headers(init?.headers ?? {});
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(input, { ...init, headers, cache: 'no-store' });
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function shortId(value: string | null): string {
  const text = String(value || '').trim();
  if (!text) return '-';
  return text.length > 12 ? `${text.slice(0, 8)}...${text.slice(-4)}` : text;
}

function lifecycleBadgeVariant(state: RetentionLifecycleState): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (state === 'deletion_failed') return 'destructive';
  if (state === 'scheduled_full_deletion') return 'destructive';
  if (state === 'scheduled_file_deletion') return 'secondary';
  if (state === 'files_deleted' || state === 'fully_deleted') return 'default';
  return 'outline';
}

function lifecycleLabel(state: RetentionLifecycleState): string {
  return state.replace(/_/g, ' ');
}

function scopeLabel(scope: RetentionScope): string {
  return scope.replace(/_/g, ' ');
}

function actionVariant(status: RetentionActionStatus): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'failed') return 'destructive';
  if (status === 'deleted') return 'default';
  if (status === 'in_progress') return 'secondary';
  return 'outline';
}

export function ConexRetentionMonitor() {
  const { toast } = useToast();
  const [overview, setOverview] = useState<RetentionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningAction, setRunningAction] = useState<'preview' | 'run' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RetentionRunResult | null>(null);

  const loadOverview = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const response = await authedFetch('/api/admin/retention?limit=25');
      const payload = await parseJson<{ ok?: boolean; overview?: RetentionOverview; error?: string; details?: unknown }>(response);
      if (!response.ok || !payload.overview) {
        const message =
          payload.error ||
          (typeof payload.details === 'string' ? payload.details : '') ||
          'Failed to load retention status.';
        throw new Error(message);
      }

      setOverview(payload.overview);
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[ConexRetentionMonitor] overview', {
          users: payload.overview.users.length,
          documents: payload.overview.documents.length,
          recentActions: payload.overview.recentActions.length,
        });
      }
    } catch (fetchError: any) {
      setError(String(fetchError?.message || 'Failed to load retention status.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const runAction = useCallback(
    async (action: 'preview' | 'run') => {
      setRunningAction(action);
      setError(null);

      try {
        const response = await authedFetch('/api/admin/retention', {
          method: 'POST',
          body: JSON.stringify({
            action,
            previewLimit: 25,
          }),
        });
        const payload = await parseJson<{ ok?: boolean; result?: RetentionRunResult; error?: string; details?: unknown }>(response);
        if (!response.ok || !payload.result) {
          const message =
            payload.error ||
            (typeof payload.details === 'string' ? payload.details : '') ||
            `Retention ${action} failed.`;
          throw new Error(message);
        }

        setLastRun(payload.result);
        setOverview(payload.result);
        toast({
          title: action === 'preview' ? 'Retention preview ready' : 'Retention cleanup finished',
          description: payload.result.locked
            ? 'Another cleanup run is already active.'
            : `Documents processed: ${payload.result.execution.processedDocuments}.`,
        });
      } catch (runError: any) {
        const message = String(runError?.message || `Retention ${action} failed.`);
        setError(message);
        toast({
          title: 'Retention action failed',
          description: message,
          variant: 'destructive',
        });
      } finally {
        setRunningAction(null);
      }
    },
    [toast],
  );

  const summaryCards = useMemo(
    () =>
      overview
        ? [
            { label: 'Active', value: overview.summary.activeUsers },
            { label: 'File cleanup due', value: overview.summary.scheduledFileDeletionUsers },
            { label: 'Files deleted', value: overview.summary.filesDeletedUsers },
            { label: 'Manual account deletes', value: overview.summary.fullyDeletedUsers },
            { label: 'Failures', value: overview.summary.failedActions },
          ]
        : [],
    [overview],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">Retention Enforcement</h3>
          <p className="text-sm text-muted-foreground">
            Backend cleanup state for upload expiry and seven-day signed-out document deletion.
          </p>
          {overview ? (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">Signed out: {overview.policy.signedOutDocumentCleanupDays ?? overview.policy.fileCleanupInactivityDays}d document cleanup</Badge>
              <Badge variant="outline">Free/Promo: {overview.policy.freeDocumentExpirationDays ?? 14}d</Badge>
              <Badge variant="outline">Pro: {overview.policy.paidProDocumentExpirationDays ?? 30}d</Badge>
              <Badge variant="outline">Queued docs: {overview.summary.documentsQueuedForDeletion}</Badge>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadOverview({ silent: true })} disabled={loading || refreshing || Boolean(runningAction)}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void runAction('preview')} disabled={loading || Boolean(runningAction)}>
            {runningAction === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
            Dry Run
          </Button>
          <Button size="sm" onClick={() => void runAction('run')} disabled={loading || Boolean(runningAction)}>
            {runningAction === 'run' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Run Cleanup
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Retention fetch failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {lastRun?.locked ? (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Cleanup already running</AlertTitle>
          <AlertDescription>A lease is active, so this request returned the latest overview without starting a second delete pass.</AlertDescription>
        </Alert>
      ) : null}

      {loading && !overview ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading backend retention state...
          </CardContent>
        </Card>
      ) : null}

      {overview ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            {summaryCards.map((card) => (
              <Card key={card.label}>
                <CardContent className="p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</div>
                  <div className="mt-2 text-2xl font-semibold">{card.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>Users At Risk</CardTitle>
                <CardDescription>
                  {overview.users.length > 0
                    ? `${overview.users.length} user records currently exposed to retention actions.`
                    : 'No users are currently queued for retention actions.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {overview.users.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    No users are currently scheduled for document cleanup.
                  </div>
                ) : (
                  overview.users.map((user) => (
                    <div key={user.userId} className="rounded-lg border p-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-1">
                          <div className="font-medium">{user.fullName || user.email || shortId(user.userId)}</div>
                          <div className="text-xs text-muted-foreground">
                            {user.email || shortId(user.userId)} · docs {user.documentsCount} · last seen {formatDateTime(user.lastSeenAt)}
                          </div>
                        </div>
                        <Badge variant={lifecycleBadgeVariant(user.lifecycleState)}>{lifecycleLabel(user.lifecycleState)}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">Tier: {user.tier || 'free'}</Badge>
                        <Badge variant="outline">File delete at: {formatDateTime(user.fileCleanupDueAt)}</Badge>
                        {user.latestActionError ? <Badge variant="destructive">{user.latestActionError}</Badge> : null}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Documents Queued</CardTitle>
                <CardDescription>
                  {overview.documents.length > 0
                    ? `${overview.documents.length} document records are eligible for deletion in the current preview window.`
                    : 'No documents are currently queued for deletion.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {overview.documents.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    No files are currently due for expiry or inactivity cleanup.
                  </div>
                ) : (
                  overview.documents.map((document) => (
                    <div key={document.documentId} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="font-medium">{document.fileName || shortId(document.documentId)}</div>
                          <div className="text-xs text-muted-foreground">
                            {document.email || shortId(document.ownerId)} · expires {formatDateTime(document.expiresAt)}
                          </div>
                        </div>
                        <Badge variant="secondary">{scopeLabel(document.scope)}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">{document.reason}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Recent Actions</CardTitle>
                <CardDescription>Per-document and per-user cleanup attempts recorded by the backend runner.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {overview.recentActions.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    No retention actions have been recorded yet.
                  </div>
                ) : (
                  overview.recentActions.slice(0, 8).map((action) => (
                    <div key={action.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium">
                          {action.targetType} {shortId(action.targetId)}
                        </div>
                        <Badge variant={actionVariant(action.status)}>{action.status}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{scopeLabel(action.scope)}</Badge>
                        <Badge variant="outline">Attempts: {action.attempts}</Badge>
                        <span>Last seen {formatDateTime(action.lastSeenAt)}</span>
                      </div>
                      {action.lastError ? <div className="mt-2 text-xs text-destructive">{action.lastError}</div> : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Runs</CardTitle>
                <CardDescription>Dry-runs and execute passes performed by admins or cron.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {overview.recentRuns.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    No retention runs have been recorded yet.
                  </div>
                ) : (
                  overview.recentRuns.slice(0, 8).map((run) => (
                    <div key={run.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium">
                          #{run.id} · {run.mode} · {run.triggerSource}
                        </div>
                        <Badge variant={run.status.includes('error') || run.status === 'failed' ? 'destructive' : 'outline'}>
                          {run.status}
                        </Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Started {formatDateTime(run.startedAt)} · Completed {formatDateTime(run.completedAt)}
                      </div>
                      {run.errorMessage ? <div className="mt-2 text-xs text-destructive">{run.errorMessage}</div> : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
