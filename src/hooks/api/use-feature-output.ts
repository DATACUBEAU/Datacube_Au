'use client';

import { useCallback, useEffect, useState } from 'react';
import { safeFetch } from '@/lib/api/safe-fetch';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { shouldDeferProtectedRequest } from '@/lib/auth/session-expiry-policy';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { describeApiErrorForUser, type UserFacingErrorDescriptor } from '@/lib/api/user-facing-error';

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

const FEATURE_OUTPUT_CACHE_TTL_MS = 20_000;
const FEATURE_OUTPUT_CACHE_EVENT = 'dcau:feature-output-cache-updated';
const featureOutputCache = new Map<string, {
  payload: FeatureOutputResponse<unknown>;
  cachedAt: number;
}>();
const featureOutputInFlight = new Map<string, Promise<FeatureOutputResponse<unknown>>>();

function buildFeatureOutputCacheKey(input: {
  feature: FeatureOutputKey;
  documentId?: string | null;
  docVersionId?: string | null;
}): string {
  return `${input.feature}:${input.documentId || ''}:${input.docVersionId || ''}`;
}

function applyFeatureOutputPayload<T>(
  payload: FeatureOutputResponse<T>,
  setters: {
    setStatus: (status: FeatureOutputStatus) => void;
    setOutput: (output: T | null) => void;
    setDocVersionId: (value: string | null) => void;
    setGeneratedAt: (value: string | null) => void;
    setErrorMessage: (value: string | null) => void;
    setErrorInfo: (value: UserFacingErrorDescriptor | null) => void;
  },
): void {
  setters.setStatus(payload.status);
  setters.setOutput(payload.output ?? null);
  setters.setDocVersionId(payload.doc_version_id || null);
  setters.setGeneratedAt(payload.generatedAt || null);
  setters.setErrorMessage(null);
  setters.setErrorInfo(null);
}

export function writeFeatureOutputCache<T>(input: {
  feature: FeatureOutputKey;
  documentId?: string | null;
  docVersionId?: string | null;
  payload: FeatureOutputResponse<T>;
}): void {
  const cacheKey = buildFeatureOutputCacheKey(input);
  featureOutputCache.set(cacheKey, {
    payload: input.payload as FeatureOutputResponse<unknown>,
    cachedAt: Date.now(),
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(FEATURE_OUTPUT_CACHE_EVENT, {
        detail: {
          key: cacheKey,
          payload: input.payload,
        },
      }),
    );
  }
}

export function useFeatureOutput<T>(input: {
  feature: FeatureOutputKey;
  documentId?: string | null;
  docVersionId?: string | null;
  enabled?: boolean;
}) {
  const { session, isLoadingAuth, isRestoringAuth, isAuthLocked } = useSmartAuth();
  const { networkState } = useNetworkStatus();
  const [status, setStatus] = useState<FeatureOutputStatus>('idle');
  const [output, setOutput] = useState<T | null>(null);
  const [docVersionId, setDocVersionId] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorInfo, setErrorInfo] = useState<UserFacingErrorDescriptor | null>(null);
  const cacheKey = buildFeatureOutputCacheKey(input);

  const refresh = useCallback(async () => {
    if (input.enabled === false) {
      setStatus('idle');
      setOutput(null);
      setDocVersionId(null);
      setGeneratedAt(null);
      setErrorMessage(null);
      setErrorInfo(null);
      return;
    }

    if (shouldDeferProtectedRequest({
      isAuthLoading: isLoadingAuth,
      isAuthRestoring: isRestoringAuth,
      isAuthLocked,
    })) {
      setStatus('idle');
      setErrorMessage(null);
      setErrorInfo(null);
      return;
    }

    if (!input.documentId && !input.docVersionId) {
      setStatus('idle');
      setOutput(null);
      setDocVersionId(null);
      setGeneratedAt(null);
      setErrorMessage(null);
      setErrorInfo(null);
      return;
    }

    const cached = featureOutputCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < FEATURE_OUTPUT_CACHE_TTL_MS) {
      applyFeatureOutputPayload(cached.payload as FeatureOutputResponse<T>, {
        setStatus,
        setOutput,
        setDocVersionId,
        setGeneratedAt,
        setErrorMessage,
        setErrorInfo,
      });
      return;
    }

    const url = new URL('/api/feature-output', window.location.origin);
    url.searchParams.set('feature', input.feature);
    if (input.documentId) url.searchParams.set('documentId', input.documentId);
    if (input.docVersionId) url.searchParams.set('docVersionId', input.docVersionId);

    setStatus((current) => (current === 'ready' ? 'loading' : 'loading'));
    setErrorMessage(null);
    setErrorInfo(null);

    try {
      let request = featureOutputInFlight.get(cacheKey) as Promise<FeatureOutputResponse<T>> | undefined;
      if (!request) {
        request = (async () => {
          const response = await safeFetch(url.toString(), {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            timeout: 15_000,
            silent: true,
            suppressAuthError: true,
            authIntent: 'background',
            retries: 0,
          });
          const payload = (await response.json().catch(() => null)) as FeatureOutputResponse<T> | null;
          if (!response.ok || !payload?.ok) {
            throw {
              ...(payload && typeof payload === 'object' ? payload : {}),
              status: response.status,
              message: (payload as any)?.message || response.statusText || 'Failed to load cached output.',
            };
          }
          return payload;
        })().finally(() => {
          featureOutputInFlight.delete(cacheKey);
        });
        featureOutputInFlight.set(cacheKey, request as Promise<FeatureOutputResponse<unknown>>);
      }

      const payload = await request;

      writeFeatureOutputCache({
        feature: input.feature,
        documentId: input.documentId,
        docVersionId: input.docVersionId,
        payload,
      });
      applyFeatureOutputPayload(payload, {
        setStatus,
        setOutput,
        setDocVersionId,
        setGeneratedAt,
        setErrorMessage,
        setErrorInfo,
      });
    } catch (error: any) {
      const userFacingError = describeApiErrorForUser(error, {
        context: 'generation',
        networkState,
      });
      setErrorMessage(userFacingError.description);
      setErrorInfo(userFacingError);
      setStatus((current) => (current === 'ready' ? current : 'idle'));
      setOutput((current) => current);
      setDocVersionId((current) => current);
      setGeneratedAt((current) => current);
    }
  }, [
    input.docVersionId,
    input.documentId,
    input.enabled,
    input.feature,
    isAuthLocked,
    isLoadingAuth,
    isRestoringAuth,
    networkState,
    cacheKey,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleCacheUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ key?: string; payload?: FeatureOutputResponse<T> }>;
      if (customEvent.detail?.key !== cacheKey || !customEvent.detail.payload) return;
      applyFeatureOutputPayload(customEvent.detail.payload, {
        setStatus,
        setOutput,
        setDocVersionId,
        setGeneratedAt,
        setErrorMessage,
        setErrorInfo,
      });
    };

    window.addEventListener(FEATURE_OUTPUT_CACHE_EVENT, handleCacheUpdate as EventListener);
    return () => {
      window.removeEventListener(FEATURE_OUTPUT_CACHE_EVENT, handleCacheUpdate as EventListener);
    };
  }, [cacheKey]);

  return {
    status,
    output,
    docVersionId,
    generatedAt,
    errorMessage,
    errorInfo,
    refresh,
    isReady: status === 'ready',
    isRunning: status === 'running' || status === 'loading',
    isFailed: status === 'failed',
  };
}
