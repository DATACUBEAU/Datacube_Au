import type { LimitExceededPayload } from '@/lib/limits/limit-errors';

export type LimitSeverity = 'info' | 'warn' | 'block';

export type LimitAlert = {
  id: string;
  severity: LimitSeverity;
  title: string;
  message: string;
  cta?: { label: string; href: string };
  dismissible: boolean;
  cooldownKey: string;
  reasoning: {
    limitName: string;
    threshold: number;
    currentUsage: number;
    limitValue: number;
  };
  suggestions: string[];
};

export type LimitsFlagsConfig = {
  alertsEnabled: boolean;
  thresholds: { warn: number[]; block: number[] };
  cooldownMinutes: number;
  enforcementEnabled: boolean;
  upsellEnabled: boolean;
};

export type LimitationsAgentInput = {
  route: 'upload' | 'chat' | 'ingestion' | 'dashboard' | string;
  plan: string;
  limits: Record<string, number>;
  usageToday: Record<string, number>;
  usageTotal: Record<string, number>;
  resetAt?: string | null;
  flags: LimitsFlagsConfig;
  context?: {
    pendingFileSizeMb?: number | null;
    expectedPages?: number | null;
    expectedChunks?: number | null;
    activeJobsCount?: number | null;
    totalDocsCount?: number | null;
    totalStorageMb?: number | null;
  };
  serverLimitError?: LimitExceededPayload | null;
};

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function getSuggestions(limitKey: string): string[] {
  switch (limitKey) {
    case 'max_chunks_per_doc':
      return [
        'Increase chunk size to reduce total chunk count.',
        'Lower chunk overlap to avoid duplicate chunks.',
        'Select fewer pages or sections before ingestion.',
      ];
    case 'max_pages_per_doc':
      return [
        'Trim non-essential pages before uploading.',
        'Split the file into multiple smaller documents.',
      ];
    case 'max_file_mb':
      return [
        'Compress the PDF before uploading.',
        'Split the file into multiple smaller documents.',
      ];
    case 'max_uploads_total':
      return [
        'Delete unused documents before uploading new ones.',
        'Batch uploads and prioritize the most important files first.',
      ];
    case 'max_chats_total':
    case 'max_tokens_total':
      return [
        'Use shorter prompts and concise replies to reduce token usage.',
        'Upgrade your plan for higher or unlimited caps.',
      ];
    case 'max_exams_total':
      return [
        'Generate exams only after finalizing your study scope.',
        'Upgrade your plan for higher or unlimited exam caps.',
      ];
    case 'max_storage_mb':
      return [
        'Delete old or duplicate documents to free storage.',
        'Archive large files you no longer need in AU.',
      ];
    case 'max_jobs_concurrent':
      return [
        'Wait for active ingestion jobs to finish first.',
        'Reduce parallel uploads and queue them gradually.',
      ];
    default:
      return [];
  }
}

function normalizeThresholds(values: number[], fallback: number[]): number[] {
  const normalized = values
    .map((value) => asNumber(value))
    .filter((value) => value > 0 && value <= 100);
  if (normalized.length === 0) return fallback;
  return Array.from(new Set(normalized)).sort((a, b) => a - b);
}

function thresholdSeverity(percent: number, warnLevels: number[], blockLevels: number[]): LimitSeverity | null {
  const block = blockLevels.slice().sort((a, b) => b - a).find((value) => percent >= value);
  if (typeof block === 'number') return 'block';
  const warn = warnLevels.slice().sort((a, b) => b - a).find((value) => percent >= value);
  if (typeof warn === 'number') return 'warn';
  return null;
}

function makeAlert(params: {
  id: string;
  severity: LimitSeverity;
  title: string;
  message: string;
  limitName: string;
  current: number;
  max: number;
  threshold: number;
  upsellEnabled: boolean;
}): LimitAlert {
  return {
    id: params.id,
    severity: params.severity,
    title: params.title,
    message: params.message,
    cta: params.upsellEnabled ? { label: 'Upgrade to Pro', href: '/pricing' } : undefined,
    dismissible: params.severity !== 'block',
    cooldownKey: params.id,
    reasoning: {
      limitName: params.limitName,
      threshold: params.threshold,
      currentUsage: params.current,
      limitValue: params.max,
    },
    suggestions: getSuggestions(params.limitName),
  };
}

function maybeUsageAlert(params: {
  id: string;
  title: string;
  limitKey: string;
  current: number;
  max: number;
  warnLevels: number[];
  blockLevels: number[];
  upsellEnabled: boolean;
}): LimitAlert | null {
  if (!Number.isFinite(params.max) || params.max <= 0) return null;
  const percent = (params.current / params.max) * 100;
  const severity = thresholdSeverity(percent, params.warnLevels, params.blockLevels);
  if (!severity) return null;

  const roundedPercent = Math.floor(Math.max(0, Math.min(100, percent)));
  const threshold = severity === 'block'
    ? params.blockLevels.slice().sort((a, b) => b - a).find((value) => percent >= value) ?? 100
    : params.warnLevels.slice().sort((a, b) => b - a).find((value) => percent >= value) ?? 70;

  const message = severity === 'block'
    ? `You reached ${params.limitKey}. Current usage is ${params.current}/${params.max}.`
    : `You are at ${roundedPercent}% of ${params.limitKey} (${params.current}/${params.max}).`;

  return makeAlert({
    id: params.id,
    severity,
    title: params.title,
    message,
    limitName: params.limitKey,
    current: params.current,
    max: params.max,
    threshold,
    upsellEnabled: params.upsellEnabled,
  });
}

function fromServerLimitError(payload: LimitExceededPayload, upsellEnabled: boolean): LimitAlert {
  const limitName = String(payload.limit || payload.key || 'unknown_limit');
  const current = asNumber(payload.current, 0);
  const max = asNumber(payload.max, 0);
  const isProRequired = payload.code === 'PRO_REQUIRED';
  const message = typeof payload.message === 'string' && payload.message.trim()
    ? payload.message
    : (isProRequired
      ? 'This action is available on Pro.'
      : `This action exceeded ${limitName}${max > 0 ? ` (${current}/${max})` : ''}.`);
  const alert = makeAlert({
    id: `server:${limitName}`,
    severity: 'block',
    title: isProRequired ? 'Pro feature locked' : 'Action blocked by plan limit',
    message,
    limitName,
    current,
    max,
    threshold: 100,
    upsellEnabled,
  });
  if (upsellEnabled && payload?.upgrade && typeof payload.upgrade === 'object') {
    const href = typeof payload.upgrade.href === 'string' ? payload.upgrade.href : '/pricing';
    const label = typeof payload.upgrade.cta === 'string' ? payload.upgrade.cta : 'Upgrade to Pro';
    return { ...alert, cta: { label, href } };
  }
  return alert;
}

export function buildLimitationsAlerts(input: LimitationsAgentInput): LimitAlert[] {
  const alerts: LimitAlert[] = [];
  const warnLevels = normalizeThresholds(input.flags.thresholds.warn, [70, 90]);
  const blockLevels = normalizeThresholds(input.flags.thresholds.block, [100]);
  const upsellEnabled = input.flags.upsellEnabled;

  const serverLimitError = input.serverLimitError || null;
  if (serverLimitError && ['LIMIT_EXCEEDED', 'LIMIT_REACHED', 'PRO_REQUIRED'].includes(String(serverLimitError.code || ''))) {
    alerts.push(fromServerLimitError(serverLimitError, upsellEnabled));
  }

  if (!input.flags.alertsEnabled) {
    return alerts;
  }

  const route = String(input.route || '').toLowerCase();
  const total = input.usageTotal || {};
  const ctx = input.context || {};

  if (route === 'upload') {
    const maxFileMb = asNumber(input.limits.max_file_mb, 0);
    const pendingFileMb = asNumber(ctx.pendingFileSizeMb, 0);
    if (maxFileMb > 0 && pendingFileMb > 0) {
      const percent = (pendingFileMb / maxFileMb) * 100;
      const severity: LimitSeverity = percent > 100 ? 'block' : (thresholdSeverity(percent, warnLevels, blockLevels) || 'info');
      if (severity !== 'info' || percent >= warnLevels[0]) {
        alerts.push(
          makeAlert({
            id: 'upload:max_file_mb',
            severity,
            title: severity === 'block' ? 'File exceeds upload size limit' : 'File is near upload size limit',
            message: `Selected file size is ${pendingFileMb.toFixed(2)}MB. Plan limit is ${maxFileMb}MB.`,
            limitName: 'max_file_mb',
            current: pendingFileMb,
            max: maxFileMb,
            threshold: severity === 'block' ? 100 : warnLevels[0],
            upsellEnabled,
          }),
        );
      }
    }

    const uploadsAlert = maybeUsageAlert({
      id: 'upload:max_uploads_total',
      title: 'Upload cap usage',
      limitKey: 'max_uploads_total',
      current: asNumber(total.used_uploads, asNumber(total.uploads_count, 0)),
      max: asNumber(input.limits.max_uploads_total, 0),
      warnLevels,
      blockLevels,
      upsellEnabled,
    });
    if (uploadsAlert) alerts.push(uploadsAlert);

    const jobsAlert = maybeUsageAlert({
      id: 'upload:max_jobs_concurrent',
      title: 'Concurrent ingestion jobs',
      limitKey: 'max_jobs_concurrent',
      current: asNumber(ctx.activeJobsCount, 0),
      max: asNumber(input.limits.max_jobs_concurrent, 0),
      warnLevels,
      blockLevels,
      upsellEnabled,
    });
    if (jobsAlert) alerts.push(jobsAlert);
  }

  if (route === 'ingestion') {
    const pagesAlert = maybeUsageAlert({
      id: 'ingestion:max_pages_per_doc',
      title: 'Document page limit',
      limitKey: 'max_pages_per_doc',
      current: asNumber(ctx.expectedPages, 0),
      max: asNumber(input.limits.max_pages_per_doc, 0),
      warnLevels,
      blockLevels,
      upsellEnabled,
    });
    if (pagesAlert) alerts.push(pagesAlert);

    const chunksAlert = maybeUsageAlert({
      id: 'ingestion:max_chunks_per_doc',
      title: 'Document chunk limit',
      limitKey: 'max_chunks_per_doc',
      current: asNumber(ctx.expectedChunks, 0),
      max: asNumber(input.limits.max_chunks_per_doc, 0),
      warnLevels,
      blockLevels,
      upsellEnabled,
    });
    if (chunksAlert) alerts.push(chunksAlert);
  }

  if (route === 'chat' || route === 'global-chat') {
    const messagesAlert = maybeUsageAlert({
      id: 'chat:max_chats_total',
      title: 'Chat cap usage',
      limitKey: 'max_chats_total',
      current: asNumber(total.used_chats, asNumber(total.messages_count, 0)),
      max: asNumber(input.limits.max_chats_total, 0),
      warnLevels,
      blockLevels,
      upsellEnabled,
    });
    if (messagesAlert) alerts.push(messagesAlert);

    const tokensAlert = maybeUsageAlert({
      id: 'chat:max_tokens_total',
      title: 'Token cap usage',
      limitKey: 'max_tokens_total',
      current: asNumber(total.used_tokens, asNumber(total.tokens_used, 0)),
      max: asNumber(input.limits.max_tokens_total, 0),
      warnLevels,
      blockLevels,
      upsellEnabled,
    });
    if (tokensAlert) alerts.push(tokensAlert);
  }

  if (route === 'dashboard' || route === 'upload' || route === 'chat' || route === 'ingestion' || route === 'global-chat') {
    const storageCurrent = asNumber(ctx.totalStorageMb, asNumber(total.uploaded_mb, 0));
    const storageAlert = maybeUsageAlert({
      id: 'storage:max_storage_mb',
      title: 'Storage usage',
      limitKey: 'max_storage_mb',
      current: storageCurrent,
      max: asNumber(input.limits.max_storage_mb, 0),
      warnLevels,
      blockLevels,
      upsellEnabled,
    });
    if (storageAlert) alerts.push(storageAlert);
  }

  const severityWeight: Record<LimitSeverity, number> = {
    block: 3,
    warn: 2,
    info: 1,
  };

  return alerts.sort((a, b) => {
    const scoreDiff = severityWeight[b.severity] - severityWeight[a.severity];
    if (scoreDiff !== 0) return scoreDiff;
    const aPct = a.reasoning.limitValue > 0 ? a.reasoning.currentUsage / a.reasoning.limitValue : 0;
    const bPct = b.reasoning.limitValue > 0 ? b.reasoning.currentUsage / b.reasoning.limitValue : 0;
    return bPct - aPct;
  });
}
