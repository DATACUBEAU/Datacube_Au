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
  resetLabels: Record<string, string>;
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
