'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useUploadJobs } from '@/components/upload/upload-jobs-provider';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import type { AuDocumentRow, AuDocumentType } from '@/lib/au/types';
import { listAuDocumentsForUser, countPastQuestionsForParent } from '@/lib/au/documents';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { detectUploadKind, normalizeFileName, supportedExtensions, validateFile } from '@/lib/upload/file-types';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import { UploadCloud, X, RefreshCw, CheckCircle2, AlertTriangle, Loader2, Info } from 'lucide-react';
import { TruncatedText } from '@/components/TruncatedText';

// Use both MIME types and extensions for better browser compatibility
const ACCEPT = 'application/pdf,.pdf,text/plain,.txt,text/markdown,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx';

function statusLabel(status: string) {
  switch (status) {
    case 'queued':
      return { text: 'Queued', variant: 'secondary' as const };
    case 'uploading':
      return { text: 'Uploading', variant: 'default' as const };
    case 'uploaded':
      return { text: 'Enqueued', variant: 'secondary' as const };
    case 'processing':
      return { text: 'Processing', variant: 'secondary' as const };
    case 'done':
      return { text: 'Done', variant: 'default' as const };
    case 'failed':
      return { text: 'Failed', variant: 'destructive' as const };
    case 'cancelled':
      return { text: 'Cancelled', variant: 'outline' as const };
    default:
      return { text: status, variant: 'outline' as const };
  }
}

export default function UploadCenter() {
  const { toast } = useToast();
  const [user] = useSupabaseUser();
  const isOnline = useOnlineStatus();
  const { 
    jobs, 
    activeJobs,
    hasFailedJobs,
    enqueueUploads, 
    cancelJob, 
    retryJob, 
    attachFileToJob, 
    removeJob 
  } = useUploadJobs();

  const inputRef = useRef<HTMLInputElement | null>(null);
  const retryFileInputRef = useRef<HTMLInputElement | null>(null);
  const [label, setLabel] = useState('');
  const [docType, setDocType] = useState<AuDocumentType>('main_textbook');
  const [parentId, setParentId] = useState<string | null>(null);
  const [parents, setParents] = useState<AuDocumentRow[]>([]);
  const [parentsLoading, setParentsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [reattachJobId, setReattachJobId] = useState<string | null>(null);

  const supportsUploads = Boolean(user) && isOnline;

  const loadParents = useCallback(async () => {
    if (!user) return;
    
    setParentsLoading(true);
    try {
      // Load all textbooks, even those still processing, so user can attach sub-files
      const allDocs = await listAuDocumentsForUser(user);
      const textbooks = allDocs.filter(d => d.document_type === 'main_textbook');
      setParents(textbooks);
    } catch (err) {
      console.error('Failed to load textbooks:', err);
      setParents([]);
    } finally {
      setParentsLoading(false);
    }
  }, [user]);

  const needsParent = docType === 'past_questions';

  // Load parents when document type changes to one that needs a parent
  useEffect(() => {
    if (needsParent && user && !parentsLoading && parents.length === 0) {
      loadParents();
    }
  }, [needsParent, user, parents.length, parentsLoading, loadParents]);

  // Re-fetch textbooks when a job completes, so they show up in the "Attach To" dropdown
  const completedJobIds = useMemo(() => 
    jobs.filter(j => j.status === 'done').map(j => j.id).join(','), 
    [jobs]
  );
  
  useEffect(() => {
    if (user && needsParent) {
      loadParents();
    }
  }, [completedJobIds, user, needsParent, loadParents]);

  const onPickFiles = useCallback(() => {
    if (!supportsUploads) {
      toast({
        variant: 'destructive',
        title: 'Upload unavailable',
        description: !user ? 'Sign in to upload files.' : 'Connect to the internet to upload.',
      });
      return;
    }
    inputRef.current?.click();
  }, [supportsUploads, toast, user]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!supportsUploads || !user) {
        return;
      }

      const accepted: File[] = [];
      const validationErrors: string[] = [];

      for (const file of files) {
        const { valid, error } = validateFile(file);
        if (valid) {
          accepted.push(file);
        } else if (error) {
          validationErrors.push(`${file.name}: ${error}`);
        }
      }

      if (validationErrors.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Validation Error',
          description: validationErrors.join('\n'),
        });
      }

      if (needsParent) {
        if (!parentId) {
          toast({
            variant: 'destructive',
            title: 'Select a textbook',
            description: 'Past Questions must be attached to a textbook.',
          });
          return;
        }

        // Check limit: max 2 past questions per textbook
        try {
          const count = await countPastQuestionsForParent(user, parentId);
          if (count + accepted.length > 2) {
            toast({
              variant: 'destructive',
              title: 'Limit reached',
              description: 'You can only attach a maximum of 2 past questions per textbook.',
            });
            return;
          }
        } catch (e) {
          console.error('Failed to check past questions limit:', e);
        }
      }

      const inputs = accepted.map((file) => ({
        file,
        label: label.trim() ? label.trim() : undefined,
        documentType: docType,
        parentId: needsParent ? parentId : null,
      }));

      if (!inputs.length) {
        return;
      }

      try {
        await enqueueUploads(inputs);
        // Clear inputs on success
        setLabel('');
      } catch (e: any) {
        const message = typeof e?.message === 'string' ? e.message : 'Upload failed.';
        toast({ variant: 'destructive', title: 'Upload failed', description: message });
      } finally {
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [supportsUploads, user, needsParent, parentId, label, docType, enqueueUploads, toast]
  );

  const onFilesChanged = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      try {
        const files = Array.from(e.target.files ?? []);
        // Reset input value immediately to allow selecting the same file again
        if (inputRef.current) {
          inputRef.current.value = '';
        }
        if (files.length > 0) {
          await addFiles(files);
        }
      } catch (error) {
        console.error('Error handling file selection:', error);
        toast({
          variant: 'destructive',
          title: 'Upload error',
          description: 'Failed to process selected files. Please try again.',
        });
      }
    },
    [addFiles, toast]
  );

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (!supportsUploads) return;
      const files = Array.from(e.dataTransfer.files ?? []);
      await addFiles(files);
    },
    [addFiles, supportsUploads]
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  // Use activeJobs from context instead of filtering here for consistency
  const jobsToDisplay = activeJobs;
  const jobsById = useMemo(() => new Map(jobsToDisplay.map((j) => [j.id, j])), [jobsToDisplay]);

  // Review status
  const totalActive = jobsToDisplay.length;
  const isUploading = jobsToDisplay.some(j => j.status === 'uploading');
  const isProcessing = jobsToDisplay.some(j => j.status === 'processing');

  const onPickRetryFile = useCallback(
    (jobId: string) => {
      setReattachJobId(jobId);
      retryFileInputRef.current?.click();
    },
    []
  );

  const onRetryFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const jobId = reattachJobId;
      const file = e.target.files?.[0] ?? null;
      if (!jobId || !file) return;

      const job = jobsById.get(jobId);
      if (!job) return;

      const safePickedName = normalizeFileName(file.name);
      if (safePickedName !== job.file_name) {
        toast({
          variant: 'destructive',
          title: 'Wrong file selected',
          description: `Select the original file: ${job.file_name}`,
        });
        return;
      }

      await attachFileToJob(jobId, file);
      await retryJob(jobId);

      setReattachJobId(null);
      if (retryFileInputRef.current) retryFileInputRef.current.value = '';
    },
    [attachFileToJob, jobsById, reattachJobId, retryJob, toast]
  );

  return (
    <Card className={!supportsUploads ? 'opacity-70' : ''}>
      <CardHeader>
        <CardTitle className="font-headline text-lg">Upload Center</CardTitle>
        <CardDescription>
          Drag and drop files or browse. Max 50MB per file. Supports PDF, TXT, MD, DOCX, PPTX.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {user?.is_anonymous && (
          <Alert variant="default" className="bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900">
            <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle className="text-amber-800 dark:text-amber-400">Guest Mode</AlertTitle>
            <AlertDescription className="text-amber-700 dark:text-amber-500">
              Guest mode self-destruct in 24 hours. 
              Sign in to keep them for 7 days.
            </AlertDescription>
          </Alert>
        )}
        <input ref={inputRef} type="file" multiple accept={ACCEPT} onChange={onFilesChanged} className="hidden" />
        <input ref={retryFileInputRef} type="file" accept={ACCEPT} onChange={onRetryFileSelected} className="hidden" />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-1">
            <Label>Label (optional)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Exam Notes, Lecture Slides…" />
          </div>
          <div className="md:col-span-1">
            <Label>Document Type</Label>
            <Select value={docType} onValueChange={(v) => setDocType(v as AuDocumentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="main_textbook">Main Textbook</SelectItem>
                <SelectItem value="past_questions">Past Questions</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-1">
            <Label>Attach To</Label>
            <Select
              value={parentId ?? ''}
              onValueChange={(v) => setParentId(v || null)}
              onOpenChange={(open) => {
                // Load parents when dropdown opens
                if (open && needsParent && !parentsLoading && parents.length === 0) {
                  loadParents();
                }
              }}
              disabled={!needsParent || parentsLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={!needsParent ? 'Not required' : parentsLoading ? 'Loading…' : 'Select textbook'} />
              </SelectTrigger>
              <SelectContent>
                {parents.length === 0 && !parentsLoading ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">No textbooks available</div>
                ) : (
                  parents.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <TruncatedText
                        text={p.file_name}
                        maxWidthClass="max-w-[180px]"
                      />
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onClick={onPickFiles}
          className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center transition-all duration-200 cursor-pointer ${
            isDragging 
              ? 'border-primary bg-primary/10 scale-[0.99] shadow-inner' 
              : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30 hover:shadow-sm'
          }`}
        >
          <UploadCloud className={`h-8 w-8 transition-colors ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
          <div className="space-y-1">
            <div className="font-medium">Drop files here</div>
            <div className="text-sm text-muted-foreground">or click to browse</div>
          </div>
          <Button variant="outline" size="sm" className="pointer-events-none">
            Browse Files
          </Button>
        </div>

          {jobsToDisplay.length > 0 && (
            <div className="space-y-4">
              {jobsToDisplay.map((job) => {
              const badge = statusLabel(job.status);
              const isBusy = job.status === 'uploading' || job.status === 'processing' || job.status === 'queued' || job.status === 'uploaded';
              const canRetry = job.status === 'failed';
                const canRemove = job.status === 'failed' || job.status === 'cancelled';
              const icon =
                job.status === 'done' ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : job.status === 'failed' ? (
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                ) : (
                  <Loader2 className={`h-4 w-4 ${isBusy ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
                );

              return (
                <div key={job.id} className="rounded-lg border p-3 transition-all hover:bg-muted/30 hover:shadow-sm group">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="transition-transform group-hover:scale-110">
                          {icon}
                        </div>
                        <TruncatedText
                          text={job.file_name}
                          className="font-medium group-hover:text-primary transition-colors"
                          maxWidthClass="max-w-[160px] sm:max-w-[260px]"
                        />
                        <Badge variant={badge.variant}>{badge.text}</Badge>
                        {job.label ? <Badge variant="outline">{job.label}</Badge> : null}
                      </div>
                      {job.status === 'failed' && (
                        <div className="mt-1 text-sm text-destructive">
                          {job.error || 'Processing failed. Check logs for details.'}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {canRetry && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (job.error?.includes('Missing file data')) {
                              onPickRetryFile(job.id);
                              return;
                            }
                            retryJob(job.id);
                          }}
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Retry
                        </Button>
                      )}
                          {canRemove && (
                            <Button size="sm" variant="outline" onClick={() => removeJob(job.id)}>
                              <X className="mr-2 h-4 w-4" />
                              Remove
                            </Button>
                          )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Progress value={job.progress} className="flex-1" />
                    <div className="w-12 text-right text-sm text-muted-foreground">{job.progress}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
