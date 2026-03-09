'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, RefreshCw, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { fetchAdmin } from '@/lib/api/admin-fetch';
import { formatPlanLabel, orderPlanKeys, sanitizeLimitInput } from '@/lib/conex/plan-management';
import { getSupabaseAccessToken } from '@/lib/supabase-client/client';

const FALLBACK_PLANS = ['free', 'pro', 'premium'] as const;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CAP_FIELDS = [
  'max_file_size_mb',
  'max_uploads_total',
  'max_documents_total',
  'max_chats_total',
  'max_exams_total',
  'max_tokens_total',
  'max_storage_mb',
  'max_concurrent_jobs',
] as const;
const RESET_FIELDS = [
  'tokens_reset_every_days',
  'chats_reset_every_days',
  'exams_reset_every_days',
  'uploads_reset_every_days',
  'documents_reset_every_days',
] as const;
const ALL_FIELDS = [...CAP_FIELDS, ...RESET_FIELDS, 'storage_reset_every_days'] as const;

type FieldKey = (typeof ALL_FIELDS)[number];
type Row = Record<FieldKey, number>;
type Draft = Record<FieldKey, string>;
type PlanMap<T> = Record<string, T>;

type PreviewPayload = {
  ok: boolean;
  user_found: boolean;
  planPolicy?: { label?: string };
  effectiveLimits?: Record<string, number>;
  usage?: { total?: Record<string, number>; windows?: Record<string, { label?: string; window_start?: string; window_end?: string | null }> };
  resetWindows?: Record<string, { label?: string; window_start?: string; window_end?: string | null }>;
  labels?: Record<string, string>;
};

const ALIASES: Record<FieldKey, string[]> = {
  max_file_size_mb: ['max_file_size_mb', 'max_file_mb'],
  max_uploads_total: ['max_uploads_total'],
  max_documents_total: ['max_documents_total', 'max_docs_total'],
  max_chats_total: ['max_chats_total'],
  max_exams_total: ['max_exams_total'],
  max_tokens_total: ['max_tokens_total'],
  max_storage_mb: ['max_storage_mb'],
  max_concurrent_jobs: ['max_concurrent_jobs', 'max_jobs_concurrent'],
  tokens_reset_every_days: ['tokens_reset_every_days'],
  chats_reset_every_days: ['chats_reset_every_days'],
  exams_reset_every_days: ['exams_reset_every_days'],
  uploads_reset_every_days: ['uploads_reset_every_days'],
  documents_reset_every_days: ['documents_reset_every_days'],
  storage_reset_every_days: ['storage_reset_every_days'],
};

function n(value: unknown, fallback = 0): number {
  const v = Number(value);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

function normalizeRow(primary: unknown, fallback: unknown): Row {
  const a = primary && typeof primary === 'object' ? (primary as Record<string, unknown>) : {};
  const b = fallback && typeof fallback === 'object' ? (fallback as Record<string, unknown>) : {};
  const row = {} as Row;
  for (const key of ALL_FIELDS) {
    const aliases = ALIASES[key];
    const value =
      aliases.map((alias) => a[alias]).find((entry) => entry !== null && entry !== undefined && entry !== '') ??
      aliases.map((alias) => b[alias]).find((entry) => entry !== null && entry !== undefined && entry !== '');
    row[key] = n(value, 0);
  }
  row.storage_reset_every_days = 0;
  return row;
}

function toDraft(row: Row): Draft {
  const draft = {} as Draft;
  for (const key of ALL_FIELDS) draft[key] = String(n(row[key], 0));
  draft.storage_reset_every_days = '0';
  return draft;
}

function meter(used: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.max(0, Math.min(100, (used / cap) * 100));
}

function formatWindow(start?: string, end?: string | null): string {
  if (!start || !end) return 'No reset (lifetime)';
  const s = new Date(start);
  const e = new Date(end);
  if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime())) return 'No reset (lifetime)';
  return `${s.toLocaleString()} -> ${e.toLocaleString()}`;
}

function LimitBar({ label, used, cap, resetLabel }: { label: string; used: number; cap: number; resetLabel: string }) {
  const over = cap > 0 && used >= cap;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className={over ? 'font-mono text-destructive font-semibold' : 'font-mono text-muted-foreground'}>
          {used} / {cap}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className={over ? 'h-full bg-destructive' : 'h-full bg-primary'} style={{ width: `${meter(used, cap)}%` }} />
      </div>
      <p className="text-[11px] text-muted-foreground">{resetLabel}</p>
    </div>
  );
}

export default function ConexPlanLimitsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, , isUserLoading] = useSupabaseUser();
  const [checkingAccess, setCheckingAccess] = useState(true);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [plans, setPlans] = useState<string[]>([...FALLBACK_PLANS]);
  const [selectedPlan, setSelectedPlan] = useState('free');
  const [savedRows, setSavedRows] = useState<PlanMap<Row>>({});
  const [draftRows, setDraftRows] = useState<PlanMap<Draft>>({});

  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewUserInput, setPreviewUserInput] = useState('');
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (isUserLoading) return;
      if (!user) return void router.replace('/login?redirectTo=/conex/plan-limits');
      const token = typeof window !== 'undefined' ? localStorage.getItem('conex_admin_token') : null;
      const step = typeof window !== 'undefined' ? localStorage.getItem('conex_auth_step') : null;
      if (!token || step !== '3' || !UUID_REGEX.test(token)) return void router.replace('/conex');
      const access = await getSupabaseAccessToken();
      if (!access) return void router.replace('/login?redirectTo=/conex/plan-limits');
      const res = await fetch('/conex/users?mode=access', {
        method: 'GET',
        headers: { Authorization: `Bearer ${access}` },
        cache: 'no-store',
      }).catch(() => null);
      if (cancelled) return;
      if (!res?.ok) return void router.replace(res?.status === 403 ? '/403' : '/conex');
      setCheckingAccess(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isUserLoading, router, user]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdmin('/api/admin/plan-limits', { method: 'GET' });
      const payload = ((res as any).data || (res as any)) as any;
      if (!res.ok || !payload?.ok) {
        throw new Error(String(payload?.message || payload?.error || `plan-limits failed (${res.status})`));
      }
      const limitsByPlan = payload?.limitsByPlan || {};
      const defaultsByPlan = payload?.defaultLimitsByPlan || {};
      const planKeys = orderPlanKeys([...FALLBACK_PLANS, ...Object.keys(limitsByPlan), ...Object.keys(defaultsByPlan)])
        .filter((plan) => FALLBACK_PLANS.includes(plan as (typeof FALLBACK_PLANS)[number]));

      const nextSaved: PlanMap<Row> = {};
      const nextDraft: PlanMap<Draft> = {};
      for (const plan of planKeys) {
        const row = normalizeRow(limitsByPlan[plan], defaultsByPlan[plan]);
        nextSaved[plan] = row;
        nextDraft[plan] = toDraft(row);
      }
      setPlans(planKeys.length > 0 ? planKeys : [...FALLBACK_PLANS]);
      setSelectedPlan((current) => (planKeys.includes(current) ? current : planKeys[0] || 'free'));
      setSavedRows(nextSaved);
      setDraftRows(nextDraft);
    } catch (error: any) {
      toast({ title: 'Failed to load plan limits', description: String(error?.message || error), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadPreview = useCallback(
    async (plan: string, userId: string | null) => {
      setPreviewLoading(true);
      try {
        const params = new URLSearchParams({ plan });
        if (userId) params.set('user_id', userId);
        const res = await fetchAdmin(`/api/admin/limits/preview?${params.toString()}`, { method: 'GET' });
        const payload = ((res as any).data || (res as any)) as PreviewPayload & { message?: string; error?: string };
        if (!res.ok || !payload?.ok) {
          throw new Error(String(payload?.message || payload?.error || `limits-preview failed (${res.status})`));
        }
        setPreview(payload);
      } catch (error: any) {
        toast({ title: 'Preview unavailable', description: String(error?.message || error), variant: 'destructive' });
      } finally {
        setPreviewLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!checkingAccess) void loadRows();
  }, [checkingAccess, loadRows]);

  useEffect(() => {
    if (!checkingAccess && !loading) void loadPreview(selectedPlan, previewUserId);
  }, [checkingAccess, loading, loadPreview, previewUserId, selectedPlan]);

  const selectedDraft = draftRows[selectedPlan];
  const selectedSaved = savedRows[selectedPlan];
  const limits = preview?.effectiveLimits || {};
  const usage = preview?.usage?.total || {};
  const windows = preview?.resetWindows || preview?.usage?.windows || {};
  const labels = preview?.labels || {};
  const planLabel = preview?.planPolicy?.label || formatPlanLabel(selectedPlan);
  const resetSummary = [windows.tokens?.label, windows.chats?.label].filter(Boolean).join(' | ');

  const save = useCallback(async () => {
    if (!selectedDraft) return;
    const row = {} as Row;
    for (const key of CAP_FIELDS) row[key] = n(selectedDraft[key] === '' ? 0 : selectedDraft[key], 0);
    for (const key of RESET_FIELDS) row[key] = n(selectedDraft[key] === '' ? 0 : selectedDraft[key], 0);
    row.storage_reset_every_days = 0;
    setSaving(true);
    try {
      const res = await fetchAdmin('/api/admin/plan-limits', {
        method: 'POST',
        body: JSON.stringify({ plan: selectedPlan, limits: row }),
      });
      const payload = ((res as any).data || (res as any)) as any;
      if (!res.ok || !payload?.ok) throw new Error(String(payload?.message || payload?.error || `Failed to save ${selectedPlan}`));
      const next = normalizeRow(payload?.limits, row);
      setSavedRows((prev) => ({ ...prev, [selectedPlan]: next }));
      setDraftRows((prev) => ({ ...prev, [selectedPlan]: toDraft(next) }));
      toast({ title: 'Saved', description: `${formatPlanLabel(selectedPlan)} limits updated.` });
      void loadPreview(selectedPlan, previewUserId);
    } catch (error: any) {
      toast({ title: 'Save failed', description: String(error?.message || error), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [loadPreview, previewUserId, selectedDraft, selectedPlan, toast]);

  const resetToDefaults = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetchAdmin('/api/admin/plan-limits', {
        method: 'POST',
        body: JSON.stringify({ action: 'reset_to_defaults', plan: selectedPlan }),
      });
      const payload = ((res as any).data || (res as any)) as any;
      if (!res.ok || !payload?.ok) throw new Error(String(payload?.message || payload?.error || `Failed to reset ${selectedPlan}`));
      const next = normalizeRow(payload?.limits, payload?.limits);
      setSavedRows((prev) => ({ ...prev, [selectedPlan]: next }));
      setDraftRows((prev) => ({ ...prev, [selectedPlan]: toDraft(next) }));
      toast({ title: 'Reset', description: `${formatPlanLabel(selectedPlan)} limits restored to defaults.` });
      void loadPreview(selectedPlan, previewUserId);
    } catch (error: any) {
      toast({ title: 'Reset failed', description: String(error?.message || error), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [loadPreview, previewUserId, selectedPlan, toast]);

  if (isUserLoading || checkingAccess) {
    return (
      <div className="min-h-screen p-4 md:p-8">
        <Skeleton className="mx-auto h-80 max-w-6xl" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Plan Limits</h1>
            <p className="text-sm text-muted-foreground">Caps & reset policies</p>
          </div>
          <Button variant="outline" onClick={() => router.push('/conex')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Conex
          </Button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Plan Selector</CardTitle>
                <CardDescription>Saved values from `au_plan_limits` are prefilled before editing.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Tabs value={selectedPlan} onValueChange={setSelectedPlan}>
                  <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${Math.max(plans.length, 1)}, minmax(0, 1fr))` }}>
                    {plans.map((plan) => (
                      <TabsTrigger key={plan} value={plan}>
                        {formatPlanLabel(plan)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void save()} disabled={saving || loading || !selectedDraft}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save
                  </Button>
                  <Button variant="outline" onClick={() => void resetToDefaults()} disabled={saving || loading}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reset to defaults
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => selectedSaved && setDraftRows((prev) => ({ ...prev, [selectedPlan]: toDraft(selectedSaved) }))}
                    disabled={saving || loading || !selectedSaved}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Discard changes
                  </Button>
                </div>
              </CardContent>
            </Card>

            {loading || !selectedDraft ? (
              <Card>
                <CardHeader>
                  <CardTitle>Loading saved limits...</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Caps</CardTitle>
                    <CardDescription>Whole numbers only. `0` blocks this action.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    {CAP_FIELDS.map((key) => (
                      <div key={key} className="space-y-2 rounded-md border p-3">
                        <Label>{key}</Label>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          value={selectedDraft[key]}
                          onChange={(event) =>
                            setDraftRows((prev) => ({
                              ...prev,
                              [selectedPlan]: { ...prev[selectedPlan], [key]: sanitizeLimitInput(event.target.value) },
                            }))
                          }
                        />
                        <p className="text-[11px] text-muted-foreground">Whole numbers only. `0` blocks this action.</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Reset Policies</CardTitle>
                    <CardDescription>Set quota reset windows in days.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      {RESET_FIELDS.map((key) => (
                        <div key={key} className="space-y-2 rounded-md border p-3">
                          <Label>{key}</Label>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            value={selectedDraft[key]}
                            onChange={(event) =>
                              setDraftRows((prev) => ({
                                ...prev,
                                [selectedPlan]: { ...prev[selectedPlan], [key]: sanitizeLimitInput(event.target.value) },
                              }))
                            }
                          />
                          <p className="text-[11px] text-muted-foreground">Whole numbers only. `0` blocks this action.</p>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-md border border-dashed p-3 text-sm">
                      <p className="font-medium">storage_reset_every_days is locked to `0`.</p>
                      <p className="text-xs text-muted-foreground">Storage is a cap, not a rolling quota.</p>
                    </div>
                    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      Reset windows stay on saved values. Use <span className="font-medium text-foreground">Reset To Defaults</span> to restore full plan policy.
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Policy Preview
                </CardTitle>
                <CardDescription>Mirrors the user subscription Limits & Usage card.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {previewLoading && !preview ? (
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-2/3" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Plan: <span className="font-semibold text-foreground">{String(planLabel || '').toUpperCase()}</span>
                      {resetSummary ? ` | ${resetSummary}` : ''}
                    </p>
                    <div className="space-y-3">
                      <LimitBar label="Chat Messages" used={0} cap={n(limits.max_chats_total, 0)} resetLabel={windows.chats?.label || labels.chats || 'No reset (lifetime)'} />
                      <LimitBar label="Uploads" used={0} cap={n(limits.max_uploads_total, 0)} resetLabel={windows.uploads?.label || labels.uploads || 'No reset (lifetime)'} />
                      <LimitBar label="Tokens" used={0} cap={n(limits.max_tokens_total, 0)} resetLabel={windows.tokens?.label || labels.tokens || 'No reset (lifetime)'} />
                      <LimitBar label="Storage (MB)" used={0} cap={n(limits.max_storage_mb, 0)} resetLabel={windows.storage?.label || labels.storage || 'No reset (lifetime)'} />
                    </div>
                    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      Values come from `au_plan_limits` + reset policies; changes apply immediately.
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Usage Preview</CardTitle>
                <CardDescription>Admin-only read-only used/cap preview for a user.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Preview user usage (UUID)</Label>
                  <div className="flex gap-2">
                    <Input placeholder="user_id" value={previewUserInput} onChange={(event) => setPreviewUserInput(event.target.value.trim())} />
                    <Button
                      variant="outline"
                      onClick={() => {
                        const value = previewUserInput.trim();
                        if (!value || !UUID_REGEX.test(value)) {
                          toast({ title: 'Invalid user id', description: 'Enter a valid UUID to load usage.', variant: 'destructive' });
                          return;
                        }
                        setPreviewUserId(value);
                      }}
                    >
                      Load
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setPreviewUserId(null);
                        setPreviewUserInput('');
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">If user is missing or has no usage, used values remain 0 with caps/labels visible.</p>
                </div>

                <p className="text-xs text-muted-foreground">
                  {previewUserId
                    ? preview?.user_found
                      ? `Loaded user: ${previewUserId}`
                      : `User not found for ${previewUserId}. Showing zero usage.`
                    : 'No user selected. Showing policy-only preview.'}
                </p>
                <div className="space-y-3">
                  <LimitBar label="Chat Messages" used={n(usage.used_chats ?? usage.messages_count, 0)} cap={n(limits.max_chats_total, 0)} resetLabel={windows.chats?.label || labels.chats || 'No reset (lifetime)'} />
                  <LimitBar label="Tokens" used={n(usage.used_tokens ?? usage.tokens_used, 0)} cap={n(limits.max_tokens_total, 0)} resetLabel={windows.tokens?.label || labels.tokens || 'No reset (lifetime)'} />
                  <LimitBar label="Uploads" used={n(usage.used_uploads ?? usage.uploads_count, 0)} cap={n(limits.max_uploads_total, 0)} resetLabel={windows.uploads?.label || labels.uploads || 'No reset (lifetime)'} />
                  <LimitBar label="Storage (MB)" used={n(usage.used_storage_mb ?? usage.uploaded_mb, 0)} cap={n(limits.max_storage_mb, 0)} resetLabel={windows.storage?.label || labels.storage || 'No reset (lifetime)'} />
                  <LimitBar label="Exams" used={n(usage.used_exams ?? usage.exams_count, 0)} cap={n(limits.max_exams_total, 0)} resetLabel={windows.exams?.label || labels.exams || 'No reset (lifetime)'} />
                  <LimitBar label="Concurrent Jobs" used={n(usage.running_jobs ?? usage.active_jobs, 0)} cap={n(limits.max_concurrent_jobs ?? limits.max_jobs_concurrent, 0)} resetLabel={labels.concurrent_jobs || 'No reset (current active jobs)'} />
                </div>
                <div className="space-y-2 rounded-md border p-3 text-xs">
                  <p className="font-medium">Active quota windows</p>
                  <p className="text-muted-foreground">Chats: {windows.chats?.label?.includes('No reset') ? 'No reset (lifetime)' : formatWindow(windows.chats?.window_start, windows.chats?.window_end)}</p>
                  <p className="text-muted-foreground">Tokens: {windows.tokens?.label?.includes('No reset') ? 'No reset (lifetime)' : formatWindow(windows.tokens?.window_start, windows.tokens?.window_end)}</p>
                  <p className="text-muted-foreground">Uploads: {windows.uploads?.label?.includes('No reset') ? 'No reset (lifetime)' : formatWindow(windows.uploads?.window_start, windows.uploads?.window_end)}</p>
                  <p className="text-muted-foreground">Storage: {windows.storage?.label?.includes('No reset') ? 'No reset (lifetime)' : formatWindow(windows.storage?.window_start, windows.storage?.window_end)}</p>
                  <p className="text-muted-foreground">Exams: {windows.exams?.label?.includes('No reset') ? 'No reset (lifetime)' : formatWindow(windows.exams?.window_start, windows.exams?.window_end)}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
