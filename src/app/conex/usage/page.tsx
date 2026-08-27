'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Gauge,
  Loader2,
  Minus,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { getSupabaseAccessToken } from '@/lib/supabase-client/client';
import { cn } from '@/lib/utils';

type ManagedUser = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  tier: string | null;
  role: string;
  account_status: string;
};

type UsageRow = {
  key: string;
  label: string;
  description: string;
  unit: string;
  category: string;
  mode: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  state: string;
  adjustable: boolean;
  reset: {
    policy: string;
    window_start: string;
    window_end: string | null;
    label: string;
  };
};

type UsagePayload = {
  ok: boolean;
  userId: string;
  plan: string;
  resetAt: string | null;
  usage: UsageRow[];
};

type AdjustmentAction = 'increase' | 'decrease' | 'set' | 'reset';

async function authedFetch(input: string, init?: RequestInit) {
  const token = await getSupabaseAccessToken();
  if (!token) throw new Error('Session expired. Sign in again.');
  const headers = new Headers(init?.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (init?.body) headers.set('Content-Type', 'application/json');
  return fetch(input, { ...init, headers, cache: 'no-store' });
}

async function responseError(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return new Error(String(body?.message || body?.error || fallback));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Math.max(0, value));
}

function UsageProgress({ row }: { row: UsageRow }) {
  const percent = row.limit && row.limit > 0 ? Math.min(100, Math.round((row.used / row.limit) * 100)) : 0;
  const warning = percent >= 75;
  const danger = percent >= 90;
  const blocked = percent >= 100;

  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <span className="text-2xl font-bold tabular-nums">{formatNumber(row.used)}</span>
          <span className="text-sm text-muted-foreground">{row.limit === null ? ' used' : ` / ${formatNumber(row.limit)}`}</span>
        </div>
        {row.limit !== null ? <span className="text-sm font-medium tabular-nums">{percent}%</span> : <Badge variant="outline">Unlimited</Badge>}
      </div>
      {row.limit !== null ? (
        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full', blocked ? 'bg-destructive' : danger ? 'bg-orange-500' : warning ? 'bg-amber-500' : 'bg-primary')}
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{row.limit === null ? 'No cap' : `${formatNumber(row.remaining || 0)} remaining`}</span>
        <span>{row.reset?.label || 'No automatic reset'}</span>
      </div>
    </div>
  );
}

export default function ConexUsagePage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [editingMetric, setEditingMetric] = useState<UsageRow | null>(null);
  const [action, setAction] = useState<AdjustmentAction>('increase');
  const [amount, setAmount] = useState('1');
  const [reason, setReason] = useState('Admin usage correction');
  const [saving, setSaving] = useState(false);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [resetAllReason, setResetAllReason] = useState('Admin hard reset requested');

  const selectedUser = useMemo(
    () => users.find((user) => user.user_id === selectedUserId) || null,
    [selectedUserId, users],
  );

  const loadUsers = useCallback(async (q = '') => {
    setLoadingUsers(true);
    try {
      const params = new URLSearchParams({ q, page: '1', pageSize: '100', status: 'all', role: 'all', presence: 'all' });
      const res = await authedFetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) throw await responseError(res, 'Unable to load users.');
      const payload = await res.json();
      const next = Array.isArray(payload.users) ? payload.users as ManagedUser[] : [];
      setUsers(next);
      setSelectedUserId((current) => current && next.some((user) => user.user_id === current) ? current : (next[0]?.user_id || ''));
    } catch (error: any) {
      toast({ title: 'Users could not load', description: error?.message || 'Try again.', variant: 'destructive' });
    } finally {
      setLoadingUsers(false);
    }
  }, [toast]);

  const loadUsage = useCallback(async (userId: string) => {
    if (!userId) {
      setUsage(null);
      return;
    }
    setLoadingUsage(true);
    try {
      const res = await authedFetch(`/api/admin/limits/user-usage?userId=${encodeURIComponent(userId)}`);
      if (!res.ok) throw await responseError(res, 'Unable to load usage.');
      setUsage(await res.json());
    } catch (error: any) {
      setUsage(null);
      toast({ title: 'Usage could not load', description: error?.message || 'Try again.', variant: 'destructive' });
    } finally {
      setLoadingUsage(false);
    }
  }, [toast]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);
  useEffect(() => { void loadUsage(selectedUserId); }, [loadUsage, selectedUserId]);

  const adjustableRows = (usage?.usage || []).filter((row) => row.adjustable);
  const capacityRows = (usage?.usage || []).filter((row) => !row.adjustable);

  function openAdjustment(row: UsageRow, nextAction: AdjustmentAction) {
    setEditingMetric(row);
    setAction(nextAction);
    setAmount(nextAction === 'set' ? String(row.used) : '1');
    setReason(nextAction === 'reset' ? 'Reset this usage allowance' : 'Admin usage correction');
  }

  async function saveAdjustment() {
    if (!editingMetric || !selectedUserId) return;
    const numericAmount = Number(amount);
    if (action !== 'reset' && (!Number.isFinite(numericAmount) || numericAmount < 0)) {
      toast({ title: 'Enter a valid amount', variant: 'destructive' });
      return;
    }
    if (reason.trim().length < 3) {
      toast({ title: 'Add a short reason', description: 'Reasons make usage changes auditable.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const res = await authedFetch('/api/admin/limits/user-usage', {
        method: 'POST',
        body: JSON.stringify({
          userId: selectedUserId,
          metricKey: editingMetric.key,
          action,
          amount: action === 'reset' ? undefined : numericAmount,
          reason: reason.trim(),
          requestId: `conex-usage:${crypto.randomUUID()}`,
        }),
      });
      if (!res.ok) throw await responseError(res, 'Unable to update usage.');
      const payload = await res.json();
      setUsage((current) => current ? { ...current, plan: payload.plan || current.plan, usage: payload.usage || current.usage } : current);
      setEditingMetric(null);
      toast({ title: 'Usage updated', description: `${editingMetric.label} now reflects the admin adjustment.` });
    } catch (error: any) {
      toast({ title: 'Usage update failed', description: error?.message || 'Try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function hardResetAll() {
    if (!selectedUserId || resetAllReason.trim().length < 3) return;
    setSaving(true);
    try {
      const res = await authedFetch('/api/admin/limits/user-usage', {
        method: 'POST',
        body: JSON.stringify({
          userId: selectedUserId,
          action: 'reset_all',
          reason: resetAllReason.trim(),
          requestId: `conex-hard-reset:${crypto.randomUUID()}`,
        }),
      });
      if (!res.ok) throw await responseError(res, 'Unable to reset usage.');
      const payload = await res.json();
      setUsage((current) => current ? { ...current, plan: payload.plan || current.plan, usage: payload.usage || current.usage } : current);
      setResetAllOpen(false);
      toast({ title: 'Usage reset', description: 'All adjustable usage for the active windows was reset without deleting history.' });
    } catch (error: any) {
      toast({ title: 'Hard reset failed', description: error?.message || 'Try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
            <Link href="/conex"><ArrowLeft className="mr-2 h-4 w-4" />Conex</Link>
          </Button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">User usage</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Choose a user, correct their current usage, or reset an allowance. Plan caps stay consistent for everyone on the same plan.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/conex/plan-limits"><Gauge className="mr-2 h-4 w-4" />Edit plan caps & reset rules</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="user-search">Find a user</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="user-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void loadUsers(search.trim()); }}
                  className="pl-9"
                  placeholder="Name or email"
                />
              </div>
              <Button type="button" variant="outline" onClick={() => void loadUsers(search.trim())} disabled={loadingUsers}>
                {loadingUsers ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
              </Button>
            </div>
            <Select value={selectedUserId} onValueChange={setSelectedUserId} disabled={loadingUsers || users.length === 0}>
              <SelectTrigger aria-label="Selected user"><SelectValue placeholder="Choose a user" /></SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.user_id} value={user.user_id}>
                    {user.full_name || user.email || user.user_id} {user.email && user.full_name ? `· ${user.email}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button type="button" variant="outline" onClick={() => void loadUsage(selectedUserId)} disabled={!selectedUserId || loadingUsage}>
            {loadingUsage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh usage
          </Button>
        </CardContent>
      </Card>

      {selectedUser ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-background shadow-sm"><UserRound className="h-5 w-5" /></div>
              <div>
                <p className="font-semibold">{selectedUser.full_name || selectedUser.email || 'Selected user'}</p>
                <p className="text-sm text-muted-foreground">{selectedUser.email || selectedUser.user_id}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{(usage?.plan || selectedUser.tier || 'free').toUpperCase()}</Badge>
              <Badge variant="outline">{selectedUser.account_status}</Badge>
              <Button type="button" variant="destructive" size="sm" onClick={() => setResetAllOpen(true)} disabled={loadingUsage || adjustableRows.length === 0}>
                <RotateCcw className="mr-2 h-4 w-4" />Hard reset usage
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loadingUsage ? (
        <div className="flex min-h-56 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading usage…</div>
      ) : usage ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Adjustable usage</h2>
              <p className="text-sm text-muted-foreground">Increase, decrease, set, or reset only counters that are true usage allowances.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {adjustableRows.map((row) => (
                <Card key={row.key}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{row.label}</CardTitle>
                        <CardDescription className="mt-1 line-clamp-2">{row.description}</CardDescription>
                      </div>
                      <Badge variant="secondary">Usage</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <UsageProgress row={row} />
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Button size="sm" variant="outline" onClick={() => openAdjustment(row, 'increase')}><Plus className="mr-1 h-3.5 w-3.5" />Add</Button>
                      <Button size="sm" variant="outline" onClick={() => openAdjustment(row, 'decrease')}><Minus className="mr-1 h-3.5 w-3.5" />Remove</Button>
                      <Button size="sm" variant="outline" onClick={() => openAdjustment(row, 'set')}><PencilLine className="mr-1 h-3.5 w-3.5" />Set</Button>
                      <Button size="sm" variant="outline" onClick={() => openAdjustment(row, 'reset')}><RotateCcw className="mr-1 h-3.5 w-3.5" />Reset</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {adjustableRows.length === 0 ? <Card className="border-dashed"><CardContent className="p-6 text-sm text-muted-foreground">This plan has no manually adjustable usage counters.</CardContent></Card> : null}
            </div>
          </section>

          <aside className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Plan caps & reset rules</CardTitle>
                <CardDescription>Caps belong to the plan so users on the same plan stay predictable.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-xl border bg-muted/20 p-3 text-sm">
                  <p className="font-medium">Current plan: {(usage.plan || 'free').toUpperCase()}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Change cap amounts or daily/weekly/monthly reset rules in Plan Limits.</p>
                </div>
                <Button asChild className="w-full"><Link href="/conex/plan-limits">Edit plan rules</Link></Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Capacity limits</CardTitle>
                <CardDescription>These describe what the account can hold or run. They are not usage counters.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {capacityRows.map((row) => (
                  <div key={row.key} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">{row.label}</p>
                      <Badge variant="outline">{row.limit === null ? 'Unlimited' : formatNumber(row.limit)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{row.reset?.label || 'No reset'}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </aside>
        </div>
      ) : selectedUserId ? (
        <Card className="border-dashed"><CardContent className="p-8 text-center text-sm text-muted-foreground">Usage data could not be loaded for this user.</CardContent></Card>
      ) : null}

      <Dialog open={Boolean(editingMetric)} onOpenChange={(open) => { if (!open && !saving) setEditingMetric(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingMetric ? `${editingMetric.label} usage` : 'Adjust usage'}</DialogTitle>
            <DialogDescription>
              This changes the effective usage for the current reset window. Original usage history is preserved.
            </DialogDescription>
          </DialogHeader>
          {editingMetric ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/20 p-3 text-sm">
                Current: <span className="font-semibold">{formatNumber(editingMetric.used)}</span>
                {editingMetric.limit !== null ? <> of <span className="font-semibold">{formatNumber(editingMetric.limit)}</span></> : null}
              </div>
              <div className="space-y-2">
                <Label>Action</Label>
                <Select value={action} onValueChange={(value) => setAction(value as AdjustmentAction)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="increase">Increase usage</SelectItem>
                    <SelectItem value="decrease">Decrease usage</SelectItem>
                    <SelectItem value="set">Set exact usage</SelectItem>
                    <SelectItem value="reset">Reset to zero</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {action !== 'reset' ? (
                <div className="space-y-2">
                  <Label htmlFor="usage-amount">{action === 'set' ? 'New usage' : 'Amount'}</Label>
                  <Input id="usage-amount" type="number" min="0" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="usage-reason">Reason</Label>
                <Textarea id="usage-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this adjustment needed?" />
                <p className="text-xs text-muted-foreground">Required for the admin audit trail.</p>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditingMetric(null)} disabled={saving}>Cancel</Button>
            <Button type="button" onClick={() => void saveAdjustment()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Apply change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={resetAllOpen} onOpenChange={setResetAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hard reset this user&apos;s usage?</AlertDialogTitle>
            <AlertDialogDescription>
              All adjustable usage allowances will be reset to zero for their current windows. Documents, chats, generated content, and historical usage records are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="reset-all-reason">Reason</Label>
            <Textarea id="reset-all-reason" value={resetAllReason} onChange={(event) => setResetAllReason(event.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void hardResetAll(); }} disabled={saving || resetAllReason.trim().length < 3}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              Reset usage
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
