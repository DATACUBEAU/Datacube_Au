
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
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '@/hooks/use-toast';
import { useNetworkStatus } from '@/components/providers/network-status-provider';

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

export function UploadJobsProvider({ children }: { children: React.ReactNode }) {
  const [user] = useSupabaseUser();
  const { session, loading: isLoadingAuth } = useSupabaseSession();
  const { toast } = useToast();
  const { isOnline } = useNetworkStatus();

  const [jobs, setJobs] = useState<UploadJobRow[]>([]);
  const [isThrottled, setIsThrottled] = useState(false);
  const [maxUploadSize, setMaxUploadSize] = useState(50 * 1024 * 1024); // Default 50MB
  const [useSafeSelection, setUseSafeSelection] = useState<boolean>(false);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const runningRef = useRef<Set<string>>(new Set());
  const lastProgressWriteRef = useRef<Map<string, number>>(new Map());
  const lastProgressTimeRef = useRef<Map<string, number>>(new Map());
  const stuckNotifiedRef = useRef<Set<string>>(new Set());

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  // Fetch Limit on Load
  useEffect(() => {
    async function fetchLimit() {
       if (!user || !isOnline) return;
       try {
           // 1. Get Tier
           const { data: profile } = await supabase.from("au_user_profiles").select("tier").eq("user_id", user.id).maybeSingle();
           const tier = profile?.tier || "free";
           
           // 2. Get Flag
           const { data: flag } = await supabase.from("au_feature_flags").select("is_enabled").eq("key", "pro_upload_100mb").maybeSingle();
           const is100MB = flag?.is_enabled === true;
           
           if (tier === 'pro' && is100MB) {
               setMaxUploadSize(100 * 1024 * 1024);
           } else {
               setMaxUploadSize(50 * 1024 * 1024);
           }
       } catch (e) {
           console.warn("[upload-jobs] Failed to fetch upload limit, defaulting to 50MB", e);
       }
    }
    fetchLimit();
  }, [isOnline, user]);

  const mergeJobs = useCallback((remoteJobs: UploadJobRow[]) => {
    setJobs(currentJobs => {
      const remoteMap = new Map(remoteJobs.map(j => [j.id, j]));
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
          
          let finalStatus = remoteJob.status;
          let finalProgress = remoteJob.progress ?? 0;

          if (isUploadingLocal && isPostUploadRemote) {
            finalProgress = 100;
          } else if (remoteJob.status === localJob.status) {
            finalProgress = Math.max(localJob.progress, finalProgress);
          }

          merged.push({ ...remoteJob, status: finalStatus, progress: finalProgress });
          processedIds.add(localJob.id);
        }
      });

      remoteJobs.forEach(remoteJob => {
        if (!processedIds.has(remoteJob.id)) {
          merged.push(remoteJob);
          processedIds.add(remoteJob.id);
        }
      });

      return merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
    });
  }, []);

  const refreshJobs = useCallback(async () => {
    if (isLoadingAuth) {
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
      const fullConditions = await getEffectiveOwnershipConditions(user);
      
      const safeColumns = [
        'id', 'user_id', 'document_id', 'label', 'file_name', 'mime_type', 
        'file_size_bytes', 'bucket', 'object_path', 'status', 'progress', 
        'tus_url', 'created_at', 'updated_at'
      ];

      if (useSafeSelection) {
        const safeConditions = fullConditions;

        const query = supabase
          .from('au_worker_jobs')
          .select(safeColumns.join(', '))
          .order('created_at', { ascending: false })
          .limit(50);

        applyOwnershipFilter(query, safeConditions);
        const { data, error } = await query;

        if (!error && data) {
          mergeJobs(data.map((j: any) => ({ 
            ...j, 
            error: j.error || null,
          })) as UploadJobRow[]);
        }
        return;
      }

      const query = supabase
        .from('au_worker_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      applyOwnershipFilter(query, fullConditions);
      const { data, error } = await query;

      if (error) {
        const errorMsg = error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
        const isMissingErrorCol = isMissingUploadJobsErrorColumn(error);

        if (isMissingErrorCol) {
          setUseSafeSelection(true);
          
          const safeConditions = fullConditions;
          
          const query2 = supabase
            .from('au_worker_jobs')
            .select(safeColumns.join(', '))
            .order('created_at', { ascending: false })
            .limit(50);
          
          applyOwnershipFilter(query2, safeConditions);
          const { data: data2, error: error2 } = await query2;
          
          if (!error2 && data2) {
            mergeJobs(data2.map((j: any) => ({ 
              ...j, 
              error: null,
            })) as UploadJobRow[]);
            return;
          }
        }
      } else if (data) {
        mergeJobs(data as UploadJobRow[]);
      }
    } catch (err) {
      console.error('[upload-jobs] Unexpected error in refreshJobs:', err);
    }
  }, [isLoadingAuth, isOnline, session?.access_token, user, useSafeSelection, mergeJobs]);

  useEffect(() => {
    if (isLoadingAuth) return;
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
  }, [isLoadingAuth, isOnline, refreshJobs, session?.access_token, user]);

  useEffect(() => {
    const PROCESSING_STUCK_MS = 10 * 60 * 1000;
    const UPLOADING_STUCK_MS = 5 * 60 * 1000;
    const interval = setInterval(() => {
      const now = Date.now();
      jobs.forEach((j) => {
        const updatedAt = Date.parse(j.updated_at);
        if (Number.isNaN(updatedAt)) return;
        if (j.status === 'processing' && now - updatedAt > PROCESSING_STUCK_MS && !stuckNotifiedRef.current.has(j.id)) {
          stuckNotifiedRef.current.add(j.id);
          toast({
            title: 'Processing taking longer than expected',
            description: `“${j.file_name}” may be stuck. You can retry from Uploads.`,
            variant: 'destructive',
          });
        } else if (j.status === 'uploading' && now - updatedAt > UPLOADING_STUCK_MS && !stuckNotifiedRef.current.has(j.id)) {
          stuckNotifiedRef.current.add(j.id);
          toast({
            title: 'Upload taking longer than expected',
            description: `“${j.file_name}” may be stuck. Check your network and retry.`,
            variant: 'destructive',
          });
        }
      });
    }, 15000);
    return () => clearInterval(interval);
  }, [jobs, toast]);

  const updateJobRow = useCallback(
    async (jobId: string, patch: Partial<UploadJobRow>) => {
      const fullConditions = await getEffectiveOwnershipConditions(user);
      const safePatch = { ...patch };
      let conditions = fullConditions;
      if (useSafeSelection) {
        delete (safePatch as any).error;
        conditions = fullConditions;
      }

      const query = supabase
        .from('au_worker_jobs')
        .update(safePatch)
        .eq('id', jobId);
      
      applyOwnershipFilter(query, conditions);
      const { error } = await query;
      
      if (!error) return;

      const errorMsg = error.message || '';
      const isMissingErrorCol = isMissingUploadJobsErrorColumn(error);

      if (Object.prototype.hasOwnProperty.call(safePatch, 'error') && isMissingErrorCol) {
        setUseSafeSelection(true);
        const nextPatch = { ...(safePatch as any) };
        if (isMissingErrorCol) {
          delete nextPatch.error;
        }

        const retryQuery = supabase
          .from('au_worker_jobs')
          .update(nextPatch)
          .eq('id', jobId);
        
        applyOwnershipFilter(retryQuery, conditions);
        await retryQuery;
      }
    },
    [user, useSafeSelection]
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

      try {
        if (!isOnline) throw new Error('Offline. Connect to the internet to upload.');
        if (!session?.access_token) throw new Error('Sign in required to upload.');

        const file = await getJobFile(job.id);
        if (!file) throw new Error('Missing file data. Retry upload.');
        const resolvedMimeType = resolveUploadMimeType(file);

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
        console.log(`[upload-jobs] Initiating upload for ${job.id}...`);
        const initResult = await initiateUpload(
            user, 
            {
                fileName: job.file_name,
                fileSize: file.size,
                documentType: effectiveDocumentType,
                jobId: job.id,
                documentId: job.document_id,
                parentId: effectiveParentId,
            },
            accessToken || undefined
        );

        if (!initResult.ok || !initResult.uploadUrl) {
            throw new Error((initResult as any).error || "Upload initiation failed");
        }
        const uploadMimeType = initResult.contentType || resolvedMimeType;

        // 5. Upload File (PUT to Signed URL)
        console.log(`[upload-jobs] Uploading to Signed URL...`);
        updateJobLocal(job.id, { status: 'uploading', progress: 10 });

        let uploaded = false;
        const bucketName = initResult.bucket || process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents';

        // Prefer Supabase signed-upload API when token/path are available.
        if (initResult.token && initResult.path) {
          const { error: signedUploadError } = await supabase.storage
            .from(bucketName)
            .uploadToSignedUrl(initResult.path, initResult.token, file, {
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
            body: file,
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
        console.log(`[upload-jobs] Completing upload...`);
        const completeResult = await completeUpload(
            user,
            {
                documentId: job.document_id,
                jobId: job.id,
                fileName: job.file_name,
                fileSize: file.size,
                mimeType: uploadMimeType
            },
            accessToken || undefined
        );

        if (!completeResult.ok) {
            throw new Error((completeResult as any).error || "Upload completion failed");
        }

        console.log(`[upload-jobs] Registration success for ${job.id}.`);

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
        const errorMsg = e.message || '';

        if (e.isThrottled) {
          setIsThrottled(true);
        }

        const isRetryable = errorMsg.includes('storage_error') || 
                           errorMsg.includes('server_error') ||
                           e.status >= 500;

        if (isRetryable && retryAttempt < 3) {
          const delay = Math.pow(2, retryAttempt) * 1000;
          console.warn(`[upload-jobs] Retryable error, attempt ${retryAttempt + 1} in ${delay}ms:`, errorMsg);
          
          await new Promise(resolve => setTimeout(resolve, delay));
          runningRef.current.delete(job.id);
          return runUpload(job, retryAttempt + 1);
        } else if (e?.name === 'AbortError') {
          updateJobLocal(job.id, { status: 'cancelled' });
        } else {
          updateJobLocal(job.id, { status: 'failed', error: errorMsg || 'Upload failed.' });
        }
      } finally {
        controllersRef.current.delete(job.id);
        runningRef.current.delete(job.id);
      }
    },
    [isOnline, session?.access_token, updateJobLocal, updateJobRow, user, maxUploadSize]
  );

  useEffect(() => {
    if (!user) return;
    if (!isOnline) return;
    if (isLoadingAuth) return;
    if (!session?.access_token) return;

    const active = jobs.filter((j) => isActiveStatus(j.status));
    active.forEach((j) => {
      if (j.status === 'processing' || j.status === 'done' || j.status === 'cancelled') return;
      if (j.status === 'queued' || j.status === 'uploading' || j.status === 'uploaded') {
        if (j.status === 'queued' || j.status === 'uploaded') return;
        runUpload(j);
      }
    });
  }, [isLoadingAuth, isOnline, jobs, runUpload, session?.access_token, user]);

  const enqueueUploads = useCallback(
    async (inputs: CreateUploadJobInput[]) => {
      if (!isOnline) throw new Error('Offline. Connect to the internet to upload.');
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
    [isLoadingAuth, isOnline, maxUploadSize, session?.access_token]
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
    [jobs, updateJobLocal, updateJobRow, user]
  );

  const attachFileToJob = useCallback(
    async (jobId: string, file: File) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;

      await putJobFile(jobId, file);

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
