import Link from 'next/link';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { loadPublicPlanCatalog } from '@/lib/server/au-limits';
import { formatExpirationWindowLabel } from '@/lib/plans/subscription-policy';

const ADMIN_WHATSAPP_URL = 'https://wa.me/2349036553377';
const ADMIN_WHATSAPP_MESSAGE = 'Hello Admin, I want to subscribe to the Premium plan.';

function formatCount(value: number) {
  return Number(value || 0).toLocaleString();
}

function describeLimit(label: string, value: number, resetLabel: string) {
  return `${label}: ${formatCount(value)} (${resetLabel})`;
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams?: Promise<{ source?: string | string[] }>;
}) {
  const supabase = createSupabaseAdminClient();
  const plans = await loadPublicPlanCatalog(supabase).catch(() => []);
  const resolvedSearchParams = await searchParams;
  const sourceParam = Array.isArray(resolvedSearchParams?.source) ? resolvedSearchParams?.source[0] : resolvedSearchParams?.source;
  const sourceLabel = sourceParam ? sourceParam.replace(/^feature_|^limit_/, '').replace(/_/g, ' ') : '';

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <section className="space-y-4 text-center">
        <Badge variant="outline">Live plan catalog</Badge>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Plans & limits</h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          Pricing, caps, and reset policies below are rendered from the same plan tables used by limits enforcement.
        </p>
        {sourceLabel ? (
          <p className="text-sm text-muted-foreground">
            Highlighted from: <span className="font-medium text-foreground">{sourceLabel}</span>
          </p>
        ) : null}
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/dashboard/settings/subscription">Manage Billing</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => {
          const highlighted = plan.plan === 'pro' || sourceParam?.includes('pro');
          const monthly = plan.pricing.monthly;
          const weekly = plan.pricing.weekly;
          const isContactAdminCta = plan.metadata.cta_label.trim().toLowerCase() === 'contact admin';
          const ctaHref = isContactAdminCta
            ? `${ADMIN_WHATSAPP_URL}?text=${encodeURIComponent(ADMIN_WHATSAPP_MESSAGE)}`
            : (plan.metadata.cta_href || '/dashboard/settings/subscription');
          const ctaIsExternal = /^https?:\/\//i.test(ctaHref);

          return (
            <Card key={plan.plan} className={highlighted ? 'border-primary shadow-lg shadow-primary/10' : ''}>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>{plan.metadata.label}</CardTitle>
                    <CardDescription>{plan.metadata.description}</CardDescription>
                  </div>
                  {plan.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-xl font-semibold">{plan.metadata.price_display}</div>
                  {monthly || weekly ? (
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {monthly ? <p>Monthly: NGN {formatCount(monthly.amount)}{monthly.compare_at ? ` (was NGN ${formatCount(monthly.compare_at)})` : ''}</p> : null}
                      {weekly ? <p>Weekly: NGN {formatCount(weekly.amount)}{weekly.compare_at ? ` (was NGN ${formatCount(weekly.compare_at)})` : ''}</p> : null}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2 text-sm">
                  {plan.metadata.feature_bullets.map((feature) => (
                    <div key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 text-primary" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <p>Document expiration: {formatExpirationWindowLabel(Number(plan.metadata.expiration_days || 0))}</p>
                  <p>{describeLimit('Chats', Number(plan.limits.max_chats_total || 0), plan.resetLabels.max_chats_total)}</p>
                  <p>{describeLimit('Uploads stored', Number(plan.limits.max_uploads_total || 0), plan.resetLabels.max_uploads_total)}</p>
                  <p>{describeLimit('Tokens', Number(plan.limits.max_tokens_total || 0), plan.resetLabels.max_tokens_total)}</p>
                  <p>{describeLimit('Exam predictions', Number(plan.limits.max_exam_predictions || 0), plan.resetLabels.max_exam_predictions)}</p>
                  <p>{describeLimit('Practice exams', Number(plan.limits.max_practice_exams || 0), plan.resetLabels.max_practice_exams)}</p>
                  <p>{describeLimit('Knowledge Hub items', Number(plan.limits.max_knowledge_hub || 0), plan.resetLabels.max_knowledge_hub)}</p>
                  <p>{describeLimit('Concurrent jobs', Number(plan.limits.max_concurrent_jobs || 0), plan.resetLabels.max_concurrent_jobs)}</p>
                  <p>Per-file upload size: {formatCount(Number(plan.limits.max_file_size_mb || 0))} MB ({plan.resetLabels.max_file_size_mb})</p>
                </div>

                <Button asChild className="w-full" variant={plan.plan === 'free' ? 'outline' : 'default'}>
                  <Link
                    href={ctaHref}
                    target={ctaIsExternal ? '_blank' : undefined}
                    rel={ctaIsExternal ? 'noopener noreferrer' : undefined}
                  >
                    {plan.metadata.cta_label || 'Open plan'}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </main>
  );
}
