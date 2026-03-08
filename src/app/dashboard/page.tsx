'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BrainCircuit,
  ClipboardCheck,
  FilePlus,
  MessageCircle,
  Loader2,
  FileText as FileTextIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useMemo } from 'react';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { TruncatedText } from '@/components/TruncatedText';
import type { AuDocumentRow } from '@/lib/au/types';
import { useAuDocuments } from '@/hooks/api/use-au-documents';
import { useUploadJobs } from '@/components/upload/upload-jobs-provider';
import type { UploadJobStatus } from '@/lib/upload/types';
import { useDelayedLoadingState } from '@/hooks/use-delayed-loading-state';
import { DashboardPageSkeleton, SlowNetworkNotice } from '@/components/skeletons/page-skeletons';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { useLimitationsAgent } from '@/hooks/use-limitations-agent';
import { LimitAlertCard } from '@/components/limits/limit-alert-card';
import { LimitToast } from '@/components/limits/limit-toast';
import { useEffectiveEntitlements } from '@/hooks/use-effective-entitlements';
import { usePlanCatalog } from '@/hooks/api/use-plan-catalog';
import {
  buildPromoCopy,
  formatPromoEndsAtLabel,
  normalizePromoContentConfig,
} from '@/lib/conex/promo-content';

const quickAccessItems = [
  {
    title: 'Upload Document',
    description: 'Add a new PDF, TXT, or DOCX file.',
    icon: FilePlus,
    href: '/dashboard/documents',
    color: 'text-blue-500',
  },
  {
    title: 'Start AU Chat',
    description: 'Ask questions about your data.',
    icon: MessageCircle,
    href: '/dashboard/chat',
    color: 'text-green-500',
  },
  {
    title: 'View Predictions',
    description: 'See likely exam questions.',
    icon: ClipboardCheck,
    href: '/dashboard/predictions',
    color: 'text-purple-500',
  },
  {
    title: 'Explore Knowledge',
    description: 'Visualize concepts and summaries.',
    icon: BrainCircuit,
    href: '/dashboard/knowledge',
    color: 'text-orange-500',
  },
];


export default function DashboardPage() {
  const [user] = useSupabaseUser();
  const { isOnline } = useNetworkStatus();
  const { entitlements } = useEffectiveEntitlements();
  const { plans: planCatalog } = usePlanCatalog();
  const {
    documents,
    loading: documentsLoading,
    refresh,
    isUsingCachedData,
    cachedAt,
  } = useAuDocuments();
  const { jobs } = useUploadJobs();
  const { showSkeleton, showSlowNotice } = useDelayedLoadingState(documentsLoading);
  const {
    primaryAlert: dashboardLimitAlert,
    toastCandidate: dashboardLimitToast,
    markToastShown: markDashboardLimitToastShown,
    dismissAlert: dismissDashboardLimitAlert,
    clearLimitError: clearDashboardLimitError,
  } = useLimitationsAgent({
    route: 'dashboard',
  });
  const promoContent = useMemo(
    () => normalizePromoContentConfig(entitlements.promoContentConfig || {}),
    [entitlements.promoContentConfig],
  );
  const promoEndsLabel = useMemo(
    () => formatPromoEndsAtLabel(entitlements.promoEndsAtLagos || promoContent.promoEndsAtLagosIso),
    [entitlements.promoEndsAtLagos, promoContent.promoEndsAtLagosIso],
  );
  const promoCopy = useMemo(
    () => buildPromoCopy(promoContent, promoEndsLabel),
    [promoContent, promoEndsLabel],
  );
  const proPlanCatalog = useMemo(
    () => planCatalog.find((entry) => entry.plan === 'pro') || null,
    [planCatalog],
  );

  const recentDocuments = useMemo(() => {
    if (!user) return [];

    const statusFromJob = (status: UploadJobStatus): AuDocumentRow['status'] | null => {
      if (status === 'completed') return 'completed';
      if (status === 'failed' || status === 'stale_timeout') return 'failed';
      if (status === 'processing' || status === 'uploaded') return 'processing';
      if (status === 'uploading' || status === 'queued') return 'uploading';
      return null;
    };

    const map = new Map<string, AuDocumentRow>();
    documents.forEach((d) => map.set(d.id, d));

    jobs.forEach((job) => {
      const id = job.document_id || job.id;
      const mappedStatus = statusFromJob(job.status);
      if (!mappedStatus) return;

      if (map.has(id)) {
        const existing = map.get(id)!;
        if (mappedStatus === 'completed' && existing.status !== 'completed') {
          map.set(id, { ...existing, status: 'completed' });
          return;
        }
        if (existing.status !== 'completed' && mappedStatus !== 'completed') {
          map.set(id, { ...existing, status: mappedStatus });
        }
        return;
      }

      map.set(id, {
        id,
        user_id: job.user_id ?? user.id,
        document_type: (job.label as AuDocumentRow['document_type'] | null) ?? 'main_textbook',
        file_name: job.file_name,
        file_path: job.object_path,
        status: mappedStatus,
        parent_id: null,
        created_at: job.created_at ?? new Date().toISOString(),
        expires_at: null,
        error: (job as any).error ?? null,
      });
    });

    return Array.from(map.values())
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 5);
  }, [documents, jobs, user]);

  if (documentsLoading && showSkeleton && documents.length === 0) {
    return <DashboardPageSkeleton />;
  }

  function statusToBadge(status: string) {
    switch (status) {
      case 'completed':
        return (
          <Badge className="bg-green-600 hover:bg-green-700">Completed</Badge>
        );
      case 'processing':
        return <Badge variant="secondary">Processing</Badge>;
      case 'failed':
        return <Badge variant="destructive">Error</Badge>;
      case 'uploading':
        return <Badge variant="outline">Uploading</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <LimitToast alert={dashboardLimitToast} onShown={markDashboardLimitToastShown} />
      {showSlowNotice && documentsLoading ? <SlowNetworkNotice onRetry={() => void refresh()} /> : null}
      {isUsingCachedData && !isOnline ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-2 text-xs text-blue-900 dark:border-blue-500/40 dark:bg-blue-950/30 dark:text-blue-100">
          Offline • showing cached dashboard data{cachedAt ? ` from ${new Date(cachedAt).toLocaleString()}` : ''}.
        </div>
      ) : null}
      {dashboardLimitAlert ? (
        <LimitAlertCard
          alert={dashboardLimitAlert}
          onDismiss={(alertId) => {
            dismissDashboardLimitAlert(alertId);
            if (alertId.startsWith('server:')) {
              clearDashboardLimitError();
            }
          }}
        />
      ) : null}
      {entitlements.promoBannerEnabled && entitlements.promoActive ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <p className="font-semibold">{promoCopy.intro}</p>
          <p className="text-muted-foreground">{proPlanCatalog?.metadata?.price_display ? `Pricing after promo: ${proPlanCatalog.metadata.price_display}` : promoCopy.pricing}</p>
          <p className="text-xs text-muted-foreground">{promoCopy.ending}</p>
        </div>
      ) : null}

      <div className="flex items-center">
        <h1 className="font-headline text-2xl font-semibold">
          Welcome, {(user?.user_metadata?.full_name as string | undefined) || (user?.user_metadata?.name as string | undefined) || 'User'}!
        </h1>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {quickAccessItems.map((item) => (
          <Card key={item.title} className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg font-medium font-headline">{item.title}</CardTitle>
              <item.icon className={`h-6 w-6 ${item.color}`} aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{item.description}</p>
              <Button asChild variant="link" className="px-0 mt-2">
                <Link href={item.href}>
                  Go <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      
      <div className="grid grid-cols-1 gap-4 md:gap-8">
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="grid gap-2">
              <CardTitle className="font-headline">Recent Documents</CardTitle>
              <CardDescription>
                Your latest uploads and their status.
              </CardDescription>
            </div>
            <Link href="/dashboard/documents" className="ml-auto">
              <Button size="sm" className="gap-1 w-full sm:w-auto">
                View All
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead className="hidden md:table-cell">Date</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documentsLoading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center">
                      <div className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        Loading...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : recentDocuments.length > 0 ? (
                  recentDocuments.map((doc) => (
                    <TableRow key={doc.id} className="group cursor-default">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <FileTextIcon className="h-4 w-4 text-primary opacity-70 group-hover:opacity-100 transition-opacity" />
                          <TruncatedText
                            text={doc.file_name}
                            className="group-hover:text-primary transition-colors"
                            maxWidthClass="max-w-[140px] sm:max-w-[220px]"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground group-hover:text-foreground transition-colors">
                        {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : 'N/A'}
                      </TableCell>
                      <TableCell className="text-right">{statusToBadge(doc.status)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow><TableCell colSpan={3} className="h-24 text-center">No recent documents.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
