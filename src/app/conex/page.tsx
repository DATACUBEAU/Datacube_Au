'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Lock, ArrowRight, Loader2, AlertCircle, CheckCircle2, LayoutDashboard, Database, MessageSquare, Activity, Key, Plus, Trash2, Save, Users, Clock, Star, Mail, Download, Terminal, ThumbsUp, ThumbsDown, HeartPulse, Zap, RefreshCw, Smartphone, Globe, Send, UserMinus, Search, Menu, FolderTree, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { fetchAdmin } from '@/lib/api/admin-fetch';
import { getSupabaseAccessToken } from '@/lib/supabase-client/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AdminAnalytics } from '@/components/admin/admin-analytics';
import { ConexAccessControl } from '@/components/admin/conex-access-control';
import { ConexUserManagement } from '@/components/admin/conex-user-management';

// Admin Dashboard Components
const AdminBilling = ({ token }: { token: string }) => {
  const [config, setConfig] = useState<any>({});
  const [auConfig, setAuConfig] = useState<any>({});
  const [flags, setFlags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_conex_config' })
      });
      if (res.ok) setConfig((res as any).config || {});

      const auRes = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_au_config' })
      });
      if (auRes.ok) setAuConfig((auRes as any).config || {});

      const flagsRes = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_feature_flags' })
      });
      if (flagsRes.ok) setFlags((flagsRes as any).flags || []);

    } catch (e: any) {
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const toggleFlag = async (key: string, current: boolean) => {
    try {
        const res = await fetchAdmin('admin-handler', {
            method: 'POST',
            body: JSON.stringify({ action: 'update_feature_flag', key, is_enabled: !current })
        });
        if (res.ok) {
            toast({ title: 'Updated', description: `Flag ${key} updated.` });
            fetchConfig();
        }
    } catch (e: any) {
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleSave = async (newConfig: any) => {
    setSaving(true);
    try {
      const auSave = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'update_au_config', config: auConfig })
      });
      if (!auSave.ok) throw new Error((auSave as any).error || 'Failed to update AU config');

      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'update_conex_config', config: newConfig })
      });
      if (res.ok) {
          toast({ title: 'Saved', description: 'Billing configuration updated.' });
          setConfig(newConfig);
          fetchConfig();
      }
    } catch (e: any) {
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
        setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
        <Tabs defaultValue="config">
            <TabsList>
                <TabsTrigger value="config">Configuration</TabsTrigger>
                <TabsTrigger value="payments">Manual Payments</TabsTrigger>
            </TabsList>

            <TabsContent value="config">
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-medium">Billing Controls</h3>
                        <Button onClick={() => handleSave(config)} disabled={saving}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save Changes
                        </Button>
                    </div>

                    <div className="grid gap-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Global Limits</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between p-4 border rounded-lg bg-red-50 dark:bg-red-900/10">
                                    <div>
                                        <Label className="text-red-900 dark:text-red-200 font-bold">Free Pressure Mode</Label>
                                        <p className="text-xs text-red-700 dark:text-red-300">
                                            Strictly limit free users (2 docs, low speed, 1 active doc/week) to drive upgrades.
                                        </p>
                                    </div>
                                    <Switch checked={config.free_pressure_mode_enabled} onCheckedChange={(c) => setConfig({...config, free_pressure_mode_enabled: c})} />
                                </div>
                                <div className="flex items-center justify-between p-4 border rounded-lg bg-blue-50 dark:bg-blue-900/10">
                                    <div>
                                        <Label className="text-blue-900 dark:text-blue-200 font-bold">Paid Models Only</Label>
                                        <p className="text-xs text-blue-700 dark:text-blue-300">
                                            Disable "Auto-Switch" across free keys. Enforce use of Primary/Paid keys only.
                                        </p>
                                    </div>
                                    <Switch checked={config.paid_mode_enabled} onCheckedChange={(c) => setConfig({...config, paid_mode_enabled: c})} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label>Billing Enabled</Label>
                                    <Switch checked={!!auConfig.billing_enabled} onCheckedChange={(c) => setAuConfig({ ...auConfig, billing_enabled: c })} />
                                </div>

                                <div className="grid grid-cols-2 gap-4 pt-2">
                                  <div className="space-y-2">
                                    <Label>Free Chat Daily Limit</Label>
                                    <Input
                                      type="number"
                                      value={auConfig.free_chat_daily_limit ?? 10}
                                      onChange={(e) => setAuConfig({ ...auConfig, free_chat_daily_limit: Number(e.target.value) })}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Free Exam Daily Limit</Label>
                                    <Input
                                      type="number"
                                      value={auConfig.free_exam_daily_limit ?? 2}
                                      onChange={(e) => setAuConfig({ ...auConfig, free_exam_daily_limit: Number(e.target.value) })}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Free Upload Daily Limit</Label>
                                    <Input
                                      type="number"
                                      value={auConfig.free_upload_daily_limit ?? 3}
                                      onChange={(e) => setAuConfig({ ...auConfig, free_upload_daily_limit: Number(e.target.value) })}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Free Max Upload MB</Label>
                                    <Input
                                      type="number"
                                      value={auConfig.free_max_upload_mb ?? 10}
                                      onChange={(e) => setAuConfig({ ...auConfig, free_max_upload_mb: Number(e.target.value) })}
                                    />
                                  </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Pro Tier Features</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <Label>100MB Upload Limit</Label>
                                        <p className="text-xs text-muted-foreground">
                                            Allow Pro users to upload files up to 100MB (Default: 50MB).
                                        </p>
                                    </div>
                                    <Switch 
                                        checked={flags.find(f => f.key === 'pro_upload_100mb')?.is_enabled ?? false} 
                                        onCheckedChange={() => toggleFlag('pro_upload_100mb', flags.find(f => f.key === 'pro_upload_100mb')?.is_enabled ?? false)} 
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Feature Gating</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <Label>Global Chat</Label>
                                        <p className="text-xs text-muted-foreground">Enable the global assistant.</p>
                                    </div>
                                    <Switch checked={config.global_chat_enabled} onCheckedChange={(c) => setConfig({...config, global_chat_enabled: c})} />
                                </div>
                                <div className="space-y-4 border rounded-lg p-4 bg-muted/10">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <Label>Premium Models Enabled</Label>
                                            <p className="text-xs text-muted-foreground">Master switch to enable premium models in the system.</p>
                                        </div>
                                        <Switch checked={config.premium_models_enabled} onCheckedChange={(c) => setConfig({...config, premium_models_enabled: c})} />
                                    </div>

                                    {config.premium_models_enabled && (
                                        <div className="flex items-center justify-between pl-4 border-l-2 border-primary/20 ml-1">
                                            <div>
                                                <Label>Paid Plans Only</Label>
                                                <p className="text-xs text-muted-foreground">
                                                    <strong>ON:</strong> Only Pro/Enterprise users access paid models.<br/>
                                                    <strong>OFF:</strong> Everyone (including Free tier) accesses paid models.
                                                </p>
                                            </div>
                                            <Switch checked={config.premium_models_paid_only} onCheckedChange={(c) => setConfig({...config, premium_models_paid_only: c})} />
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Stripe Configuration</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Weekly Price ID</Label>
                                        <Input value={config.stripe_price_weekly || ''} onChange={(e) => setConfig({...config, stripe_price_weekly: e.target.value})} placeholder="price_..." />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Monthly Price ID</Label>
                                        <Input value={config.stripe_price_monthly || ''} onChange={(e) => setConfig({...config, stripe_price_monthly: e.target.value})} placeholder="price_..." />
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label>Live Mode</Label>
                                    <Switch checked={config.stripe_live_mode} onCheckedChange={(c) => setConfig({...config, stripe_live_mode: c})} />
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Bank Transfer Details</CardTitle>
                                <CardDescription>Displayed to users in the payment modal.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Bank Name</Label>
                                        <Input value={config.bank_name || ''} onChange={(e) => setConfig({...config, bank_name: e.target.value})} placeholder="e.g. Moniepoint" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Account Number</Label>
                                        <Input value={config.bank_account_number || ''} onChange={(e) => setConfig({...config, bank_account_number: e.target.value})} placeholder="0123456789" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Account Name</Label>
                                    <Input value={config.bank_account_name || ''} onChange={(e) => setConfig({...config, bank_account_name: e.target.value})} placeholder="Datacube AU..." />
                                </div>
                                <div className="space-y-2">
                                    <Label>Instructions</Label>
                                    <Textarea value={config.bank_instructions || ''} onChange={(e) => setConfig({...config, bank_instructions: e.target.value})} placeholder="Additional instructions..." />
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </TabsContent>

            <TabsContent value="payments">
                <AdminManualPayments token={token} />
            </TabsContent>
        </Tabs>
    </div>
  );
};

const AdminManualPayments = ({ token }: { token: string }) => {
    const [payments, setPayments] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const fetchPayments = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetchAdmin('admin-handler', {
                method: 'POST',
                body: JSON.stringify({ action: 'get_manual_payments' })
            });
            if (res.ok) setPayments((res as any).payments || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchPayments(); }, [fetchPayments]);

    const handleProcess = async (id: string, status: 'confirmed' | 'rejected') => {
        if (!confirm(`Are you sure you want to ${status} this payment?`)) return;
        try {
            const res = await fetchAdmin('admin-handler', {
                method: 'POST',
                body: JSON.stringify({ action: 'process_manual_payment', paymentId: id, status })
            });
            if (res.ok) {
                toast({ title: 'Success', description: `Payment ${status}.` });
                fetchPayments();
                
                // If confirmed, trigger invoice generation (Client-side trigger for now to keep it simple or handled in edge function)
                // For this implementation, we rely on the edge function to update the user tier. 
                // Invoice generation will be added as a separate step or automatic.
            }
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        }
    };

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Pending Bank Transfers</CardTitle>
                <CardDescription>Review and approve manual payments.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-muted">
                            <tr>
                                <th className="p-3 text-left">Date</th>
                                <th className="p-3 text-left">User</th>
                                <th className="p-3 text-left">Ref Code</th>
                                <th className="p-3 text-left">Amount</th>
                                <th className="p-3 text-left">Status</th>
                                <th className="p-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {payments.length === 0 ? (
                                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No payments found.</td></tr>
                            ) : (
                                payments.map((p) => (
                                    <tr key={p.id} className="border-t hover:bg-muted/30">
                                        <td className="p-3 whitespace-nowrap">{new Date(p.created_at).toLocaleDateString()}</td>
                                        <td className="p-3">
                                            <div className="flex flex-col">
                                                <span className="font-medium">{p.au_user_profiles?.[0]?.full_name || 'User'}</span>
                                                <span className="text-xs text-muted-foreground">{p.au_users?.email}</span>
                                            </div>
                                        </td>
                                        <td className="p-3 font-mono">{p.reference_code}</td>
                                        <td className="p-3 font-bold">₦{p.amount}</td>
                                        <td className="p-3">
                                            <Badge variant={p.status === 'confirmed' ? 'default' : p.status === 'rejected' ? 'destructive' : 'secondary'}>
                                                {p.status}
                                            </Badge>
                                        </td>
                                        <td className="p-3 text-right space-x-2">
                                            {p.status === 'pending' && (
                                                <>
                                                    <Button size="sm" variant="outline" className="text-green-600 hover:text-green-700 hover:bg-green-50" onClick={() => handleProcess(p.id, 'confirmed')}>
                                                        <CheckCircle2 className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleProcess(p.id, 'rejected')}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </CardContent>
        </Card>
    );
};

const AdminUsage = ({ token }: { token: string }) => {
  const [usage, setUsage] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalCalls: 0, failedCalls: 0, successfulCalls: 0 });
  const [loading, setLoading] = useState(true);
  const [totalUsers, setTotalUsers] = useState(0);
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch Usage using the centralized fetchAdmin utility
      const usageRes = await fetchAdmin('admin-handler', {
        method: 'POST',
        headers: { 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'get_usage' })
      });
      if (!usageRes.ok) {
        throw new Error((usageRes as any).error || 'Failed to load usage');
      }
      setUsage((usageRes as any).usage || []);
      if ((usageRes as any).stats) setStats((usageRes as any).stats);

      const usersRes = await fetchAdmin('admin-handler', {
        method: 'POST',
        headers: { 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'list_users', page: 1, pageSize: 1 })
      });
      if (usersRes.ok) {
        const data = (usersRes as any).data || usersRes;
        setTotalUsers(Number(data.total || 0));
      } else {
        throw new Error((usersRes as any).error || 'Failed to load users');
      }
    } catch (e) {
      console.error('[AdminUsage] fetch error:', e);
      const message =
        e instanceof Error && e.message.toLowerCase().includes('unauthorized')
          ? 'Session expired. Please sign in again, then re-open Conex.'
          : 'Failed to load usage dashboard.';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast, token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 bg-primary/10 rounded-full text-primary">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Total Users</p>
              <p className="text-2xl font-bold">{totalUsers}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-green-500/5 border-green-500/20">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 bg-green-500/10 rounded-full text-green-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Successful Calls</p>
              <p className="text-2xl font-bold">{stats.successfulCalls}</p>
              <p className="text-[10px] text-muted-foreground">{((stats.successfulCalls / (stats.totalCalls || 1)) * 100).toFixed(1)}% Success Rate</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-red-500/5 border-red-500/20">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 bg-red-500/10 rounded-full text-red-600">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Failed Calls</p>
              <p className="text-2xl font-bold">{stats.failedCalls}</p>
              <p className="text-[10px] text-muted-foreground">{stats.totalCalls} Total Attempts</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Recent Activity</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <Activity className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead className="bg-muted">
            <tr>
              <th className="p-3 text-left">Time</th>
              <th className="p-3 text-left">Model</th>
              <th className="p-3 text-left">Tokens</th>
              <th className="p-3 text-left">User ID</th>
              <th className="p-3 text-left">Feature</th>
            </tr>
          </thead>
          <tbody>
            {usage.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-muted-foreground italic">No usage records found.</td></tr>
            ) : (
              usage.map((u) => (
                <tr key={u.id} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="p-3 text-xs whitespace-nowrap">{new Date(u.created_at).toLocaleString()}</td>
                  <td className="p-3 font-mono text-xs">{u.model_id}</td>
                  <td className="p-3">{u.total_tokens || 0}</td>
                  <td className="p-3 text-xs">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-4">
                          {(u.user_id || 'Anonymous').slice(0, 8)}...
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="font-mono text-[10px]">{u.user_id || 'Anonymous'}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className="text-[10px] uppercase">{u.feature}</Badge>
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

const AdminRegistry = ({ token }: { token: string }) => {
  const [keys, setKeys] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [selectedKey, setSelectedKey] = useState<any>(null);
  const [registrySource, setRegistrySource] = useState<'free' | 'pro'>('free');
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchRegistry = useCallback(async () => {
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ 
            action: 'get_registry',
            keyAlias: selectedKey?.service // Pass the selected key alias to filter models!
        })
      });
      if (res.ok) {
        setKeys((res as any).keys || []);
        setModels((res as any).models || []);
        setRegistrySource(((res as any).registrySource === 'pro' ? 'pro' : 'free') as any);
      }
    } catch (e) {
      console.error('[AdminRegistry] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [selectedKey?.service]); // Depend on selectedKey.service

  useEffect(() => {
    if (!selectedKey) return;
    const updated = keys.find((k: any) => k.service === selectedKey.service);
    if (updated && updated !== selectedKey) setSelectedKey(updated);
  }, [keys, selectedKey]);

  useEffect(() => {
    if (selectedKey || keys.length === 0) return;
    const preferred = keys.find((k: any) => String(k?.metadata?.tier || '').toLowerCase() === 'free') || keys[0];
    setSelectedKey(preferred);
  }, [keys, selectedKey]);
  
  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]); // Will re-fetch when selectedKey.service changes

  // --- API Keys Logic ---
  const handleUpdateKey = async (keyData: any) => {
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'update_api_key', keyData })
      });
      if (res.ok) {
        toast({ title: 'Success', description: 'API Key configuration saved.' });
        fetchRegistry();
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const toggleModelForKey = async (modelId: string, currentAllowed: string[] | null) => {
      if (!selectedKey) return;
      
      let newAllowed: string[] = [];
      
      if (currentAllowed === null) {
          newAllowed = [modelId];
      } else {
          if (currentAllowed.includes(modelId)) {
              newAllowed = currentAllowed.filter(id => id !== modelId);
          } else {
              newAllowed = [...currentAllowed, modelId];
          }
      }

      // Optimistic update
      const updatedKey = { ...selectedKey, allowed_models: newAllowed };
      setSelectedKey(updatedKey);
      
      await handleUpdateKey(updatedKey);
  };

  const setAllFreeMode = async (enabled: boolean) => {
      if (!selectedKey) return;
      const updatedKey = { ...selectedKey, allowed_models: enabled ? null : [] };
      setSelectedKey(updatedKey);
      await handleUpdateKey(updatedKey);
  };

  const handleDeleteKey = async (service: string) => {
    if (!confirm(`Delete key for ${service}?`)) return;
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete_api_key', service })
      });
      if (res.ok) {
        toast({ title: 'Deleted', description: 'API Key removed.' });
        setSelectedKey(null);
        fetchRegistry();
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  // --- Models Logic ---
  const handleUpdateModel = async (model: any) => {
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'update_model', model, registry: registrySource })
      });
      if (res.ok) {
        toast({ title: 'Success', description: 'Model updated.' });
        fetchRegistry();
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleAddModel = async (model: any) => {
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'update_model', model, registry: registrySource })
      });
      if (res.ok) {
        toast({ title: 'Success', description: 'Model added successfully.' });
        fetchRegistry();
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:h-[600px] h-auto">
      {/* Sidebar: Keys List */}
      <div className="w-full lg:w-1/3 flex flex-col gap-4 lg:border-r lg:pr-4 border-b pb-4 lg:border-b-0 lg:pb-0 h-[400px] lg:h-auto">
        <div className="flex items-center justify-between">
            <h3 className="font-medium flex items-center gap-2"><Key className="h-4 w-4" /> API Keys</h3>
            <Sheet>
              <SheetTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 w-8 p-0">
                  <Plus className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Add API Key</SheetTitle>
                </SheetHeader>
                <KeyForm onSubmit={handleUpdateKey} />
              </SheetContent>
            </Sheet>
        </div>
        
        <div className="space-y-2 overflow-y-auto flex-1 pr-2">
            {keys.map(k => (
                <div 
                    key={k.service}
                    onClick={() => setSelectedKey(k)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all hover:bg-muted/50 ${selectedKey?.service === k.service ? 'bg-primary/5 border-primary shadow-sm' : ''}`}
                >
                    <div className="flex justify-between items-start mb-1">
                        <span className="font-bold text-sm">{k.service}</span>
                        {k.is_active ? (
                            <div className="h-2 w-2 rounded-full bg-green-500" />
                        ) : (
                            <div className="h-2 w-2 rounded-full bg-red-300" />
                        )}
                    </div>
                    <div className="flex justify-between items-end">
                         <span className="text-[10px] font-mono text-muted-foreground">{k.key_value || 'No Key'}</span>
                         <div className="flex items-center gap-1">
                           <Badge variant="secondary" className="text-[9px] h-4">{k.provider_type}</Badge>
                           <Badge variant="outline" className="text-[9px] h-4 uppercase">
                             {String(k?.metadata?.tier || 'free')}
                           </Badge>
                         </div>
                    </div>
                    {/* Mini Usage Bar (Mock for now, or use last_used_at) */}
                    <div className="mt-2 text-[9px] text-muted-foreground flex justify-between">
                        <span>Last used: {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}</span>
                    </div>
                </div>
            ))}
        </div>
      </div>

      {/* Main Panel: Configuration */}
      <div className="flex-1 flex flex-col gap-6 overflow-hidden min-h-[500px] lg:min-h-0">
         {!selectedKey ? (
             <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50">
                 <FolderTree className="h-12 w-12 mb-4" />
                 <p>Select an API Key to configure its model access.</p>
             </div>
         ) : (
             <div className="flex flex-col h-full gap-6">
                 {/* Key Header */}
                 <div className="flex justify-between items-start pb-4 border-b">
                     <div>
                         <h2 className="text-lg font-bold flex items-center gap-2">
                             {selectedKey.service} 
                             <Badge variant="outline">{selectedKey.provider_type}</Badge>
                         </h2>
                         <p className="text-xs text-muted-foreground font-mono mt-1">
                             {selectedKey.key_value}
                         </p>
                     </div>
                     <div className="flex gap-2">
                         <Sheet>
                              <SheetTrigger asChild>
                                <Button variant="outline" size="sm">Edit Key</Button>
                              </SheetTrigger>
                              <SheetContent>
                                <SheetHeader>
                                  <SheetTitle>Edit API Key</SheetTitle>
                                </SheetHeader>
                                <KeyForm initialData={selectedKey} onSubmit={handleUpdateKey} />
                              </SheetContent>
                         </Sheet>
                         <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteKey(selectedKey.service)}>
                            <Trash2 className="h-4 w-4" />
                         </Button>
                     </div>
                 </div>

                 {/* Model Access Tree */}
                 <div className="flex-1 flex flex-col min-h-0">
                     <div className="flex justify-between items-center mb-4">
                         <h3 className="font-medium flex items-center gap-2"><Database className="h-4 w-4" /> Attached Models</h3>
                         
                         {/* Registry Indicator */}
                         <Badge variant={registrySource === 'pro' ? 'default' : 'secondary'} className="ml-2 text-[10px] h-5">
                             Registry: {registrySource.toUpperCase()}
                         </Badge>
                         
                         <div className="flex items-center gap-2">
                             <span className="text-xs text-muted-foreground">Mode:</span>
                             <div className="flex items-center gap-2 bg-muted p-1 rounded-lg">
                                 <Button 
                                    variant={selectedKey.allowed_models === null ? "default" : "ghost"} 
                                    size="sm" 
                                    className="h-6 text-[10px] px-2"
                                    onClick={() => setAllFreeMode(true)}
                                 >
                                     Auto (All Free)
                                 </Button>
                                 <Button 
                                    variant={selectedKey.allowed_models !== null ? "default" : "ghost"} 
                                    size="sm" 
                                    className="h-6 text-[10px] px-2"
                                    onClick={() => setAllFreeMode(false)}
                                 >
                                     Manual Select
                                 </Button>
                             </div>
                             
                             <Sheet>
                                <SheetTrigger asChild>
                                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 ml-2">
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                </SheetTrigger>
                                <SheetContent className="overflow-y-auto">
                                    <SheetHeader>
                                        <SheetTitle>Add New Model</SheetTitle>
                                        <SheetDescription>Register a new AI model to the system.</SheetDescription>
                                    </SheetHeader>
                                    <ModelForm onSubmit={handleAddModel} />
                                </SheetContent>
                             </Sheet>
                         </div>
                     </div>

                     <div className="flex-1 overflow-y-auto border rounded-lg bg-background">
                         <table className="w-full text-sm">
                             <thead className="bg-muted/50 sticky top-0 z-10 backdrop-blur-sm">
                                 <tr>
                                     <th className="p-3 text-left w-12">Use</th>
                                     <th className="p-3 text-left hidden sm:table-cell">Model ID</th>
                                     <th className="p-3 text-left hidden sm:table-cell">Tier</th>
                                     <th className="p-3 text-right hidden sm:table-cell">RPM</th>
                                     <th className="p-3 text-right">Actions</th>
                                 </tr>
                             </thead>
                             <tbody className="divide-y">
                                 {models.map(m => {
                                     const isAllowed = selectedKey.allowed_models === null 
                                         ? m.is_free // In Auto mode, only free models are "allowed" implicitly (or we can show all free as checked)
                                         : selectedKey.allowed_models.includes(m.model_id);
                                     
                                     // Visual cue for "Implicitly Allowed" vs "Explicitly Allowed"
                                     const isImplicit = selectedKey.allowed_models === null && m.is_free;
                                     
                                     return (
                                         <tr key={m.model_id} className={`hover:bg-muted/20 transition-colors ${isAllowed ? 'bg-primary/5' : ''}`}>
                                             <td className="p-3">
                                                 <Switch 
                                                     checked={isAllowed} 
                                                     onCheckedChange={() => toggleModelForKey(m.model_id, selectedKey.allowed_models)}
                                                     disabled={selectedKey.allowed_models === null && !isImplicit}
                                                 />
                                             </td>
                                             <td className="p-3 hidden sm:table-cell">
                                                 <div className="flex flex-col">
                                                     <span className={`font-medium ${isAllowed ? 'text-primary' : 'text-muted-foreground'}`}>{m.display_name}</span>
                                                     <span className="text-[10px] font-mono text-muted-foreground">{m.model_id}</span>
                                                 </div>
                                             </td>
                                             <td className="p-3 hidden sm:table-cell">
                                                 {m.is_free ? (
                                                     <Badge variant="secondary" className="bg-green-100 text-green-700 hover:bg-green-100 text-[10px]">FREE</Badge>
                                                 ) : (
                                                     <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100 text-[10px]">PAID</Badge>
                                                 )}
                                             </td>
                                             <td className="p-3 text-right font-mono text-xs text-muted-foreground hidden sm:table-cell">
                                                 {m.rate_limit_rpm}
                                             </td>
                                             <td className="p-3 text-right">
                                                 <Sheet>
                                                      <SheetTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-6 w-6">
                                                          <Activity className="h-3 w-3" />
                                                        </Button>
                                                      </SheetTrigger>
                                                      <SheetContent className="overflow-y-auto">
                                                        <SheetHeader>
                                                          <SheetTitle>Edit Model</SheetTitle>
                                                        </SheetHeader>
                                                        <ModelForm initialData={m} onSubmit={handleUpdateModel} />
                                                      </SheetContent>
                                                 </Sheet>
                                             </td>
                                         </tr>
                                     );
                                 })}
                             </tbody>
                         </table>
                     </div>
                 </div>
             </div>
         )}
      </div>
    </div>
  );
};

const ModelForm = ({ initialData, onSubmit }: { initialData?: any, onSubmit: (data: any) => void }) => {
  const [data, setData] = useState(initialData || {
    model_id: '',
    display_name: '',
    provider: 'openrouter',
    type: 'chat',
    is_free: false,
    is_active: true,
    context_window: 4096,
    rate_limit_rpm: 20
  });

  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label>Model ID</Label>
        <Input 
          value={data.model_id} 
          onChange={e => setData({...data, model_id: e.target.value})} 
          placeholder="provider/model-name"
          disabled={!!initialData}
        />
      </div>
      <div className="space-y-2">
        <Label>Display Name</Label>
        <Input 
          value={data.display_name} 
          onChange={e => setData({...data, display_name: e.target.value})} 
          placeholder="Friendly Name"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Provider</Label>
          <Input 
            value={data.provider} 
            onChange={e => setData({...data, provider: e.target.value})} 
          />
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={data.type} onValueChange={v => setData({...data, type: v})}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="chat">Chat</SelectItem>
              <SelectItem value="embedding">Embedding</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
           <Label>Context Window</Label>
           <Input type="number" value={data.context_window} onChange={e => setData({...data, context_window: parseInt(e.target.value)})} />
        </div>
        <div className="space-y-2">
           <Label>Rate Limit (RPM)</Label>
           <Input type="number" value={data.rate_limit_rpm} onChange={e => setData({...data, rate_limit_rpm: parseInt(e.target.value)})} />
        </div>
      </div>
      <div className="flex items-center gap-4 pt-4">
        <div className="flex items-center gap-2">
          <Switch checked={data.is_free} onCheckedChange={c => setData({...data, is_free: c})} />
          <Label>Free Tier</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={data.is_active} onCheckedChange={c => setData({...data, is_active: c})} />
          <Label>Active</Label>
        </div>
      </div>
      <Button className="w-full mt-4" onClick={() => onSubmit(data)}>Save Model</Button>
    </div>
  );
};

const KeyForm = ({ initialData, onSubmit }: { initialData?: any, onSubmit: (data: any) => void }) => {
  const [data, setData] = useState(initialData || {
    service: '',
    key_value: '',
    provider_type: 'openrouter',
    is_active: true
  });

  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label>Service Name</Label>
        <Input 
          value={data.service} 
          onChange={e => setData({...data, service: e.target.value})} 
          placeholder="e.g. openrouter-primary"
          disabled={!!initialData}
        />
      </div>
      <div className="space-y-2">
        <Label>API Key</Label>
        <Input 
          type="password"
          value={data.key_value} 
          onChange={e => setData({...data, key_value: e.target.value})} 
          placeholder="sk-..."
        />
      </div>
      <div className="space-y-2">
        <Label>Provider Type</Label>
        <select 
          className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          value={data.provider_type} 
          onChange={e => setData({...data, provider_type: e.target.value})}
        >
          <option value="openrouter">OpenRouter</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Google</option>
        </select>
      </div>
      <div className="flex items-center gap-2 pt-4">
          <Switch checked={data.is_active} onCheckedChange={c => setData({...data, is_active: c})} />
          <Label>Active</Label>
      </div>
      <Button
        className="w-full mt-4"
        disabled={!String(data.service || '').trim() || (!initialData && !String(data.key_value || '').trim())}
        onClick={() => onSubmit(data)}
      >
        Save Key
      </Button>
    </div>
  );
};

const AdminUsers = () => <ConexUserManagement />;

const AdminActivity = ({ token }: { token: string }) => {
  const [isLive, setIsLive] = useState(true);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_active_users' }),
      });
      if (res.ok) setEvents((res as any).events || []);
    } catch (e: any) {
      console.error('[AdminActivity] fetch error:', e);
      toast({ title: 'Error', description: 'Failed to load activity feed.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      fetchEvents().catch(() => {});
    }, 10_000);
    return () => clearInterval(interval);
  }, [isLive, fetchEvents]);

  const activeUsers = React.useMemo(() => new Set((events || []).map((e) => e.user_id)).size, [events]);

  if (loading && !events.length) {
    return (
      <div className="flex flex-col items-center justify-center p-8 gap-4">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
        <p className="text-sm text-muted-foreground">Loading Activity Feed...</p>
        <Button variant="ghost" size="sm" onClick={() => setIsLive(false)}>
          Pause Live Mode
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-muted'}`} />
          <span className="text-sm font-medium">{isLive ? 'Live Monitoring (Supabase)' : 'Monitoring Paused'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchEvents()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsLive(!isLive)}>
            {isLive ? 'Pause' : 'Resume'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-2 bg-blue-100 rounded-lg text-blue-600"><Users className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Active Users</p>
              <p className="text-xl font-bold">{activeUsers}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-2 bg-green-100 rounded-lg text-green-600"><Activity className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Recent Events</p>
              <p className="text-xl font-bold">{(events || []).length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-2 bg-purple-100 rounded-lg text-purple-600"><Clock className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Window</p>
              <p className="text-xl font-bold">15m</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 text-left">Time</th>
              <th className="p-2 text-left">User</th>
              <th className="p-2 text-left">Event</th>
              <th className="p-2 text-left">Context</th>
            </tr>
          </thead>
          <tbody>
            {!events || events.length === 0 ? (
              <tr><td colSpan={4} className="p-8 text-center text-muted-foreground italic">No recent activity detected.</td></tr>
            ) : (
              events.slice(0, 50).map((e, idx) => (
                <tr key={idx} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="p-2 text-xs font-medium">{new Date(e.timestamp).toLocaleTimeString()}</td>
                  <td className="p-2">
                    <div className="flex flex-col">
                      <span className="text-xs font-mono text-muted-foreground">{String(e.user_id || '').slice(0, 8)}...</span>
                      {e.metadata?.type && (
                        <span className="text-[9px] uppercase tracking-tighter opacity-70">{e.metadata.type}</span>
                      )}
                    </div>
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px] font-bold tracking-wider uppercase">
                        {String(e.event_type || '').replace(/_/g, ' ')}
                      </Badge>
                      {e.metadata?.pwa && (
                        <Badge className="bg-green-500/10 text-green-600 border-green-500/20 h-4 px-1 text-[8px] font-black">PWA</Badge>
                      )}
                    </div>
                  </td>
                  <td className="p-2 text-xs text-muted-foreground truncate max-w-[200px]" title={JSON.stringify(e.metadata)}>
                    {e.event_type === 'heartbeat' && e.metadata?.device ? (
                      <span className="flex items-center gap-1">
                        {e.metadata.device.platform?.includes('Win') ? <Terminal className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                        {e.metadata.device.browser?.split('/')[0]} on {e.metadata.device.platform}
                      </span>
                    ) : Object.keys(e.metadata || {}).length > 0 ? (
                      JSON.stringify(e.metadata)
                    ) : '-'}
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

const AdminFeedback = ({ token }: { token: string }) => {
  const [feedback, setFeedback] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFeedback = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_feedback' })
      });
      if (res.ok) setFeedback((res as any).feedback || []);
    } catch (e) {
      console.error('[AdminFeedback] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  const handleExport = () => {
    const csvContent = "data:text/csv;charset=utf-8," 
      + ["Date,User,Section,Rating,Comment"].join(",") + "\n"
      + feedback.map(f => [
          new Date(f.created_at).toLocaleString(),
          f.user_id || 'Anonymous',
          f.section,
          f.rating,
          `"${f.comment?.replace(/"/g, '""') || ''}"`
        ].join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `au_feedback_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium">User Feedback</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchFeedback} disabled={loading}>
            <Activity className="h-4 w-4 mr-2" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={feedback.length === 0}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
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
                    <Badge className={`text-[10px] ${f.rating === 'positive' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {f.rating === 'positive' ? <ThumbsUp className="h-3 w-3 mr-1" /> : <ThumbsDown className="h-3 w-3 mr-1" />}
                      {f.rating}
                    </Badge>
                  </td>
                  <td className="p-2 text-xs italic">{f.comment || '-'}</td>
                  <td className="p-2 text-xs font-mono text-muted-foreground">{f.user_id?.slice(0,8) || 'Anon'}...</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const AdminAlerts = ({ token }: { token: string }) => {
  const [configs, setConfigs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_alert_config' })
      });
      if (res.ok) setConfigs((res as any).configs || []);
    } catch (e) {
      console.error('[AdminAlerts] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const handleUpdate = async (config: any) => {
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'update_alert_config', config })
      });
      if (res.ok) {
        toast({ title: 'Config Updated', description: `Alerts for ${config.event_type} updated.` });
        fetchConfigs();
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="grid gap-4">
        {configs.map((c) => (
          <Card key={c.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-md font-bold uppercase tracking-wider">{c.event_type.replace(/_/g, ' ')}</CardTitle>
                <Switch 
                  checked={c.is_enabled} 
                  onCheckedChange={(val) => handleUpdate({ ...c, is_enabled: val })}
                />
              </div>
              <CardDescription>Automatic email alerts for this system event.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Recipients (Comma Separated)</Label>
                <div className="flex gap-2">
                  <Input 
                    value={c.recipients.join(', ')} 
                    onChange={(e) => {
                      const next = [...configs];
                      const idx = next.findIndex(item => item.id === c.id);
                      next[idx].recipients = e.target.value.split(',').map(r => r.trim()).filter(Boolean);
                      setConfigs(next);
                    }}
                    placeholder="admin@datacube.au, dev@datacube.au"
                  />
                  <Button size="sm" onClick={() => handleUpdate(c)}>
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

const AdminLogs = ({ token }: { token: string }) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const { toast } = useToast();

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_debug_logs' })
      });
      if (res.ok) setLogs((res as any).logs || []);
    } catch (e) {
      console.error('[AdminLogs] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearLogs = async () => {
    if (!confirm('Are you sure you want to wipe all debug logs?')) return;
    setClearing(true);
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'clear_logs' })
      });
      if (res.ok) {
        toast({ title: 'Logs Cleared', description: 'All debug logs have been removed.' });
        setLogs([]);
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setClearing(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  if (loading && logs.length === 0) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">System Debug Logs</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button variant="destructive" size="sm" onClick={clearLogs} disabled={clearing || logs.length === 0}>
            {clearing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
            Clear All Logs
          </Button>
        </div>
      </div>
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-muted">
            <tr>
              <th className="p-3 text-left">Time</th>
              <th className="p-3 text-left">Level</th>
              <th className="p-3 text-left">Source</th>
              <th className="p-3 text-left">Message</th>
              <th className="p-3 text-left">Details</th>
            </tr>
          </thead>
          <tbody className="font-mono text-[11px]">
            {logs.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-muted-foreground italic">No debug logs found.</td></tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="p-3 text-muted-foreground whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                  <td className="p-3">
                    <Badge variant={log.level === 'error' ? 'destructive' : log.level === 'warn' ? 'outline' : 'secondary'} className="text-[9px] uppercase px-1 py-0">
                      {log.level || 'info'}
                    </Badge>
                  </td>
                  <td className="p-3 font-bold">{log.source || log.component}</td>
                  <td className="p-3">{log.message}</td>
                  <td className="p-3 truncate max-w-[200px]">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-4">
                          View Details
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-md p-4 bg-black text-white font-mono text-[10px] overflow-auto max-h-[300px]">
                          <pre>{JSON.stringify(log.details, null, 2)}</pre>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
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

const AdminHealth = ({ token }: { token: string }) => {
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const { toast } = useToast();

  const verify = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'verify_system' })
      });
      if (res.ok) setResults((res as any).results || {});
    } catch (e) {
      console.error('[AdminHealth] verify error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadSchema = async () => {
    setReloading(true);
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'reload_schema' })
      });
      if (res.ok) {
        toast({ title: 'Success', description: 'Schema reload signal sent. Tables should appear shortly.' });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setReloading(false);
    }
  };

  useEffect(() => { verify(); }, [verify]);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">System Integrity</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={verify} disabled={loading}>
            <Activity className="h-4 w-4 mr-2" /> Verify
          </Button>
          <Button variant="destructive" size="sm" onClick={reloadSchema} disabled={reloading}>
            <Zap className="h-4 w-4 mr-2" /> Reload Cache
          </Button>
        </div>
      </div>

      <div className="grid gap-3">
        {Object.entries(results).map(([table, exists]) => (
          <div key={table} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
            <span className="font-mono text-sm">{table}</span>
            {exists ? (
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100 gap-1"><CheckCircle2 className="h-3 w-3" /> Ready</Badge>
            ) : (
              <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Not Found (404)</Badge>
            )}
          </div>
        ))}
      </div>

      {!Object.values(results).every(v => v) && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Missing Tables Detected</AlertTitle>
          <AlertDescription>
            Some tables are returning 404. This usually means the migration hasn't been applied or the cache is stale. Try "Reload Cache" or verify migrations in Supabase.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default function ConexPage() {
  const router = useRouter();
  const [user, , isUserLoading] = useSupabaseUser();
  const [isCheckingConexAccess, setIsCheckingConexAccess] = useState(true);
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [puzzle, setPuzzle] = useState(() => {
    const a = Math.floor(Math.random() * 10) + 1;
    const b = Math.floor(Math.random() * 10) + 1;
    return { a, b, val: '' };
  });
  const [answer, setAnswer] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("access");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;

    const verifyConexAccess = async () => {
      if (isUserLoading) return;

      if (!user) {
        router.replace('/login?redirectTo=/conex');
        return;
      }

      const token = await getSupabaseAccessToken();
      if (!token) {
        router.replace('/login?redirectTo=/conex');
        return;
      }

      try {
        const res = await fetch('/conex/users?mode=access', {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        });

        if (cancelled) return;

        if (res.ok) {
          setIsCheckingConexAccess(false);
          return;
        }

        if (res.status === 403) {
          router.replace('/403');
          return;
        }

        router.replace('/login?redirectTo=/conex');
      } catch {
        if (!cancelled) router.replace('/login?redirectTo=/conex');
      }
    };

    verifyConexAccess();

    return () => {
      cancelled = true;
    };
  }, [isUserLoading, user, router]);

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const resetConexAuth = (opts?: { message?: string }) => {
    localStorage.removeItem('conex_admin_token');
    localStorage.removeItem('conex_session_id');
    localStorage.removeItem('conex_auth_step');
    setAdminToken(null);
    setSessionId(null);
    setAccessKey('');
    setAnswer('');
    setStep(0);
    if (opts?.message) setError(opts.message);
  };

  // Handle persistence on refresh
  useEffect(() => {
    let mounted = true;

    const restoreAdminState = async () => {
      const accessToken = await getSupabaseAccessToken();
      if (!mounted) return;
      if (!accessToken) {
        resetConexAuth({ message: 'Session expired. Please log in again.' });
        return;
      }

      const savedToken = localStorage.getItem('conex_admin_token');
      const savedSession = localStorage.getItem('conex_session_id');
      const savedStep = localStorage.getItem('conex_auth_step');

      if (savedStep === '3') {
        if (!savedToken || savedToken === 'undefined' || !uuidRegex.test(savedToken)) {
          resetConexAuth({ message: 'Session expired. Please log in again.' });
          return;
        }
        setAdminToken(savedToken);
        setStep(3);
        return;
      }

      if (savedStep === '2') {
        if (!savedSession || savedSession === 'undefined' || !uuidRegex.test(savedSession)) {
          resetConexAuth({ message: 'Session expired. Please restart access.' });
          return;
        }
        setSessionId(savedSession);
        setStep(2);
      }
    };

    restoreAdminState();
    return () => {
      mounted = false;
    };
  }, []);

  const handlePuzzle = (e: React.FormEvent) => {
    e.preventDefault();
    if (parseInt(puzzle.val) === puzzle.a + puzzle.b) {
      setStep(1);
      setError(null);
    } else {
      setError('Incorrect. Access denied.');
      setPuzzle(prev => ({ ...prev, val: '' }));
    }
  };

  const handleStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const accessToken = await getSupabaseAccessToken();
      if (!accessToken) {
        throw new Error('Sign in required. Please log in to your account first.');
      }

      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: 'auth', step: 1, answer })
      });
      const data = await res.json();
      if (res.ok) {
        const nextSessionId = String(data.sessionId || '');
        if (!uuidRegex.test(nextSessionId)) {
          throw new Error('Auth session could not be created. Please try again.');
        }
        setSessionId(nextSessionId);
        setStep(2);
        localStorage.setItem('conex_session_id', nextSessionId);
        localStorage.setItem('conex_auth_step', '2');
      } else {
        throw new Error(data.error || 'Authentication failed');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || sessionId === 'undefined' || !uuidRegex.test(sessionId)) {
      resetConexAuth({ message: 'Invalid session. Please restart access.' });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const accessToken = await getSupabaseAccessToken();
      if (!accessToken) {
        throw new Error('Sign in required. Please log in to your account first.');
      }

      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: 'auth', step: 2, accessKey, sessionId })
      });
      const data = await res.json();
      if (res.ok) {
        const nextAdminToken = String(data.adminToken || '');
        if (!uuidRegex.test(nextAdminToken)) {
          throw new Error('Admin token missing. Please try again.');
        }
        setAdminToken(nextAdminToken);
        setStep(3);
        localStorage.setItem('conex_admin_token', nextAdminToken);
        localStorage.setItem('conex_auth_step', '3');
        toast({ title: 'Welcome, Admin', description: 'System access granted.' });
      } else {
        throw new Error(data.error || 'Access denied');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    resetConexAuth();
    window.location.reload();
  };

  const navItems = [
    { value: 'access', label: 'Access', icon: Shield },
    { value: 'usage', label: 'Usage', icon: LayoutDashboard },
    { value: 'billing', label: 'Billing', icon: Crown },
    { value: 'registry', label: 'Registry', icon: Database },
    { value: 'users', label: 'Users', icon: Users },
    { value: 'activity', label: 'Activity', icon: Activity },
    { value: 'feedback', label: 'Feedback', icon: Star },
    { value: 'alerts', label: 'Alerts', icon: Mail },
    { value: 'health', label: 'Health', icon: HeartPulse },
    { value: 'analytics', label: 'Analytics', icon: Activity },
    { value: 'logs', label: 'Logs', icon: Terminal },
  ];

  if (isUserLoading || isCheckingConexAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent p-4">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (step === 3 && adminToken) {
    return (
      <div className="min-h-screen bg-transparent p-4 md:p-8">
        <div className="mx-auto max-w-6xl space-y-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight uppercase truncate">AU Central Command</h1>
            </div>
            
            <div className="flex items-center gap-2">
                {/* Mobile Menu */}
                <div className="md:hidden">
                    <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
                        <SheetTrigger asChild>
                            <Button variant="outline" size="icon">
                                <Menu className="h-5 w-5" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left">
                            <SheetHeader>
                                <SheetTitle className="uppercase tracking-widest font-bold text-left">Navigation</SheetTitle>
                                <SheetDescription className="text-left">
                                    Access command modules.
                                </SheetDescription>
                            </SheetHeader>
                            <div className="grid gap-2 py-4">
                                {navItems.map((item) => (
                                    <Button 
                                        key={item.value} 
                                        variant={activeTab === item.value ? "default" : "ghost"} 
                                        className="justify-start gap-2"
                                        onClick={() => {
                                            setActiveTab(item.value);
                                            setIsMobileMenuOpen(false);
                                        }}
                                    >
                                        <item.icon className="h-4 w-4" />
                                        {item.label}
                                    </Button>
                                ))}
                                <div className="h-px bg-muted my-2" />
                                <Button variant="destructive" className="justify-start gap-2" onClick={handleLogout}>
                                    <Lock className="h-4 w-4" /> Logout
                                </Button>
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
                
                <Button variant="outline" size="sm" onClick={handleLogout} className="hidden md:flex">Logout</Button>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="hidden md:grid w-full grid-cols-11 mb-8">
                {navItems.map((item) => (
                    <TabsTrigger key={item.value} value={item.value} className="gap-2">
                        <item.icon className="h-4 w-4" /> {item.label}
                    </TabsTrigger>
                ))}
            </TabsList>

            <TabsContent value="access">
              <ConexAccessControl />
            </TabsContent>
            
            <TabsContent value="usage">
              <Card>
                <CardHeader>
                  <CardTitle>Model Usage</CardTitle>
                  <CardDescription>Recent API calls and token consumption.</CardDescription>
                </CardHeader>
                <CardContent>
                  <AdminUsage token={adminToken} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="billing">
              <Card>
                <CardHeader>
                  <CardTitle>Billing & Monetization</CardTitle>
                  <CardDescription>Manage Stripe integration and premium features.</CardDescription>
                </CardHeader>
                <CardContent>
                  <AdminBilling token={adminToken} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="registry">
              <Card>
                <CardHeader>
                  <CardTitle>Model Registry</CardTitle>
                  <CardDescription>Configure API keys and model assignments.</CardDescription>
                </CardHeader>
                <CardContent>
                  <AdminRegistry token={adminToken} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="users">
              <Card>
                <CardHeader>
                  <CardTitle>User Management</CardTitle>
                  <CardDescription>Manage profiles, status, roles, permissions, access, and audit activity.</CardDescription>
                </CardHeader>
                <CardContent>
                  <AdminUsers />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity">
              <Card>
                <CardHeader>
                  <CardTitle>Live Activity</CardTitle>
                  <CardDescription>Real-time view of user interactions.</CardDescription>
                </CardHeader>
                <CardContent>
                  <AdminActivity token={adminToken} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="feedback">
              <Card>
                <CardHeader>
                  <CardTitle>User Feedback</CardTitle>
                  <CardDescription>View ratings and comments from users.</CardDescription>
                </CardHeader>
                <CardContent>
                  <AdminFeedback token={adminToken} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="alerts">
              <Card>
                <CardHeader>
                  <CardTitle>Email Alerts</CardTitle>
                  <CardDescription>Configure automatic notifications for system events.</CardDescription>
                </CardHeader>
                <CardContent>
                  <AdminAlerts token={adminToken} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="health">
              <Card>
                <CardHeader>
                  <CardTitle>System Health</CardTitle>
                  <CardDescription>Verify table existence and recover from 404 errors.</CardDescription>
                </CardHeader>
                <CardContent>
                  <AdminHealth token={adminToken} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="analytics">
              <Card>
                <CardHeader>
                  <CardTitle>Database Analytics</CardTitle>
                  <CardDescription>Visual insights into system usage and performance.</CardDescription>
                </CardHeader>
                <CardContent>
                  <AdminAnalytics token={adminToken} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="logs">
              <Card>
                <CardHeader>
                  <CardTitle>System Logs</CardTitle>
                  <CardDescription>Detailed debug logs from the AU backend.</CardDescription>
                </CardHeader>
                <CardContent>
                  <AdminLogs token={adminToken} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div
            key="step0"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-md"
          >
            <Card className="border-primary/20 shadow-xl">
              <CardHeader className="text-center">
                <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-2xl font-headline tracking-tighter uppercase">Security Check</CardTitle>
                <CardDescription>Prove you are human.</CardDescription>
              </CardHeader>
              <form onSubmit={handlePuzzle}>
                <CardContent className="space-y-4">
                  <div className="space-y-2 text-center">
                    <Label className="text-lg font-medium">What is {puzzle.a} + {puzzle.b}?</Label>
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
                  <Button type="submit" className="w-full h-12 text-lg font-bold uppercase tracking-tighter">
                    Verify
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div
            key="step1"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-md"
          >
            <Card className="border-primary/20 shadow-xl">
              <CardHeader className="text-center">
                <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-2xl font-headline tracking-tighter uppercase">Conex Access</CardTitle>
                <CardDescription>Identify yourself to proceed.</CardDescription>
              </CardHeader>
              <form onSubmit={handleStep1}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-lg font-medium">Who are you now?</Label>
                    <Input 
                      value={answer} 
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="Enter the secret answer..."
                      className="text-center text-lg py-6"
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
                <CardFooter>
                  <Button type="submit" className="w-full h-12 text-lg font-bold uppercase tracking-tighter" disabled={loading}>
                    {loading ? <Loader2 className="animate-spin" /> : <>Identify <ArrowRight className="ml-2 h-5 w-5" /></>}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="w-full max-w-md"
          >
            <Card className="border-primary/20 shadow-xl">
              <CardHeader className="text-center">
                <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Key className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-2xl font-headline tracking-tighter uppercase">Access Key</CardTitle>
                <CardDescription>Final security checkpoint.</CardDescription>
              </CardHeader>
              <form onSubmit={handleStep2}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-lg font-medium">Admin Access Key</Label>
                    <Input 
                      type="password"
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
                <CardFooter>
                  <Button type="submit" className="w-full h-12 text-lg font-bold uppercase tracking-tighter" disabled={loading}>
                    {loading ? <Loader2 className="animate-spin" /> : <>Unlock Command Center <Lock className="ml-2 h-5 w-5" /></>}
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


