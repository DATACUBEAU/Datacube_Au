
'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { 
  validateFile, 
  normalizeFileName,
  resolveUploadMimeType,
} from '@/lib/upload/file-types';
import { 
  supabase, 
  getEffectiveOwnershipConditions,
  applyOwnershipFilter
} from '@/lib/supabase-client/client';
import { initiateUpload, completeUpload, deleteDocument } from '@/lib/api/documents';
import type { UploadJobRow, CreateUploadJobInput, UploadJobStatus } from '@/lib/upload/types';
import { deleteJobFile, getJobFile, putJobFile } from '@/lib/upload/idb';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '@/hooks/use-toast';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { guardRequest } from '@/lib/api/request-guard';
import { useLimits } from '@/components/providers/limits-provider';
import { extractLimitExceededPayload } from '@/lib/limits/limit-errors';
import { registerAuthBoundAbortController } from '@/lib/auth/session-expiry-events';
import { isRetryableUploadError } from '@/lib/upload/retry-policy';

type UploadJobsContextValue = {
  jobs: UploadJobRow[];
  activeJobs: UploadJobRow[];
  hasFailedJobs: boolean;
  hasCompletedJobs: boolean;
  isThrottled: boolean;
  maxUploadSize: number; // Expose max size
  setIsThrottled: (val: boolean) => void;
  enqueueUploads: (inputs: CreateUploadJobInput[]) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
  attachFileToJob: (jobId: string, file: File) => Promise<void>;
  removeJob: (jobId: string) => Promise<void>;
};

const UploadJobsContext = createContext<UploadJobsContextValue | null>(null);

function isActiveStatus(status: UploadJobStatus) {
  return status === 'queued' || status === 'uploading' || status === 'uploaded' || status === 'processing';
}

function isTerminalStatus(status: UploadJobStatus) {
  return status === 'failed' || status === 'cancelled' || status === 'done' || status === 'completed';
}

function statusRank(status: UploadJobStatus): number {
  switch (status) {
    case 'uploading':
      return 1;
    case 'uploaded':
      return 2;
    case 'queued':
      return 3;
    case 'processing':
      return 4;
    case 'done':
    case 'completed':
      return 5;
    case 'failed':
    case 'cancelled':
      return 6;
    case 'deleting':
      return 7;
    default:
      return 0;
  }
}

function isMissingUploadJobsErrorColumn(err: unknown): boolean {
  const message = typeof (err as any)?.message === 'string' ? (err as any).message : '';
  const code = typeof (err as any)?.code === 'string' ? (err as any).code : '';
  if (!message && !code) return false;
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes("could not find the 'error' column") ||
    lowerMessage.includes("column 'error'") ||
    lowerMessage.includes('column "error"') ||
    (lowerMessage.includes('schema cache') && lowerMessage.includes("'error'")) ||
    lowerMessage.includes('does not exist') && lowerMessage.includes('error') ||
    code === '42703' // PostgreSQL error code for undefined column
  );
}

function createId() {
  const randomUUID = (globalThis.crypto as Crypto | undefined)?.randomUUID;
  return typeof randomUUID === 'function' ? randomUUID.call(globalThis.crypto) : uuidv4();
}

const UPLOAD_MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function getExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index === -1) return '';
  return fileName.slice(index).toLowerCase();
}

function ensureUploadMimeType(fileName: string, mimeType: string): string {
  const normalizedMime = String(mimeType || '').trim().toLowerCase();
  const ext = getExtension(fileName);
  const extMime = UPLOAD_MIME_BY_EXTENSION[ext];
  if (extMime) return extMime;
  if (normalizedMime && normalizedMime !== 'application/octet-stream') return normalizedMime;
  return 'text/plain';
}

function isMissingOwnerIdColumnError(error: any): boolean {
  if (!error) return false;
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  return (
    message.includes('owner_id') && message.includes('does not exist')
  ) || (
    details.includes('owner_id') && details.includes('does not exist')
  );
}

function pickFirstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function getUploadErrorContext(error: any): {
  status: number;
  code: string;
  message: string;
  details: any;
} {
  const details = error?.details || null;
  const status = Number(
    error?.status ??
      details?.status ??
      details?.details?.status ??
      details?.error?.status ??
      0,
  );
  const code = pickFirstNonEmptyString(
    error?.code,
    details?.code,
    details?.details?.code,
    details?.error?.code,
    details?.details?.error?.code,
  ).toLowerCase();
  const message = pickFirstNonEmptyString(
    error?.message,
    details?.message,
    details?.error,
    details?.details?.message,
    details?.details?.error,
    details?.error?.message,
    details?.details?.error?.message,
  );

  return {
    status: Number.isFinite(status) ? status : 0,
    code,
    message,
    details,
  };
}

export function UploadJobsProvider({ children }: { children: React.ReactNode }) {
  const [user] = useSupabaseUser();
  const { session, loading: isLoadingAuth } = useSupabaseSession();
  const { isAuthLocked } = useSmartAuth();
  const { toast } = useToast();
  const { isOnline } = useNetworkStatus();
  const { usage: limitsUsage, reportServerLimitError } = useLimits();

  const [jobs, setJobs] = useState<UploadJobRow[]>([]);
  const [isThrottled, setIsThrottled] = useState(false);
  const [maxUploadSize, setMaxUploadSize] = useState(50 * 1024 * 1024); // Default 50MB
  const [useSafeSelection, setUseSafeSelection] = useState<boolean>(false);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const runningRef = useRef<Set<string>>(new Set());
  const blockedAutoRestartRef = useRef<Set<string>>(new Set());
  const lastProgressWriteRef = useRef<Map<string, number>>(new Map());
  const lastProgressTimeRef = useRef<Map<string, number>>(new Map());
  const stuckNotifiedRef = useRef<Set<string>>(new Set());

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  const getWorkerOwnershipConditions = useCallback(async (): Promise<string[]> => {
    const effective = await getEffectiveOwnershipConditions(user);
    if (!user?.id) {
      return effective ? [effective] : [];
    }

    const combined = `owner_id.eq.${user.id},user_id.eq.${user.id}`;
    if (!effective || effective === combined) {
      return [combined];
    }
    return [combined, effective];
  }, [user]);

  // Derive upload size cap from server-provided effective limits.
  useEffect(() => {
    const maxFileMb = Number((limitsUsage?.limits || {})?.max_file_mb);
    if (!Number.isFinite(maxFileMb)) {
      setMaxUploadSize(50 * 1024 * 1024);
      return;
    }
    if (maxFileMb <= 0) {
      setMaxUploadSize(Number.MAX_SAFE_INTEGER);
      return;
    }
    setMaxUploadSize(Math.floor(maxFileMb * 1024 * 1024));
  }, [limitsUsage?.limits]);

  const mergeJobs = useCallback((remoteJobs: UploadJobRow[]) => {
    setJobs(currentJobs => {
      const normalizedRemoteJobs = remoteJobs.map((job) => ({
        ...job,
        owner_id: job.owner_id ?? job.user_id ?? null,
        user_id: job.user_id ?? job.owner_id ?? null,
      }));
      const remoteMap = new Map(normalizedRemoteJobs.map(j => [j.id, j]));
      const merged: UploadJobRow[] = [];
      const processedIds = new Set<string>();

      currentJobs.forEach(localJob => {
        if (processedIds.has(localJob.id)) return;

        const remoteJob = remoteMap.get(localJob.id);
        
        if (!remoteJob) {
          if (isActiveStatus(localJob.status) || localJob.status === 'failed') {
            merged.push(localJob);
            processedIds.add(localJob.id);
          }
        } else {
          const isUploadingLocal = localJob.status === 'uploading';
          const isPostUploadRemote = ['queued', 'uploaded', 'processing', 'done'].includes(remoteJob.status);
          const remoteRegressed =
            statusRank(remoteJob.status) < statusRank(localJob.status) &&
            !isTerminalStatus(remoteJob.status);
          const preserveLocalTerminal =
            isTerminalStatus(localJob.status) &&
            !isTerminalStatus(remoteJob.status);
          
          let finalStatus = remoteJob.status;
          let finalProgress = remoteJob.progress ?? 0;

          if (preserveLocalTerminal || remoteRegressed) {
            finalStatus = localJob.status;
            finalProgress = Math.max(localJob.progress, finalProgress);
          } else if (isUploadingLocal && isPostUploadRemote) {
            finalProgress = 100;
          } else if (remoteJob.status === localJob.status) {
            finalProgress = Math.max(localJob.progress, finalProgress);
          }

          merged.push({ ...remoteJob, status: finalStatus, progress: finalProgress });
          processedIds.add(localJob.id);
        }
      });

      normalizedRemoteJobs.forEach(remoteJob => {
        if (!processedIds.has(remoteJob.id)) {
          merged.push(remoteJob);
          processedIds.add(remoteJob.id);
        }
      });

      return merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
    });
  }, []);

  const normalizeJobRows = useCallback((rows: any[], includeError: boolean): UploadJobRow[] => {
    return rows.map((j: any) => ({
      ...j,
      owner_id: j.owner_id ?? j.user_id ?? null,
      user_id: j.user_id ?? j.owner_id ?? null,
      error: includeError ? (j.error || null) : null,
    })) as UploadJobRow[];
  }, []);

  const reconcileJobsWithDocuments = useCallback(
    async (rows: UploadJobRow[]): Promise<UploadJobRow[]> => {
      if (!user?.id || rows.length === 0) return rows;

      const targetDocumentIds = Array.from(
        new Set(
          rows
            .filter((job) => job.status === 'queued' || job.status === 'uploaded' || job.status === 'processing')
            .map((job) => job.document_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      if (targetDocumentIds.length === 0) return rows;

      const { data: documentRows, error: documentError } = await supabase
        .from('au_documents')
        .select('id,status,error,created_at')
        .in('id', targetDocumentIds)
        .limit(targetDocumentIds.length);

      if (documentError) {
        console.warn('[upload-jobs] Failed to reconcile with au_documents', {
          message: documentError.message,
          details: documentError.details,
          hint: documentError.hint,
        });
        return rows;
      }
      if (!documentRows) return rows;

      const docMap = new Map<string, any>();
      for (const row of documentRows) {
        if (!row?.id) continue;
        docMap.set(String(row.id), row);
      }

      return rows.map((job) => {
        const doc = docMap.get(job.document_id);
        if (!doc) return job;

        const docStatus = String(doc.status || '').toLowerCase();
        const docTimestamp = typeof doc.created_at === 'string' ? doc.created_at : job.updated_at;

        if (docStatus === 'failed') {
          return {
            ...job,
            status: 'failed',
            error: (typeof doc.error === 'string' && doc.error) || job.error || 'Document processing failed.',
            updated_at: docTimestamp,
          };
        }

        if (docStatus === 'completed' || docStatus === 'done' || docStatus === 'indexed') {
          return {
            ...job,
            status: 'done',
            progress: 100,
            error: null,
            updated_at: docTimestamp,
          };
        }

        if (docStatus === 'processing' || docStatus === 'uploaded') {
          return {
            ...job,
            status: 'processing',
            progress: Math.max(job.progress || 0, 92),
            updated_at: docTimestamp,
          };
        }

        return job;
      });
    },
    [user?.id],
  );

  const refreshJobs = useCallback(async () => {
    if (isLoadingAuth) {
      return;
    }
    if (isAuthLocked) {
      setJobs([]);
      return;
    }
    if (!user || !session?.access_token) {
      setJobs([]);
      return;
    }
    if (!isOnline) {
      return;
    }

    try {
      const ownershipConditions = await getWorkerOwnershipConditions();
      if (ownershipConditions.length === 0) return;
      
      const safeColumns = [
        'id', 'owner_id', 'user_id', 'document_id', 'label', 'file_name', 'mime_type', 
        'file_size_bytes', 'bucket', 'object_path', 'status', 'progress', 
        'tus_url', 'created_at', 'updated_at'
      ];

      if (useSafeSelection) {
        let safeData: any[] | null = null;
        for (const safeConditions of ownershipConditions) {
          const query = supabase
            .from('au_worker_jobs')
            .select(safeColumns.join(', '))
            .order('created_at', { ascending: false })
            .limit(50);

          applyOwnershipFilter(query, safeConditions);
          const { data, error } = await query;
          if (error) {
            if (isMissingOwnerIdColumnError(error) && safeConditions.includes('owner_id')) {
              continue;
            }
            break;
          }
          safeData = data || [];
          break;
        }

        if (safeData) {
          const normalizedRows = normalizeJobRows(safeData, true);
          const reconciledRows = await reconcileJobsWithDocuments(normalizedRows);
          mergeJobs(reconciledRows);
        }
        return;
      }

      let data: any[] | null = null;
      let error: any = null;
      for (const conditions of ownershipConditions) {
        const query = supabase
          .from('au_worker_jobs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);

        applyOwnershipFilter(query, conditions);
        const result = await query;
        data = result.data || null;
        error = result.error || null;

        if (!error) break;
        if (isMissingOwnerIdColumnError(error) && conditions.includes('owner_id')) {
          continue;
        }
        break;
      }

      if (error) {
        const isMissingErrorCol = isMissingUploadJobsErrorColumn(error);

        if (isMissingErrorCol) {
          setUseSafeSelection(true);
          
          for (const safeConditions of ownershipConditions) {
            const query2 = supabase
              .from('au_worker_jobs')
              .select(safeColumns.join(', '))
              .order('created_at', { ascending: false })
              .limit(50);

            applyOwnershipFilter(query2, safeConditions);
            const { data: data2, error: error2 } = await query2;
            if (error2) {
              if (isMissingOwnerIdColumnError(error2) && safeConditions.includes('owner_id')) {
                continue;
              }
              break;
            }

            if (data2) {
              const normalizedRows = normalizeJobRows(data2, false);
              const reconciledRows = await reconcileJobsWithDocuments(normalizedRows);
              mergeJobs(reconciledRows);
              return;
            }
          }
        }
      } else if (data) {
        const normalizedRows = normalizeJobRows(data as any[], true);
        const reconciledRows = await reconcileJobsWithDocuments(normalizedRows);
        mergeJobs(reconciledRows);
      }
    } catch (err) {
      console.error('[upload-jobs] Unexpected error in refreshJobs:', err);
    }
  }, [
    getWorkerOwnershipConditions,
    isAuthLocked,
    isLoadingAuth,
    isOnline,
    mergeJobs,
    normalizeJobRows,
    reconcileJobsWithDocuments,
    session?.access_token,
    useSafeSelection,
    user,
  ]);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (isAuthLocked) {
      setJobs([]);
      return;
    }
    if (!user || !session?.access_token) {
      setJobs([]);
      return;
    }
    if (!isOnline) return;

    refreshJobs();

    const interval = setInterval(() => {
      setJobs((currentJobs) => {
        const hasActive = currentJobs.some((j) => isActiveStatus(j.status));
        if (hasActive) {
          refreshJobs();
        }
        return currentJobs;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [isAuthLocked, isLoadingAuth, isOnline, refreshJobs, session?.access_token, user]);

  useEffect(() => {
    if (isAuthLocked) return;
    const PROCESSING_STUCK_MS = 10 * 60 * 1000;
    const UPLOADING_STUCK_MS = 5 * 60 * 1000;
    const QUEUED_STUCK_MS = 3 * 60 * 1000;
    const interval = setInterval(() => {
      const now = Date.now();
      jobs.forEach((j) => {
        const updatedAt = Date.parse(j.updated_at);
        if (Number.isNaN(updatedAt)) return;

        if (j.status === 'processing' && now - updatedAt > PROCESSING_STUCK_MS && !stuckNotifiedRef.current.has(j.id)) {
          stuckNotifiedRef.current.add(j.id);
          toast({
            title: 'Processing taking longer than expected',
            description: `"${j.file_name}" may be stuck. You can retry from Uploads.`,
            variant: 'destructive',
          });
        } else if (j.status === 'uploading' && now - updatedAt > UPLOADING_STUCK_MS && !stuckNotifiedRef.current.has(j.id)) {
          stuckNotifiedRef.current.add(j.id);
          toast({
            title: 'Upload taking longer than expected',
            description: `"${j.file_name}" may be stuck. Check your network and retry.`,
            variant: 'destructive',
          });
        } else if ((j.status === 'queued' || j.status === 'uploaded') && now - updatedAt > QUEUED_STUCK_MS && !stuckNotifiedRef.current.has(j.id)) {
          stuckNotifiedRef.current.add(j.id);
          toast({
            title: 'Upload is queued for too long',
            description: `"${j.file_name}" is waiting for backend processing. Check VPS worker/queue health.`,
            variant: 'destructive',
          });
        }
      });
    }, 15000);
    return () => clearInterval(interval);
  }, [isAuthLocked, jobs, toast]);

  const updateJobRow = useCallback(
    async (jobId: string, patch: Partial<UploadJobRow>) => {
      const ownershipConditions = await getWorkerOwnershipConditions();
      if (ownershipConditions.length === 0) return;
      const safePatch = { ...patch };
      if (useSafeSelection) {
        delete (safePatch as any).error;
      }

      const runUpdate = async (payload: Partial<UploadJobRow>) => {
        let latestError: any = null;
        for (const conditions of ownershipConditions) {
          const query = supabase
            .from('au_worker_jobs')
            .update(payload)
            .eq('id', jobId);

          applyOwnershipFilter(query, conditions);
          const { error } = await query;
          if (!error) return null;

          latestError = error;
          if (isMissingOwnerIdColumnError(error) && conditions.includes('owner_id')) {
            continue;
          }
          return error;
        }
        return latestError;
      };

      const error = await runUpdate(safePatch);
      if (!error) return;

      const isMissingErrorCol = isMissingUploadJobsErrorColumn(error);

      if (Object.prototype.hasOwnProperty.call(safePatch, 'error') && isMissingErrorCol) {
        setUseSafeSelection(true);
        const nextPatch = { ...(safePatch as any) };
        if (isMissingErrorCol) {
          delete nextPatch.error;
        }
        await runUpdate(nextPatch);
      }
    },
    [getWorkerOwnershipConditions, useSafeSelection]
  );

  const updateJobLocal = useCallback((jobId: string, patch: Partial<UploadJobRow>) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? ({ ...j, ...patch } as UploadJobRow) : j)));
  }, []);

  const runUpload = useCallback(
    async (job: UploadJobRow, retryAttempt = 0) => {
      if (runningRef.current.has(job.id)) return;
      runningRef.current.add(job.id);

      const controller = new AbortController();
      controllersRef.current.set(job.id, controller);
      const unregisterAuthAbort = registerAuthBoundAbortController(controller);
      let handedOffToRetry = false;

      try {
        if (isAuthLocked) {
          throw new Error('Session expired. Please sign in again.');
        }
        const correlationId = job.id;
        const gate = guardRequest({
          isOnline,
          requireAuth: true,
          accessToken: session?.access_token ?? null,
          allowOfflineRead: false,
          warnKey: 'upload:run',
          context: 'upload job',
        });
        if (!gate.ok) {
          throw new Error(
            gate.reason === 'offline'
              ? 'Offline. Connect to the internet to upload.'
              : 'Sign in required to upload.',
          );
        }

        const file = await getJobFile(job.id);
        if (!file) throw new Error('Missing file data. Retry upload.');
        const resolvedMimeType = ensureUploadMimeType(file.name, resolveUploadMimeType(file));

        const { data: { session: currentSession } } = await supabase.auth.getSession();
        let accessToken = currentSession?.access_token;
        
        if (accessToken === 'undefined' || accessToken === 'null') {
          accessToken = undefined;
        }

        const effectiveUserId = currentSession?.user?.id;
        if (!effectiveUserId) throw new Error('Could not determine owner ID. Please sign in or refresh.');
        if (!accessToken) throw new Error('Sign in required to upload.');

        // Use dynamic limit
        if (file.size > maxUploadSize) {
          throw new Error(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds the ${(maxUploadSize / 1024 / 1024).toFixed(0)}MB limit.`);
        }

        const { data: docData } = await supabase
          .from('au_documents')
          .select('expires_at, parent_id, document_type')
          .eq('id', job.document_id)
          .maybeSingle();
        
        const effectiveParentId = job.parent_id || docData?.parent_id;
        const effectiveDocumentType = String(job.document_type || docData?.document_type || 'main_textbook')
          .toLowerCase()
          .trim()
          .replace(/\s+/g, "_");

        updateJobLocal(job.id, { status: 'uploading', progress: 5 });

        // 4. Initiate Upload (Server-side validation)
        console.log(`[upload-jobs] [${correlationId}] Initiating upload for ${job.id}...`);
        const initResult = await initiateUpload(
            user, 
            {
                fileName: job.file_name,
                fileSize: file.size,
                documentType: effectiveDocumentType,
                jobId: job.id,
                uploadId: job.id,
                correlationId,
                documentId: job.document_id,
                parentId: effectiveParentId,
            },
            accessToken || undefined
        );

        if (!initResult.ok || !initResult.uploadUrl) {
            throw new Error((initResult as any).error || "Upload initiation failed");
        }
        const uploadMimeType = ensureUploadMimeType(
          job.file_name,
          (initResult.contentType || resolvedMimeType) as string,
        );
        const uploadFile = file.type === uploadMimeType
          ? file
          : new File([file], file.name, { type: uploadMimeType, lastModified: file.lastModified });

        // 5. Upload File (PUT to Signed URL)
        console.log(`[upload-jobs] [${correlationId}] Uploading to Signed URL...`);
        updateJobLocal(job.id, { status: 'uploading', progress: 10 });

        let uploaded = false;
        const bucketName = initResult.bucket || process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';

        // Prefer Supabase signed-upload API when token/path are available.
        if (initResult.token && initResult.path) {
          const { error: signedUploadError } = await supabase.storage
            .from(bucketName)
            .uploadToSignedUrl(initResult.path, initResult.token, uploadFile, {
              contentType: uploadMimeType,
              upsert: true,
            });

          if (!signedUploadError) {
            uploaded = true;
          } else {
            console.warn('[upload-jobs] uploadToSignedUrl failed, falling back to fetch PUT:', signedUploadError.message);
          }
        }

        if (!uploaded) {
          const uploadRes = await fetch(initResult.uploadUrl, {
            method: 'PUT',
            body: uploadFile,
            headers: {
              'Content-Type': uploadMimeType,
              'x-upsert': 'true',
            },
            signal: controller.signal,
          });

          if (!uploadRes.ok) {
            const raw = await uploadRes.text().catch(() => '');
            const details = raw || uploadRes.statusText || 'Bad Request';
            throw new Error(`Upload failed (${uploadRes.status}): ${details}`);
          }
        }
        
        updateJobLocal(job.id, { progress: 90 });

        // 6. Complete Upload (Register Job)
        console.log(`[upload-jobs] [${correlationId}] Completing upload...`);
        const completeResult = await completeUpload(
            user,
            {
                documentId: job.document_id,
                jobId: job.id,
                uploadId: job.id,
                correlationId,
                fileName: job.file_name,
                fileSize: file.size,
                mimeType: uploadMimeType,
                path: initResult.path,
                bucket: bucketName,
            },
            accessToken || undefined
        );

        if (!completeResult.ok) {
            throw new Error((completeResult as any).error || "Upload completion failed");
        }

        console.log(`[upload-jobs] [${correlationId}] Registration success for ${job.id}.`);
        blockedAutoRestartRef.current.delete(job.id);

        updateJobLocal(job.id, {
          status: 'queued',
          progress: 100
        });
        
        await updateJobRow(job.id, { 
          status: 'queued', 
          progress: 100, 
          updated_at: new Date().toISOString() 
        } as any);

        try { await deleteJobFile(job.id); } catch {}
        
      } catch (e: any) {
        const limitPayload = extractLimitExceededPayload(e);
        if (limitPayload) {
          reportServerLimitError(limitPayload);
        }

        const errorContext = getUploadErrorContext(e);
        const errorMsg = errorContext.message;
        const errorStatus = errorContext.status;
        const errorCode = errorContext.code;

        if (e.isThrottled) {
          setIsThrottled(true);
        }

        const isRetryable = !limitPayload && isRetryableUploadError({
          status: errorStatus,
          code: errorCode,
          message: errorMsg,
          details: errorContext.details,
        });

        if (isRetryable && retryAttempt < 3) {
          const delay = Math.pow(2, retryAttempt) * 1000;
          console.warn(
            `[upload-jobs] Retryable error, attempt ${retryAttempt + 1} in ${delay}ms:`,
            {
              message: errorMsg,
              status: errorStatus || null,
              code: errorCode || null,
              details: errorContext.details,
            },
          );
          
          await new Promise(resolve => setTimeout(resolve, delay));
          handedOffToRetry = true;
          controllersRef.current.delete(job.id);
          runningRef.current.delete(job.id);
          unregisterAuthAbort();
          return await runUpload(job, retryAttempt + 1);
        } else if (e?.name === 'AbortError') {
          const cancelledAt = new Date().toISOString();
          updateJobLocal(job.id, { status: 'cancelled', updated_at: cancelledAt });
          try {
            await updateJobRow(job.id, {
              status: 'cancelled',
              updated_at: cancelledAt,
            } as any);
          } catch (updateError) {
            console.warn('[upload-jobs] Failed to persist cancelled status:', updateError);
          }
        } else {
          const friendlyLimitError = limitPayload
            ? `Limit exceeded (${String(limitPayload.limit || 'unknown')}).`
            : '';
          const finalError = friendlyLimitError || errorMsg || 'Upload failed.';
          const failedAt = new Date().toISOString();
          blockedAutoRestartRef.current.add(job.id);
          updateJobLocal(job.id, {
            status: 'failed',
            error: finalError,
            updated_at: failedAt,
          });
          try {
            await updateJobRow(job.id, {
              status: 'failed',
              error: finalError,
              updated_at: failedAt,
            } as any);
          } catch (updateError) {
            console.warn('[upload-jobs] Failed to persist failed status:', updateError);
          }
        }
      } finally {
        if (!handedOffToRetry) {
          controllersRef.current.delete(job.id);
          runningRef.current.delete(job.id);
          unregisterAuthAbort();
        }
      }
    },
    [isAuthLocked, isOnline, maxUploadSize, reportServerLimitError, session?.access_token, updateJobLocal, updateJobRow, user]
  );

  useEffect(() => {
    if (!user) return;
    if (isAuthLocked) return;
    if (!isOnline) return;
    if (isLoadingAuth) return;
    if (!session?.access_token) return;

    const active = jobs.filter((j) => isActiveStatus(j.status));
    active.forEach((j) => {
      if (blockedAutoRestartRef.current.has(j.id)) return;
      if (j.status === 'processing' || j.status === 'done' || j.status === 'cancelled') return;
      if (j.status === 'queued' || j.status === 'uploading' || j.status === 'uploaded') {
        if (j.status === 'queued' || j.status === 'uploaded') return;
        runUpload(j);
      }
    });
  }, [isAuthLocked, isLoadingAuth, isOnline, jobs, runUpload, session?.access_token, user]);

  const enqueueUploads = useCallback(
    async (inputs: CreateUploadJobInput[]) => {
      if (isAuthLocked) {
        throw new Error('Session expired. Please sign in again.');
      }
      const gate = guardRequest({
        isOnline,
        requireAuth: true,
        accessToken: session?.access_token ?? null,
        allowOfflineRead: false,
        warnKey: 'upload:enqueue',
        context: 'upload enqueue',
      });
      if (!gate.ok) {
        throw new Error(
          gate.reason === 'offline'
            ? 'Offline. Connect to the internet to upload.'
            : 'Authentication required to upload.',
        );
      }

      if (isLoadingAuth) throw new Error('Authentication is still loading. Please try again.');
      if (!session?.access_token) throw new Error('Authentication required to upload.');

      const { data: sessionData } = await supabase.auth.getSession();
      const authUser = sessionData.session?.user ?? null;
      
      if (!authUser?.id) {
        throw new Error('Authentication required to upload.');
      }

      const createdJobs: UploadJobRow[] = [];
      const errors: string[] = [];

      for (const input of inputs) {
        const file = input.file;

        // Use dynamic limit
        const fileVal = validateFile(file, maxUploadSize);
        if (!fileVal.valid) {
          errors.push(`${file.name}: ${fileVal.error}`);
          continue;
        }

        const jobId = createId();
        const docId = createId();
        const safeFileName = normalizeFileName(file.name);
        const effectiveUserId = authUser.id;
        
        const nowIso = new Date().toISOString();
        const job: UploadJobRow = {
          id: jobId,
          document_id: docId,
          document_type: input.documentType,
          parent_id: input.parentId ?? null,
          user_id: effectiveUserId,
          owner_id: effectiveUserId,
          label: input.label ?? null,
          file_name: safeFileName,
          mime_type: resolveUploadMimeType(file),
          file_size_bytes: file.size,
          bucket: process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents',
          object_path: '',
          status: 'uploading',
          progress: 0,
          tus_url: null,
          error: null,
          created_at: nowIso,
          updated_at: nowIso,
        };

        try {
          await putJobFile(jobId, file);
          createdJobs.push(job);
          setJobs((prev) => [job, ...prev]);
        } catch (err: any) {
          console.error(`[upload-jobs] Failed to store file for ${file.name}:`, err);
          errors.push(`${file.name}: Failed to prepare upload`);
        }
      }

      if (errors.length > 0 && createdJobs.length === 0) {
        throw new Error(errors.join('\n'));
      }
    },
    [isAuthLocked, isLoadingAuth, isOnline, maxUploadSize, session?.access_token]
  );

  const cancelJob = useCallback(
    async (jobId: string) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;

      const controller = controllersRef.current.get(jobId);
      if (controller) controller.abort();

      updateJobLocal(jobId, { status: 'cancelled' });
      
      try {
        await updateJobRow(jobId, { status: 'cancelled', updated_at: new Date().toISOString() } as any);
      } catch (e) {
        console.warn('[upload-jobs] Failed to update job row status:', e);
      }

      try {
        await deleteJobFile(jobId);
      } catch {}

      try {
        await supabase.storage.from(job.bucket).remove([job.object_path]);
      } catch {}

      try {
        const conditions = await getEffectiveOwnershipConditions(user);
        const docUpdateQuery = supabase
          .from('au_documents')
          .update({ status: 'failed', error: 'Cancelled' })
          .eq('id', job.document_id);
        
        applyOwnershipFilter(docUpdateQuery, conditions);
        await docUpdateQuery;
      } catch {}
    },
    [jobs, updateJobLocal, updateJobRow, user]
  );

  const removeJob = useCallback(
    async (jobId: string) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;

      updateJobLocal(jobId, { status: 'deleting' });

      const controller = controllersRef.current.get(jobId);
      if (controller) controller.abort();

      try {
        await deleteDocument(user, job.document_id);
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
        try { await deleteJobFile(job.id); } catch {}
      } catch (err: any) {
        console.error('[upload-jobs] Delete failed:', err);
        updateJobLocal(jobId, { status: 'failed', error: 'Deletion failed. Try again.' });
        toast({
          title: 'Delete failed',
          description: err.message || 'Could not delete document.',
          variant: 'destructive',
        });
      }
    },
    [jobs, user, updateJobLocal, toast]
  );

  const retryJob = useCallback(
    async (jobId: string) => {
      if (!user) return;
      if (isAuthLocked) return;
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;

      const file = await getJobFile(jobId);
      if (!file) {
        updateJobLocal(jobId, { status: 'failed', error: 'Missing file data. Re-add the file.' });
        await updateJobRow(jobId, { status: 'failed', error: 'Missing file data. Re-add the file.' } as any);
        return;
      }

      try {
        await supabase.storage.from(job.bucket).remove([job.object_path]);
      } catch {}
      try {
        const conditions = await getEffectiveOwnershipConditions(user);
        const chunkDeleteQuery = supabase.from('au_document_chunks')
          .delete()
          .eq('document_id', job.document_id);
        
        applyOwnershipFilter(chunkDeleteQuery, conditions);
        await chunkDeleteQuery;
      } catch {}

      blockedAutoRestartRef.current.delete(jobId);
      updateJobLocal(jobId, { status: 'uploading', progress: 0, error: null, tus_url: null });
      await updateJobRow(jobId, { status: 'uploading', progress: 0, error: null, tus_url: null, updated_at: new Date().toISOString() } as any);
      
      const conditions = await getEffectiveOwnershipConditions(user);
      const docUpdateQuery = supabase
        .from('au_documents')
        .update({ status: 'uploading', error: null })
        .eq('id', job.document_id);
      
      applyOwnershipFilter(docUpdateQuery, conditions);
      await docUpdateQuery;
    },
    [isAuthLocked, jobs, updateJobLocal, updateJobRow, user]
  );

  const attachFileToJob = useCallback(
    async (jobId: string, file: File) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;

      await putJobFile(jobId, file);
      blockedAutoRestartRef.current.delete(jobId);

      updateJobLocal(jobId, {
        status: 'uploading',
        progress: 0,
        error: null,
        tus_url: null,
        mime_type: resolveUploadMimeType(file),
        file_size_bytes: file.size,
      });

      await updateJobRow(
        jobId,
        {
          status: 'uploading',
          progress: 0,
          error: null,
          tus_url: null,
          mime_type: resolveUploadMimeType(file),
          file_size_bytes: file.size,
          updated_at: new Date().toISOString(),
        } as any
      );

      const conditions = await getEffectiveOwnershipConditions(user);
      const docUpdateQuery = supabase
        .from('au_documents')
        .update({ status: 'uploading', error: null })
        .eq('id', job.document_id);
      
      applyOwnershipFilter(docUpdateQuery, conditions);
      await docUpdateQuery;
    },
    [jobs, updateJobLocal, updateJobRow, user]
  );

  const activeJobs = useMemo(
    () =>
      jobs
        .filter((j) => isActiveStatus(j.status))
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [jobs]
  );

  const hasFailedJobs = useMemo(() => jobs.some((j) => j.status === 'failed'), [jobs]);
  const hasCompletedJobs = useMemo(
    () => jobs.some((j) => j.status === 'completed' || j.status === 'done'),
    [jobs]
  );

  const value = useMemo<UploadJobsContextValue>(
    () => ({
      jobs,
      activeJobs,
      hasFailedJobs,
      hasCompletedJobs,
      isThrottled,
      maxUploadSize,
      setIsThrottled,
      enqueueUploads,
      cancelJob,
      retryJob,
      attachFileToJob,
      removeJob,
    }),
    [
      attachFileToJob,
      cancelJob,
      enqueueUploads,
      jobs,
      removeJob,
      retryJob,
      activeJobs,
      hasFailedJobs,
      hasCompletedJobs,
      isThrottled,
      maxUploadSize,
      setIsThrottled,
    ]
  );

  return <UploadJobsContext.Provider value={value}>{children}</UploadJobsContext.Provider>;
}

export function useUploadJobs() {
  const ctx = useContext(UploadJobsContext);
  if (!ctx) throw new Error('useUploadJobs must be used within UploadJobsProvider');
  return ctx;
}
