import Link from 'next/link';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DEFAULT_MAX_UPLOAD_MB,
  FLAGGED_MAX_UPLOAD_MB,
  TIER_FEATURE_POLICIES,
  TIER_QUOTA_POLICIES,
  TIER_TUNING_POLICY,
} from '@/lib/tier/policy';

function yesNo(value: boolean) {
  return value ? (
    <span className="inline-flex items-center gap-1 text-green-600">
      <Check className="h-4 w-4" /> Yes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <X className="h-4 w-4" /> No
    </span>
  );
}

export default function PricingPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <section className="space-y-4 text-center">
        <Badge variant="outline">Free vs Pro</Badge>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Upgrade to Pro</h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          Pro unlocks premium model quality, advanced memory depth, and higher daily quotas.
        </p>
        <p className="text-sm text-muted-foreground">NGN 4,500/month or NGN 1,500/week</p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/dashboard/settings/subscription">Upgrade Now</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Capability Matrix</CardTitle>
          <CardDescription>Generated from the shared tier policy configuration.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left">Feature</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-left">Free</th>
                <th className="px-3 py-2 text-left">Pro</th>
                <th className="px-3 py-2 text-left">UI Entry</th>
                <th className="px-3 py-2 text-left">Server Enforcement</th>
              </tr>
            </thead>
            <tbody>
              {TIER_FEATURE_POLICIES.map((row) => {
                const freeAllowed = row.allowedTiers.includes('FREE');
                const proAllowed = row.allowedTiers.includes('PRO') || row.allowedTiers.includes('PROMO_PRO');
                return (
                  <tr key={row.key} className="border-b align-top">
                    <td className="px-3 py-3 font-medium">{row.title}</td>
                    <td className="px-3 py-3 text-muted-foreground">{row.description}</td>
                    <td className="px-3 py-3">{yesNo(freeAllowed)}</td>
                    <td className="px-3 py-3">{yesNo(proAllowed)}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{row.uiEntryPoints.join(', ')}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{row.serverEnforcement.join(', ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quota Policy</CardTitle>
          <CardDescription>Server-enforced quotas with atomic counters.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left">Quota Key</th>
                <th className="px-3 py-2 text-left">Period</th>
                <th className="px-3 py-2 text-left">Free</th>
                <th className="px-3 py-2 text-left">Pro</th>
                <th className="px-3 py-2 text-left">Description</th>
              </tr>
            </thead>
            <tbody>
              {TIER_QUOTA_POLICIES.map((row) => (
                <tr key={row.key} className="border-b align-top">
                  <td className="px-3 py-3 font-mono text-xs">{row.key}</td>
                  <td className="px-3 py-3">{row.period}</td>
                  <td className="px-3 py-3">{row.freeLimit <= 0 ? 'Locked/Unlimited' : row.freeLimit}</td>
                  <td className="px-3 py-3">{row.proLimit <= 0 ? 'Unlimited' : row.proLimit}</td>
                  <td className="px-3 py-3 text-muted-foreground">{row.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Key Limits</CardTitle>
          <CardDescription>Hard constraints currently active in production policy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Upload size: <span className="font-semibold">{DEFAULT_MAX_UPLOAD_MB}MB</span> for everyone by default.
            When feature flag <span className="font-mono">upload_100mb</span> is ON, this becomes <span className="font-semibold">{FLAGGED_MAX_UPLOAD_MB}MB</span> for everyone.
          </p>
          <p>
            Lifetime total uploaded documents: <span className="font-semibold">Free 4</span>, <span className="font-semibold">Pro 10</span>.
          </p>
          <p>
            Memory turn window: Free {TIER_TUNING_POLICY.memoryTurnWindow.free}, Pro {TIER_TUNING_POLICY.memoryTurnWindow.pro}.
          </p>
          <p>
            Retrieval depth top-k: Free {TIER_TUNING_POLICY.retrievalTopK.free}, Pro {TIER_TUNING_POLICY.retrievalTopK.pro}.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
