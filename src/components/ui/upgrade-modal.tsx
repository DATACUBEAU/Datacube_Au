"use client";

import { useStore } from "@/hooks/use-store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useMemo, useEffect } from "react";
import { Sparkles, CheckCircle2, Globe, BrainCircuit, ClipboardCheck, SquarePen } from "lucide-react";
import { useFeatureFlags } from "@/components/feature-flag-provider";
import { useEffectiveEntitlements } from "@/hooks/use-effective-entitlements";
import { usePlanCatalog } from "@/hooks/api/use-plan-catalog";
import {
  buildPromoCopy,
  formatPromoEndsAtLabel,
  normalizePromoContentConfig,
} from "@/lib/conex/promo-content";
import { trackUpgradeModalOpen, trackUpgradeCTAClick } from "@/lib/analytics/premium-nav-events";

// ── Per-feature copy ──────────────────────────────────────────────────────────

type FeatureCopy = {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  bullets: string[];
};

const FEATURE_COPY: Record<string, FeatureCopy> = {
  global_chat: {
    title: "Unlock Global Chat",
    description: "Chat across all your uploaded documents — simultaneously.",
    icon: Globe,
    bullets: [
      "Query any document in your workspace in one conversation",
      "Real-time cross-document context and synthesis",
      "Collaborative AI with memory across all your files",
      "Instant answers with cited sources from multiple docs",
    ],
  },
  knowledge_hub: {
    title: "Unlock Knowledge Hub",
    description: "Transform your documents into structured study materials in seconds.",
    icon: BrainCircuit,
    bullets: [
      "AI-generated study notes and concept summaries",
      "Interactive concept maps and topic breakdowns",
      "Auto-extracted key terms and definitions",
      "Export-ready revision materials for any subject",
    ],
  },
  exam_prediction: {
    title: "Unlock Exam Predictions",
    description: "Know what's likely to appear on your exam before test day.",
    icon: ClipboardCheck,
    bullets: [
      "AI exam intelligence briefing per subject",
      "Past-question trend analysis and topic forecasting",
      "Confidence scores per predicted topic",
      "Updated predictions as you upload more material",
    ],
  },
  practice_exam_generation: {
    title: "Unlock Practice Exams",
    description: "Generate and take fully marked practice papers instantly.",
    icon: SquarePen,
    bullets: [
      "Generate custom practice papers from your documents",
      "Instant AI marking with detailed feedback",
      "Performance insights and weak-area identification",
      "Unlimited exam attempts with varied question sets",
    ],
  },
};

const GENERIC_COPY: FeatureCopy = {
  title: "Upgrade to Pro",
  description: "This action is limited on your current plan.",
  icon: Sparkles,
  bullets: [],
};

// ─────────────────────────────────────────────────────────────────────────────

export function UpgradeModal() {
  const open = useStore((state) => state.upgradeModalOpen);
  const context = useStore((state) => state.upgradeContext);
  const setOpen = useStore((state) => state.setUpgradeModalOpen);
  const { records: featureFlagRecords } = useFeatureFlags();
  const { entitlements } = useEffectiveEntitlements();
  const { plans, loading: loadingPlanCatalog } = usePlanCatalog();
  const router = useRouter();
  const rawContext = (context || {}) as any;
  const {
    reason,
    message,
    key,
    limit,
    used,
    resetsAt,
    cta,
    upgradeUrl,
  } = rawContext;
  const limitKey = String(key || limit || "general").trim();

  // Resolve per-feature copy, falling back to generic
  const featureCopy: FeatureCopy = useMemo(
    () => FEATURE_COPY[limitKey] ?? GENERIC_COPY,
    [limitKey],
  );
  const FeatureIcon = featureCopy.icon;

  const proPlan = useMemo(() => plans.find((entry) => entry.plan === 'pro') || null, [plans]);

  const benefits = useMemo(() => {
    // Prefer per-feature bullets, then plan catalog, then generic fallback
    if (featureCopy.bullets.length) return featureCopy.bullets;
    if (proPlan?.metadata?.feature_bullets?.length) return proPlan.metadata.feature_bullets;
    return limitKey
      ? [`Higher ${limitKey.replace(/_/g, ' ')}`, 'More storage', 'Priority processing', 'Advanced study tools']
      : [];
  }, [featureCopy.bullets, limitKey, proPlan]);

  const promoActive = entitlements.promoActive;
  const promoContent = useMemo(
    () => normalizePromoContentConfig(featureFlagRecords.promo_content?.config || {}),
    [featureFlagRecords],
  );
  const promoCopy = useMemo(() => {
    const endsLabel = formatPromoEndsAtLabel(promoContent.promoEndsAtLagosIso);
    return buildPromoCopy(promoContent, endsLabel);
  }, [promoContent]);

  // Resolve user plan label for analytics
  const planLabel = useMemo(() => {
    if (entitlements.plan === 'admin') return 'admin';
    if (entitlements.plan === 'premium') return 'premium';
    if (entitlements.promoActive) return 'promo_pro';
    if (entitlements.hasPro) return 'pro';
    return 'free';
  }, [entitlements]);

  // Fire upgrade_modal_open analytics when modal becomes visible
  useEffect(() => {
    if (open && limitKey) {
      trackUpgradeModalOpen(limitKey, planLabel, 'upgrade_modal');
    }
    // Only fire when open transitions to true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleUpgrade = () => {
    trackUpgradeCTAClick(limitKey, planLabel, 'upgrade_modal');
    setOpen(false);
    const normalizedUpgradeUrl =
      typeof upgradeUrl === 'string' && upgradeUrl.startsWith('/')
        ? upgradeUrl
        : '/pricing';
    router.push(normalizedUpgradeUrl);
  };

  if (!context) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[520px]" data-testid="upgrade-modal">
        <DialogHeader>
          <div className="mx-auto bg-primary/10 p-3 rounded-full mb-2 w-fit">
            <FeatureIcon className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl" data-testid="upgrade-modal-title">
            {featureCopy.title}
          </DialogTitle>
          <DialogDescription className="text-center pt-2">
            {featureCopy.description !== GENERIC_COPY.description
              ? featureCopy.description
              : (reason || message || featureCopy.description)}
          </DialogDescription>
        </DialogHeader>

        {promoActive ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
            <p className="font-semibold">{promoCopy.intro}</p>
            <p>{proPlan?.metadata?.price_display ? `Pricing after promo: ${proPlan.metadata.price_display}` : promoCopy.pricing}</p>
            <p>{promoCopy.ending}</p>
          </div>
        ) : null}

        {typeof used === 'number' && (
          <div className="py-1 text-center space-y-2">
            <div className="text-sm text-muted-foreground">
              Current Usage: <span className="font-semibold text-foreground">{used}</span> / <span className="font-semibold text-foreground">{typeof limit === 'number' ? limit : 'Plan limit'}</span>
            </div>
            {resetsAt && (
              <div className="text-xs text-muted-foreground">
                Resets at: {new Date(resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm" data-testid="upgrade-modal-benefits">
          {benefits.slice(0, 4).map((item) => (
            <div key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{item}</span>
            </div>
          ))}
        </div>

        <div className="rounded-lg border p-3 text-sm">
          <div className="font-medium">Pro pricing</div>
          <div className="text-muted-foreground">
            {loadingPlanCatalog ? 'Loading live pricing...' : (proPlan?.metadata?.price_display || 'Pricing unavailable')}
          </div>
        </div>

        <DialogFooter className="sm:justify-center flex-col sm:flex-row gap-2">
          <Button
            variant="default"
            onClick={handleUpgrade}
            className="w-full sm:w-auto"
            data-testid="upgrade-modal-cta"
          >
            {cta || "Upgrade Now"}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)} className="w-full sm:w-auto">
            Maybe Later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
