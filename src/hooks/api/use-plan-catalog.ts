'use client';

import { useEffect, useState } from 'react';

type PlanCatalogEntry = {
  plan: string;
  isDefault: boolean;
  metadata: {
    label: string;
    description: string;
    price_display: string;
    feature_bullets: string[];
    cta_label: string;
    cta_href: string;
    retention_days: number;
    expiration_days: number;
  };
  pricing: {
    monthly: { amount: number; compare_at: number | null; label: string; plan_key: string | null } | null;
    weekly: { amount: number; compare_at: number | null; label: string; plan_key: string | null } | null;
  };
  limits: Record<string, number>;
  limitRules: Record<string, {
    key: string;
    label: string;
    description: string;
    unit_label: string;
    category: string;
    value: number | null;
    mode: string;
    reset_policy: string;
    reset_interval_value: number | null;
    reset_interval_unit: string | null;
    is_enabled: boolean;
    is_unlimited: boolean;
    state: string;
    inherited: boolean;
    source_scope: string;
    updated_at: string | null;
    enforced_by: string[];
    presentation: {
      cap_label: string;
      mode_label: string;
      reset_label: string;
      reset_description: string;
      summary: string;
    };
  }>;
};

type PlanCatalogState = {
  loading: boolean;
  error: string | null;
  plans: PlanCatalogEntry[];
  flags: Record<string, boolean>;
};

const DEFAULT_STATE: PlanCatalogState = {
  loading: true,
  error: null,
  plans: [],
  flags: {},
};

export function usePlanCatalog() {
  const [state, setState] = useState<PlanCatalogState>(DEFAULT_STATE);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/public/plan-catalog', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.ok) {
          throw new Error(String(payload?.message || payload?.error || `plan-catalog failed (${res.status})`));
        }
        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          plans: Array.isArray(payload.plans) ? payload.plans : [],
          flags: payload.flags && typeof payload.flags === 'object' ? payload.flags as Record<string, boolean> : {},
        });
      } catch (error: any) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: String(error?.message || error),
        }));
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
