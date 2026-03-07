"use client";

import { useStore } from "@/hooks/use-store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { Sparkles, CheckCircle2 } from "lucide-react";
import { useFeatureFlags } from "@/components/feature-flag-provider";
import { useEffectiveEntitlements } from "@/hooks/use-effective-entitlements";
import { usePlanCatalog } from "@/hooks/api/use-plan-catalog";
import {
  buildPromoCopy,
  formatPromoEndsAtLabel,
  normalizePromoContentConfig,
} from "@/lib/conex/promo-content";

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
  const proPlan = useMemo(() => plans.find((entry) => entry.plan === 'pro') || null, [plans]);
  const benefits = useMemo(() => {
    if (proPlan?.metadata?.feature_bullets?.length) {
      return proPlan.metadata.feature_bullets;
    }
    return limitKey ? [`Higher ${limitKey.replace(/_/g, ' ')}`, 'More storage', 'Priority processing', 'Advanced study tools'] : [];
  }, [limitKey, proPlan]);
  const promoActive = entitlements.promoActive;
  const promoContent = useMemo(
    () => normalizePromoContentConfig(featureFlagRecords.promo_content?.config || {}),
    [featureFlagRecords],
  );
  const promoCopy = useMemo(() => {
    const endsLabel = formatPromoEndsAtLabel(promoContent.promoEndsAtLagosIso);
    return buildPromoCopy(promoContent, endsLabel);
  }, [promoContent]);

  const handleUpgrade = () => {
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
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <div className="mx-auto bg-primary/10 p-3 rounded-full mb-2 w-fit">
              <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">Upgrade to Pro</DialogTitle>
          <DialogDescription className="text-center pt-2">
            {reason || message || "This action is limited on your current plan."}
          </DialogDescription>
        </DialogHeader>

        {promoActive ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
            <p className="font-semibold">{promoCopy.intro}</p>
            <p>{proPlan?.metadata?.price_display ? `Pricing after promo: ${proPlan.metadata.price_display}` : promoCopy.pricing}</p>
            <p>{promoCopy.ending}</p>
          </div>
        ) : null}
        
        <div className="py-1 text-center space-y-2">
            <div className="text-sm text-muted-foreground">
                Current Usage: <span className="font-semibold text-foreground">{typeof used === 'number' ? used : 0}</span> / <span className="font-semibold text-foreground">{typeof limit === 'number' ? limit : 'Plan limit'}</span>
            </div>
            {resetsAt && (
                <div className="text-xs text-muted-foreground">
                    Resets at: {new Date(resetsAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </div>
            )}
        </div>

        <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
          {benefits.slice(0, 4).map((item) => (
            <div key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
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
          <Button variant="default" onClick={handleUpgrade} className="w-full sm:w-auto">
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
