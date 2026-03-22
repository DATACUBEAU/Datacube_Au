"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { useSupabaseUser } from "@/hooks/use-supabase-auth";
import { useAuDocuments } from "@/hooks/api/use-au-documents";
import UploadCenter from "@/components/upload/upload-center";
import { useUploadJobs } from "@/components/upload/upload-jobs-provider";
import { FileNameText } from "@/components/FileNameText";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
} from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  Trash2,
  MoreVertical,
  ChevronRight,
  Folder,
  FolderOpen,
  FileText as FileTextIcon,
  Clock,
  FileStack,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDelayedLoadingState } from '@/hooks/use-delayed-loading-state';
import { DocumentsPageSkeleton, SlowNetworkNotice } from '@/components/skeletons/page-skeletons';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { FREE_RETENTION_DAYS, resolveDocumentRetentionDays } from '@/lib/au/document-normalization';

type DocumentType = "main_textbook" | "past_questions";
type DocumentStatus = "uploading" | "processing" | "completed" | "failed";

interface DocumentData {
  id: string;
  fileName: string;
  documentType: DocumentType;
  status: DocumentStatus;
  createdAt: string;
  expiresAt?: string;
  parentId?: string;
  filePath?: string;
}

export default function DocumentsPage() {
  const [user] = useSupabaseUser();
  const { isOnline, networkState } = useNetworkStatus();
  const { 
    documents: apiDocuments, 
    loading: apiLoading, 
    remove: apiRemove,
    deletingIds,
    refresh,
    isUsingCachedData,
    cachedAt,
  } = useAuDocuments(5000);
  const { jobs, removeJob } = useUploadJobs();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState<number>(FREE_RETENTION_DAYS);

  useEffect(() => {
    let active = true;
    void resolveDocumentRetentionDays(user?.id ?? null).then((days) => {
      if (!active) return;
      setRetentionDays(days);
    });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const toggleFolder = (id: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Map API documents to local format
  const documents = useMemo(() => apiDocuments.map(row => {
    // Accept legacy/status drift values from worker pipelines.
    const rowStatus = String(row.status || '').toLowerCase();
    const normalizedStatus = (rowStatus === 'indexed' || rowStatus === 'done')
      ? 'completed'
      : row.status;

    return {
      id: row.id,
      fileName: row.file_name,
      documentType: row.document_type as DocumentType,
      status: normalizedStatus as DocumentStatus,
      createdAt: row.created_at,
      expiresAt: row.expires_at ?? undefined,
      parentId: row.parent_id ?? undefined,
      filePath: row.file_path,
    };
  }), [apiDocuments]);

  const loading = apiLoading;
  const { showSkeleton, showSlowNotice } = useDelayedLoadingState(loading);

  const getComputedExpiresAt = (doc: DocumentData) => {
    return new Date(new Date(doc.createdAt).getTime() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
  };

  // ---- MERGE UPLOAD JOBS INTO UI (VISUAL ONLY) ----
  const mergedDocuments = useMemo(() => {
    const map = new Map(documents.map(d => [d.id, d]));

    jobs.forEach(job => {
      // Use document_id to avoid duplication with DB entries
      const id = job.document_id || job.id;
      
      // Map UploadJobStatus to DocumentStatus
      let status: DocumentStatus = "uploading";
      if (job.status === "completed" || job.status === "done") status = "completed";
      else if (job.status === "failed" || job.status === "stale_timeout") status = "failed";
      else if (job.status === "processing" || job.status === "uploaded") status = "processing";

      if (map.has(id)) {
        // Update status from job if it's more "active" or "done"
        const existing = map.get(id)!;
        
        // If the job is done but DB isn't updated yet, show as completed
        if (status === "completed" && existing.status !== "completed") {
          map.set(id, { ...existing, status: "completed" });
        } 
        // If both are active, job state is usually more real-time
        else if (existing.status !== "completed" && status !== "completed") {
          map.set(id, { ...existing, status });
        }
      } else {
        map.set(id, {
          id: id,
          fileName: job.file_name,
          documentType: ((job as any).document_type || "main_textbook") as DocumentType,
          status,
          createdAt: job.created_at || new Date().toISOString(),
          filePath: job.object_path,
          expiresAt: undefined,
          parentId: undefined,
        });
      }
    });

    // Show all documents that are either in the DB or currently being uploaded
    return Array.from(map.values());
  }, [documents, jobs]);

  const tree = useMemo(() => {
    const map = new Map<string, any>();
    const roots: any[] = [];

    mergedDocuments.forEach(d => map.set(d.id, { doc: d, children: [] }));
    mergedDocuments.forEach(d => {
      const node = map.get(d.id);
      if (d.parentId && map.has(d.parentId)) {
        map.get(d.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    });

    return roots;
  }, [mergedDocuments]);

  if (loading && showSkeleton && mergedDocuments.length === 0) {
    return <DocumentsPageSkeleton />;
  }

  // ---- TREE BUILD ----
  // ---- HELPERS ----
  const handleDeleteConfirm = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null); // Close modal immediately

    // Optimistically update local state to hide the item
    // We can't modify the real 'documents' or 'jobs' directly here since they come from hooks,
    // but we can track "deletingIds" or similar local state if we want visual feedback.
    // However, the user wants "no freeze". The best way is to fire-and-forget the API call.

    try {
      // Find if this is a job-only document or a real document
      const job = jobs.find(j => (j.document_id || j.id) === id);
      
      if (job) {
        // Remove job (backgrounded in provider)
        await removeJob(job.id);
      } else {
        // Remove real document
        await apiRemove(id);
      }

      // Hard reload after delete for stability
      window.location.reload();
    } catch (error: any) {
      console.error("[deleteDocument] Error:", error);
    }
  };

  const daysLeft = (expires?: string) => {
    if (!expires) return "No expiry";
    const distance = formatDistanceToNowStrict(new Date(expires));
    return `${distance} left`;
  };


  const ProgressBar = ({ status, expiresAt }: { status: DocumentStatus; expiresAt?: string }) => {
    const isExpiring = !!expiresAt;
    
    if (status !== "completed" && status !== "failed" && status !== "uploading" && status !== "processing") {
      return <div className="h-1 w-full mt-1" />;
    }

    return (
      <div className="h-1 w-full mt-1 relative bg-muted rounded overflow-hidden">
        {status === "completed" && (
          <motion.div
            initial={{ width: "100%" }}
            animate={isExpiring ? { 
              opacity: [1, 0.6, 1] 
            } : { opacity: 1 }}
            transition={isExpiring ? { 
              duration: 2, 
              repeat: Infinity,
              ease: "easeInOut"
            } : { duration: 0.3 }}
            className={`h-full ${isExpiring ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-green-500"}`}
          />
        )}
        {status === "failed" && (
          <div className="h-full w-full bg-red-500" />
        )}
        {(status === "uploading" || status === "processing") && (
          <motion.div 
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            className="h-full w-1/2 bg-primary/50" 
          />
        )}
      </div>
    );
  };

  const renderDoc = (doc: DocumentData, children: any[] = [], child = false, isLast = false, parentExpiresAt?: string) => {
    const isFolder = doc.documentType === "main_textbook";
    const isExpanded = expandedFolders.has(doc.id);
    const hasChildren = children.length > 0;
    const isDeleting = deletingIds.has(doc.id);

    // Propagate parent expiry if child has none
    // If we passed effectiveExpiresAt from parent, use it here if doc.expiresAt is undefined
    // For now, let's keep it simple: use doc.expiresAt
    const effectiveExpiresAt = doc.expiresAt || parentExpiresAt || getComputedExpiresAt(doc);

    return (
      <div key={doc.id} className="flex flex-col relative overflow-hidden">
        <div
          className={`relative flex min-w-0 items-center justify-between gap-3 px-4 py-3 group transition-all duration-200 border-l-2 border-transparent ${
            isFolder ? "cursor-pointer" : ""
          } ${
            isDeleting 
              ? "opacity-60 pointer-events-none bg-muted/40" 
              : "hover:bg-muted/60 hover:border-primary/40 hover:shadow-sm"
          }`}
          onClick={() => isFolder && !isDeleting && toggleFolder(doc.id)}
        >
          {/* Deleting Progress Bar (Subtle top line) */}
          {isDeleting && (
            <motion.div 
              className="absolute top-0 left-0 h-[2px] bg-destructive z-50"
              initial={{ width: 0 }}
              animate={{ width: "100%" }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}

          {/* Background Highlight for Child Items (covers full width) */}
          {child && <div className="absolute inset-y-0 left-0 w-8 bg-muted/10 pointer-events-none" />}

          <div className={`flex-1 min-w-0 flex items-center gap-3 ${child ? "ml-8" : ""}`}>
            {/* Branch lines (adjusted for the new structure) */}
            {child && (
              <>
                <div className="absolute left-4 top-0 w-[1px] h-full bg-border/60" />
                <div className={`absolute left-4 top-1/2 w-4 h-[1px] bg-border/60 ${isLast ? "h-1/2 top-0" : ""}`} />
              </>
            )}

            <div className="flex-shrink-0 z-10">
              {isFolder ? (
                <div className="p-2 rounded-md bg-primary/10 relative transition-transform group-hover:scale-105">
                  {isExpanded ? (
                    <FolderOpen className="h-5 w-5 text-primary" aria-hidden="true" />
                  ) : (
                    <Folder className="h-5 w-5 text-primary" aria-hidden="true" />
                  )}
                  {hasChildren && (
                    <Badge className="absolute -top-2 -right-2 h-4 min-w-[16px] px-1 flex items-center justify-center text-[10px] bg-primary text-primary-foreground border-none shadow-sm">
                      {children.length}
                    </Badge>
                  )}
                </div>
              ) : (
                <div className={`p-2 rounded-md transition-colors ${child ? "bg-muted group-hover:bg-background" : "bg-primary/10 group-hover:bg-primary/20"}`}>
                  <FileTextIcon className={`h-5 w-5 ${child ? "text-muted-foreground" : "text-primary"}`} aria-hidden="true" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                <FileNameText
                  text={doc.fileName}
                  className={`font-medium transition-colors ${isDeleting ? "text-muted-foreground" : "group-hover:text-primary"}`}
                  maxWidthClass="max-w-[200px] sm:max-w-[300px] md:max-w-[400px] lg:max-w-[500px]"
                />
                {isDeleting ? (
                  <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-destructive/20 bg-destructive/10 px-2 py-0.5">
                    <Loader2 className="h-3 w-3 animate-spin text-destructive" aria-hidden="true" />
                    <span className="text-[10px] text-destructive font-bold uppercase tracking-tighter">Deleting</span>
                  </div>
                ) : (
                  <>
                    {(doc.status === "uploading" || doc.status === "processing") && (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" aria-hidden="true" />
                    )}
                    {doc.status === "failed" && (
                      <Badge variant="destructive" className="h-4 shrink-0 px-1 text-[10px]">Failed</Badge>
                    )}
                  </>
                )}
                {isFolder && (
                  <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${isExpanded ? "rotate-90" : "group-hover:translate-x-0.5"}`} aria-hidden="true" />
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
                  {(doc.documentType || "main_textbook").replace("_", " ")}
                </span>
                {isFolder && hasChildren && (
                  <>
                    <span className="text-[11px] text-muted-foreground">•</span>
                    <div className="flex items-center gap-1 text-[11px] text-primary font-medium">
                      <FileStack className="h-3 w-3" aria-hidden="true" />
                      {children.length} {children.length === 1 ? "file" : "files"}
                    </div>
                  </>
                )}
                {doc.status !== "failed" && effectiveExpiresAt && (
                  <>
                    <span className="text-[11px] text-muted-foreground">•</span>
                    <div className="flex items-center gap-1 text-[11px] text-green-600 font-medium">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {daysLeft(effectiveExpiresAt)}
                    </div>
                  </>
                )}
              </div>
              {!isDeleting && <ProgressBar status={doc.status} expiresAt={effectiveExpiresAt} />}
            </div>
          </div>

          <div className="ml-4 flex shrink-0 items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-background shadow-sm" 
                  aria-label="More options"
                  disabled={isDeleting}
                >
                  <MoreVertical className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem 
                  className="text-destructive focus:text-destructive cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteId(doc.id);
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                  Delete Document
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Render children if expanded */}
        <AnimatePresence>
          {isFolder && isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden bg-muted/20"
            >
              <div className="divide-y divide-border/50">
                {children.map((c: any, index: number) => 
                  renderDoc(c.doc, [], true, index === children.length - 1, effectiveExpiresAt)
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  // ---- RENDER ----
  return (
    <main className="p-4 md:p-8 space-y-6">
      {showSlowNotice && loading ? <SlowNetworkNotice onRetry={() => void refresh()} /> : null}
      {isUsingCachedData && networkState !== 'online' ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-2 text-xs text-blue-900 dark:border-blue-500/40 dark:bg-blue-950/30 dark:text-blue-100">
          {isOnline ? 'Connection unstable' : 'Offline'}
          {' '}• showing cached data{cachedAt ? ` from ${new Date(cachedAt).toLocaleString()}` : ''}.
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-headline font-semibold">Document Manager</h1>
        <p className="text-sm text-muted-foreground">Manage and organize your study materials.</p>
      </div>

      <div id="upload-section" className="w-full overflow-hidden">
        <UploadCenter />
      </div>

      {loading && !showSkeleton && (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {!loading && tree.length === 0 && (
        <Card className="p-12 text-center border-dashed">
          <div className="flex flex-col items-center gap-3">
            <div className="p-4 rounded-full bg-muted/50">
              <FileStack className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-medium">No document collections yet</p>
              <p className="text-sm text-muted-foreground max-w-[250px] mx-auto">
                Upload your first textbook to get started with AU insights.
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4">
        <AnimatePresence mode="popLayout" initial={false}>
          {tree.map(node => (
            <motion.div
              key={node.doc.id}
              layout
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
              transition={{ duration: 0.2 }}
            >
              <Card className="overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                <div className="divide-y divide-border/50">
                  {renderDoc(node.doc, node.children)}
                </div>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Confirmation Modal */}
      <AlertDialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the document,
              all its chapters, and any associated A U insights.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => window.location.reload()}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
