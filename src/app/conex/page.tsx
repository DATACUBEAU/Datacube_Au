'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Shield, Lock, LogOut, Loader2, AlertCircle, CheckCircle2, Users, Star, HeartPulse, Crown, Activity, Download, ThumbsUp, ThumbsDown, Key, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { explicitSignOut } from '@/lib/auth/explicit-signout';
import { fetchAdmin, readCachedAdminResponsePayload } from '@/lib/api/admin-fetch';
import { getSupabaseAccessToken } from '@/lib/supabase-client/client';

const ConexUserManagement = dynamic(() => import('@/components/admin/conex-user-management').then(m => m.ConexUserManagement), { loading: () => <p className="p-4 text-sm text-muted-foreground">Loading users…</p> });
const ConexRetentionMonitor = dynamic(() => import('@/components/admin/conex-retention-monitor').then(m => m.ConexRetentionMonitor), { loading: () => <p className="p-4 text-sm text-muted-foreground">Loading retention…</p> });

function readAdminPayload<T = Record<string, unknown>>(response: Response): T {
  return readCachedAdminResponsePayload<T>(response);
}

function readAdminError(response: Response, fallback: string): string {
  const payload = readAdminPayload<any>(response);
  const message =
    payload?.message ||
    payload?.error ||
    payload?.details?.message ||
    (typeof payload?.details === 'string' ? payload.details : '');

  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}

function logConexDebug(scope: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV !== 'production') {
    console.debug(`[Conex:${scope}]`, details);
  }
}

function AdminLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Data Load Failed</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{message}</span>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

type BillingOverview = { transactions: any[]; subscriptions: any[]; entitlementAudit: any[]; cancellationFeedback: any[] };
const billingSections = [
  { key: 'subscriptions', label: 'Subscriptions', fields: [['user_id','Account'],['plan_key','Plan'],['status','Status'],['ends_at','Ends'],['cancel_at_period_end','Cancel at period end']] },
  { key: 'transactions', label: 'Transactions', fields: [['reference','Reference'],['status','Status'],['amount_kobo','Amount (NGN)'],['channel','Channel'],['paid_at','Paid']] },
  { key: 'entitlementAudit', label: 'Entitlement history', fields: [['user_id','Account'],['action','Action'],['source','Source'],['created_at','Date']] },
  { key: 'cancellationFeedback', label: 'Cancellation feedback', fields: [['plan_key','Plan'],['cancellation_reason','Reason'],['created_at','Date']] },
] as const;
function AdminBilling() {
  const [data, setData] = useState<BillingOverview | null>(null);
  const [section, setSection] = useState<string>('subscriptions');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetchAdmin('/api/admin/billing/overview', { cache: 'no-store' });
      if (!res.ok) throw new Error(readAdminError(res, 'Billing unavailable.'));
      const payload = readAdminPayload<Partial<BillingOverview>>(res);
      setData({ transactions: payload.transactions || [], subscriptions: payload.subscriptions || [],
        entitlementAudit: payload.entitlementAudit || [], cancellationFeedback: payload.cancellationFeedback || [] });
    } catch (e) { setError(e instanceof Error ? e.message : 'Billing unavailable.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const active = billingSections.find(s => s.key === section) || billingSections[0];
  const rows = data?.[active.key] || [];
  return <section className="space-y-4 min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold">Billing</h2><p className="text-sm text-muted-foreground">Recent subscription and payment records. Cloud AU offers are paused.</p></div>
      <Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
    </div>
    {error && <AdminLoadError message={error} onRetry={() => void refresh()} />}
    <div className="flex flex-wrap gap-2">{billingSections.map(s => <Button key={s.key} size="sm" variant={section === s.key ? 'default' : 'outline'} onClick={() => setSection(s.key)}>{s.label}</Button>)}</div>
    {loading && !data ? <p className="text-sm text-muted-foreground">Loading billing records…</p> :
      <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm">
        <thead className="bg-muted"><tr>{active.fields.map(([key,label]) => <th key={key} className="p-3 text-left whitespace-nowrap">{label}</th>)}</tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={active.fields.length} className="p-5 text-muted-foreground">No recent records.</td></tr> :
          rows.map((row,i) => <tr key={i} className="border-t">{active.fields.map(([key]) => <td className="p-3 max-w-xs break-words" key={key}>{key === 'amount_kobo' && typeof row[key] === 'number' ? (row[key]/100).toLocaleString('en-NG', {style:'currency',currency:'NGN'}) : String(row[key] ?? '—')}</td>)}</tr>)}</tbody>
      </table></div>}
    <p className="text-xs text-muted-foreground">Read-only overview. Subscription records and audit history are preserved.</p>
  </section>;
}
function AdminHealth() {
  const [checks, setChecks] = useState<Record<string,{ok:boolean;latencyMs?:number}>>({});
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const verify = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetchAdmin('admin-handler',{method:'POST',body:JSON.stringify({action:'verify_system'}),cache:'no-store'});
      const payload = readAdminPayload<any>(res);
      if (!payload?.checks || typeof payload.checks !== 'object') throw new Error('Health check unavailable.');
      setChecks(payload.checks);
      if (!res.ok) setError('One or more checks failed.');
    } catch(e) { setError(e instanceof Error ? e.message : 'Health check unavailable.'); }
    finally { setLoading(false); }
  };
  return <section className="space-y-4"><div className="flex flex-wrap justify-between gap-3">
    <div><h2 className="text-xl font-semibold">System health</h2><p className="text-sm text-muted-foreground">Check essential account, billing and admin services on demand.</p></div>
    <Button onClick={() => void verify()} disabled={loading} variant="outline">{loading?'Checking…':'Run checks'}</Button>
  </div>{error && <AdminLoadError message={error} onRetry={() => void verify()}/>}
    {Object.entries(checks).map(([name,check]) => <div key={name} className="flex justify-between items-center gap-2 border rounded-lg p-3"><span className="text-sm break-all">{name}</span><Badge variant={check.ok?'secondary':'destructive'}>{check.ok?'Ready':'Unavailable'}</Badge></div>)}
    <ConexRetentionMonitor />
  </section>;
}

const AdminFeedback = (_props: { token?: string }) => {
  const [feedback, setFeedback] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchAdmin('/api/admin/feedback?limit=50', {
        method: 'GET',
      });
      if (!res.ok) {
        throw new Error(readAdminError(res, 'Failed to load user feedback.'));
      }

      const payload = readAdminPayload<any>(res);
      const nextFeedback = Array.isArray(payload?.feedback) ? payload.feedback : [];
      setFeedback(nextFeedback);
      logConexDebug('feedback', {
        count: nextFeedback.length,
        sourceTable: payload?.meta?.sourceTable || 'au_feedback',
      });
    } catch (e: any) {
      console.error('[AdminFeedback] fetch error:', e);
      const message = String(e?.message || 'Failed to load user feedback.');
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetchAdmin('/api/admin/feedback/export.csv', {
        method: 'GET',
        headers: {
          Accept: 'text/csv',
        },
      });
      if (!res.ok) {
        throw new Error(readAdminError(res, 'Failed to export feedback.'));
      }

      const csv = await res.text();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `au_feedback_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setLoadError(String(e?.message || 'Failed to export feedback.'));
    } finally {
      setExporting(false);
    }
  }, []);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {loadError ? <AdminLoadError message={loadError} onRetry={() => void fetchFeedback()} /> : null}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-medium">User Feedback</h3>
          <p className="text-xs text-muted-foreground">{feedback.length} record{feedback.length === 1 ? '' : 's'} loaded (up to 50 recent records).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void fetchFeedback()} disabled={loading}>
            <Activity className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handleExport()} disabled={feedback.length === 0 || exporting}>
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />} Export CSV
          </Button>
        </div>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-left">Section</th>
              <th className="p-2 text-left">Rating</th>
              <th className="p-2 text-left">Comment</th>
              <th className="p-2 text-left">User</th>
            </tr>
          </thead>
          <tbody>
            {feedback.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-muted-foreground italic">No feedback received yet.</td></tr>
            ) : (
              feedback.map((f) => (
                <tr key={f.id} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="p-2 text-xs">{new Date(f.created_at).toLocaleString()}</td>
                  <td className="p-2"><Badge variant="outline" className="text-[10px]">{f.section}</Badge></td>
                  <td className="p-2">
                    <Badge
                      className={`text-[10px] ${
                        f.rating_variant === 'positive'
                          ? 'bg-green-100 text-green-700'
                          : f.rating_variant === 'negative'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-muted text-foreground'
                      }`}
                    >
                      {f.rating_variant === 'positive' ? <ThumbsUp className="h-3 w-3 mr-1" /> : null}
                      {f.rating_variant === 'negative' ? <ThumbsDown className="h-3 w-3 mr-1" /> : null}
                      {f.rating_label}
                    </Badge>
                  </td>
                  <td className="p-2 text-xs italic">{f.comment || '-'}</td>
                  <td className="p-2 text-xs">
                    <div className="flex flex-col">
                      <span className="font-medium">{f.user_label || 'Anonymous'}</span>
                      {f.user_email ? <span className="font-mono text-[10px] text-muted-foreground">{f.user_email}</span> : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default function ConexPage() {
  const router = useRouter();
  const [user, , isUserLoading] = useSupabaseUser();
  const [isCheckingConexAccess, setIsCheckingConexAccess] = useState(true);
  const [step, setStep] = useState<0 | 2 | 3>(0);
  const [puzzle, setPuzzle] = useState({ a: 0, b: 0, val: '' });
  const [accessKey, setAccessKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("users");
  const { toast } = useToast();

  const challenge = useCallback(async (body?: Record<string, unknown>) => {
    const token = await getSupabaseAccessToken();
    if (!token) { router.replace('/'); throw new Error('Sign in required.'); }
    const res = await fetch('/api/admin/auth', {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && !body) router.replace('/');
    if (res.status === 409) {
      setStep(0);
      setPuzzle({ a: 0, b: 0, val: '' });
    }
    if (!res.ok) throw new Error(data.error || 'Security check unavailable.');
    return data;
  }, [router]);

  const start = useCallback(async () => {
    const data = await challenge();
    if (data.stage === 'unlocked') setStep(3);
    else if (data.stage === 'passcode') setStep(2);
    else if (data.stage === 'math') {
      setPuzzle({ a: data.a, b: data.b, val: '' });
      setStep(0);
    } else throw new Error('Invalid challenge.');
    setAccessKey('');
  }, [challenge]);

  useEffect(() => {
    let cancelled = false;
    if (isUserLoading) return;
    if (!user) { router.replace('/'); return; }
    setIsCheckingConexAccess(true);
    for (const key of ['conex_admin_token', 'conex_session_id', 'conex_auth_step']) {
      try { localStorage.removeItem(key); } catch {}
    }
    start().catch(() => { if (!cancelled) setError('Could not load verification. Retry.'); })
      .finally(() => { if (!cancelled) setIsCheckingConexAccess(false); });
    return () => { cancelled = true; };
  }, [isUserLoading, user?.id, router, start]);

  const handlePuzzle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !puzzle.val || !puzzle.a) return;
    setLoading(true); setError(null);
    try {
      const data = await challenge({ stage: 'math', answer: Number(puzzle.val) });
      if (data.stage !== 'passcode') throw new Error('Invalid challenge response.');
      setStep(2);
    } catch (e) { setError(e instanceof Error ? e.message : 'Security check failed.'); }
    finally { setLoading(false); }
  };
  const restartChallenge = async () => {
    setLoading(true); setError(null);
    try { await start(); } catch (e) { setError(e instanceof Error ? e.message : 'Security check failed.'); }
    finally { setLoading(false); }
  };
  const handleStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !accessKey.trim()) return;
    setLoading(true); setError(null);
    try {
      const data = await challenge({ stage: 'passcode', passcode: accessKey });
      if (data.stage !== 'unlocked') throw new Error('Security check failed.');
      setStep(3);
      toast({ title: 'Conex unlocked' });
    } catch (e) { setError(e instanceof Error ? e.message : 'Security check failed.'); }
    finally { setAccessKey(''); setLoading(false); }
  };
  const handleLogout = async () => {
    await fetch('/api/admin/auth', { method: 'DELETE' }).catch(() => {});
    setStep(0); setAccessKey('');
    await explicitSignOut(user?.id ?? null);
    router.replace('/');
  };

  const navItems = [
    { value: 'users', label: 'Users', icon: Users },
    { value: 'billing', label: 'Billing', icon: Crown },
    { value: 'feedback', label: 'Feedback', icon: Star },
    { value: 'health', label: 'System', icon: HeartPulse },
  ];

  if (isUserLoading || isCheckingConexAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent p-4">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (step === 3) {
    return <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6 min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><Shield className="h-7 w-7 text-primary"/><div><h1 className="text-2xl font-semibold">Conex</h1><p className="text-sm text-muted-foreground">DataCube AU administration</p></div></div>
          <Button variant="outline" size="sm" onClick={() => void handleLogout()}><LogOut className="mr-2 h-4 w-4"/>Sign out</Button>
        </header>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto gap-1">
            {navItems.map(item => <TabsTrigger className="gap-2 py-2" key={item.value} value={item.value}><item.icon className="h-4 w-4"/>{item.label}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="users" className="min-w-0"><ConexUserManagement/></TabsContent>
          <TabsContent value="billing" className="min-w-0"><AdminBilling/></TabsContent>
          <TabsContent value="feedback" className="min-w-0"><AdminFeedback/></TabsContent>
          <TabsContent value="health" className="min-w-0"><AdminHealth/></TabsContent>
        </Tabs>
      </div>
    </main>;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
      <div className="mb-4 flex w-full max-w-md justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => void handleLogout()}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </Button>
      </div>
      <div className="flex w-full flex-1 items-center justify-center">
        {step === 0 && (
          <div className="w-full max-w-md">
            <Card className="border-primary/20 shadow-xl">
              <CardHeader className="text-center">
                <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-2xl font-headline tracking-tighter uppercase">Security Check</CardTitle>
                <CardDescription>Step 1 of 2 · Solve the arithmetic question.</CardDescription>
              </CardHeader>
              <form onSubmit={handlePuzzle}>
                <CardContent className="space-y-4">
                  <div className="space-y-2 text-center">
                    <Label className="text-lg font-medium">{puzzle.a ? `What is ${puzzle.a} + ${puzzle.b}?` : "Challenge unavailable"}</Label>
                    {!puzzle.a && <Button type="button" variant="outline" onClick={() => start().catch(() => setError("Could not load challenge."))}>Retry</Button>}
                    <Input 
                      type="number"
                      value={puzzle.val} 
                      onChange={(e) => setPuzzle(prev => ({ ...prev, val: e.target.value }))}
                      placeholder="?"
                      className="text-center text-lg py-6 font-mono"
                      autoFocus
                    />
                  </div>
                  {error && (
                    <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-md justify-center">
                      <AlertCircle className="h-4 w-4" />
                      <span>{error}</span>
                    </div>
                  )}
                </CardContent>
                <CardFooter>
                  <Button type="submit" disabled={loading || !puzzle.val || !puzzle.a} className="w-full h-12 text-lg font-bold uppercase tracking-tighter">
                    Verify
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </div>
        )}

        {step === 2 && (
          <div className="w-full max-w-md">
            <Card className="border-primary/20 shadow-xl">
              <CardHeader className="text-center">
                <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Key className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-2xl font-headline tracking-tighter uppercase">Passcode</CardTitle>
                <CardDescription>Step 2 of 2 · Enter your admin passcode.</CardDescription>
              </CardHeader>
              <form onSubmit={handleStep2}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-lg font-medium">Admin passcode</Label>
                    <Input 
                      type="password"
                      autoComplete="off"
                      value={accessKey} 
                      onChange={(e) => setAccessKey(e.target.value)}
                      placeholder="••••••••••••••••"
                      className="text-center text-lg py-6 font-mono"
                      autoFocus
                    />
                  </div>
                  {error && (
                    <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-md">
                      <AlertCircle className="h-4 w-4" />
                      <span>{error}</span>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="flex flex-col gap-2">
                  <Button type="submit" className="w-full h-12 text-lg font-bold uppercase tracking-tighter" disabled={loading || !accessKey}>
                    {loading ? <Loader2 className="animate-spin" /> : <>Unlock Conex <Lock className="ml-2 h-5 w-5" /></>}
                  </Button>
                  <Button type="button" variant="ghost" disabled={loading} onClick={restartChallenge}>Restart security check</Button>
                </CardFooter>
              </form>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
