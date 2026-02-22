"use client";

import { useStore } from "@/hooks/use-store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

export function UpgradeModal() {
  const open = useStore((state) => state.upgradeModalOpen);
  const context = useStore((state) => state.upgradeContext);
  const setOpen = useStore((state) => state.setUpgradeModalOpen);
  const router = useRouter();

  if (!context) return null;

  const { reason, limit, used, resetsAt, cta, upgradeUrl } = context;

  const handleUpgrade = () => {
    setOpen(false);
    const normalizedUpgradeUrl =
      typeof upgradeUrl === 'string' && upgradeUrl.startsWith('/dashboard/settings/subscription')
        ? upgradeUrl
        : '/dashboard/settings/subscription';
    router.push(normalizedUpgradeUrl);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="mx-auto bg-primary/10 p-3 rounded-full mb-2 w-fit">
              <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">Upgrade to Pro</DialogTitle>
          <DialogDescription className="text-center pt-2">
            {reason || "You've reached your free daily limit."}
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4 text-center space-y-2">
            <div className="text-sm text-muted-foreground">
                Current Usage: <span className="font-semibold text-foreground">{used}</span> / <span className="font-semibold text-foreground">{limit}</span>
            </div>
            {resetsAt && (
                <div className="text-xs text-muted-foreground">
                    Resets at: {new Date(resetsAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </div>
            )}
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
