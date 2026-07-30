'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Loader2, Wand2, Info, WifiOff, BrainCircuit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { useStore } from '@/hooks/use-store';
import { safeFetch } from '@/lib/api/safe-fetch';
import { getSupabaseAccessToken } from '@/lib/supabase-client/client';
import type { GenerateKnowledgeOutput } from '@/app/actions';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { useAuDocuments } from '@/hooks/api/use-au-documents';
import { FileNameText } from '@/components/FileNameText';
import { DocumentSelectValue } from '@/components/document-select-value';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNowStrict } from 'date-fns';
import { useFeatureFlags } from '@/components/feature-flag-provider';
import { useEffectiveEntitlements } from '@/hooks/use-effective-entitlements';
import { FeatureGatePanel } from '@/components/feature-gate-panel';
import { FREE_PLAN_EXPIRATION_DAYS, PAID_PRO_PLAN_EXPIRATION_DAYS } from '@/lib/plans/subscription-policy';
import { buildUpgradeContext, getDashboardFeatureAccess } from '@/lib/feature-access';
import { useFeatureOutput } from '@/hooks/api/use-feature-output';
import { describeApiErrorForUser } from '@/lib/api/user-facing-error';
import {
  clearKnowledgeGenerationLockRecord,
  readKnowledgeGenerationLockRecord,
  resolveKnowledgeGenerateButtonState,
  writeKnowledgeGenerationLockRecord,
  type KnowledgeGenerationLockRecord,
} from '@/lib/knowledge/generation-lock';
import { openSupportEmail } from '@/lib/support/contact';

// Lazy-load the animation components to keep the initial bundle small
const AnimatedText = dynamic(() => import('@/components/animated-text'), {
  ssr: false,
});
const InteractiveConceptMap = dynamic(() => import('@/components/interactive-concept-map'), {
  ssr: false,
});


interface StoredKnowledgeHistory {
  timestamp: number;
  data: GenerateKnowledgeOutput;
}

function coerceMultiline(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((v) => String(v)).join('\n');
  return '';
}

export default function KnowledgePage() {
  const { records: featureFlagRecords } = useFeatureFlags();
  const { entitlements, loading: entitlementsLoading } = useEffectiveEntitlements();
  const setUpgradeModalOpen = useStore((state) => state.setUpgradeModalOpen);
  const access = useMemo(
    () => getDashboardFeatureAccess('knowledge_hub', entitlements, featureFlagRecords),
    [entitlements, featureFlagRecords],
  );

  useEffect(() => {
    if (entitlementsLoading || access.allowed || access.code !== 'PRO_REQUIRED') return;
    setUpgradeModalOpen(true, buildUpgradeContext(access));
  }, [access, entitlementsLoading, setUpgradeModalOpen]);

  if (entitlementsLoading) {
    return (
      <main className="flex flex-1 items-center justify-center p-4 md:p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    );
  }

  if (!access.enabled) {
    return (
      <FeatureGatePanel
        title="Knowledge Hub unavailable"
        description={access.message}
        mode="disabled"
      />
    );
  }

  if (!access.allowed) {
    return (
      <FeatureGatePanel
        title="Knowledge Hub is Pro only"
        description={access.message}
        mode="upgrade"
        onPrimaryAction={() => setUpgradeModalOpen(true, buildUpgradeContext(access))}
      />
    );
  }

  return <KnowledgePageContent />;
}

function KnowledgePageContent() {
  const [user] = useSupabaseUser();
  const { session } = useSupabaseSession();
  const { isLoading: isAuthLoading, isRestoringAuth, isAuthLocked } = useSmartAuth();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  
  // Use global hook for documents
  const { documents: apiDocuments, loading: docsLoading } = useAuDocuments();

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [persistedLock, setPersistedLock] = useState<KnowledgeGenerationLockRecord | null>(null);
  const [isConceptMapDevOpen, setIsConceptMapDevOpen] = useState(false);
  const [conceptMapClickedTerm, setConceptMapClickedTerm] = useState<string | null>(null);

  const selectedDoc = useMemo(() => {
    if (!selectedDocId) return null;
    return apiDocuments.find(d => d.id === selectedDocId) || null;
  }, [apiDocuments, selectedDocId]);
  const selectedDocReady = selectedDoc?.status === 'completed';
  const knowledgeOutput = useFeatureOutput<GenerateKnowledgeOutput>({
    feature: 'knowledge_hub',
    documentId: selectedDocId,
    enabled: Boolean(selectedDocId && user && !isAuthLoading && !isRestoringAuth && !isAuthLocked),
  });

  const attachedFileCount = useMemo(() => {
    if (!selectedDocId) return 0;
    return apiDocuments.filter(d => d.parent_id === selectedDocId).length;
  }, [apiDocuments, selectedDocId]);

  const getDocumentExpiryMs = useCallback((docId: string): number | null => {
    const doc = apiDocuments.find((item) => item.id === docId);
    if (!doc?.expires_at) return null;
    const expiryMs = new Date(doc.expires_at).getTime();
    return Number.isFinite(expiryMs) ? expiryMs : null;
  }, [apiDocuments]);

  const selectedDocExpiresAt = useMemo(() => {
    if (!selectedDoc) return null;
    return selectedDoc.expires_at;
  }, [selectedDoc]);
  
  // Filter documents for Knowledge Hub (Textbooks only)
  const documents = useMemo(() => apiDocuments.filter(d => 
    d.document_type === 'main_textbook' && 
    (d.expires_at || d.status !== 'failed')
  ), [apiDocuments]);

  // Zustand state
  const {
    knowledgeData,
    isGeneratingKnowledge,
    generateKnowledge,
    clearKnowledgeAndPredictions,
    setKnowledgeData,
  } = useStore();

  const visibleKnowledgeData = knowledgeOutput.status === 'missing' ? null : knowledgeData;
  const knowledgeButtonState = useMemo(
    () =>
      resolveKnowledgeGenerateButtonState({
        documentId: selectedDocId,
        isGenerating: isGeneratingKnowledge,
        isOnline,
        documentReady: Boolean(selectedDocReady),
        remoteStatus: knowledgeOutput.status,
        localLockStatus: persistedLock?.status ?? null,
      }),
    [isGeneratingKnowledge, isOnline, knowledgeOutput.status, persistedLock?.status, selectedDocId, selectedDocReady],
  );

  useEffect(() => {
    if (knowledgeOutput.status !== 'ready' || !knowledgeOutput.output) return;
    setKnowledgeData(knowledgeOutput.output);
  }, [knowledgeOutput.output, knowledgeOutput.status, setKnowledgeData]);

  useEffect(() => {
    if (!selectedDocId || typeof window === 'undefined') {
      setPersistedLock(null);
      return;
    }
    setPersistedLock(readKnowledgeGenerationLockRecord(selectedDocId, window.localStorage));
  }, [selectedDocId]);

  useEffect(() => {
    if (!selectedDocId || typeof window === 'undefined') return;

    if (knowledgeOutput.status === 'ready') {
      if (knowledgeOutput.output) {
        const historyToStore: StoredKnowledgeHistory = {
          timestamp: Date.now(),
          data: knowledgeOutput.output,
        };
        window.localStorage.setItem(`knowledge_history_user_${selectedDocId}`, JSON.stringify(historyToStore));
      }

      const nextLock: KnowledgeGenerationLockRecord = {
        documentId: selectedDocId,
        status: 'ready',
        docVersionId: knowledgeOutput.docVersionId || null,
        updatedAt: knowledgeOutput.generatedAt || null,
      };
      writeKnowledgeGenerationLockRecord(window.localStorage, nextLock);
      setPersistedLock(nextLock);
      return;
    }

    if (knowledgeOutput.status === 'failed') {
      const nextLock: KnowledgeGenerationLockRecord = {
        documentId: selectedDocId,
        status: 'failed',
        docVersionId: knowledgeOutput.docVersionId || null,
        updatedAt: knowledgeOutput.generatedAt || null,
      };
      writeKnowledgeGenerationLockRecord(window.localStorage, nextLock);
      setPersistedLock(nextLock);
      return;
    }

    if (knowledgeOutput.status === 'missing') {
      clearKnowledgeGenerationLockRecord(selectedDocId, window.localStorage);
      window.localStorage.removeItem(`knowledge_history_user_${selectedDocId}`);
      setPersistedLock(null);
    }
  }, [
    knowledgeOutput.docVersionId,
    knowledgeOutput.generatedAt,
    knowledgeOutput.output,
    knowledgeOutput.status,
    selectedDocId,
  ]);

  const handleDocSelectionChange = (docId: string) => {
    setSelectedDocId(docId);
    clearKnowledgeAndPredictions(); // Clear global state immediately

    if (user && isOnline) {
      const cacheKey = `knowledge_history_user_${docId}`;
      const storedJSON = localStorage.getItem(cacheKey);
      if (storedJSON) {
        try {
          const stored: StoredKnowledgeHistory = JSON.parse(storedJSON);
          const expiryMs = getDocumentExpiryMs(docId);
          const nowMs = Date.now();
          if (expiryMs && nowMs >= expiryMs) {
            localStorage.removeItem(cacheKey);
            return;
          }

          const hasValidTimestamp = typeof stored.timestamp === 'number' && Number.isFinite(stored.timestamp);
          const stillValid = hasValidTimestamp && (!expiryMs || stored.timestamp <= expiryMs);

          if (stillValid) {
            setKnowledgeData(stored.data); // Directly set the data in the store
            const cachedLock: KnowledgeGenerationLockRecord = {
              documentId: docId,
              status: 'ready',
              docVersionId: null,
              updatedAt: new Date(stored.timestamp).toISOString(),
            };
            writeKnowledgeGenerationLockRecord(window.localStorage, cachedLock);
            setPersistedLock(cachedLock);
            toast({ title: 'Loaded from history', description: 'Showing cached knowledge materials.' });
          } else {
            localStorage.removeItem(cacheKey); // Stale data
            clearKnowledgeGenerationLockRecord(docId, window.localStorage);
            setPersistedLock(null);
          }
        } catch (e) {
          console.error('Failed to parse knowledge history from localStorage', e);
          localStorage.removeItem(cacheKey);
          clearKnowledgeGenerationLockRecord(docId, window.localStorage);
          setPersistedLock(null);
        }
      }
    }
  };

  useEffect(() => {
    if (docsLoading || !documents.length) return;
    const completedDocIds = documents.filter((doc) => doc.status === 'completed').map((doc) => doc.id);
    const docIds = completedDocIds.length > 0 ? completedDocIds : documents.map((doc) => doc.id);
    if (!selectedDocId || !docIds.includes(selectedDocId)) {
      const newSelectedId = docIds[0] ? docIds[0] : null;
      if (newSelectedId) {
        handleDocSelectionChange(newSelectedId);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, docsLoading]);

  const triggerGeneration = async () => {
    if (!selectedDocId || !user || isGeneratingKnowledge) {
      return;
    }
    if (!selectedDocReady) {
      toast({
        variant: 'destructive',
        title: 'Document not ready',
        description: `The selected document is ${selectedDoc?.status || 'not ready'}. Please wait for completion.`,
      });
      return;
    }
    
    if (!isOnline) {
        toast({ variant: 'destructive', title: 'You are offline', description: 'This action requires an internet connection.' });
        return;
    }
    if (isAuthLoading || isRestoringAuth || isAuthLocked) {
      toast({ variant: 'destructive', title: 'Sign in required', description: 'Wait for session restore to finish, then try again.' });
      return;
    }

    try {
        const accessToken = await getSupabaseAccessToken();
        const attachedPQs = apiDocuments.filter(d => d.parent_id === selectedDocId && (d.document_type === 'past_questions' || d.document_type === 'exam_questions') && d.status === 'completed');

        await generateKnowledge(selectedDocId, {
          pastQuestionIds: attachedPQs.map((pq) => pq.id),
          accessToken,
        });
        if (typeof window !== 'undefined') {
          const optimisticLock: KnowledgeGenerationLockRecord = {
            documentId: selectedDocId,
            status: 'ready',
            docVersionId: knowledgeOutput.docVersionId || null,
            updatedAt: new Date().toISOString(),
          };
          writeKnowledgeGenerationLockRecord(window.localStorage, optimisticLock);
          setPersistedLock(optimisticLock);
        }

    } catch (error: any) {
      const userFacingError = describeApiErrorForUser(error, { context: 'generation' });
      console.error('Failed to prepare for study material generation:', {
        code: userFacingError.error.code,
        status: userFacingError.error.status,
        message: userFacingError.description,
        requestId: userFacingError.requestId,
        correlationId: userFacingError.correlationId,
      });
      toast({
        variant: 'destructive',
        title: userFacingError.title,
        description: userFacingError.description,
      });
    }
  };

  const showGeneratedExplanation = useCallback(() => {
    toast({
      title: 'Already generated',
      description: 'This Knowledge Hub output is already saved for this document. Use "Force" mode if you are an admin or upload a new version.',
    });
  }, [toast]);

  const handleClearCache = useCallback(async () => {
    if (!selectedDocId || !user) return;
    try {
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (session?.access_token) {
        headers.set('Authorization', `Bearer ${session.access_token}`);
      }
      const res = await safeFetch('/api/admin/feature-output', {
        method: 'DELETE',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          documentId: selectedDocId,
          feature: 'knowledge_hub',
        }),
      });
      if (res.ok) {
        toast({ title: 'Cache cleared', description: 'Generation lock released. You can now retry.' });
        void knowledgeOutput.refresh();
      } else {
        throw new Error('Failed to clear cache');
      }
    } catch (e) {
      const opened = openSupportEmail({
        subject: 'Knowledge Generation Locked',
        body: 'Hello, I encountered a generation lock for the selected document. Please clear the cache.',
      });
      if (!opened) {
        toast({
          variant: 'destructive',
          title: 'Support email not configured',
          description: 'Please contact an administrator to clear the affected generation cache.',
        });
      }
    }
  }, [knowledgeOutput, selectedDocId, session?.access_token, toast, user]);

  const handleGenerateClick = async () => {
    if (knowledgeButtonState.effectiveLockStatus === 'ready') {
      showGeneratedExplanation();
      return;
    }
    if (knowledgeButtonState.effectiveLockStatus === 'failed') {
      toast({
        variant: 'destructive',
        title: 'Generation locked',
        description: 'This document has a failed cached output. Ask an admin to clear the cache before retrying.',
        action: (
          <ToastAction altText="Clear Cache" onClick={handleClearCache}>
            Ask Admin / Clear
          </ToastAction>
        ),
      });
      return;
    }
    if (knowledgeButtonState.isBusy) {
      toast({
        title: 'Generating in progress',
        description: 'Knowledge Hub is already generating for this document.',
      });
      return;
    }
    await triggerGeneration();
    void knowledgeOutput.refresh();
  };
  
  // Animation variants
  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.08,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5,
        ease: 'easeOut',
      },
    },
  };

  const renderContent = () => {
    if (!isOnline && !visibleKnowledgeData) {
      return (
        <div className="flex h-full min-h-[400px] flex-col items-center justify-center">
          <div className="space-y-2 text-center text-muted-foreground">
            <WifiOff className="mx-auto h-10 w-10 text-primary/30" aria-hidden="true" />
            <p className="text-lg font-semibold">Feature Unavailable Offline</p>
            <p>Connect to the internet to generate and view knowledge materials.</p>
          </div>
        </div>
      );
    }

    if (isGeneratingKnowledge) {
      return (
        <div className="flex h-full min-h-[400px] flex-col items-center justify-center">
            <div className="flex flex-col items-center justify-center space-y-4">
              <div className="relative flex h-16 w-16 items-center justify-center">
                  <div className="absolute h-12 w-12 animate-spin rounded-full border-2 border-dashed border-primary/50"></div>
                  <div className="absolute h-16 w-16 animate-[spin_3s_linear_infinite_reverse] rounded-full border-2 border-dashed border-accent/50"></div>
                  <Icons.logo className="h-8 w-8 text-primary drop-shadow-[0_0_5px_hsl(var(--primary)/0.7)]" aria-hidden="true" />
              </div>
              <div className="text-center">
                  <p className="font-semibold">The AU is analyzing your document...</p>
                  <p className="text-sm text-muted-foreground">This may take a moment. You can navigate away.</p>
              </div>
            </div>
        </div>
      );
    }

    if (!visibleKnowledgeData) {
      return (
         <div className="flex h-full min-h-[400px] flex-col items-center justify-center">
              <div className="space-y-2 text-center text-muted-foreground">
                <Wand2 className="mx-auto h-10 w-10 text-primary/30" aria-hidden="true" />
                <p className="text-lg font-semibold">{selectedDocId ? "Ready to unlock AU insights?" : "Please select a document"}</p>
                <p>{selectedDocId ? "Click 'Generate' to begin." : "Choose one of your completed textbooks to get started."}</p>
              </div>
        </div>
      );
    }
    
    return (
      <Tabs defaultValue="summary" className="flex-1">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-3 lg:grid-cols-5 h-auto">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="key-points">Key Points</TabsTrigger>
          <TabsTrigger value="concept-map">Concept Map</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="roadmap">Study Roadmap</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
           <Card>
            <CardHeader><CardTitle className="font-headline">Document Summary</CardTitle><CardDescription>A concise overview of your selected document.</CardDescription></CardHeader>
            <CardContent>
                <div className="pr-6">
                    {AnimatedText && <AnimatedText text={visibleKnowledgeData.summary} />}
                </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="key-points" className="mt-4">
           <Card>
              <CardHeader>
                <CardTitle className="font-headline">Key Points</CardTitle>
                <CardDescription>The most important takeaways from the document.</CardDescription>
              </CardHeader>
              <CardContent className="max-h-[50vh] overflow-y-auto custom-scrollbar scroll-smooth p-6">
                  <motion.div
                      className="grid grid-cols-1 gap-4 md:grid-cols-2"
                      variants={containerVariants}
                      initial="hidden"
                      animate="visible"
                  >
                  {coerceMultiline((visibleKnowledgeData as any)?.keyPoints).split('\n').filter((p: string) => p.trim()).map((point: string, index: number) => (
                      <motion.div key={index} variants={itemVariants} className="flex items-start rounded-lg border bg-secondary/50 p-4">
                      <div className="mr-4 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary"><span className="text-xs font-bold text-primary-foreground">{index + 1}</span></div>
                      <p className="text-sm leading-relaxed">{point.replace(/^\d+\.\s*/, '')}</p>
                      </motion.div>
                  ))}
                  </motion.div>
              </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="concept-map" className="mt-4">
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Interactive Concept Map</CardTitle>
                    <CardDescription>Nodes are visible, but this section is still under development.</CardDescription>
                </CardHeader>
                <CardContent>
                     <div className="relative pr-6">
                        {InteractiveConceptMap && (
                          <InteractiveConceptMap
                            content={visibleKnowledgeData.conceptMap}
                            onConceptClick={(term) => {
                              setConceptMapClickedTerm(term);
                              setIsConceptMapDevOpen(true);
                            }}
                          />
                        )}

                        <AnimatePresence>
                          {isConceptMapDevOpen && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="absolute inset-0 z-20"
                            >
                              <div
                                className="absolute inset-0 rounded-lg bg-background/60 backdrop-blur-sm"
                                onClick={() => setIsConceptMapDevOpen(false)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setIsConceptMapDevOpen(false);
                                  }
                                }}
                              />

                              <motion.div
                                initial={{ y: 8, scale: 0.98, opacity: 0 }}
                                animate={{ y: 0, scale: 1, opacity: 1 }}
                                exit={{ y: 8, scale: 0.98, opacity: 0 }}
                                transition={{ duration: 0.2, ease: 'easeOut' }}
                                className="relative mx-auto mt-6 w-[min(520px,92%)] rounded-xl border bg-background/80 p-4 shadow-lg"
                              >
                                <div className="flex items-start gap-4">
                                  <motion.img
                                    src="/assets/au-anime-dev.svg"
                                    alt="AU character"
                                    className="h-24 w-24 shrink-0"
                                    animate={{ y: [0, -6, 0] }}
                                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                                    draggable={false}
                                  />

                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold">The future is coming soon… still under development!</p>
                                    {conceptMapClickedTerm && (
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        You clicked: <span className="font-semibold text-foreground">{conceptMapClickedTerm}</span>
                                      </p>
                                    )}
                                    <p className="mt-2 text-xs text-muted-foreground">
                                      This modal only affects the Concept Map section. Everything else in Knowledge Hub stays live.
                                    </p>

                                    <div className="mt-3 flex justify-end">
                                      <Button size="sm" variant="secondary" onClick={() => setIsConceptMapDevOpen(false)}>
                                        Close
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </motion.div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                     </div>
                </CardContent>
            </Card>
        </TabsContent>

        <TabsContent value="relationships" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-headline">Topic Relationships</CardTitle><CardDescription>How different topics in the document relate to each other.</CardDescription></CardHeader>
            <CardContent>
                <div className="pr-6">
                    {AnimatedText && <AnimatedText text={visibleKnowledgeData.topicRelationships} />}
                </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roadmap" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-headline">Study Roadmap</CardTitle>
              <CardDescription>A suggested path for learning the material effectively.</CardDescription>
            </CardHeader>
            <CardContent className="relative max-h-[50vh] overflow-y-auto custom-scrollbar scroll-smooth p-6">
                <div className="absolute left-6 top-2 bottom-2 w-px -translate-x-1/2 bg-border"></div>
                <motion.div 
                className="space-y-8"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                >
                {coerceMultiline((visibleKnowledgeData as any)?.studyRoadmap).split('\n').filter((s: string) => s.trim().length > 0).map((item: string, index: number) => {
                    const [title, ...descriptionParts] = item.replace(/^\d+\.\s*/, '').split(': ');
                    const description = descriptionParts.join(': ');
                    return (
                    <motion.div key={index} variants={itemVariants} className="relative flex items-start">
                        <div className="z-10 mr-6 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-4 border-background bg-primary"><span className="text-lg font-bold text-primary-foreground">{index + 1}</span></div>
                        <div className="pt-1.5"><h3 className="font-semibold text-md">{title}</h3><p className="text-sm text-muted-foreground">{description}</p></div>
                    </motion.div>
                    )
                })}
                </motion.div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <>
      <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <BrainCircuit className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-headline text-2xl font-bold">Knowledge Hub</h1>
            <p className="text-sm text-muted-foreground">Deep analysis and study materials for your documents.</p>
          </div>
        </div>

        <div className="flex w-full min-w-0 flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
          {docsLoading ? (
             <div className="flex items-center gap-2 text-sm text-muted-foreground sm:shrink-0">
               <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
               Loading documents...
             </div>
          ) : (
            <div className="flex min-w-0 w-full flex-col gap-1 sm:w-auto">
              <Select value={selectedDocId || undefined} onValueChange={handleDocSelectionChange}>
                <SelectTrigger
                  className="w-full min-w-0 sm:w-auto sm:min-w-[200px] sm:max-w-[300px]"
                  aria-label="Select document"
                  title={selectedDoc?.file_name || undefined}
                >
                  <DocumentSelectValue
                    text={selectedDoc?.file_name}
                    placeholder="Select a textbook"
                    maxWidthClass="max-w-full sm:max-w-[250px]"
                  />
                </SelectTrigger>
                <SelectContent>
                  {documents.map((doc) => (
                    <SelectItem
                      key={doc.id}
                      value={doc.id}
                      disabled={doc.status !== 'completed'}
                      textValue={doc.file_name}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <FileNameText text={doc.file_name} maxWidthClass="max-w-[200px] sm:max-w-[300px] md:max-w-[400px]" />
                        {doc.status !== 'completed' && (
                          <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px] animate-pulse">
                            {doc.status}...
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedDocId && selectedDocExpiresAt && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="uppercase tracking-wider font-bold">main textbook</span>
                  <span>•</span>
                  <span>{attachedFileCount} {attachedFileCount === 1 ? 'file' : 'files'}</span>
                  <span>•</span>
                  <span>
                    {new Date(selectedDocExpiresAt).getTime() <= Date.now()
                      ? 'Expired'
                      : `${formatDistanceToNowStrict(new Date(selectedDocExpiresAt))} left`}
                  </span>
                </div>
              )}
            </div>
          )}

          <Button 
            onClick={() => void handleGenerateClick()}
            disabled={knowledgeButtonState.disabled}
            aria-disabled={knowledgeButtonState.ariaDisabled}
            className="w-full shrink-0 gap-2 shadow-md hover:shadow-lg transition-all sm:w-auto"
          >
            {isGeneratingKnowledge || knowledgeOutput.status === 'loading' || knowledgeOutput.status === 'running' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Wand2 className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="truncate">{knowledgeButtonState.label}</span>
          </Button>
        </div>
      </div>
        <div className="mt-4 flex-1">
          {renderContent()}
        </div>
        {knowledgeButtonState.effectiveLockStatus === 'ready' && (
          <div className="mt-2 text-center text-xs text-muted-foreground">
            Saved output loaded. Regeneration is locked until the document version changes or an admin clears the cache.
          </div>
        )}
        {knowledgeButtonState.effectiveLockStatus === 'failed' && (
          <div className="mt-2 text-center text-xs text-muted-foreground">
            This document has a failed cached output. Upload a new version or ask an admin to clear the cache before retrying.
          </div>
        )}
        {knowledgeOutput.errorMessage && (
          <div className="mt-2 text-center text-xs text-muted-foreground">
            {knowledgeOutput.errorMessage} {knowledgeButtonState.effectiveLockStatus ? 'Keeping the last confirmed lock for this document.' : ''}
          </div>
        )}
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3 w-3" />
          <span>
            Documents retain for {FREE_PLAN_EXPIRATION_DAYS} days on Free and Promo, and {PAID_PRO_PLAN_EXPIRATION_DAYS} days on paid Pro. Generated materials expire with the source document.
          </span>
        </div>
      </main>
    </>
  );
}
