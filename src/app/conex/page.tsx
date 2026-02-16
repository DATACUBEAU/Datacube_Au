'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
import { fetchAdmin } from '@/lib/api/admin-fetch';
import { supabase } from '@/lib/supabase-client/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AdminAnalytics } from '@/components/admin/admin-analytics';

// Admin Dashboard Components
const AdminBilling = ({ token }: { token: string }) => {
  const [config, setConfig] = useState<any>({});
  const [auConfig, setAuConfig] = useState<any>({});
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
    } catch (e: any) {
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch Usage using the centralized fetchAdmin utility
      const usageRes = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_usage' })
      });
      if (usageRes.ok) {
        setUsage((usageRes as any).usage || []);
        if ((usageRes as any).stats) setStats((usageRes as any).stats);
      }

      // Fetch Users Count using the centralized fetchAdmin utility
      const usersRes = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_users' })
      });
      if (usersRes.ok) {
        setTotalUsers((usersRes as any).users.authenticated?.length || 0);
      }
    } catch (e) {
      console.error('[AdminUsage] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

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
        body: JSON.stringify({ action: 'update_model', model })
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
        body: JSON.stringify({ action: 'update_model', model })
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
                         <Badge variant="secondary" className="text-[9px] h-4">{k.provider_type}</Badge>
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
                         <Badge variant={selectedKey.service === 'openrouter_primary' ? 'default' : 'secondary'} className="ml-2 text-[10px] h-5">
                             Registry: {selectedKey.service === 'openrouter_primary' ? 'PRO' : 'FREE'}
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

const AdminUsers = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [msgContent, setMsgContent] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'auth'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { toast } = useToast();

  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const allUsers = users;

  const getBrowserName = (ua?: string) => {
    if (!ua) return '';
    const s = ua.toLowerCase();
    if (s.includes('edg/')) return 'Edge';
    if (s.includes('opr/') || s.includes('opera')) return 'Opera';
    if (s.includes('firefox/')) return 'Firefox';
    if (s.includes('chrome/') && !s.includes('edg/') && !s.includes('opr/')) return 'Chrome';
    if (s.includes('safari/') && !s.includes('chrome/')) return 'Safari';
    return 'Browser';
  };

  const getBrowserType = (ua?: string) => {
    const s = (ua || '').toLowerCase();
    if (/chrome|crios/.test(s) && !/edge|edg/.test(s)) return 'chrome';
    if (/safari/.test(s) && !/chrome|crios/.test(s)) return 'safari';
    if (/firefox|fxios/.test(s)) return 'firefox';
    if (/edge|edg/.test(s)) return 'edge';
    return 'other';
  };

  const getDetectedDevice = (u: any, ua: string) => {
    const dt = String(u?.device_info?.deviceType || '').toLowerCase();
    if (dt === 'desktop') return 'Desktop / Laptop';
    if (dt === 'tablet') return 'Tablet';
    if (dt === 'mobile') return 'Mobile Device';

    const s = (ua || '').toLowerCase();
    const isTablet = /ipad|android/.test(s) && !/mobile/.test(s);
    const isIOS = /iphone|ipad|ipod/.test(s);
    if (isTablet) return 'Tablet';
    if (isIOS) return 'iPhone / iPad (iOS)';
    if (/android/.test(s)) return 'Android Device';
    if (s) return 'Desktop / Laptop';
    return 'Unknown Device';
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({
          action: 'list_users',
          q: searchQuery,
          type: filterStatus === 'auth' ? 'auth' : 'all',
          provider: 'all',
          sortBy: 'last_active_at',
          sortDir: 'desc',
          page,
          pageSize
        })
      });
      if (res.ok) {
        const data = (res as any).data || res;
        setUsers(data.users || []);
        setTotal(data.total || 0);
      } else {
        throw new Error((res as any).error || 'Failed to load users');
      }
    } catch (e: any) {
      console.error('[AdminUsers] list error:', e);
      toast({ title: 'Error', description: 'Failed to load users.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filterStatus, page, pageSize, toast]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    let cancelled = false;
    const loadMessages = async () => {
      if (!selectedUser?.user_id) {
        setMessages([]);
        setLoadingMsgs(false);
        return;
      }
      setLoadingMsgs(true);
      try {
        const { data, error } = await supabase
          .from('au_messages')
          .select('*')
          .eq('user_id', selectedUser.user_id)
          .order('created_at', { ascending: true })
          .limit(200);
        if (error) throw error;
        if (!cancelled) setMessages(data || []);
      } catch (e: any) {
        console.error('[AdminUsers] messages error:', e);
        if (!cancelled) {
          toast({ title: 'Error', description: 'Failed to load messages.', variant: 'destructive' });
          setMessages([]);
        }
      } finally {
        if (!cancelled) setLoadingMsgs(false);
      }
    };
    loadMessages();
    return () => {
      cancelled = true;
    };
  }, [selectedUser?.user_id, toast]);

  const exportUsersCsv = useCallback(async () => {
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({
          action: 'export_users_csv',
          q: searchQuery,
          type: filterStatus === 'auth' ? 'auth' : 'all',
          provider: 'all',
          sortBy: 'last_active_at',
          sortDir: 'desc'
        })
      });
      if (!res.ok) throw new Error((res as any).error || 'Export failed');
      const data = (res as any).data || res;
      const csv = data.csv || '';
      const filename = data.filename || `users_export_${new Date().toISOString().slice(0, 10)}.csv`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error('[AdminUsers] export error:', e);
      toast({ title: 'Error', description: 'Failed to export users.', variant: 'destructive' });
    }
  }, [searchQuery, filterStatus, toast]);

  const clearChat = useCallback(async () => {
    if (!selectedUser?.user_id) return;
    try {
      const { error } = await supabase.from('au_messages').delete().eq('user_id', selectedUser.user_id);
      if (error) throw error;
      setMessages([]);
      toast({ title: 'Cleared', description: 'User messages cleared.' });
    } catch (e: any) {
      console.error('[AdminUsers] clear error:', e);
      toast({ title: 'Error', description: 'Failed to clear messages.', variant: 'destructive' });
    }
  }, [selectedUser?.user_id, toast]);

  const deleteUser = useCallback(async (userId: string) => {
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete_user', userId })
      });
      if (!res.ok) throw new Error((res as any).error || 'Delete failed');
      setUsers(prev => prev.filter(u => u.user_id !== userId));
      if (selectedUser?.user_id === userId) {
        setSelectedUser(null);
        setMessages([]);
      }
      toast({ title: 'User deleted', description: 'User account removed.' });
    } catch (e: any) {
      console.error('[AdminUsers] delete error:', e);
      toast({ title: 'Error', description: 'Failed to delete user.', variant: 'destructive' });
    }
  }, [selectedUser?.user_id, toast]);

  const sendMessage = useCallback(async () => {
    if (!selectedUser?.user_id || !msgContent.trim()) return;
    setSending(true);
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({
          action: 'send_user_notification',
          targetUserId: selectedUser.user_id,
          title: 'Admin Message',
          content: msgContent.trim()
        })
      });
      if (!res.ok) throw new Error((res as any).error || 'Send failed');
      const now = new Date().toISOString();
      setMessages(prev => [
        ...prev,
        { id: crypto.randomUUID(), sender_type: 'admin', content: msgContent.trim(), created_at: now }
      ]);
      setMsgContent('');
    } catch (e: any) {
      console.error('[AdminUsers] send error:', e);
      toast({ title: 'Error', description: 'Failed to send message.', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  }, [selectedUser?.user_id, msgContent, toast]);

  if (loading && allUsers.length === 0) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:h-[800px] h-auto">
      <div className="w-full lg:w-1/3 flex flex-col gap-4 lg:border-r lg:pr-4 border-b pb-4 lg:border-b-0 lg:pb-0 h-[500px] lg:h-auto">
        <div className="flex flex-col gap-2">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2 w-full overflow-x-auto pb-1">
              <Button 
                variant={filterStatus === 'all' ? 'default' : 'outline'} 
                size="sm" 
                onClick={() => setFilterStatus('all')}
                className="rounded-full px-3 text-xs"
              >
                All
              </Button>
              <Button 
                variant={filterStatus === 'auth' ? 'default' : 'outline'} 
                size="sm" 
                onClick={() => setFilterStatus('auth')}
                className="rounded-full px-3 text-xs"
              >
                Auth
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportUsersCsv} className="h-8 px-2 text-[11px] gap-1">
                <Download className="h-3 w-3" /> Export
              </Button>
            </div>
        </div>

        <div className="space-y-2 overflow-y-auto flex-1 pr-2">
            {allUsers.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground italic">
                    {searchQuery ? 'No users matching your search.' : 'No users found.'}
                </div>
            ) : (
                allUsers.map((u) => {
                    // Fix: Activity takes precedence. If they have heartedbeat recently, they are online.
                    // We use a 90-second threshold (heartbeat is 60s + 30s buffer).
                    const isRecent = new Date(u.last_active_at).getTime() > nowTs - 90 * 1000;
                    
                    // We also consider them online if the explicit connection status says so AND they were active in last 5 mins
                    const connectionSaysOnline = u.connection?.isOnline === true;
                    const isSemiRecent = new Date(u.last_active_at).getTime() > nowTs - 5 * 60 * 1000;
                    
                    const isOnline = isRecent || (isSemiRecent && connectionSaysOnline);
                    
                    const initials = (u.full_name || u.email || 'G').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
                    const displayName = u.full_name || u.email || 'Unnamed User';
                    const ua = u.device_info?.browser || u.device_info?.userAgent || u.user_agent || '';
                    const browserType = getBrowserType(ua);
                    const detectedDevice = getDetectedDevice(u, ua);
                    const browserName = u.device_info?.browserName || getBrowserName(ua);
                    const browserVersion = u.device_info?.browserVersion || '';
                    const osName = u.device_info?.osName || '';
                    const osVersion = u.device_info?.osVersion || '';
                    const deviceModel = u.device_info?.deviceModel || '';
                    const deviceType = u.device_info?.deviceType || '';
                    const platform = u.device_info?.platform || '';
                    const timeZone = u.device_info?.timeZone || '';
                    const screen = u.device_info?.screen || u.device_info?.screenResolution || '';
                    const deviceLabel = [deviceModel, deviceType && deviceType !== 'unknown' ? deviceType : '', platform].filter(Boolean).join(' • ');
                    
                    return (
                        <div 
                            key={`${u.type}:${u.user_id}`}
                            onClick={() => setSelectedUser(u)}
                            className={`p-3 rounded-lg border cursor-pointer transition-all hover:bg-muted/50 flex items-start gap-3 ${selectedUser?.user_id === u.user_id ? 'bg-primary/5 border-primary shadow-sm' : ''}`}
                        >
                             <div className="relative">
                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                                    {initials}
                                </div>
                                {isOnline && <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-background" />}
                             </div>
                             
                             <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start">
                                    <span className="font-bold text-base text-foreground truncate">{displayName}</span>
                                    <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</span>
                                </div>
                                <p className="text-sm font-medium text-muted-foreground/80 truncate mt-0.5">{u.email || u.user_id}</p>
                                <div className="flex items-center gap-2 mt-2">
                                   <Badge variant={u.type === 'Auth' ? 'default' : 'secondary'} className="text-[10px] h-5 px-2 font-semibold shadow-sm">{u.type}</Badge>
                                   {u.is_pwa && <Badge className="bg-green-500/10 text-green-600 border-green-500/20 text-[10px] h-5 px-2 font-semibold">PWA</Badge>}
                                   <Badge variant={isOnline ? 'default' : 'outline'} className={`text-[10px] h-5 px-2 font-semibold ${isOnline ? 'bg-green-500 text-white border-transparent' : 'bg-muted/50 text-muted-foreground'}`}>
                                     {isOnline ? 'Online' : 'Offline'}
                                   </Badge>
                               </div>
                               <div className="mt-2 text-[10px] font-medium text-muted-foreground space-y-1.5 p-2 bg-muted/30 rounded-md border border-muted/50" title={JSON.stringify(u.device_info)}>
                                  <div className="flex items-center gap-1">
                                    <span className="font-semibold">Detected:</span>
                                    <span className="truncate">{detectedDevice} ({browserType})</span>
                                  </div>
                                  {(ua || platform || timeZone) && (
                                    <div className="flex items-center gap-1">
                                      {platform?.toLowerCase().includes('win') || platform?.toLowerCase().includes('mac') ? <Globe className="h-3 w-3" /> : <Smartphone className="h-3 w-3" />}
                                      <span className="truncate max-w-[160px]">
                                        {browserName}{browserVersion ? ` ${browserVersion}` : ''}{osName ? ` • ${osName}${osVersion ? ` ${osVersion}` : ''}` : ''}{screen ? ` • ${screen}` : ''}
                                      </span>
                                    </div>
                                  )}
                                  {deviceLabel && (
                                    <div className="flex items-center gap-1 pl-0.5">
                                      <span className="font-medium">Device:</span>
                                      <span className="truncate">{deviceLabel}</span>
                                    </div>
                                  )}
                                  {timeZone && (
                                    <div className="flex items-center gap-1 pl-0.5">
                                      <Clock className="h-2.5 w-2.5 opacity-70" />
                                      <span className="font-medium">TZ:</span>
                                      <span>{timeZone}</span>
                                    </div>
                                  )}
                                </div>
                             </div>
                        </div>
                    );
                })
            )}
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t">
          <span>{total} total</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Prev
            </Button>
            <span className="tabular-nums">{page} / {Math.max(1, Math.ceil(total / pageSize))}</span>
            <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setPage((p) => p + 1)} disabled={page >= Math.ceil(total / pageSize)}>
              Next
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-6 overflow-hidden min-h-[600px] lg:min-h-0">
        <Card className="h-full flex flex-col shadow-sm border-0">
            <CardHeader className="p-4 border-b bg-muted/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-primary" /> 
                  {selectedUser ? 'Conversation' : 'Select a user'}
                </CardTitle>
                {selectedUser && (
                  <div className="flex items-center gap-2">
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:bg-muted" onClick={clearChat} title="Clear History">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => deleteUser(selectedUser.user_id)} title="Delete User">
                        <UserMinus className="h-4 w-4" />
                      </Button>
                  </div>
                )}
              </div>
              {selectedUser && (
                <div className="mt-2 flex items-center gap-2">
                   <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                      {(selectedUser.full_name || selectedUser.email || 'G')[0].toUpperCase()}
                   </div>
                   <div className="flex flex-col min-w-0">
                      <span className="text-xs font-semibold truncate">{selectedUser.full_name || selectedUser.email || 'Unnamed User'}</span>
                      <span className="text-[9px] text-muted-foreground truncate font-mono">{selectedUser.user_id}</span>
                   </div>
                </div>
              )}
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
              {!selectedUser ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 opacity-50">
                  <div className="p-4 bg-muted rounded-full">
                    <Users className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Messaging Console</p>
                    <p className="text-xs text-muted-foreground mt-1">Select a user from the list to view history and send direct replies.</p>
                  </div>
                </div>
              ) : loadingMsgs ? (
                <div className="flex flex-col items-center justify-center h-full space-y-2">
                  <Loader2 className="animate-spin h-5 w-5 text-primary" />
                  <span className="text-[10px] text-muted-foreground">Loading history...</span>
                </div>
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-50">
                   <MessageSquare className="h-6 w-6 mb-2" />
                   <p className="text-xs italic">No messages found for this user.</p>
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className={`flex flex-col ${m.sender_type === 'admin' ? 'items-end' : 'items-start'}`}>
                    <div className={`max-w-[90%] p-3 rounded-2xl text-xs shadow-sm ${
                      m.sender_type === 'admin' 
                        ? 'bg-primary text-primary-foreground rounded-tr-none' 
                        : 'bg-muted rounded-tl-none border'
                    }`}>
                      {m.content}
                    </div>
                    <span className="text-[9px] text-muted-foreground mt-1.5 px-1 flex items-center gap-1">
                      {m.sender_type === 'admin' ? 'Sent' : 'Received'} • {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
            {selectedUser && (
              <CardFooter className="p-3 border-t bg-muted/5">
                <div className="flex w-full gap-2 items-end">
                  <Textarea 
                    placeholder="Type your reply..." 
                    value={msgContent} 
                    onChange={(e) => setMsgContent(e.target.value)}
                    className="min-h-[40px] max-h-[120px] text-xs resize-none py-2"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                  />
                  <Button 
                    size="icon" 
                    className="h-9 w-9 shrink-0" 
                    onClick={sendMessage} 
                    disabled={sending || !msgContent.trim()}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </CardFooter>
            )}
          </Card>
      </div>
    </div>
  );
};

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
  const [activeTab, setActiveTab] = useState("usage");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { toast } = useToast();

  // Handle persistence on refresh
  useEffect(() => {
    const savedToken = localStorage.getItem('conex_admin_token');
    const savedSession = localStorage.getItem('conex_session_id');
    const savedStep = localStorage.getItem('conex_auth_step');

    if (savedToken && savedStep === '3') {
      setAdminToken(savedToken);
      setStep(3);
    } else if (savedSession && savedStep === '2') {
      setSessionId(savedSession);
      setStep(2);
    }
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
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auth', step: 1, answer })
      });
      const data = await res.json();
      if (res.ok) {
        setSessionId(data.sessionId);
        setStep(2);
        localStorage.setItem('conex_session_id', data.sessionId);
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
    if (!sessionId || sessionId === 'undefined') {
        setError("Invalid Session. Please refresh and try again.");
        return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auth', step: 2, accessKey, sessionId })
      });
      const data = await res.json();
      if (res.ok) {
        setAdminToken(data.adminToken);
        setStep(3);
        localStorage.setItem('conex_admin_token', data.adminToken);
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
    localStorage.removeItem('conex_admin_token');
    localStorage.removeItem('conex_session_id');
    localStorage.removeItem('conex_auth_step');
    window.location.reload();
  };

  const navItems = [
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

  if (step === 3 && adminToken) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-8">
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
            <TabsList className="hidden md:grid w-full grid-cols-9 mb-8">
                {navItems.map((item) => (
                    <TabsTrigger key={item.value} value={item.value} className="gap-2">
                        <item.icon className="h-4 w-4" /> {item.label}
                    </TabsTrigger>
                ))}
            </TabsList>
            
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
                  <CardDescription>Monitor active users.</CardDescription>
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
