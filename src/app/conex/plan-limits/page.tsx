'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { fetchAdmin } from '@/lib/api/admin-fetch';
import { sanitizeLimitInput } from '@/lib/conex/plan-management';
import {
  APPROVED_LIMIT_KEYS,
  DEFAULT_PLAN_ORDER,
  PLAN_LIMIT_SCOPE_KEYS,
  describePlanLimitMode,
  describePlanLimitResetLabel,
  type ApprovedLimitKey,
  type EffectivePlanCode,
  type PlanLimitScopeKey,
} from '@/lib/limits/plan-limit-model';
import { getSupabaseAccessToken } from '@/lib/supabase-client/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORY_ORDER = ['usage_counter', 'stored_item', 'per_request', 'runtime'] as const;

type RuleDraft = {
  inheritsDefault: boolean;
  value: string;
  state: 'capped' | 'unlimited' | 'disabled';
  mode: 'usage' | 'current' | 'per_request' | 'concurrency';
  reset_policy: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'never' | 'custom';
  reset_interval_value: string;
  reset_interval_unit: 'hour' | 'day' | 'week' | 'month';
};

type ScopeDrafts = Record<PlanLimitScopeKey, Record<ApprovedLimitKey, RuleDraft>>;
type RuleErrors = Partial<Record<ApprovedLimitKey, string[]>>;

type LimitDefinition = {
  key: ApprovedLimitKey;
  label: string;
  description: string;
  unit_label: string;
  category: 'usage_counter' | 'stored_item' | 'per_request' | 'runtime';
  default_mode: RuleDraft['mode'];
  supported_modes: RuleDraft['mode'][];
  default_reset_policy: RuleDraft['reset_policy'];
  supported_reset_policies: RuleDraft['reset_policy'][];
  enforced_by: string[];
};

type SerializedRule = {
  key: ApprovedLimitKey;
  label: string;
  description: string;
  unit_label: string;
  category: LimitDefinition['category'];
  value: number | null;
  mode: RuleDraft['mode'];
  reset_policy: RuleDraft['reset_policy'];
  reset_interval_value: number | null;
  reset_interval_unit: RuleDraft['reset_interval_unit'] | null;
  is_enabled: boolean;
  is_unlimited: boolean;
  state: RuleDraft['state'];
  inherited?: boolean;
  source_scope?: PlanLimitScopeKey;
  updated_at: string | null;
  enforced_by: string[];
  presentation?: {
    cap_label?: string;
    mode_label?: string;
    reset_label?: string;
    reset_description?: string;
    summary?: string;
  };
};

type UsageByLimitEntry = {
  key: ApprovedLimitKey;
  used: number;
  limit: number | null;
  remaining: number | null;
  state: RuleDraft['state'];
  mode: RuleDraft['mode'];
  label: string;
  description: string;
  category: LimitDefinition['category'];
  reset: {
    policy: RuleDraft['reset_policy'];
    intervalValue: number | null;
    intervalUnit: RuleDraft['reset_interval_unit'] | null;
    window_start: string;
    window_end: string | null;
    label: string;
  };
};

type AdminPlanLimitsPayload = {
  ok?: boolean;
  source?: string;
  generatedAt?: string;
  scopeLabels?: Record<PlanLimitScopeKey, string>;
  limitDefinitions?: LimitDefinition[];
  defaultRules?: Record<ApprovedLimitKey, SerializedRule>;
  storedRulesByScope?: Record<PlanLimitScopeKey, Record<ApprovedLimitKey, SerializedRule | null>>;
  effectiveRulesByPlan?: Record<EffectivePlanCode, Record<ApprovedLimitKey, SerializedRule>>;
  validationErrors?: RuleErrors;
};

type PreviewPayload = {
  ok?: boolean;
  plan?: EffectivePlanCode;
  user_id?: string | null;
  user_found?: boolean;
  planPolicy?: {
    plan: EffectivePlanCode;
    label: string;
    description: string;
    limits: Record<ApprovedLimitKey, number>;
    limit_rules: Record<ApprovedLimitKey, SerializedRule>;
    resetLabels: Record<ApprovedLimitKey, string>;
  };
  effectiveLimitRules?: Record<ApprovedLimitKey, SerializedRule>;
  usage?: {
    by_limit?: Record<ApprovedLimitKey, UsageByLimitEntry>;
  };
};

const CATEGORY_DESCRIPTIONS: Record<(typeof CATEGORY_ORDER)[number], string> = {
  usage_counter: 'Counts new actions inside a reset window and enforces the cap before the next request is accepted.',
  stored_item: 'Caps the current stored item count. Deleting stored items frees capacity immediately.',
  per_request: 'Validates each request independently. These limits do not use scheduled resets.',
  runtime: 'Caps live concurrent work. These limits are checked against the current system state, not a quota window.',
};

const SCOPE_DESCRIPTIONS: Record<PlanLimitScopeKey, string> = {
  default: 'Global baseline rules stored in the backend. Plans inherit these values unless a plan-specific override exists.',
  free: 'Optional override for Free only. Turn on inherit to remove the override and use the default rule.',
  pro: 'Optional override for Pro only. Turn on inherit to remove the override and use the default rule.',
  premium: 'Optional override for Premium only. Turn on inherit to remove the override and use the default rule.',
};

function readPayload<T>(response: Response): T {
  const payload = (response as any)?.data;
  return (payload && typeof payload === 'object' ? payload : {}) as T;
}

async function readResponsePayload<T>(response: Response): Promise<T> {
  const direct = readPayload<T>(response);
  if (direct && typeof direct === 'object' && Object.keys(direct as Record<string, unknown>).length > 0) {
    return direct;
  }

  try {
    const clone = response.clone();
    const json = await clone.json();
    return (json && typeof json === 'object' ? json : {}) as T;
  } catch {
    return {} as T;
  }
}

function readErrorMessage(payload: any, fallback: string) {
  const message = payload?.message || payload?.error;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
}

function formatScope(scope: string) {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

function formatTime(value: string | null | undefined) {
  if (!value) return 'Not saved yet';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : 'Not saved yet';
}

function getRulePresentation(rule: SerializedRule | null | undefined) {
  return rule?.presentation || null;
}

function getRuleCapLabel(rule: SerializedRule | null | undefined) {
  return String(getRulePresentation(rule)?.cap_label || '').trim();
}

function getRuleModeResetText(rule: SerializedRule | null | undefined) {
  return [
    String(getRulePresentation(rule)?.mode_label || '').trim(),
    String(getRulePresentation(rule)?.reset_label || '').trim(),
  ].filter(Boolean).join(' / ');
}

function getRuleSummaryText(rule: SerializedRule | null | undefined) {
  const presentation = getRulePresentation(rule);
  const summary = String(presentation?.summary || '').trim();
  if (summary) return summary;
  return [
    String(presentation?.cap_label || '').trim(),
    String(presentation?.mode_label || '').trim(),
    String(presentation?.reset_label || '').trim(),
  ].filter(Boolean).join(' / ');
}

function getRuleResetText(rule: SerializedRule | null | undefined, usageEntry?: UsageByLimitEntry | null) {
  const usageLabel = String(usageEntry?.reset?.label || '').trim();
  if (usageLabel) return usageLabel;
  const presentation = getRulePresentation(rule);
  return String(presentation?.reset_description || presentation?.reset_label || '').trim();
}

function categoryLabel(category: string) {
  if (category === 'usage_counter') return 'Usage Counters';
  if (category === 'stored_item') return 'Current Count Caps';
  if (category === 'per_request') return 'Per Request';
  return 'Runtime Caps';
}

function modeLabel(mode: string) {
  return describePlanLimitMode(mode as RuleDraft['mode']);
}

function resetLabel(policy: string) {
  if (policy === 'custom') return 'Custom interval';
  return describePlanLimitResetLabel({
    resetPolicy: policy as RuleDraft['reset_policy'],
    resetIntervalValue: null,
    resetIntervalUnit: null,
  });
}

function stateLabel(state: RuleDraft['state']) {
  if (state === 'unlimited') return 'Unlimited';
  if (state === 'disabled') return 'Disabled';
  return 'Capped';
}

function modeHelp(mode: RuleDraft['mode']) {
  if (mode === 'current') return 'Uses the current stored item count instead of a rolling quota window.';
  if (mode === 'per_request') return 'Validated independently on each request.';
  if (mode === 'concurrency') return 'Checked against live concurrent jobs.';
  return 'Counts new usage events inside the selected reset window.';
}

function resetHelp(policy: RuleDraft['reset_policy']) {
  if (policy === 'never') return 'No scheduled reset. The limit only changes when usage drops or the cap is edited.';
  if (policy === 'custom') return 'Uses the custom interval value and unit below.';
  return `Resets on a ${resetLabel(policy).toLowerCase()} schedule.`;
}

function sourceLabel(source: string | undefined) {
  if (source === 'au_plan_limit_rules') return 'Canonical rules table';
  if (source === 'legacy_plan_limits') return 'Seeded from legacy plan limits';
  if (source === 'seed_defaults') return 'Seed defaults';
  return 'Unknown source';
}

function serializeDraftForScope(scope: PlanLimitScopeKey, draft: RuleDraft) {
  return JSON.stringify({
    inheritsDefault: scope !== 'default' ? draft.inheritsDefault : false,
    value: draft.value,
    state: draft.state,
    mode: draft.mode,
    reset_policy: draft.reset_policy,
    reset_interval_value: draft.reset_interval_value,
    reset_interval_unit: draft.reset_interval_unit,
  });
}

function getApplicableResetPolicies(definition: LimitDefinition, draft: RuleDraft) {
  if (draft.mode !== 'usage') return ['never'] as RuleDraft['reset_policy'][];
  return definition.supported_reset_policies;
}

function formatScopeList(plans: EffectivePlanCode[]) {
  if (plans.length === 0) return 'None';
  return plans.map((plan) => formatScope(plan)).join(', ');
}

function buildDrafts(payload: AdminPlanLimitsPayload): ScopeDrafts {
  return PLAN_LIMIT_SCOPE_KEYS.reduce((scopeAcc, scope) => {
    scopeAcc[scope] = APPROVED_LIMIT_KEYS.reduce((ruleAcc, key) => {
      const storedRule = payload?.storedRulesByScope?.[scope]?.[key] || null;
      const effectiveRule =
        scope === 'default' ? payload?.defaultRules?.[key] : payload?.effectiveRulesByPlan?.[scope]?.[key];
      const rule = storedRule || effectiveRule;
      ruleAcc[key] = {
        inheritsDefault: scope !== 'default' && !storedRule,
        value: rule?.value === null || rule?.value === undefined ? '' : String(rule.value),
        state: rule?.state || 'capped',
        mode: rule?.mode || 'usage',
        reset_policy: rule?.reset_policy || 'never',
        reset_interval_value:
          rule?.reset_interval_value === null || rule?.reset_interval_value === undefined
            ? ''
            : String(rule.reset_interval_value),
        reset_interval_unit: rule?.reset_interval_unit || 'day',
      };
      return ruleAcc;
    }, {} as Record<ApprovedLimitKey, RuleDraft>);
    return scopeAcc;
  }, {} as ScopeDrafts);
}

function LimitBar({ label, used, limit, reset }: { label: string; used: number; limit: number | null; reset?: string }) {
  const percent = limit && limit > 0 ? Math.max(0, Math.min(100, (used / limit) * 100)) : 0;
  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {limit === null ? `${used} / Unlimited` : `${used} / ${limit}`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      {reset ? <p className="text-[11px] text-muted-foreground">{reset}</p> : null}
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
  const [resetting, setResetting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [payload, setPayload] = useState<AdminPlanLimitsPayload | null>(null);
  const [drafts, setDrafts] = useState<ScopeDrafts | null>(null);
  const [selectedScope, setSelectedScope] = useState<PlanLimitScopeKey>('default');
  const [previewPlan, setPreviewPlan] = useState<EffectivePlanCode>('free');
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewUserInput, setPreviewUserInput] = useState('');
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [ruleErrors, setRuleErrors] = useState<RuleErrors>({});

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (isUserLoading) return;
      if (!user) {
        router.replace('/login?redirectTo=/conex/plan-limits');
        return;
      }
      const access = await getSupabaseAccessToken();
      if (!access) {
        router.replace('/login?redirectTo=/conex/plan-limits');
        return;
      }
      const res = await fetch('/conex/users?mode=access', {
        method: 'GET',
        headers: { Authorization: `Bearer ${access}` },
        cache: 'no-store',
      }).catch(() => null);
      if (cancelled) return;
      if (!res?.ok) {
        router.replace(res?.status === 403 ? '/403' : '/conex');
        return;
      }
      setCheckingAccess(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isUserLoading, router, user]);

  const definitions = useMemo(() => {
    const incoming = Array.isArray(payload?.limitDefinitions) ? payload.limitDefinitions : [];
    return APPROVED_LIMIT_KEYS.map((key) => incoming.find((entry) => entry.key === key)).filter(Boolean) as LimitDefinition[];
  }, [payload]);

  const definitionsByKey = useMemo(
    () =>
      definitions.reduce((acc, definition) => {
        acc[definition.key] = definition;
        return acc;
      }, {} as Record<ApprovedLimitKey, LimitDefinition>),
    [definitions],
  );

  const groupedDefinitions = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        items: definitions.filter((definition) => definition.category === category),
      })).filter((group) => group.items.length > 0),
    [definitions],
  );

  const savedDrafts = useMemo(() => (payload ? buildDrafts(payload) : null), [payload]);
  const selectedDrafts = drafts?.[selectedScope] || null;
  const selectedSavedDrafts = savedDrafts?.[selectedScope] || null;
  const selectedScopeLabel = payload?.scopeLabels?.[selectedScope] || formatScope(selectedScope);
  const selectedStoredRules = payload?.storedRulesByScope?.[selectedScope] || null;
  const selectedEffectiveRules =
    selectedScope === 'default' ? payload?.defaultRules || null : payload?.effectiveRulesByPlan?.[selectedScope] || null;

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedDrafts || !selectedSavedDrafts) return false;
    return APPROVED_LIMIT_KEYS.some(
      (key) =>
        serializeDraftForScope(selectedScope, selectedDrafts[key]) !==
        serializeDraftForScope(selectedScope, selectedSavedDrafts[key]),
    );
  }, [selectedDrafts, selectedSavedDrafts, selectedScope]);

  const previewRules = preview?.effectiveLimitRules || payload?.effectiveRulesByPlan?.[previewPlan] || null;
  const previewUsageByLimit = (preview?.usage?.by_limit || {}) as Partial<Record<ApprovedLimitKey, UsageByLimitEntry>>;

  const applyToPlans = useCallback(
    (scope: PlanLimitScopeKey, key: ApprovedLimitKey) => {
      if (!payload?.effectiveRulesByPlan) return [];
      if (scope === 'default') {
        return DEFAULT_PLAN_ORDER.filter((plan) => payload.effectiveRulesByPlan?.[plan]?.[key]?.source_scope === 'default');
      }
      return payload.effectiveRulesByPlan?.[scope]?.[key]?.source_scope === scope ? [scope] : [];
    },
    [payload],
  );

  const loadState = useCallback(
    async (opts?: { silent?: boolean; showSuccess?: boolean }) => {
      if (opts?.silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setLoadError(null);

      try {
        const res = await fetchAdmin('/api/admin/plan-limits', { method: 'GET' });
        const nextPayload = await readResponsePayload<AdminPlanLimitsPayload>(res);
        if (!res.ok || !nextPayload?.ok) {
          throw new Error(readErrorMessage(nextPayload, `plan-limits failed (${res.status})`));
        }
        setPayload(nextPayload);
        setDrafts(buildDrafts(nextPayload));
        setRuleErrors({});
        if (opts?.showSuccess) {
          setStatusMessage({ tone: 'success', text: 'Plan limits reloaded from the backend source of truth.' });
        }
      } catch (error: any) {
        const message = String(error?.message || error);
        setLoadError(message);
        setStatusMessage({ tone: 'error', text: message });
        toast({ title: 'Failed to load plan limits', description: message, variant: 'destructive' });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [toast],
  );

  const loadPreview = useCallback(
    async (plan: EffectivePlanCode, userId: string | null, opts?: { silent?: boolean }) => {
      setPreviewLoading(true);
      try {
        const params = new URLSearchParams({ plan });
        if (userId) params.set('user_id', userId);
        const res = await fetchAdmin(`/api/admin/limits/preview?${params.toString()}`, { method: 'GET' });
        const nextPreview = await readResponsePayload<PreviewPayload>(res);
        if (!res.ok || !nextPreview?.ok) {
          throw new Error(readErrorMessage(nextPreview, `limits-preview failed (${res.status})`));
        }
        setPreview(nextPreview);
      } catch (error: any) {
        const message = String(error?.message || error);
        if (!opts?.silent) {
          toast({ title: 'Preview unavailable', description: message, variant: 'destructive' });
        }
      } finally {
        setPreviewLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!checkingAccess) {
      void loadState();
    }
  }, [checkingAccess, loadState]);

  useEffect(() => {
    if (!checkingAccess && payload) {
      void loadPreview(previewPlan, previewUserId, { silent: true });
    }
  }, [checkingAccess, loadPreview, payload, previewPlan, previewUserId]);

  useEffect(() => {
    setRuleErrors({});
  }, [selectedScope]);

  useEffect(() => {
    if (selectedScope !== 'default') {
      setPreviewPlan(selectedScope);
    }
  }, [selectedScope]);

  const updateDraft = useCallback(
    (key: ApprovedLimitKey, patch: Partial<RuleDraft>) => {
      const definition = definitionsByKey[key];
      if (!definition) return;

      setDrafts((current) => {
        if (!current) return current;
        const existing = current[selectedScope][key];
        const nextRule: RuleDraft = { ...existing, ...patch };

        if (patch.mode && patch.mode !== 'usage') {
          nextRule.reset_policy = 'never';
          nextRule.reset_interval_value = '';
          nextRule.reset_interval_unit = 'day';
        }

        if (patch.reset_policy && patch.reset_policy !== 'custom') {
          nextRule.reset_interval_value = '';
          nextRule.reset_interval_unit = 'day';
        }

        if (patch.reset_policy === 'custom' && !nextRule.reset_interval_value) {
          nextRule.reset_interval_value = '1';
        }

        const allowedResetPolicies = getApplicableResetPolicies(definition, nextRule);
        if (!allowedResetPolicies.includes(nextRule.reset_policy)) {
          nextRule.reset_policy = allowedResetPolicies[0] || 'never';
          if (nextRule.reset_policy !== 'custom') {
            nextRule.reset_interval_value = '';
            nextRule.reset_interval_unit = 'day';
          }
        }

        return {
          ...current,
          [selectedScope]: {
            ...current[selectedScope],
            [key]: nextRule,
          },
        };
      });

      setRuleErrors((current) => {
        if (!current[key]?.length) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    },
    [definitionsByKey, selectedScope],
  );

  const discardScopeChanges = useCallback(() => {
    if (!selectedSavedDrafts) return;
    setDrafts((current) => {
      if (!current) return current;
      return {
        ...current,
        [selectedScope]: APPROVED_LIMIT_KEYS.reduce((acc, key) => {
          acc[key] = { ...selectedSavedDrafts[key] };
          return acc;
        }, {} as Record<ApprovedLimitKey, RuleDraft>),
      };
    });
    setRuleErrors({});
    setStatusMessage({ tone: 'success', text: `${selectedScopeLabel} changes discarded.` });
  }, [selectedSavedDrafts, selectedScope, selectedScopeLabel]);

  const saveScope = useCallback(async () => {
    if (!selectedDrafts) return;

    setSaving(true);
    setStatusMessage(null);
    setRuleErrors({});

    try {
      const rule_inputs = APPROVED_LIMIT_KEYS.reduce((acc, key) => {
        const draft = selectedDrafts[key];
        acc[key] = {
          inheritsDefault: selectedScope !== 'default' ? draft.inheritsDefault : false,
          value: draft.state === 'capped' ? (draft.value === '' ? null : Number(draft.value)) : null,
          mode: draft.mode,
          state: draft.state,
          reset_policy: draft.reset_policy,
          reset_interval_value: draft.reset_policy === 'custom' ? Number(draft.reset_interval_value || 0) : null,
          reset_interval_unit: draft.reset_policy === 'custom' ? draft.reset_interval_unit : null,
        };
        return acc;
      }, {} as Record<ApprovedLimitKey, Record<string, unknown>>);

      const res = await fetchAdmin('/api/admin/plan-limits', {
        method: 'POST',
        body: JSON.stringify({
          scope: selectedScope,
          action: 'save',
          rule_inputs,
        }),
      });

      const nextPayload = await readResponsePayload<AdminPlanLimitsPayload>(res);
      if (!res.ok || !nextPayload?.ok) {
        if (nextPayload?.validationErrors) {
          setRuleErrors(nextPayload.validationErrors);
        }
        throw new Error(readErrorMessage(nextPayload, `Failed to save ${selectedScopeLabel}.`));
      }

      setPayload(nextPayload);
      setDrafts(buildDrafts(nextPayload));
      setRuleErrors({});
      setStatusMessage({ tone: 'success', text: `${selectedScopeLabel} rules saved to the backend source of truth.` });
      toast({ title: 'Saved', description: `${selectedScopeLabel} rules updated.` });
      await loadPreview(previewPlan, previewUserId, { silent: true });
    } catch (error: any) {
      const message = String(error?.message || error);
      setStatusMessage({ tone: 'error', text: message });
      toast({ title: 'Save failed', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [loadPreview, previewPlan, previewUserId, selectedDrafts, selectedScope, selectedScopeLabel, toast]);

  const resetScope = useCallback(async () => {
    setResetting(true);
    setStatusMessage(null);
    setRuleErrors({});

    try {
      const res = await fetchAdmin('/api/admin/plan-limits', {
        method: 'POST',
        body: JSON.stringify({
          scope: selectedScope,
          action: 'reset_scope',
        }),
      });
      const nextPayload = await readResponsePayload<AdminPlanLimitsPayload>(res);
      if (!res.ok || !nextPayload?.ok) {
        throw new Error(readErrorMessage(nextPayload, `Failed to reset ${selectedScopeLabel}.`));
      }

      setPayload(nextPayload);
      setDrafts(buildDrafts(nextPayload));
      setRuleErrors({});
      setStatusMessage({
        tone: 'success',
        text:
          selectedScope === 'default'
            ? 'Default scope restored to the canonical baseline.'
            : `${selectedScopeLabel} overrides removed. Effective values now inherit from Default where no override remains.`,
      });
      toast({ title: 'Scope reset', description: `${selectedScopeLabel} restored.` });
      await loadPreview(previewPlan, previewUserId, { silent: true });
    } catch (error: any) {
      const message = String(error?.message || error);
      setStatusMessage({ tone: 'error', text: message });
      toast({ title: 'Reset failed', description: message, variant: 'destructive' });
    } finally {
      setResetting(false);
    }
  }, [loadPreview, previewPlan, previewUserId, selectedScope, selectedScopeLabel, toast]);

  const refreshAll = useCallback(async () => {
    await loadState({ silent: true, showSuccess: true });
    await loadPreview(previewPlan, previewUserId, { silent: true });
  }, [loadPreview, loadState, previewPlan, previewUserId]);

  if (isUserLoading || checkingAccess) {
    return (
      <div className="min-h-screen p-4 md:p-8">
        <Skeleton className="mx-auto h-96 max-w-7xl" />
      </div>
    );
  }

  function renderRuleCard(key: ApprovedLimitKey) {
    const definition = definitionsByKey[key];
    const draft = selectedDrafts?.[key];
    const storedRule = selectedStoredRules?.[key] || null;
    const effectiveRule = selectedEffectiveRules?.[key] || null;

    if (!definition || !draft || !effectiveRule) return null;

    const appliedPlans = applyToPlans(selectedScope, key);
    const supportedResetPolicies = getApplicableResetPolicies(definition, draft);
    const disableFields = selectedScope !== 'default' && draft.inheritsDefault;

    return (
      <div key={key} className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{key}</Badge>
              <Badge variant="secondary">{categoryLabel(definition.category)}</Badge>
              <Badge variant={draft.state === 'disabled' ? 'destructive' : 'outline'}>{stateLabel(draft.state)}</Badge>
              {selectedScope === 'default' ? (
                <Badge variant="secondary">Default Rule</Badge>
              ) : (
                <Badge variant={draft.inheritsDefault ? 'secondary' : 'outline'}>
                  {draft.inheritsDefault ? 'Inherits Default' : 'Plan Override'}
                </Badge>
              )}
            </div>
            <div>
              <h3 className="text-base font-semibold">{definition.label}</h3>
              <p className="text-sm text-muted-foreground">{definition.description}</p>
            </div>
          </div>

          <div className="min-w-[220px] rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Effective now</p>
            <p>{getRuleCapLabel(effectiveRule) || 'Unavailable'}</p>
            <p>{getRuleModeResetText(effectiveRule)}</p>
            <p>
              Source: {formatScope(effectiveRule.source_scope || selectedScope)}
              {effectiveRule.inherited ? ' (inherited)' : ''}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {selectedScope === 'default' ? (
            <div className="space-y-2 rounded-xl border border-dashed p-4">
              <p className="text-sm font-medium">Applies to plans</p>
              <p className="text-xs text-muted-foreground">
                Currently effective on: {appliedPlans.length > 0 ? formatScopeList(appliedPlans) : 'No plan currently inherits this default for this key.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border border-dashed p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="text-sm font-medium">Inherit from Default</Label>
                  <p className="text-xs text-muted-foreground">
                    When enabled, this plan stores no override for this key and resolves from Default.
                  </p>
                </div>
                <Switch checked={draft.inheritsDefault} onCheckedChange={(checked) => updateDraft(key, { inheritsDefault: checked })} />
              </div>
            </div>
          )}

          <div className="space-y-2 rounded-xl border border-dashed p-4">
            <p className="text-sm font-medium">Enforced by</p>
            <p className="text-xs text-muted-foreground">{definition.enforced_by.join(', ')}</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>Value</Label>
            <Input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              disabled={disableFields || draft.state !== 'capped'}
              value={draft.value}
              onChange={(event) => updateDraft(key, { value: sanitizeLimitInput(event.target.value) })}
            />
            <p className="text-[11px] text-muted-foreground">Whole numbers only. Unit: {definition.unit_label || 'items'}.</p>
          </div>

          <div className="space-y-2">
            <Label>Limit State</Label>
            <Select value={draft.state} onValueChange={(value) => updateDraft(key, { state: value as RuleDraft['state'] })} disabled={disableFields}>
              <SelectTrigger>
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="capped">Capped</SelectItem>
                <SelectItem value="unlimited">Unlimited</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Choose whether the rule is capped, unlimited, or disabled.</p>
          </div>

          <div className="space-y-2">
            <Label>Mode</Label>
            <Select
              value={draft.mode}
              onValueChange={(value) => updateDraft(key, { mode: value as RuleDraft['mode'] })}
              disabled={disableFields || definition.supported_modes.length === 1}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent>
                {definition.supported_modes.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {modeLabel(mode)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{modeHelp(draft.mode)}</p>
          </div>

          <div className="space-y-2">
            <Label>Reset Policy</Label>
            <Select
              value={draft.reset_policy}
              onValueChange={(value) => updateDraft(key, { reset_policy: value as RuleDraft['reset_policy'] })}
              disabled={disableFields || supportedResetPolicies.length === 1}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select reset policy" />
              </SelectTrigger>
              <SelectContent>
                {supportedResetPolicies.map((policy) => (
                  <SelectItem key={policy} value={policy}>
                    {resetLabel(policy)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{resetHelp(draft.reset_policy)}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <Label>Custom Interval</Label>
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              disabled={disableFields || draft.reset_policy !== 'custom'}
              value={draft.reset_interval_value}
              onChange={(event) => updateDraft(key, { reset_interval_value: sanitizeLimitInput(event.target.value) })}
            />
            <p className="text-[11px] text-muted-foreground">Required only when reset policy is custom.</p>
          </div>

          <div className="space-y-2">
            <Label>Custom Interval Unit</Label>
            <Select
              value={draft.reset_interval_unit}
              onValueChange={(value) => updateDraft(key, { reset_interval_unit: value as RuleDraft['reset_interval_unit'] })}
              disabled={disableFields || draft.reset_policy !== 'custom'}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select interval unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hour">Hours</SelectItem>
                <SelectItem value="day">Days</SelectItem>
                <SelectItem value="week">Weeks</SelectItem>
                <SelectItem value="month">Months</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">Use this only for a production-safe custom reset window.</p>
          </div>

          <div className="space-y-2 rounded-xl border bg-muted/20 p-4 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Applies to plans:</span>{' '}
              {selectedScope === 'default'
                ? appliedPlans.length > 0
                  ? formatScopeList(appliedPlans)
                  : 'No plan currently inherits this default for this key.'
                : draft.inheritsDefault
                  ? `${formatScope(selectedScope)} inherits Default`
                  : formatScope(selectedScope)}
            </p>
            <p>
              <span className="font-medium text-foreground">Last updated:</span> {formatTime((storedRule || effectiveRule)?.updated_at)}
            </p>
            <p>
              <span className="font-medium text-foreground">Stored value:</span>{' '}
              {storedRule ? (getRuleCapLabel(storedRule) || 'Unavailable') : 'No stored override'}
            </p>
          </div>
        </div>

        {ruleErrors[key]?.length ? (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>{definition.label} has validation errors</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-5">
                {ruleErrors[key]?.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">Plan Limits</h1>
              <Badge variant="outline">{sourceLabel(payload?.source)}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Canonical plan-limit rules with explicit value, mode, reset policy, inheritance, and enforcement metadata.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => router.push('/conex')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Conex
            </Button>
            <Button variant="outline" onClick={() => void refreshAll()} disabled={loading || refreshing}>
              {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </div>

        {statusMessage ? (
          <Alert variant={statusMessage.tone === 'error' ? 'destructive' : 'default'}>
            {statusMessage.tone === 'success' ? <CheckCircle2 className="h-4 w-4" /> : null}
            <AlertTitle>{statusMessage.tone === 'success' ? 'Backend state updated' : 'Plan limits error'}</AlertTitle>
            <AlertDescription>{statusMessage.text}</AlertDescription>
          </Alert>
        ) : null}

        {loadError ? (
          <Alert variant="destructive">
            <AlertTitle>Failed to load plan-limit state</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => void loadState()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Source of Truth</CardTitle>
              <CardDescription>The page reads live backend rules and writes back to the same canonical table.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Current source: <span className="font-medium text-foreground">{sourceLabel(payload?.source)}</span>
              </p>
              <p>
                Generated: <span className="font-medium text-foreground">{formatTime(payload?.generatedAt)}</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scope Model</CardTitle>
              <CardDescription>Default defines the baseline. Free, Pro, and Premium store overrides only when they differ.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Selected scope: <span className="font-medium text-foreground">{selectedScopeLabel}</span>
              </p>
              <p>{SCOPE_DESCRIPTIONS[selectedScope]}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Runtime Preview</CardTitle>
              <CardDescription>Live preview uses the same backend rule resolution and usage aggregation as production enforcement.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Preview plan: <span className="font-medium text-foreground">{formatScope(previewPlan)}</span>
              </p>
              <p>
                Preview user: <span className="font-medium text-foreground">{previewUserId || 'Policy only'}</span>
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Scope Editor</CardTitle>
                <CardDescription>
                  Edit the real stored rules for each scope. Refresh always reloads backend truth; save writes to the canonical table.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <Tabs value={selectedScope} onValueChange={(value) => setSelectedScope(value as PlanLimitScopeKey)}>
                  <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${PLAN_LIMIT_SCOPE_KEYS.length}, minmax(0, 1fr))` }}>
                    {PLAN_LIMIT_SCOPE_KEYS.map((scope) => (
                      <TabsTrigger key={scope} value={scope}>
                        {payload?.scopeLabels?.[scope] || formatScope(scope)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>

                <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">{selectedScopeLabel}</p>
                  <p>{SCOPE_DESCRIPTIONS[selectedScope]}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void saveScope()} disabled={loading || saving || resetting || !selectedDrafts}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Scope
                  </Button>
                  <Button variant="outline" onClick={() => void resetScope()} disabled={loading || saving || resetting || !payload}>
                    {resetting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    {selectedScope === 'default' ? 'Restore Baseline' : 'Reset Overrides'}
                  </Button>
                  <Button variant="ghost" onClick={discardScopeChanges} disabled={!hasUnsavedChanges || loading || saving || resetting}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Discard
                  </Button>
                </div>
              </CardContent>
            </Card>

            {loading || !payload || !selectedDrafts ? (
              <Card>
                <CardHeader>
                  <CardTitle>Loading plan rules...</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </CardContent>
              </Card>
            ) : (
              groupedDefinitions.map((group) => (
                <Card key={group.category}>
                  <CardHeader>
                    <CardTitle>{categoryLabel(group.category)}</CardTitle>
                    <CardDescription>{CATEGORY_DESCRIPTIONS[group.category]}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">{group.items.map((definition) => renderRuleCard(definition.key))}</CardContent>
                </Card>
              ))
            )}

            <Card>
              <CardHeader>
                <CardTitle>Effective Plan Matrix</CardTitle>
                <CardDescription>Default scope plus the effective Free, Pro, and Premium rules after inheritance and overrides resolve.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Limit</TableHead>
                      <TableHead>Default</TableHead>
                      <TableHead>Free</TableHead>
                      <TableHead>Pro</TableHead>
                      <TableHead>Premium</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {APPROVED_LIMIT_KEYS.map((key) => {
                      const defaultRule = payload?.defaultRules?.[key];
                      return (
                        <TableRow key={key}>
                          <TableCell className="align-top">
                            <div className="space-y-1">
                              <p className="font-medium">{definitionsByKey[key]?.label || key}</p>
                              <p className="text-xs text-muted-foreground">{key}</p>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            {defaultRule ? (
                              <div className="space-y-1 text-xs">
                                <p className="font-medium text-foreground">{getRuleCapLabel(defaultRule) || 'Unavailable'}</p>
                                <p className="text-muted-foreground">{getRuleModeResetText(defaultRule)}</p>
                              </div>
                            ) : (
                              'N/A'
                            )}
                          </TableCell>
                          {DEFAULT_PLAN_ORDER.map((plan) => {
                            const rule = payload?.effectiveRulesByPlan?.[plan]?.[key];
                            return (
                              <TableCell key={`${plan}-${key}`} className="align-top">
                                {rule ? (
                                  <div className="space-y-1 text-xs">
                                    <p className="font-medium text-foreground">{getRuleCapLabel(rule) || 'Unavailable'}</p>
                                    <p className="text-muted-foreground">{getRuleModeResetText(rule)}</p>
                                    <p className="text-muted-foreground">
                                      {rule.inherited ? `Inherits ${formatScope(rule.source_scope || 'default')}` : `${formatScope(plan)} override`}
                                    </p>
                                  </div>
                                ) : (
                                  'N/A'
                                )}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Live Preview
                </CardTitle>
                <CardDescription>Reads the same effective rule set and usage snapshot used by production enforcement.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label>Preview plan</Label>
                    <Select value={previewPlan} onValueChange={(value) => setPreviewPlan(value as EffectivePlanCode)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select plan" />
                      </SelectTrigger>
                      <SelectContent>
                        {DEFAULT_PLAN_ORDER.map((plan) => (
                          <SelectItem key={plan} value={plan}>
                            {formatScope(plan)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Preview user usage (UUID)</Label>
                    <div className="flex gap-2">
                      <Input value={previewUserInput} onChange={(event) => setPreviewUserInput(event.target.value.trim())} placeholder="user_id" />
                      <Button
                        variant="outline"
                        onClick={() => {
                          const value = previewUserInput.trim();
                          if (!value) {
                            setPreviewUserId(null);
                            return;
                          }
                          if (!UUID_REGEX.test(value)) {
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
                          setPreviewUserInput('');
                          setPreviewUserId(null);
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Leave empty to preview policy-only effective values with zero usage.</p>
                  </div>
                </div>

                {previewLoading && !preview ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                ) : (
                  <>
                    <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
                      <p>
                        Plan: <span className="font-medium text-foreground">{preview?.planPolicy?.label || formatScope(previewPlan)}</span>
                      </p>
                      <p>
                        User:{' '}
                        <span className="font-medium text-foreground">
                          {previewUserId ? (preview?.user_found ? previewUserId : `${previewUserId} (not found)`) : 'Policy only'}
                        </span>
                      </p>
                    </div>

                    <div className="space-y-3">
                      {APPROVED_LIMIT_KEYS.map((key) => {
                        const usageEntry = previewUsageByLimit[key];
                        const rule = previewRules?.[key];
                        if (!rule) return null;
                        return (
                          <LimitBar
                            key={key}
                            label={rule.label}
                            used={Number(usageEntry?.used || 0)}
                            limit={typeof usageEntry?.limit === 'number' || usageEntry?.limit === null ? usageEntry.limit : rule.value}
                            reset={getRuleResetText(rule, usageEntry)}
                          />
                        );
                      })}
                    </div>

                    <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">Effective rule summary</p>
                      <div className="mt-2 space-y-2">
                        {APPROVED_LIMIT_KEYS.map((key) => {
                          const rule = previewRules?.[key];
                          if (!rule) return null;
                          return (
                            <p key={key}>
                              <span className="font-medium text-foreground">{rule.label}:</span>{' '}
                              {getRuleSummaryText(rule)}
                            </p>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
