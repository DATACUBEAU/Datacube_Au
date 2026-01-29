'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { 
  validateFile, 
  validateGuestSessionId, 
  detectUploadKind, 
  normalizeFileName 
} from '@/lib/upload/file-types';
import { 
  supabase, 
  getGuestToken, 
  decodeJWT, 
  setGuestToken, 
  clearGuestToken,
  ensureGuestSession,
  getEffectiveOwnershipConditions,
  applyOwnershipFilter
} from '@/lib/supabase/client';
import { uploadDocument, deleteDocument } from '@/lib/api/documents';
import { safeFetch } from '@/lib/api/safe-fetch';
import type { UploadJobRow, CreateUploadJobInput, UploadJobStatus } from '@/lib/upload/types';
import { deleteJobFile, getJobFile, putJobFile } from '@/lib/upload/idb';
import { createTusUpload, uploadTus } from '@/lib/upload/tus';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '@/hooks/use-toast';

type UploadJobsContextValue = {
  jobs: UploadJobRow[];
  activeJobs: UploadJobRow[];
  hasFailedJobs: boolean;
  hasCompletedJobs: boolean;
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
  const [session] = useSupabaseSession();
  const { toast } = useToast();

  const [jobs, setJobs] = useState<UploadJobRow[]>([]);
  const [useSafeSelection, setUseSafeSelection] = useState<boolean>(false);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const runningRef = useRef<Set<string>>(new Set());
  const lastProgressWriteRef = useRef<Map<string, number>>(new Map());
  const lastProgressTimeRef = useRef<Map<string, number>>(new Map());
  const stuckNotifiedRef = useRef<Set<string>>(new Set());

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  const ensureAuthenticatedSession = useCallback(async () => {
      try {
        console.log('[upload-jobs] Ensuring authenticated session...');
        const { data, error } = await supabase.auth.getSession();
        if (!error && data.session?.access_token) {
          console.log('[upload-jobs] Found existing session');
          return data.session;
        }
        
        if (error) {
          console.warn('[upload-jobs] Auth session error:', error.message);
        }
      } catch (e) {
        console.error('[upload-jobs] Error getting session:', e);
      }

      console.log('[upload-jobs] No session found, attempting anonymous sign-in...');
      try {
        const { data: anonData, error: anonError } = await supabase.auth.signInAnonymously();
        if (anonError) {
          console.error('[upload-jobs] Anonymous sign-in failed:', anonError.message);
          throw anonError;
        }
        console.log('[upload-jobs] Anonymous sign-in successful');
        return anonData.session;
      } catch (err: any) {
        console.error('[upload-jobs] CRITICAL: Failed to establish any session:', err);
        throw err;
      }
    }, []);

  // Helper to merge remote jobs with local state to prevent flickering
  const mergeJobs = useCallback((remoteJobs: UploadJobRow[]) => {
    setJobs(currentJobs => {
      const remoteMap = new Map(remoteJobs.map(j => [j.id, j]));
      const merged: UploadJobRow[] = [];
      const processedIds = new Set<string>();

      // 1. Preserve local jobs that are actively uploading/queued and not yet in remote
      // OR merge if they exist in remote but local has better progress info
      currentJobs.forEach(localJob => {
        if (processedIds.has(localJob.id)) return;

        const remoteJob = remoteMap.get(localJob.id);
        
        if (!remoteJob) {
          // If local job is active but missing from remote, keep it (optimistic)
          // UNLESS it's very old (stale)
          if (isActiveStatus(localJob.status) || localJob.status === 'failed') {
            merged.push(localJob);
            processedIds.add(localJob.id);
          }
        } else {
          // Job exists in both. Decide which version to keep.
          if (localJob.status === 'uploading' && remoteJob.status === 'queued') {
            merged.push(localJob);
          } else if (localJob.status === 'uploading' && remoteJob.status === 'uploading') {
             // Trust local progress if higher
             if (localJob.progress > (remoteJob.progress || 0)) {
               merged.push({ ...remoteJob, progress: localJob.progress });
             } else {
               merged.push(remoteJob);
             }
          } else {
            // Otherwise trust remote
            merged.push(remoteJob);
          }
          processedIds.add(localJob.id);
        }
      });

      // 2. Add remaining remote jobs
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
    try {
      const fullConditions = await getEffectiveOwnershipConditions(user);
      
      // if (process.env.NODE_ENV === 'development') {
      //   console.log(`[upload-jobs] Refreshing jobs (safe=${useSafeSelection}) with conditions:`, fullConditions);
      // }

      const safeColumns = [
        'id', 'user_id', 'document_id', 'label', 'file_name', 'mime_type', 
        'file_size_bytes', 'bucket', 'object_path', 'status', 'progress', 
        'tus_url', 'created_at', 'updated_at'
      ];

      // If we already know we need safe selection, use it immediately
      if (useSafeSelection) {
        const safeConditions = fullConditions
          .split(',')
          .filter(c => !c.trim().startsWith('guest_session_id'))
          .join(',') || 'id.eq.00000000-0000-0000-0000-000000000000';

        const query = supabase
          .from('au_upload_jobs')
          .select(safeColumns.join(', '))
          .order('created_at', { ascending: false })
          .limit(50);

        applyOwnershipFilter(query, safeConditions);
        const { data, error } = await query;

        if (!error && data) {
          mergeJobs(data.map((j: any) => ({ 
            ...j, 
            error: j.error || null,
            guest_session_id: j.guest_session_id || null 
          })) as UploadJobRow[]);
        }
        return;
      }

      const query = supabase
        .from('au_upload_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      applyOwnershipFilter(query, fullConditions);
      const { data, error } = await query;

      if (error) {
        const errorMsg = error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
        const isMissingGuestSession = errorMsg.includes('guest_session_id') || errorMsg.includes('column "guest_session_id"');
        const isMissingErrorCol = isMissingUploadJobsErrorColumn(error);

        if (isMissingErrorCol || isMissingGuestSession) {
          setUseSafeSelection(true);
          console.warn(`[upload-jobs] Initial fetch failed (missing ${isMissingGuestSession ? 'guest_session_id' : ''}${isMissingGuestSession && isMissingErrorCol ? '/' : ''}${isMissingErrorCol ? 'error' : ''}), switching to safe selection mode`);
          
          const safeConditions = fullConditions
            .split(',')
            .filter(c => !c.trim().startsWith('guest_session_id'))
            .join(',') || 'id.eq.00000000-0000-0000-0000-000000000000';
          
          const query2 = supabase
            .from('au_upload_jobs')
            .select(safeColumns.join(', '))
            .order('created_at', { ascending: false })
            .limit(50);
          
          applyOwnershipFilter(query2, safeConditions);
          const { data: data2, error: error2 } = await query2;
          
          if (!error2 && data2) {
            mergeJobs(data2.map((j: any) => ({ 
              ...j, 
              error: null,
              guest_session_id: null 
            })) as UploadJobRow[]);
            return;
          }
        } else {
          console.error('[upload-jobs] Error fetching jobs:', errorMsg);
        }
      } else if (data) {
        mergeJobs(data as UploadJobRow[]);
      }
    } catch (err) {
      console.error('[upload-jobs] Unexpected error in refreshJobs:', err);
    }
  }, [user?.id, useSafeSelection, mergeJobs]);

  useEffect(() => {
    refreshJobs();

    // Poll for updates if there are active jobs
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
  }, [refreshJobs]);

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

      // Filter patch to remove columns we know are often missing in older schemas
      const safePatch = { ...patch };
      
      // If we already know we need safe selection, apply it immediately
      let conditions = fullConditions;
      if (useSafeSelection) {
        delete (safePatch as any).error;
        delete (safePatch as any).guest_session_id;
        conditions = fullConditions
          .split(',')
          .filter(c => !c.trim().startsWith('guest_session_id'))
          .join(',') || 'id.eq.00000000-0000-0000-0000-000000000000';
      }

      // Manual filtering as RLS is disabled
      const query = supabase
        .from('au_upload_jobs')
        .update(safePatch)
        .eq('id', jobId);
      
      applyOwnershipFilter(query, conditions);
      const { error } = await query;
      
      if (!error) return;

      const errorMsg = error.message || '';
      const isMissingGuest = errorMsg.includes('guest_session_id') || error.code === '42703';
      const isMissingErrorCol = isMissingUploadJobsErrorColumn(error);

      if ((Object.prototype.hasOwnProperty.call(safePatch, 'error') && isMissingErrorCol) || isMissingGuest) {
        setUseSafeSelection(true);
        const nextPatch = { ...(safePatch as any) };
        if (isMissingErrorCol) {
          delete nextPatch.error;
        }

        let retryConditions = conditions;
        if (isMissingGuest) {
          delete nextPatch.guest_session_id; // Also remove from patch if present
          retryConditions = conditions
            .split(',')
            .filter(c => !c.startsWith('guest_session_id'))
            .join(',') || 'id.eq.00000000-0000-0000-0000-000000000000';
        }

        const retryQuery = supabase
          .from('au_upload_jobs')
          .update(nextPatch)
          .eq('id', jobId);
        
        applyOwnershipFilter(retryQuery, retryConditions);
        await retryQuery;
      }
    },
    [user, useSafeSelection]
  );

  const updateJobLocal = useCallback((jobId: string, patch: Partial<UploadJobRow>) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? ({ ...j, ...patch } as UploadJobRow) : j)));
  }, []);

  const writeProgressThrottled = useCallback(
    async (jobId: string, progress: number) => {
      const now = Date.now();
      const lastP = lastProgressWriteRef.current.get(jobId) ?? -1;
      const lastT = lastProgressTimeRef.current.get(jobId) ?? 0;

      if (progress === lastP) return;
      if (now - lastT < 700 && Math.abs(progress - lastP) < 3) return;

      lastProgressWriteRef.current.set(jobId, progress);
      lastProgressTimeRef.current.set(jobId, now);
      await updateJobRow(jobId, { progress, updated_at: new Date().toISOString() } as any);
    },
    [updateJobRow]
  );

  const runUpload = useCallback(
    async (job: UploadJobRow, retryAttempt = 0) => {
      if (runningRef.current.has(job.id)) return;
      runningRef.current.add(job.id);

      const controller = new AbortController();
      controllersRef.current.set(job.id, controller);

      try {
        const file = await getJobFile(job.id);
        if (!file) throw new Error('Missing file data. Retry upload.');

        // 1. Ensure user authentication & token
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        let accessToken = currentSession?.access_token || getGuestToken();
        
        // Sanitize accessToken
        if (accessToken === 'undefined' || accessToken === 'null') {
          accessToken = null;
        }

        // 2. Ensure a valid guest_session_id (if using guest mode)
        let guestSessionId = job.guest_session_id;
        if (!currentSession?.user && !guestSessionId) {
          guestSessionId = await ensureGuestSession();
        }

        // 3. Prepare Storage Upload (Architecture Change: Browser Direct Upload)
        const effectiveUserId = currentSession?.user?.id || guestSessionId;
        if (!effectiveUserId) throw new Error('Could not determine owner ID. Please sign in or refresh.');

        // File size validation
        const MAX_SIZE = 50 * 1024 * 1024; // 50MB
        if (file.size > MAX_SIZE) {
          throw new Error(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds the 50MB limit.`);
        }

        let folder = "uploads";
        if (job.label === "main_textbook") folder = "textbooks";
        else if (job.label === "supplementary") folder = "supplementary";
        
        const safeFileName = job.file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const filePath = `${effectiveUserId}/${folder}/${safeFileName}`;
        const bucket = process.env.NEXT_PUBLIC_SUPABASE_BUCKET || "documents";

        // Update local UI state
        updateJobLocal(job.id, { status: 'uploading', progress: 5 });

        // 4. Upload directly to Supabase Storage using TUS for reliability & progress
        // We use the same anonKey and accessToken (which could be a guest token)
        console.log(`[upload-jobs] Starting direct storage upload for ${job.id} to ${filePath}...`);
        
        const uploadUrl = await createTusUpload({
          supabaseUrl,
          anonKey,
          accessToken: accessToken || anonKey, // Use anonKey as fallback if no token
          bucket,
          objectName: filePath,
          file,
          upsert: true,
        });

        await uploadTus({
          uploadUrl,
          anonKey,
          accessToken: accessToken || anonKey,
          file,
          signal: controller.signal,
          onProgress: (uploaded, total) => {
            const pct = Math.round((uploaded / total) * 90); // 0-90% for upload
            updateJobLocal(job.id, { progress: 5 + pct });
          }
        });

        console.log(`[upload-jobs] Storage upload complete for ${job.id}. Registering with Edge Function...`);

        // 5. Find the document to get its expires_at and parent_id
        const { data: docData } = await supabase
          .from('au_documents')
          .select('expires_at, parent_id')
          .eq('id', job.document_id)
          .maybeSingle();
        
        const effectiveParentId = (job as any).parent_id || docData?.parent_id;

        // 6. Call Edge Function with metadata only (Architecture Change: Metadata-only Edge Function)
        const result = await uploadDocument(
          user,
          {
            fileName: job.file_name,
            filePath,
            fileSize: file.size,
            jobId: job.id,
            documentId: job.document_id,
            guestSessionId: guestSessionId || undefined,
            documentType: job.label ?? undefined,
            expiresAt: docData?.expires_at,
            parentId: effectiveParentId,
          },
          accessToken || undefined
        );

        if (!result.ok) throw new Error('Upload registration failed');

        // On success, the job is enqueued on the backend.
        // We update the local state and stop here.
        updateJobLocal(job.id, { 
          status: 'queued', 
          progress: 100, 
          document_id: result.jobId || job.document_id // The Edge Function might return a new ID
        });
        
        // Update the remote row too so polling sees it's enqueued
        await updateJobRow(job.id, { 
          status: 'queued', 
          progress: 100, 
          updated_at: new Date().toISOString() 
        } as any);

        // Cleanup local file
        try { await deleteJobFile(job.id); } catch {}
        
        // IMPORTANT: We do NOT call runProcessing here anymore.
        // The backend should pick it up asynchronously.
        
      } catch (e: any) {
        // 6. Error handling
        const errorMsg = e.message || '';
        const isGuestError = errorMsg.includes('invalid_guest_session') || 
                            errorMsg.includes('invalid guest_session_id') || 
                            errorMsg.includes('foreign key');
        
        const isRetryable = errorMsg.includes('storage_error') || 
                           errorMsg.includes('server_error') ||
                           e.status >= 500;

        if (isGuestError && retryAttempt === 0) {
          console.warn('[upload-jobs] Session invalid, retrying once after recovery...');
          try {
            await ensureGuestSession();
            runningRef.current.delete(job.id);
            return runUpload(job, retryAttempt + 1);
          } catch (retryErr) {
            updateJobLocal(job.id, { status: 'failed', error: 'Please refresh or sign in.' });
          }
        } else if (isRetryable && retryAttempt < 3) {
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
    [updateJobLocal, updateJobRow, user, ensureGuestSession]
  );

  useEffect(() => {
    // If no user AND no guest token, we can't start uploads yet.
    // useSupabaseUser/useSupabaseSession will eventually establish an anonymous session
    // if a guest token exists.
    if (!user && !getGuestToken()) return;

    const active = jobs.filter((j) => isActiveStatus(j.status));
    active.forEach((j) => {
      if (j.status === 'processing' || j.status === 'done' || j.status === 'cancelled') return;
      if (j.status === 'queued' || j.status === 'uploading' || j.status === 'uploaded') {
        // If it's already uploaded or queued, we just wait for polling to update the status.
        // The backend is responsible for moving it from queued -> processing -> done.
        if (j.status === 'queued' || j.status === 'uploaded') return;
        
        // Only trigger runUpload for jobs that are truly new or need a retry of the upload itself.
        runUpload(j);
      }
    });
  }, [jobs, runUpload, user]);

  const enqueueUploads = useCallback(
    async (inputs: CreateUploadJobInput[]) => {
      // 1. Ensure user authentication
      const { data: sessionData } = await supabase.auth.getSession();
      const authUser = sessionData.session?.user ?? null;
      
      let guestSessionId = null;
      const guestToken = getGuestToken();
      if (guestToken) {
        try {
          const decoded = decodeJWT(guestToken);
          guestSessionId = decoded?.guest_session_id || decoded?.sub;
        } catch (e) {}
      }

      // 3. Ensure a valid guest_session_id (if using guest mode)
      if (!authUser?.id && !guestSessionId) {
        try {
          console.log('[upload-jobs] No auth session or guest token, calling ensureGuestSession...');
          guestSessionId = await ensureGuestSession();
          console.log('[upload-jobs] Established new guest session:', guestSessionId);
        } catch (e: any) {
          console.error('[upload-jobs] ERROR: Failed to establish guest session:', e);
          throw new Error(`Guest session failed: ${e.message || 'Check connection'}`);
        }
      }

      const createdJobs: UploadJobRow[] = [];
      const errors: string[] = [];

      for (const input of inputs) {
        const file = input.file;

        // 2. Local validation before upload
        const fileVal = validateFile(file);
        if (!fileVal.valid) {
          errors.push(`${file.name}: ${fileVal.error}`);
          continue;
        }

        const jobId = createId();
        const docId = createId();
        const safeFileName = normalizeFileName(file.name);
        const effectiveUserId = authUser?.id || guestSessionId;
        
        const nowIso = new Date().toISOString();
        const job: UploadJobRow = {
          id: jobId,
          document_id: docId,
          user_id: effectiveUserId || null,
          guest_session_id: guestSessionId,
          label: input.label ?? null,
          file_name: safeFileName,
          mime_type: file.type || null,
          file_size_bytes: file.size,
          bucket: process.env.NEXT_PUBLIC_SUPABASE_BUCKET || 'documents',
          object_path: '', // Will be set by backend
          status: 'uploading',
          progress: 0,
          tus_url: null,
          error: null,
          created_at: nowIso,
          updated_at: nowIso,
          // Store parent_id temporarily in the job object if needed, 
          // although UploadJobRow might not have it. 
          // We'll use a type cast if necessary or just rely on the input.
        } as any;

        // Add parent_id to the job for runUpload to find it
        if ((input as any).parentId) {
          (job as any).parent_id = (input as any).parentId;
        }

        try {
          await putJobFile(jobId, file);
          createdJobs.push(job);
          // Update UI immediately for each job to show progress bar
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
    [ensureAuthenticatedSession, user]
  );

  const cancelJob = useCallback(
    async (jobId: string) => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return;

      const controller = controllersRef.current.get(jobId);
      if (controller) controller.abort();

      updateJobLocal(jobId, { status: 'cancelled' });
      
      // Best-effort remote updates
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

      // 1. Mark as deleting immediately (Optimistic UI)
      // This prevents freezing by updating state without waiting for the API
      updateJobLocal(jobId, { status: 'deleting' });

      // Stop any running upload
      const controller = controllersRef.current.get(jobId);
      if (controller) controller.abort();

      try {
        // 2. Call the Edge Function for robust cleanup
        // This handles storage, DB, and all relations (chunks, embeddings, jobs)
        // using the server-side logic we verified.
        await deleteDocument(user, job.document_id);
        
        // 3. On success, remove from list completely
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
        
        // Clean up local IDB
        try { await deleteJobFile(job.id); } catch {}
        
      } catch (err: any) {
        console.error('[upload-jobs] Delete failed:', err);
        // On error, revert status to failed so user can try again
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
        mime_type: file.type || null,
        file_size_bytes: file.size,
      });

      await updateJobRow(
        jobId,
        {
          status: 'uploading',
          progress: 0,
          error: null,
          tus_url: null,
          mime_type: file.type || null,
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
  const hasCompletedJobs = useMemo(() => jobs.some((j) => j.status === 'done'), [jobs]);

  const value = useMemo<UploadJobsContextValue>(
    () => ({
      jobs,
      activeJobs,
      hasFailedJobs,
      hasCompletedJobs,
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
    ]
  );

  return <UploadJobsContext.Provider value={value}>{children}</UploadJobsContext.Provider>;
}

export function useUploadJobs() {
  const ctx = useContext(UploadJobsContext);
  if (!ctx) throw new Error('useUploadJobs must be used within UploadJobsProvider');
  return ctx;
}
