"use client";

import { useStore } from "@/hooks/use-store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Sparkles, CheckCircle2 } from "lucide-react";
import { getUpgradeBenefits, isPromoWindowActive, PROMO_PRO_END_LAGOS_ISO } from "@/lib/tier/policy";

export function UpgradeModal() {
  const open = useStore((state) => state.upgradeModalOpen);
  const context = useStore((state) => state.upgradeContext);
  const setOpen = useStore((state) => state.setUpgradeModalOpen);
  const router = useRouter();

  if (!context) return null;

  const {
    reason,
    message,
    key,
    limit,
    used,
    resetsAt,
    cta,
    upgradeUrl,
  } = context as any;
  const limitKey = String(key || limit || "general").trim();
  const benefits = getUpgradeBenefits({ limitKey });
  const promoActive = isPromoWindowActive();

  const handleUpgrade = () => {
    setOpen(false);
    const normalizedUpgradeUrl =
      typeof upgradeUrl === 'string' && upgradeUrl.startsWith('/')
        ? upgradeUrl
        : '/pricing';
    router.push(normalizedUpgradeUrl);
  };

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
            You are currently on Promo Pro. On April 2nd, 2026, Pro becomes NGN 4,500/month or NGN 1,500/week.
            Promo ends at {new Date(PROMO_PRO_END_LAGOS_ISO).toLocaleString("en-US", { timeZone: "Africa/Lagos" })}.
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
          <div className="text-muted-foreground">NGN 4,500/month or NGN 1,500/week</div>
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
