'use client';

import { useCallback, useEffect, useState } from 'react';
import { safeFetch } from '@/lib/api/safe-fetch';
import { useSupabaseSession } from '@/hooks/use-supabase-auth';

export type FeatureOutputKey = 'knowledge_hub' | 'exam_prediction' | 'practice_exam_generation';
export type FeatureOutputStatus = 'idle' | 'loading' | 'missing' | 'ready' | 'running' | 'failed';

type FeatureOutputResponse<T> = {
  ok: boolean;
  status: 'missing' | 'ready' | 'running' | 'failed';
  feature: FeatureOutputKey;
  doc_version_id: string | null;
  generatedAt?: string | null;
  output: T | null;
  message?: string;
};

export function useFeatureOutput<T>(input: {
  feature: FeatureOutputKey;
  documentId?: string | null;
  docVersionId?: string | null;
  enabled?: boolean;
}) {
  const { session } = useSupabaseSession();
  const [status, setStatus] = useState<FeatureOutputStatus>('idle');
  const [output, setOutput] = useState<T | null>(null);
  const [docVersionId, setDocVersionId] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (input.enabled === false) {
      setStatus('idle');
      setOutput(null);
      setDocVersionId(null);
      setGeneratedAt(null);
      setErrorMessage(null);
      return;
    }

    const accessToken = session?.access_token;
    if (!accessToken || (!input.documentId && !input.docVersionId)) {
      setStatus('idle');
      setOutput(null);
      setDocVersionId(null);
      setGeneratedAt(null);
      setErrorMessage(null);
      return;
    }

    const url = new URL('/api/feature-output', window.location.origin);
    url.searchParams.set('feature', input.feature);
    if (input.documentId) url.searchParams.set('documentId', input.documentId);
    if (input.docVersionId) url.searchParams.set('docVersionId', input.docVersionId);

    setStatus((current) => (current === 'ready' ? 'loading' : 'loading'));
    setErrorMessage(null);

    try {
      const response = await safeFetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        timeout: 15_000,
        silent: true,
      });
      const payload = (await response.json().catch(() => null)) as FeatureOutputResponse<T> | null;

      if (!response.ok || !payload?.ok) {
        setStatus('idle');
        setOutput(null);
        setDocVersionId(null);
        setGeneratedAt(null);
        setErrorMessage((payload as any)?.message || response.statusText || 'Failed to load cached output.');
        return;
      }

      setStatus(payload.status);
      setOutput(payload.output ?? null);
      setDocVersionId(payload.doc_version_id || null);
      setGeneratedAt(payload.generatedAt || null);
    } catch (error: any) {
      setStatus('idle');
      setOutput(null);
      setDocVersionId(null);
      setGeneratedAt(null);
      setErrorMessage(String(error?.message || error || 'Failed to load cached output.'));
    }
  }, [input.docVersionId, input.documentId, input.enabled, input.feature, session?.access_token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    status,
    output,
    docVersionId,
    generatedAt,
    errorMessage,
    refresh,
    isReady: status === 'ready',
    isRunning: status === 'running' || status === 'loading',
    isFailed: status === 'failed',
  };
}
