'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import { getSupabaseAccessToken, supabase } from '@/lib/supabase-client/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AdminAnalytics } from '@/components/admin/admin-analytics';
import { ConexAccessControl } from '@/components/admin/conex-access-control';
import { ConexUserManagement } from '@/components/admin/conex-user-management';
import { readUserCache, writeUserCache } from '@/lib/cache/user-cache';
import { useDelayedLoadingState } from '@/hooks/use-delayed-loading-state';
import { AdminPageSkeleton, SlowNetworkNotice } from '@/components/skeletons/page-skeletons';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { useFeatureFlags } from '@/components/feature-flag-provider';
import {
  buildPromoCopy,
  DEFAULT_PROMO_CONTENT_CONFIG,
  formatPromoEndsAtLabel,
  normalizePromoContentConfig,
  toPromoContentDraft,
  validatePromoContentDraft,
  type PromoContentDraft,
} from '@/lib/conex/promo-content';
import {
  formatPlanLabel,
  orderPlanKeys,
  parsePlanLimitsPayload,
  sanitizeLimitInput,
  toPlanLimitDraftByPlan,
  validatePlanLimitDraft,
  type PlanLimitDraftByPlan,
  type PlanLimitsByPlan,
} from '@/lib/conex/plan-management';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROMO_CONTENT_FLAG_KEY = 'promo_content';
const FALLBACK_PLAN_KEYS = ['free', 'pro', 'premium'] as const;
const LIMIT_FIELDS: Array<{ key: string; label: string; description: string }> = [
  { key: 'max_file_mb', label: 'Max file size (MB)', description: 'Per-file upload size limit.' },
  { key: 'max_uploads_total', label: 'Max uploads total', description: 'Total uploads allowed for the account.' },
  { key: 'max_docs_total', label: 'Max documents total', description: 'Total documents stored for the account.' },
  { key: 'max_chats_total', label: 'Max chats total', description: 'Total chat messages allowed.' },
  { key: 'max_exams_total', label: 'Max exams total', description: 'Total generated exams allowed.' },
  { key: 'max_tokens_total', label: 'Max tokens total', description: 'Total token budget for AI usage.' },
  { key: 'max_storage_mb', label: 'Max storage (MB)', description: 'Storage cap across all uploaded files.' },
  { key: 'max_jobs_concurrent', label: 'Max concurrent jobs', description: 'Maximum simultaneous ingestion jobs.' },
];
const LIMIT_FIELD_KEYS = LIMIT_FIELDS.map((field) => field.key);

// Admin Dashboard Components
const AdminBilling = ({ token }: { token: string }) => {
  const [config, setConfig] = useState<any>({});
  const [planLimitsByPlan, setPlanLimitsByPlan] = useState<PlanLimitsByPlan>({});
  const [planLimitDraftByPlan, setPlanLimitDraftByPlan] = useState<PlanLimitDraftByPlan>({});
  const [planOptions, setPlanOptions] = useState<string[]>([...FALLBACK_PLAN_KEYS]);
  const [selectedPlan, setSelectedPlan] = useState<string>('free');
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingPlanLimits, setSavingPlanLimits] = useState(false);
  const [savingPromoContent, setSavingPromoContent] = useState(false);
  const [flagQuery, setFlagQuery] = useState('');
  const [flagCategory, setFlagCategory] = useState('all');
  const [modelRoutingDebug, setModelRoutingDebug] = useState<any>(null);
  const [promoDraft, setPromoDraft] = useState<PromoContentDraft>(() => toPromoContentDraft(DEFAULT_PROMO_CONTENT_CONFIG));
  const { toast } = useToast();
  const { records: featureFlagRecords, setFlag, refreshFlags } = useFeatureFlags();
  const isFetchingRef = useRef(false);
  const limitDirtyRef = useRef(false);
  const promoDirtyRef = useRef(false);
  const limitsSaveVersionRef = useRef(0);

  const normalizeConexConfig = useCallback((raw: any) => ({
    ...raw,
    global_chat_enabled: raw?.global_chat_enabled !== false,
    premium_models_enabled: raw?.premium_models_enabled !== false,
    premium_models_paid_only: raw?.premium_models_paid_only !== false,
    paid_mode_enabled: raw?.paid_mode_enabled === true,
    stripe_live_mode: raw?.stripe_live_mode === true,
    stripe_price_weekly:
      typeof raw?.stripe_price_weekly === 'string'
        ? raw.stripe_price_weekly
        : (typeof raw?.stripe_price_weekly_id === 'string' ? raw.stripe_price_weekly_id : ''),
    stripe_price_monthly:
      typeof raw?.stripe_price_monthly === 'string'
        ? raw.stripe_price_monthly
        : (typeof raw?.stripe_price_monthly_id === 'string' ? raw.stripe_price_monthly_id : ''),
  }), []);

  const fetchConfig = useCallback(async (opts?: { silent?: boolean }) => {
    if (isFetchingRef.current) {
      return;
    }
    isFetchingRef.current = true;
    if (!opts?.silent) {
      setLoading(true);
    }

    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_conex_config' })
      });
      if (res.ok) {
        setConfig(normalizeConexConfig((res as any).config || {}));
      }

      const planLimitsRes = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_plan_limits' })
      });
      if (planLimitsRes.ok) {
        const payload = (planLimitsRes as any).data || (planLimitsRes as any);
        const parsed = parsePlanLimitsPayload(payload, LIMIT_FIELD_KEYS);
        const fallbackLimitsByPlan: PlanLimitsByPlan = {};
        for (const plan of FALLBACK_PLAN_KEYS) {
          fallbackLimitsByPlan[plan] = parsed.limitsByPlan[plan] || Object.fromEntries(
            LIMIT_FIELD_KEYS.map((key) => [key, null]),
          );
        }
        const mergedLimitsByPlan =
          Object.keys(parsed.limitsByPlan).length > 0
            ? parsed.limitsByPlan
            : fallbackLimitsByPlan;
        const planKeys = orderPlanKeys(
          Object.keys(mergedLimitsByPlan).length > 0
            ? Object.keys(mergedLimitsByPlan)
            : [...FALLBACK_PLAN_KEYS],
        );

        if (!opts?.silent || !limitDirtyRef.current) {
          setPlanLimitsByPlan(mergedLimitsByPlan);
          setPlanLimitDraftByPlan(toPlanLimitDraftByPlan(mergedLimitsByPlan, LIMIT_FIELD_KEYS));
          setPlanOptions(planKeys);
          setSelectedPlan((current) => (planKeys.includes(current) ? current : (planKeys[0] || 'free')));
        }
      }

      const accessToken = await getSupabaseAccessToken();
      if (accessToken) {
        const debugRes = await fetch('/api/admin/model-routing', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          credentials: 'include',
        });
        if (debugRes.ok) {
          const debugPayload = await debugRes.json().catch(() => null);
          setModelRoutingDebug(debugPayload);
        }
      }

    } catch (e: any) {
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [normalizeConexConfig, toast]);

  useEffect(() => { void fetchConfig(); }, [fetchConfig]);

  useEffect(() => {
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (refreshTimeout !== null) {
        return;
      }
      refreshTimeout = setTimeout(() => {
        refreshTimeout = null;
        void fetchConfig({ silent: true });
      }, 150);
    };

    const channel = supabase
      .channel('conex-billing-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'au_conex_config' },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feature_flags' },
        () => {
          scheduleRefresh();
          void refreshFlags();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'au_config' },
        scheduleRefresh,
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[AdminBilling] realtime sync degraded; fallback refresh will continue.');
          scheduleRefresh();
        }
      });

    return () => {
      if (refreshTimeout !== null) {
        clearTimeout(refreshTimeout);
      }
      void supabase.removeChannel(channel);
    };
  }, [fetchConfig, refreshFlags]);

  const setFeatureFlag = useCallback(async (key: string, nextEnabled: boolean) => {
    const row = featureFlagRecords[key];
    try {
      await setFlag(key, nextEnabled, {
        category: row?.category || 'billing',
        description: row?.description || '',
        scope: row?.scope || 'global',
        config: row?.config || {},
      });
      toast({ title: 'Updated', description: `${key} is now ${nextEnabled ? 'enabled' : 'disabled'}.` });
    } catch (e: any) {
      toast({ title: 'Flag update failed', description: e?.message || String(e), variant: 'destructive' });
    }
  }, [featureFlagRecords, setFlag, toast]);

  const persistedPromoConfig = useMemo(
    () => normalizePromoContentConfig(featureFlagRecords[PROMO_CONTENT_FLAG_KEY]?.config || {}),
    [featureFlagRecords],
  );
  const promoPreview = useMemo(() => {
    const validated = validatePromoContentDraft(promoDraft);
    const endsLabel = formatPromoEndsAtLabel(validated.config.promoEndsAtLagosIso);
    return buildPromoCopy(validated.config, endsLabel);
  }, [promoDraft]);

  useEffect(() => {
    if (promoDirtyRef.current) return;
    setPromoDraft(toPromoContentDraft(persistedPromoConfig));
  }, [persistedPromoConfig]);

  const handleSave = async (newConfig: any) => {
    setSavingConfig(true);
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'update_conex_config', config: newConfig })
      });
      if (res.ok) {
          toast({ title: 'Saved', description: 'Billing configuration updated.' });
          setConfig(normalizeConexConfig(newConfig));
          void fetchConfig({ silent: true });
      }
    } catch (e: any) {
        toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
        setSavingConfig(false);
    }
  };

  const updateSelectedPlanLimit = useCallback((limitKey: string, rawValue: string) => {
    const sanitized = sanitizeLimitInput(rawValue);
    limitDirtyRef.current = true;

    setPlanLimitDraftByPlan((prev) => {
      const currentPlanDraft = { ...(prev[selectedPlan] || {}) };
      currentPlanDraft[limitKey] = sanitized;
      return {
        ...prev,
        [selectedPlan]: currentPlanDraft,
      };
    });

    setPlanLimitsByPlan((prev) => {
      const currentPlanLimits = { ...(prev[selectedPlan] || {}) };
      currentPlanLimits[limitKey] = sanitized === '' ? null : Number(sanitized);
      return {
        ...prev,
        [selectedPlan]: currentPlanLimits,
      };
    });
  }, [selectedPlan]);

  const saveSelectedPlanLimits = useCallback(async () => {
    const validation = validatePlanLimitDraft(planLimitDraftByPlan, selectedPlan, LIMIT_FIELD_KEYS);
    if (!validation.ok) {
      toast({
        title: 'Validation failed',
        description: validation.errors[0] || 'Please use non-negative integer values only.',
        variant: 'destructive',
      });
      return;
    }

    const nextLimits = {
      ...(planLimitsByPlan[selectedPlan] || {}),
      ...validation.limits,
    };

    setPlanLimitsByPlan((prev) => ({
      ...prev,
      [selectedPlan]: nextLimits,
    }));
    setPlanLimitDraftByPlan((prev) => ({
      ...prev,
      [selectedPlan]: {
        ...(prev[selectedPlan] || {}),
        ...validation.sanitizedDraft,
      },
    }));

    const saveVersion = ++limitsSaveVersionRef.current;
    setSavingPlanLimits(true);
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_plan_limits',
          plan: selectedPlan,
          limits: nextLimits,
        }),
      });
      if (!res.ok) {
        const payload = (res as any).data || {};
        throw new Error(payload?.error || payload?.message || `Failed to save ${selectedPlan} limits`);
      }
      if (saveVersion === limitsSaveVersionRef.current) {
        limitDirtyRef.current = false;
        toast({
          title: 'Saved',
          description: `${formatPlanLabel(selectedPlan)} limits updated.`,
        });
        void fetchConfig({ silent: true });
      }
    } catch (e: any) {
      toast({
        title: 'Save failed',
        description: e?.message || String(e),
        variant: 'destructive',
      });
    } finally {
      if (saveVersion === limitsSaveVersionRef.current) {
        setSavingPlanLimits(false);
      }
    }
  }, [fetchConfig, planLimitDraftByPlan, planLimitsByPlan, selectedPlan, toast]);

  const savePromoContent = useCallback(async () => {
    const validated = validatePromoContentDraft(promoDraft);
    if (!validated.ok) {
      toast({
        title: 'Validation failed',
        description: validated.errors[0] || 'Please review promo content fields.',
        variant: 'destructive',
      });
      return;
    }

    const record = featureFlagRecords[PROMO_CONTENT_FLAG_KEY];
    setSavingPromoContent(true);
    try {
      await setFlag(PROMO_CONTENT_FLAG_KEY, true, {
        category: record?.category || 'billing',
        description: record?.description || 'Editable promotional banner copy and pricing metadata.',
        scope: record?.scope || 'global',
        config: validated.config,
      });
      promoDirtyRef.current = false;
      setPromoDraft(toPromoContentDraft(validated.config));
      toast({
        title: 'Saved',
        description: 'Promotional message updated and synced.',
      });
    } catch (e: any) {
      toast({
        title: 'Save failed',
        description: e?.message || String(e),
        variant: 'destructive',
      });
    } finally {
      setSavingPromoContent(false);
    }
  }, [featureFlagRecords, promoDraft, setFlag, toast]);

  useEffect(() => {
    const timer = setInterval(() => {
      void fetchConfig({ silent: true });
    }, 45000);

    return () => {
      clearInterval(timer);
    };
  }, [fetchConfig]);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  const allFlags = Object.values(featureFlagRecords).sort((a, b) => a.key.localeCompare(b.key));
  const flagCategories = Array.from(new Set(allFlags.map((f) => (f.category || 'general').trim().toLowerCase())))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const filteredFlags = allFlags.filter((flag) => {
    const category = (flag.category || 'general').trim().toLowerCase();
    if (flagCategory !== 'all' && category !== flagCategory) return false;
    const haystack = `${flag.key} ${flag.description} ${category} ${flag.scope}`.toLowerCase();
    return haystack.includes(flagQuery.trim().toLowerCase());
  });

  const premiumEnabled = featureFlagRecords.premium_models_enabled?.enabled ?? true;
  const premiumPaidOnly = featureFlagRecords.premium_models_paid_only?.enabled ?? true;
  const billingEnabled = featureFlagRecords.billing_enabled?.enabled ?? !!config.billing_enabled;
  const promoEnabled = featureFlagRecords.promo_enabled?.enabled ?? false;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
        <Tabs defaultValue="config">
            <TabsList>
                <TabsTrigger value="config">Configuration</TabsTrigger>
                <TabsTrigger value="payments">Manual Payments</TabsTrigger>
            </TabsList>

            <TabsContent value="config">
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-medium">Billing Controls</h3>
                        <Button onClick={() => handleSave(config)} disabled={savingConfig}>
                            {savingConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save Non-Flag Config
                        </Button>
                    </div>

                    <div className="grid gap-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Plan & Premium</CardTitle>
                                <CardDescription>Primary plan switches and premium behavior controls.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                      <Label>Billing Enabled</Label>
                                      <p className="text-xs text-muted-foreground">Master monetization switch.</p>
                                    </div>
                                    <Switch checked={billingEnabled} onCheckedChange={(c) => void setFeatureFlag('billing_enabled', c)} />
                                </div>
                                <div className="flex items-center justify-between p-4 border rounded-lg bg-amber-50 dark:bg-amber-900/10">
                                    <div>
                                      <Label className="text-amber-900 dark:text-amber-200 font-bold">Promo Mode</Label>
                                      <p className="text-xs text-amber-700 dark:text-amber-300">Promo and billing are mutually exclusive. Enabling promo forces billing off.</p>
                                    </div>
                                    <Switch checked={promoEnabled} onCheckedChange={(c) => void setFeatureFlag('promo_enabled', c)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <div>
                                      <Label>Premium Models Enabled</Label>
                                      <p className="text-xs text-muted-foreground">Master switch for premium model availability.</p>
                                    </div>
                                    <Switch checked={premiumEnabled} onCheckedChange={(c) => void setFeatureFlag('premium_models_enabled', c)} />
                                </div>
                                <div className="flex items-center justify-between">
                                    <div>
                                      <Label>Premium Models Paid Only</Label>
                                      <p className="text-xs text-muted-foreground">Restrict premium models to paid plans.</p>
                                    </div>
                                    <Switch
                                      checked={premiumPaidOnly}
                                      disabled={!premiumEnabled}
                                      onCheckedChange={(c) => void setFeatureFlag('premium_models_paid_only', c)}
                                    />
                                </div>
                                <div className="flex items-center justify-between p-4 border rounded-lg bg-blue-50 dark:bg-blue-900/10">
                                    <div>
                                        <Label className="text-blue-900 dark:text-blue-200 font-bold">Paid Mode Enabled</Label>
                                        <p className="text-xs text-blue-700 dark:text-blue-300">Force paid model path and key routing.</p>
                                    </div>
                                    <Switch checked={featureFlagRecords.paid_mode_enabled?.enabled ?? false} onCheckedChange={(c) => void setFeatureFlag('paid_mode_enabled', c)} />
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Promo Content</CardTitle>
                                <CardDescription>
                                  Edit the promotional copy shown across upgrade and subscription UI. Use placeholders:
                                  {' '}
                                  <code>{'{effectiveDate}'}</code>, <code>{'{monthlyPrice}'}</code>, <code>{'{weeklyPrice}'}</code>, <code>{'{promoEndsAt}'}</code>, <code>{'{timezone}'}</code>.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2 md:col-span-2">
                                  <Label>Intro text</Label>
                                  <Input
                                    value={promoDraft.introText}
                                    onChange={(e) => {
                                      promoDirtyRef.current = true;
                                      setPromoDraft((prev) => ({ ...prev, introText: e.target.value }));
                                    }}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Effective date label</Label>
                                  <Input
                                    value={promoDraft.effectiveDateLabel}
                                    onChange={(e) => {
                                      promoDirtyRef.current = true;
                                      setPromoDraft((prev) => ({ ...prev, effectiveDateLabel: e.target.value }));
                                    }}
                                    placeholder="April 2nd, 2026"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Promo ends at (ISO-like)</Label>
                                  <Input
                                    value={promoDraft.promoEndsAtLagosIso}
                                    onChange={(e) => {
                                      promoDirtyRef.current = true;
                                      setPromoDraft((prev) => ({ ...prev, promoEndsAtLagosIso: e.target.value }));
                                    }}
                                    placeholder="2026-04-02T00:00:00+01:00"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Monthly price (NGN)</Label>
                                  <Input
                                    inputMode="numeric"
                                    value={promoDraft.monthlyPriceNgn}
                                    onChange={(e) => {
                                      promoDirtyRef.current = true;
                                      setPromoDraft((prev) => ({ ...prev, monthlyPriceNgn: sanitizeLimitInput(e.target.value) }));
                                    }}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Weekly price (NGN)</Label>
                                  <Input
                                    inputMode="numeric"
                                    value={promoDraft.weeklyPriceNgn}
                                    onChange={(e) => {
                                      promoDirtyRef.current = true;
                                      setPromoDraft((prev) => ({ ...prev, weeklyPriceNgn: sanitizeLimitInput(e.target.value) }));
                                    }}
                                  />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                  <Label>Timezone label</Label>
                                  <Input
                                    value={promoDraft.timezoneLabel}
                                    onChange={(e) => {
                                      promoDirtyRef.current = true;
                                      setPromoDraft((prev) => ({ ...prev, timezoneLabel: e.target.value }));
                                    }}
                                    placeholder="Africa/Lagos"
                                  />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                  <Label>Pricing template</Label>
                                  <Textarea
                                    value={promoDraft.pricingTemplate}
                                    onChange={(e) => {
                                      promoDirtyRef.current = true;
                                      setPromoDraft((prev) => ({ ...prev, pricingTemplate: e.target.value }));
                                    }}
                                    rows={2}
                                  />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                  <Label>Ending template</Label>
                                  <Textarea
                                    value={promoDraft.endsTemplate}
                                    onChange={(e) => {
                                      promoDirtyRef.current = true;
                                      setPromoDraft((prev) => ({ ...prev, endsTemplate: e.target.value }));
                                    }}
                                    rows={2}
                                  />
                                </div>
                              </div>

                              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                                <p className="font-semibold">{promoPreview.intro}</p>
                                <p className="text-muted-foreground">{promoPreview.pricing}</p>
                                <p className="text-xs text-muted-foreground">{promoPreview.ending}</p>
                              </div>

                              <div className="flex justify-end">
                                <Button onClick={() => void savePromoContent()} disabled={savingPromoContent}>
                                  {savingPromoContent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                  Save Promo Content
                                </Button>
                              </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Model Routing</CardTitle>
                                <CardDescription>Tier-aware OpenRouter routing controls.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between rounded-lg border p-4">
                                    <div>
                                      <Label>Tier Split Enabled</Label>
                                      <p className="text-xs text-muted-foreground">
                                        OFF: everyone uses paid models. ON: free users use free models, Pro users use paid models.
                                      </p>
                                    </div>
                                    <Switch
                                      checked={featureFlagRecords['model_routing.tier_split_enabled']?.enabled ?? false}
                                      onCheckedChange={(c) => void setFeatureFlag('model_routing.tier_split_enabled', c)}
                                    />
                                </div>
                                <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/30">
                                    <div>
                                      <Label>Paid Default Enabled</Label>
                                      <p className="text-xs text-muted-foreground">Safety default: paid routing when tier split is OFF.</p>
                                    </div>
                                    <Switch
                                      checked={featureFlagRecords['model_routing.paid_default_enabled']?.enabled ?? true}
                                      disabled
                                    />
                                </div>
                                <div className="rounded-lg border p-4 text-xs text-muted-foreground space-y-1">
                                  <p className="font-medium text-foreground">Latest Routed Model (Debug)</p>
                                  <p>
                                    Service: <span className="font-mono">{modelRoutingDebug?.latest?.service || 'n/a'}</span>
                                  </p>
                                  <p>
                                    Model: <span className="font-mono">{modelRoutingDebug?.latest?.model || 'n/a'}</span>
                                  </p>
                                  <p>
                                    Tier: <span className="font-mono">{modelRoutingDebug?.latest?.tier_wanted || 'n/a'}</span>
                                  </p>
                                  <p>
                                    At: <span className="font-mono">{modelRoutingDebug?.latest?.created_at || 'n/a'}</span>
                                  </p>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Limits & Usage Caps</CardTitle>
                                <CardDescription>Edit fixed plan caps. Set a value to <span className="font-semibold">0</span> for unlimited.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div className="w-full md:w-56">
                                  <Label className="mb-2 block">Plan</Label>
                                  <Select value={selectedPlan} onValueChange={(value) => setSelectedPlan(value)}>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {planOptions.map((plan) => (
                                        <SelectItem key={plan} value={plan}>{formatPlanLabel(plan)}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <Button onClick={() => void saveSelectedPlanLimits()} disabled={savingPlanLimits}>
                                  {savingPlanLimits ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                  Save {formatPlanLabel(selectedPlan)} Limits
                                </Button>
                              </div>

                              <div className="grid gap-4 md:grid-cols-2">
                                {LIMIT_FIELDS.map((field) => {
                                  const value = String(planLimitDraftByPlan[selectedPlan]?.[field.key] ?? '');
                                  const numericValue = Number(value);
                                  const isUnlimited = !value || (Number.isFinite(numericValue) && numericValue <= 0);
                                  return (
                                    <div key={field.key} className="rounded-md border p-3 space-y-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <div>
                                          <Label>{field.label}</Label>
                                          <p className="text-xs text-muted-foreground">{field.description}</p>
                                        </div>
                                        <Badge variant={isUnlimited ? 'secondary' : 'outline'}>
                                          {isUnlimited ? 'Unlimited' : 'Capped'}
                                        </Badge>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <Input
                                          inputMode="numeric"
                                          value={value}
                                          onChange={(e) => updateSelectedPlanLimit(field.key, e.target.value)}
                                          placeholder="0"
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Billing Feature Flags</CardTitle>
                                <CardDescription>Search and manage all feature flags in real time.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid gap-3 md:grid-cols-[1fr_220px]">
                                  <Input
                                    placeholder="Search flags by key, description, scope..."
                                    value={flagQuery}
                                    onChange={(e) => setFlagQuery(e.target.value)}
                                  />
                                  <Select value={flagCategory} onValueChange={setFlagCategory}>
                                    <SelectTrigger>
                                      <SelectValue placeholder="All categories" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="all">All categories</SelectItem>
                                      {flagCategories.map((category) => (
                                        <SelectItem key={category} value={category}>{category}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="space-y-2">
                                  {filteredFlags.length === 0 && (
                                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                                      No flags match your filter.
                                    </div>
                                  )}
                                  {filteredFlags.map((flag) => (
                                    <div key={flag.key} className="rounded-md border p-4">
                                      <div className="flex items-start justify-between gap-4">
                                        <div className="space-y-1">
                                          <div className="font-medium">{flag.key}</div>
                                          <p className="text-xs text-muted-foreground">{flag.description || 'No description.'}</p>
                                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                            <Badge variant="outline">{flag.category || 'general'}</Badge>
                                            <Badge variant="outline">{flag.scope}</Badge>
                                            <span>Updated {new Date(flag.updated_at).toLocaleString()}</span>
                                          </div>
                                        </div>
                                        <Switch
                                          checked={flag.enabled}
                                          onCheckedChange={(next) => void setFeatureFlag(flag.key, next)}
                                        />
                                      </div>
                                    </div>
                                  ))}
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
                                    <Switch checked={featureFlagRecords.stripe_live_mode?.enabled ?? !!config.stripe_live_mode} onCheckedChange={(c) => void setFeatureFlag('stripe_live_mode', c)} />
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

const AdminManualPayments = (_props: { token: string }) => {
    const [transactions, setTransactions] = useState<any[]>([]);
    const [subscriptions, setSubscriptions] = useState<any[]>([]);
    const [entitlementAudit, setEntitlementAudit] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const fetchPayments = useCallback(async () => {
        setLoading(true);
        try {
            const accessToken = await getSupabaseAccessToken();
            if (!accessToken) {
              throw new Error('Missing access token');
            }
            const res = await fetch('/api/admin/billing/overview', {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
              credentials: 'include',
            });
            const payload = await res.json().catch(() => null);
            if (!res.ok) {
              throw new Error(payload?.message || payload?.error || `Request failed (${res.status})`);
            }
            setTransactions(Array.isArray(payload?.transactions) ? payload.transactions : []);
            setSubscriptions(Array.isArray(payload?.subscriptions) ? payload.subscriptions : []);
            setEntitlementAudit(Array.isArray(payload?.entitlementAudit) ? payload.entitlementAudit : []);
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: 'Failed to load billing overview.', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { void fetchPayments(); }, [fetchPayments]);

    const renderStatus = (statusRaw: string) => {
        const status = String(statusRaw || '').toLowerCase();
        if (status === 'success' || status === 'active') {
          return <Badge className="bg-green-600 hover:bg-green-600">{status}</Badge>;
        }
        if (status === 'failed' || status === 'canceled' || status === 'rejected') {
          return <Badge variant="destructive">{status}</Badge>;
        }
        return <Badge variant="secondary">{status || 'pending'}</Badge>;
    };

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => void fetchPayments()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh
                </Button>
            </div>

            <Tabs defaultValue="manual">
                <TabsList>
                    <TabsTrigger value="manual">Transactions</TabsTrigger>
                    <TabsTrigger value="card">Subscriptions</TabsTrigger>
                    <TabsTrigger value="audit">Entitlement Audit</TabsTrigger>
                </TabsList>

                <TabsContent value="manual">
                    <Card>
                        <CardHeader>
                            <CardTitle>Transactions</CardTitle>
                            <CardDescription>Automated payment records (no manual approval flow).</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted">
                                        <tr>
                                            <th className="p-3 text-left">Date</th>
                                            <th className="p-3 text-left">User ID</th>
                                            <th className="p-3 text-left">Reference</th>
                                            <th className="p-3 text-left">Amount</th>
                                            <th className="p-3 text-left">Channel</th>
                                            <th className="p-3 text-left">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {transactions.length === 0 ? (
                                            <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No transactions found.</td></tr>
                                        ) : (
                                            transactions.map((payment) => {
                                                return (
                                                    <tr key={payment.reference} className="border-t hover:bg-muted/30">
                                                        <td className="p-3 whitespace-nowrap">{new Date(payment.created_at).toLocaleDateString()}</td>
                                                        <td className="p-3 font-mono text-xs">{payment.user_id || '-'}</td>
                                                        <td className="p-3 font-mono text-xs">{payment.reference}</td>
                                                        <td className="p-3 font-bold">N{Math.round(Number(payment.amount_kobo || 0) / 100).toLocaleString()}</td>
                                                        <td className="p-3">{payment.channel || '-'}</td>
                                                        <td className="p-3">{renderStatus(String(payment.status || 'pending'))}</td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="card">
                    <Card>
                        <CardHeader>
                            <CardTitle>Subscriptions</CardTitle>
                            <CardDescription>Auto-renew status and renewal window.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted">
                                        <tr>
                                            <th className="p-3 text-left">Updated</th>
                                            <th className="p-3 text-left">User ID</th>
                                            <th className="p-3 text-left">Plan</th>
                                            <th className="p-3 text-left">Period</th>
                                            <th className="p-3 text-left">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {subscriptions.length === 0 ? (
                                            <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No subscriptions found.</td></tr>
                                        ) : (
                                            subscriptions.map((subscription) => {
                                                return (
                                                    <tr key={`${subscription.user_id}-${subscription.updated_at}`} className="border-t hover:bg-muted/30">
                                                        <td className="p-3 whitespace-nowrap">{new Date(subscription.updated_at).toLocaleDateString()}</td>
                                                        <td className="p-3 font-mono text-xs">{subscription.user_id}</td>
                                                        <td className="p-3">{subscription.plan_key}</td>
                                                        <td className="p-3 text-xs">
                                                          {subscription.starts_at || '-'}<br />
                                                          {subscription.ends_at || '-'}
                                                        </td>
                                                        <td className="p-3">{renderStatus(String(subscription.status || 'active'))}</td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="audit">
                    <Card>
                        <CardHeader>
                            <CardTitle>Entitlement Audit</CardTitle>
                            <CardDescription>Server-side entitlement transitions.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted">
                                        <tr>
                                            <th className="p-3 text-left">Time</th>
                                            <th className="p-3 text-left">User ID</th>
                                            <th className="p-3 text-left">Action</th>
                                            <th className="p-3 text-left">Source</th>
                                            <th className="p-3 text-left">Trace</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {entitlementAudit.length === 0 ? (
                                            <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No entitlement audit rows found.</td></tr>
                                        ) : (
                                            entitlementAudit.map((row) => (
                                                <tr key={`${row.trace_id || row.created_at}-${row.user_id}`} className="border-t hover:bg-muted/30">
                                                    <td className="p-3 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                                                    <td className="p-3 font-mono text-xs">{row.user_id}</td>
                                                    <td className="p-3">{row.action}</td>
                                                    <td className="p-3">{row.source}</td>
                                                    <td className="p-3 font-mono text-xs">{row.trace_id || '-'}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
};

const AdminUsage = ({ token }: { token: string }) => {
  const [usage, setUsage] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalCalls: 0, failedCalls: 0, successfulCalls: 0 });
  const [usageSource, setUsageSource] = useState<'au_model_usage' | 'au_events_fallback' | 'au_messages_fallback'>('au_model_usage');
  const [loading, setLoading] = useState(true);
  const [totalUsers, setTotalUsers] = useState(0);
  const [isUsingCachedData, setIsUsingCachedData] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const { toast } = useToast();
  const { isOnline } = useNetworkStatus();
  const [user] = useSupabaseUser();

  const readUsageCache = useCallback(async () => {
    if (!user?.id) return { data: null as any, cachedAt: null as number | null };
    return readUserCache<any>({
      userId: user.id,
      route: '/conex',
      source: 'admin-usage',
      endpoint: 'get_usage',
      schemaVersion: 1,
      maxAgeMs: 1000 * 60 * 10,
    });
  }, [user?.id]);

  const writeUsageCache = useCallback(async (payload: any) => {
    if (!user?.id) return;
    await writeUserCache({
      userId: user.id,
      route: '/conex',
      source: 'admin-usage',
      endpoint: 'get_usage',
      schemaVersion: 1,
      ttlMs: 1000 * 60 * 10,
      data: payload,
    });
  }, [user?.id]);

  const applyPayload = useCallback((payload: any, options?: { fromCache?: boolean; cachedAt?: number | null }) => {
    setUsage(Array.isArray(payload?.usage) ? payload.usage : []);
    setStats(
      payload?.stats || {
        totalCalls: 0,
        failedCalls: 0,
        successfulCalls: 0,
      },
    );
    setUsageSource(
      (payload?.usageSource === 'au_events_fallback' || payload?.usageSource === 'au_messages_fallback'
        ? payload.usageSource
        : 'au_model_usage') as any
    );
    setTotalUsers(Number(payload?.totalUsers || 0));
    if (options?.fromCache) {
      setIsUsingCachedData(true);
      setCachedAt(options.cachedAt ?? null);
    } else {
      setIsUsingCachedData(false);
      setCachedAt(Date.now());
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (!isOnline) {
        const cached = await readUsageCache();
        if (cached.data) {
          applyPayload(cached.data, { fromCache: true, cachedAt: cached.cachedAt });
        }
        return;
      }

      // Fetch Usage using the centralized fetchAdmin utility
      const usageRes = await fetchAdmin('admin-handler', {
        method: 'POST',
        headers: { 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'get_usage' })
      });
      if (!usageRes.ok) {
        throw new Error((usageRes as any).error || 'Failed to load usage');
      }

      const payload = {
        usage: (usageRes as any).usage || [],
        stats: (usageRes as any).stats || {
          totalCalls: 0,
          failedCalls: 0,
          successfulCalls: 0,
        },
        totalUsers: Number((usageRes as any).totalUsers || 0),
      };
      applyPayload(payload);
      void writeUsageCache(payload);
    } catch (e) {
      const cached = await readUsageCache();
      if (cached.data) {
        applyPayload(cached.data, { fromCache: true, cachedAt: cached.cachedAt });
      } else {
        console.error('[AdminUsage] fetch error:', e);
        const message =
          e instanceof Error && e.message.toLowerCase().includes('unauthorized')
            ? 'Session expired. Please sign in again, then re-open Conex.'
            : 'Failed to load usage dashboard.';
        toast({ title: 'Error', description: message, variant: 'destructive' });
      }
    } finally {
      setLoading(false);
    }
  }, [applyPayload, isOnline, readUsageCache, toast, token, writeUsageCache]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const { showSkeleton, showSlowNotice } = useDelayedLoadingState(loading);
  if (loading && showSkeleton && usage.length === 0) return <AdminPageSkeleton />;

  return (
    <div className="space-y-6">
      {showSlowNotice && loading ? <SlowNetworkNotice onRetry={() => void fetchData()} /> : null}
      {isUsingCachedData && !isOnline ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-2 text-xs text-blue-900 dark:border-blue-500/40 dark:bg-blue-950/30 dark:text-blue-100">
          Offline - showing cached admin usage data{cachedAt ? ` from ${new Date(cachedAt).toLocaleString()}` : ''}.
        </div>
      ) : null}
      {usageSource !== 'au_model_usage' ? (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-50 px-4 py-2 text-xs text-yellow-900 dark:bg-yellow-900/20 dark:text-yellow-100">
          Usage fallback active: {usageSource === 'au_events_fallback' ? 'event stream' : 'message history'}.
        </div>
      ) : null}

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
  const [diagnostics, setDiagnostics] = useState<any>({});
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
        const payload = (res as any).data || res;
        setKeys((payload as any).keys || []);
        setModels((payload as any).models || []);
        setRegistrySource(((payload as any).registrySource === 'pro' ? 'pro' : 'free') as any);
        setDiagnostics((payload as any).diagnostics || {});
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
    <div className="space-y-4">
      {(diagnostics?.keysTableMissing || diagnostics?.modelsTableMissing) ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Registry Fallback Active</AlertTitle>
          <AlertDescription>
            {diagnostics?.keysTableMissing ? 'API keys table is missing. ' : ''}
            {diagnostics?.modelsTableMissing ? 'Model registry table is missing. ' : ''}
            Run Conex admin migrations in Supabase to make updates persistent.
          </AlertDescription>
        </Alert>
      ) : null}

      {Number(diagnostics?.seededModels || 0) > 0 || Number(diagnostics?.seededKeys || 0) > 0 ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Registry Auto-Healed</AlertTitle>
          <AlertDescription>
            Seeded {Number(diagnostics?.seededKeys || 0)} key entries and {Number(diagnostics?.seededModels || 0)} model entries.
          </AlertDescription>
        </Alert>
      ) : null}

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
            {keys.length === 0 ? (
                <div className="rounded-lg border p-3 text-xs text-muted-foreground">
                    No API keys found.
                </div>
            ) : null}
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
                                 {models.length === 0 ? (
                                    <tr>
                                      <td colSpan={5} className="p-6 text-center text-muted-foreground">
                                        No models found for this registry.
                                      </td>
                                    </tr>
                                 ) : null}
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
  const [activeUsers, setActiveUsers] = useState(0);
  const [windowMinutes, setWindowMinutes] = useState(15);
  const [activitySource, setActivitySource] = useState<'au_events' | 'au_user_activity'>('au_events');
  const [eventsTableMissing, setEventsTableMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_active_users' }),
      });
      if (res.ok) {
        const payload = (res as any).data || res;
        const nextEvents = Array.isArray((payload as any).events) ? (payload as any).events : [];
        setEvents(nextEvents);
        setWindowMinutes(Number((payload as any).windowMinutes || 15));
        setActivitySource(((payload as any).source === 'au_user_activity' ? 'au_user_activity' : 'au_events') as any);
        setEventsTableMissing(Boolean((payload as any)?.diagnostics?.eventsTableMissing));
        const countedActiveUsers = Number((payload as any).activeUsers || 0);
        if (countedActiveUsers > 0) {
          setActiveUsers(countedActiveUsers);
        } else {
          setActiveUsers(new Set(nextEvents.map((entry: any) => entry?.user_id).filter(Boolean)).size);
        }
      }
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
          <span className="text-sm font-medium">
            {isLive
              ? `Live Monitoring (${activitySource === 'au_user_activity' ? 'Activity Heartbeats' : 'Supabase Events'})`
              : 'Monitoring Paused'}
          </span>
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
              <p className="text-xl font-bold">{windowMinutes}m</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {eventsTableMissing ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Events Table Fallback Active</AlertTitle>
          <AlertDescription>
            Live activity is currently sourced from user heartbeats because `au_events` is unavailable.
          </AlertDescription>
        </Alert>
      ) : null}

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
                  <td className="p-2 text-xs font-medium">{new Date(e.timestamp || e.created_at).toLocaleTimeString()}</td>
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
  const [tableMissing, setTableMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetchAdmin('admin-handler', {
        method: 'POST',
        body: JSON.stringify({ action: 'get_alert_config' })
      });
      if (res.ok) {
        const payload = (res as any).data || res;
        setConfigs(Array.isArray((payload as any).configs) ? (payload as any).configs : []);
        setTableMissing(Boolean((payload as any)?.diagnostics?.tableMissing));
      }
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
      {tableMissing ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Email Alert Storage Not Ready</AlertTitle>
          <AlertDescription>
            Showing in-memory fallback alerts. Run the Conex admin SQL migration to persist changes.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4">
        {configs.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No alert rules found.
            </CardContent>
          </Card>
        ) : null}
        {configs.map((c) => (
          <Card key={c.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-md font-bold uppercase tracking-wider">{c.event_type.replace(/_/g, ' ')}</CardTitle>
                <Switch 
                  checked={c.is_enabled} 
                  onCheckedChange={(val) => handleUpdate({ ...c, is_enabled: val })}
                  disabled={Boolean(c._readonly_fallback)}
                />
              </div>
              <CardDescription>Automatic email alerts for this system event.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Recipients (Comma Separated)</Label>
                <div className="flex gap-2">
                  <Input 
                    value={Array.isArray(c.recipients) ? c.recipients.join(', ') : ''} 
                    onChange={(e) => {
                      const next = [...configs];
                      const idx = next.findIndex(item => item.id === c.id);
                      next[idx].recipients = e.target.value.split(',').map(r => r.trim()).filter(Boolean);
                      setConfigs(next);
                    }}
                    placeholder="admin@datacube.au, dev@datacube.au"
                    disabled={Boolean(c._readonly_fallback)}
                  />
                  <Button size="sm" onClick={() => handleUpdate(c)} disabled={Boolean(c._readonly_fallback)}>
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
  const [details, setDetails] = useState<Record<string, string | null>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
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
      if (res.ok) {
        const payload = (res as any).data || res;
        setResults((payload as any).results || {});
        setDetails((payload as any).details || {});
        setCounts((payload as any).counts || {});
      }
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
        const payload = (res as any).data || res;
        if ((payload as any).warning) {
          toast({
            title: 'Reload Warning',
            description: String((payload as any).warning),
            variant: 'destructive',
          });
        } else {
          toast({ title: 'Success', description: 'Schema reload signal sent. Tables should appear shortly.' });
        }
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
            <div className="flex flex-col gap-1">
              <span className="font-mono text-sm">{table}</span>
              {typeof counts[table] === 'number' ? (
                <span className="text-xs text-muted-foreground">rows: {counts[table]}</span>
              ) : null}
              {details[table] ? (
                <span className="text-xs text-yellow-600 dark:text-yellow-300">{details[table]}</span>
              ) : null}
            </div>
            <div>
              {exists ? (
                <Badge className="bg-green-100 text-green-700 hover:bg-green-100 gap-1"><CheckCircle2 className="h-3 w-3" /> Ready</Badge>
              ) : (
                <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Not Found (404)</Badge>
              )}
            </div>
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
        if (!savedToken || savedToken === 'undefined' || !UUID_REGEX.test(savedToken)) {
          resetConexAuth({ message: 'Session expired. Please log in again.' });
          return;
        }
        setAdminToken(savedToken);
        setStep(3);
        return;
      }

      if (savedStep === '2') {
        if (!savedSession || savedSession === 'undefined' || !UUID_REGEX.test(savedSession)) {
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
        if (!UUID_REGEX.test(nextSessionId)) {
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
    if (!sessionId || sessionId === 'undefined' || !UUID_REGEX.test(sessionId)) {
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
        if (!UUID_REGEX.test(nextAdminToken)) {
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
