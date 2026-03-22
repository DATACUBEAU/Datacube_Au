'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';

import { useToast } from '@/hooks/use-toast';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useStore } from '@/hooks/use-store';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  ChartContainer,
  ChartConfig,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import type { AuDocumentRow } from '@/lib/au/types';
import { getAuDocumentChunksText, listAuDocumentsForUser } from '@/lib/au/documents';
import { useAuDocuments } from '@/hooks/api/use-au-documents';
import { supabase } from '@/lib/supabase-client/client';
import { FileNameText } from '@/components/FileNameText';
import { DocumentSelectValue } from '@/components/document-select-value';
import { useFeatureFlags } from '@/components/feature-flag-provider';
import { useEffectiveEntitlements } from '@/hooks/use-effective-entitlements';
import { FeatureGatePanel } from '@/components/feature-gate-panel';
import { buildUpgradeContext, getDashboardFeatureAccess } from '@/lib/feature-access';
import { useFeatureOutput } from '@/hooks/api/use-feature-output';

import { FeedbackSection } from "@/components/au-feedback";
import {
  Loader2,
  AlertTriangle,
  FileQuestion,
  BookOpen,
  BrainCircuit,
  ChevronRight,
  WifiOff,
} from 'lucide-react';
import type { GeneratePredictionsOutput } from '@/app/actions';

const AnimatedText = dynamic(() => import('@/components/animated-text'), {
  ssr: false,
});

type FormattedTopicWeight = {
  topic: string;
  weight: number;
  fill: string;
};

type PredictionDetail = {
  topic: string;
  rationale: string;
  commonMistake: string;
  examTip: string;
  likelihood: number;
};

interface StoredPredictionHistory {
  timestamp: number;
  data: GeneratePredictionsOutput;
}

const getCacheKey = (userId: string, docId: string) => `prediction_history_${userId}_${docId}`;

const chartConfig: ChartConfig = {
  weight: { label: 'Topic Weight (%)' },
  topic: { label: 'Topic', color: 'hsl(var(--chart-1))' },
};

export default function PredictionsPage() {
  const { records: featureFlagRecords } = useFeatureFlags();
  const { entitlements, loading: entitlementsLoading } = useEffectiveEntitlements();
  const setUpgradeModalOpen = useStore((state) => state.setUpgradeModalOpen);
  const access = useMemo(
    () => getDashboardFeatureAccess('exam_prediction', entitlements, featureFlagRecords),
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
        title="Exam Prediction Engine unavailable"
        description={access.message}
        mode="disabled"
      />
    );
  }

  if (!access.allowed) {
    return (
      <FeatureGatePanel
        title="Exam Prediction Engine is Pro only"
        description={access.message}
        mode="upgrade"
        onPrimaryAction={() => setUpgradeModalOpen(true, buildUpgradeContext(access))}
      />
    );
  }

  return <PredictionsPageContent />;
}

function PredictionsPageContent() {
  const [user] = useSupabaseUser();
  const { session } = useSupabaseSession();
  const isOnline = useOnlineStatus();
  const { toast } = useToast();
  const upgradeBlocked = useStore((s) => s.upgradeBlocked);

  const [selectedPastQuestionsId, setSelectedPastQuestionsId] = useState<string | null>(null);
  const [selectedTextbookId, setSelectedTextbookId] = useState<string | null>(null);

  // Use the global Zustand store for state management
  const {
    predictionData,
    isGeneratingPredictions,
    generatePredictions,
    clearKnowledgeAndPredictions,
    setPredictionData,
  } = useStore();

  const [formattedTopicWeights, setFormattedTopicWeights] = useState<FormattedTopicWeight[]>([]);
  const [selectedPrediction, setSelectedPrediction] = useState<PredictionDetail | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Use global hook
  const { documents: allDocuments, loading: docsLoading } = useAuDocuments();

  const textbookDocs = useMemo(() => allDocuments.filter(d => d.document_type === 'main_textbook'), [allDocuments]);
  const pastQuestionsDocs = useMemo(() => allDocuments.filter(d => d.document_type === 'past_questions' || d.document_type === 'exam_questions'), [allDocuments]);
  const selectedPastQuestionDoc = useMemo(
    () => pastQuestionsDocs.find((d) => d.id === selectedPastQuestionsId) || null,
    [pastQuestionsDocs, selectedPastQuestionsId]
  );
  const selectedTextbookDoc = useMemo(
    () => textbookDocs.find((d) => d.id === selectedTextbookId) || null,
    [textbookDocs, selectedTextbookId]
  );
  const predictionOutput = useFeatureOutput<GeneratePredictionsOutput>({
    feature: 'exam_prediction',
    documentId: selectedTextbookId || selectedPastQuestionsId,
    enabled: Boolean((selectedTextbookId || selectedPastQuestionsId) && user && session?.access_token),
  });

  const mainTextbookIds = useMemo(() => textbookDocs.map((doc) => doc.id), [textbookDocs]);

  const getDocumentExpiryMs = useCallback((docId: string): number | null => {
    const doc = allDocuments.find((item) => item.id === docId);
    if (!doc) return null;

    const directExpiryMs = doc.expires_at ? new Date(doc.expires_at).getTime() : Number.NaN;
    const hasDirectExpiry = Number.isFinite(directExpiryMs);

    const isPastQuestion = doc.document_type === 'past_questions' || doc.document_type === 'exam_questions';
    if (!isPastQuestion || !doc.parent_id) {
      return hasDirectExpiry ? directExpiryMs : null;
    }

    const parent = allDocuments.find((item) => item.id === doc.parent_id);
    const parentExpiryMs = parent?.expires_at ? new Date(parent.expires_at).getTime() : Number.NaN;
    const hasParentExpiry = Number.isFinite(parentExpiryMs);

    if (hasDirectExpiry && hasParentExpiry) {
      // Enforce inheritance on client cache validation even for legacy rows.
      return Math.min(directExpiryMs, parentExpiryMs);
    }
    if (hasParentExpiry) return parentExpiryMs;
    return hasDirectExpiry ? directExpiryMs : null;
  }, [allDocuments]);

  const parseTopicWeights = useCallback((weights: any) => {
    if (!weights) {
      setFormattedTopicWeights([]);
      return;
    }

    let weightsStr = '';
    if (typeof weights === 'string') {
      weightsStr = weights;
    } else if (Array.isArray(weights)) {
      // If LLM returned an array of strings
      weightsStr = weights.join('\n');
    } else {
      console.warn('[Predictions] Unexpected type for topicWeights:', typeof weights);
      setFormattedTopicWeights([]);
      return;
    }

    const parsed = weightsStr
      .split('\n')
      .map((line, i) => {
        const [rawTopic, rawWeight] = line.split(':');
        const topic = rawTopic?.replace(/^\d+\.\s*/, '').trim();
        const weight = Number(rawWeight?.replace('%','').trim());
        if (!topic || Number.isNaN(weight)) return null;
        return { topic, weight, fill: `hsl(var(--chart-${(i % 5) + 1}))` };
      })
      .filter(Boolean) as FormattedTopicWeight[];
    setFormattedTopicWeights(parsed);
  }, []);

  // Sync cache with predictionData
  useEffect(() => {
    if (predictionData && user && selectedPastQuestionsId) {
        const historyToStore: StoredPredictionHistory = { timestamp: Date.now(), data: predictionData };
        localStorage.setItem(getCacheKey(user.id, selectedPastQuestionsId), JSON.stringify(historyToStore));
    }
  }, [predictionData, user, selectedPastQuestionsId]);

  // Update chart data when predictionData from the store changes
  useEffect(() => {
    if (predictionData?.topicWeights) {
      parseTopicWeights(predictionData.topicWeights);
    } else {
      setFormattedTopicWeights([]);
    }
  }, [predictionData, parseTopicWeights]);

  useEffect(() => {
    if (predictionOutput.status !== 'ready' || !predictionOutput.output) return;
    setPredictionData(predictionOutput.output);
  }, [predictionOutput.output, predictionOutput.status, setPredictionData]);

  const restoreCachedPredictions = useCallback((docId: string, expirySourceDocId?: string | null): boolean => {
    if (!user || !isOnline) return false;
    const cacheKey = getCacheKey(user.id, docId);
    const storedJSON = localStorage.getItem(cacheKey);
    if (!storedJSON) return false;

    try {
      const stored: StoredPredictionHistory = JSON.parse(storedJSON);
      const expiryMs = getDocumentExpiryMs(expirySourceDocId || docId);
      const nowMs = Date.now();

      if (expiryMs && nowMs >= expiryMs) {
        localStorage.removeItem(cacheKey);
        return false;
      }

      const hasValidTimestamp = typeof stored.timestamp === 'number' && Number.isFinite(stored.timestamp);
      const stillValid = hasValidTimestamp && (!expiryMs || stored.timestamp <= expiryMs);
      if (!stillValid) {
        localStorage.removeItem(cacheKey);
        return false;
      }

      setPredictionData(stored.data);
      toast({ title: 'Loaded from history', description: 'Restored your exam briefing from the last session.' });
      return true;
    } catch (e) {
      console.error("Failed to parse prediction history", e);
      localStorage.removeItem(cacheKey);
      return false;
    }
  }, [getDocumentExpiryMs, isOnline, setPredictionData, toast, user]);


  const handlePastQuestionsChange = (docId: string) => {
    setSelectedPastQuestionsId(docId);
    const pqDoc = pastQuestionsDocs.find((d) => d.id === docId);
    setSelectedTextbookId(pqDoc?.parent_id || null);
    clearKnowledgeAndPredictions(); // Clear global store data

    restoreCachedPredictions(docId, pqDoc?.parent_id || docId);
  };

  const getDocContent = async (docId: string) => {
    if (!user) throw new Error('User not available');
    return getAuDocumentChunksText(user, docId);
  };

  const triggerGetPredictions = async () => {
    if (!selectedPastQuestionsId || !user || isGeneratingPredictions || upgradeBlocked) return;

    // Check if selected document is completed
    const pqDoc = pastQuestionsDocs.find(d => d.id === selectedPastQuestionsId);
    if (pqDoc && pqDoc.status !== 'completed') {
      toast({
        variant: 'destructive',
        title: 'Document not ready',
        description: `The document is still ${pqDoc.status}. Please wait for it to complete.`,
      });
      return;
    }
    const tbDoc = selectedTextbookId ? textbookDocs.find((d) => d.id === selectedTextbookId) : null;
    if (tbDoc && tbDoc.status !== 'completed') {
      toast({
        variant: 'destructive',
        title: 'Textbook not ready',
        description: `The linked textbook is still ${tbDoc.status}. Please wait for it to complete.`,
      });
      return;
    }

    if (!isOnline) {
      toast({ variant: 'destructive', title: 'Offline', description: 'Connect to the internet to generate predictions.' });
      return;
    }

    try {
      // Get content required for the action
      const pastQuestionsContent = await getDocContent(selectedPastQuestionsId);
      const mainTextbookContent = selectedTextbookId ? await getDocContent(selectedTextbookId) : undefined;

      if (!session?.access_token) {
        toast({ variant: 'destructive', title: 'Authentication Error', description: 'Session expired. Please log in again.' });
        return;
      }

      await generatePredictions(
        pastQuestionsContent,
        mainTextbookContent,
        selectedTextbookId || selectedPastQuestionsId,
      );

    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Prediction Failed', description: `Could not retrieve document content. ${err.message}` });
    }
  };

  const showPredictionExplanation = useCallback(() => {
    toast({
      title: 'Already generated',
      description: 'This exam briefing is already saved for the current document version. Upload an updated document or ask an admin to clear the cache to regenerate.',
    });
  }, [toast]);

  const handlePredictionClick = async () => {
    if (predictionOutput.status === 'ready') {
      showPredictionExplanation();
      return;
    }
    if (predictionOutput.status === 'running' || predictionOutput.status === 'loading') {
      toast({
        title: 'Generating in progress',
        description: 'Exam Prediction is already generating for this document.',
      });
      return;
    }
    if (predictionOutput.status === 'failed') {
      toast({
        variant: 'destructive',
        title: 'Generation locked',
        description: 'This document has a failed cached prediction. Upload a new version or ask an admin to clear the cache before retrying.',
      });
      return;
    }
    await triggerGetPredictions();
    void predictionOutput.refresh();
  };

  return (
    <TooltipProvider>
      <main id="predictions-section" className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
        {/* Header */}
        <div className="grid gap-4">
          <div>
            <h1 className="font-headline text-2xl font-semibold">Exam Prediction Engine</h1>
            <p className="text-muted-foreground">Let the AU provide an intelligence briefing on your upcoming exam.</p>
          </div>

          <Alert>
            <BrainCircuit className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>How It Works</AlertTitle>
            <AlertDescription>
              Select your past questions and main textbook. The AU analyzes both to identify exam patterns, predict likely topics, and highlight common mistakes.
            </AlertDescription>
          </Alert>

          {/* Selects + Generate Button */}
          <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[1fr_auto]">
            <div className="grid min-w-0 grid-cols-1 items-end gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <Label htmlFor="past-questions"><FileQuestion className="mr-2 inline-block h-4 w-4" aria-hidden="true" />Past Questions</Label>
                <Select onValueChange={handlePastQuestionsChange} disabled={docsLoading || isGeneratingPredictions}>
                  <SelectTrigger
                    id="past-questions"
                    className="w-full min-w-0"
                    aria-label="Select past questions"
                    title={selectedPastQuestionDoc?.file_name || undefined}
                  >
                    <DocumentSelectValue
                      text={selectedPastQuestionDoc?.file_name}
                      placeholder={docsLoading ? 'Loading...' : 'Select questions...'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {pastQuestionsDocs.map((doc) => (
                      <SelectItem
                        key={doc.id}
                        value={doc.id}
                        disabled={doc.status !== 'completed'}
                        textValue={doc.file_name}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <FileNameText text={doc.file_name} />
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
              </div>

              <div className="min-w-0">
                <Label htmlFor="textbook"><BookOpen className="mr-2 inline-block h-4 w-4" aria-hidden="true" />Main Textbook (Auto-selected)</Label>
                <Select value={selectedTextbookId || ''} disabled>
                  <SelectTrigger
                    id="textbook"
                    className="w-full min-w-0"
                    aria-label="Selected textbook"
                    title={selectedTextbookDoc?.file_name || undefined}
                  >
                    <DocumentSelectValue
                      text={selectedTextbookDoc?.file_name}
                      placeholder={docsLoading ? 'Loading...' : 'Select textbook...'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {textbookDocs.map((doc) => (
                      <SelectItem key={doc.id} value={doc.id} textValue={doc.file_name}>
                        <div className="flex min-w-0 items-center gap-2">
                          <FileNameText text={doc.file_name} />
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
              </div>
            </div>

            <div className="flex items-end">
              <Button
                onClick={() => void handlePredictionClick()}
                disabled={
                  !selectedPastQuestionsId ||
                  isGeneratingPredictions ||
                  !isOnline ||
                  upgradeBlocked ||
                  predictionOutput.status === 'loading' ||
                  predictionOutput.status === 'running' ||
                  selectedPastQuestionDoc?.status !== 'completed' ||
                  (selectedTextbookId ? selectedTextbookDoc?.status !== 'completed' : false)
                }
                aria-disabled={predictionOutput.status === 'ready' || predictionOutput.status === 'running' || predictionOutput.status === 'loading'}
                className="w-full lg:w-auto"
              >
                {isGeneratingPredictions || predictionOutput.status === 'loading' || predictionOutput.status === 'running'
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  : <BrainCircuit className="mr-2 h-4 w-4" aria-hidden="true" />}
                {predictionOutput.status === 'ready' ? 'Already Generated' : 'Generate Briefing'}
              </Button>
            </div>
          </div>
          {predictionOutput.status === 'ready' && (
            <p className="text-xs text-muted-foreground">
              Saved briefing loaded. Regeneration is locked until the source document version changes or an admin clears the cache.
            </p>
          )}
        </div>

        {/* Dynamic Content */}
        <div className="mt-4">
          {!isOnline && !predictionData && (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed">
              <div className="space-y-2 text-center text-muted-foreground">
                <WifiOff className="mx-auto h-10 w-10 text-primary/30" aria-hidden="true" />
                <p className="text-lg font-semibold">Feature Unavailable Offline</p>
                <p>Connect to the internet to generate and view predictions.</p>
              </div>
            </div>
          )}

          {isOnline && isGeneratingPredictions && (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed">
              <Loader2 className="mb-4 h-10 w-10 animate-spin text-primary" aria-hidden="true" />
              <p className="font-semibold">The AU is analyzing patterns...</p>
              <p className="text-sm text-muted-foreground">This may take a moment.</p>
            </div>
          )}

          {isOnline && !isGeneratingPredictions && !predictionData && (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed">
              <p className="text-muted-foreground">Please select your documents above to generate a prediction.</p>
            </div>
          )}

          {predictionData && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Briefing Section */}
              {predictionData.briefing && (
                <Card className="lg:col-span-2 border-primary/20 bg-primary/5">
                  <CardHeader>
                    <CardTitle className="font-headline flex items-center gap-2">
                      <BrainCircuit className="h-5 w-5 text-primary" />
                      Executive Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {AnimatedText && <AnimatedText text={predictionData.briefing} className="text-sm md:text-base text-foreground/90" />}
                  </CardContent>
                </Card>
              )}

              {/* Topic Weights */}
              <Card>
                <CardHeader>
                  <CardTitle>Topic Weight Estimates</CardTitle>
                  <CardDescription>The AU's estimate of each topic's importance on the exam, based on past papers.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={chartConfig} className="h-[300px] w-full">
                    <BarChart accessibilityLayer data={formattedTopicWeights} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid horizontal={false} />
                      <YAxis dataKey="topic" type="category" tickLine={false} tickMargin={10} axisLine={false} width={100} tickFormatter={(value) => value.length > 15 ? value.slice(0, 15) + '...' : value} />
                      <XAxis dataKey="weight" type="number" hide />
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <Bar dataKey="weight" radius={5} background={{ fill: 'hsl(var(--muted))', radius: 5 }} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              {/* Predictions */}
              <Card>
                <CardHeader>
                  <CardTitle>Likely Exam Questions & Tips</CardTitle>
                  <CardDescription>Click on a topic for a detailed intelligence briefing.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {predictionData.predictions.map((p, i) => (
                      <button key={i} onClick={() => { setSelectedPrediction(p); setIsDialogOpen(true); }} className="flex w-full items-center justify-between rounded-lg border p-4 text-left transition-all hover:bg-muted">
                        <div className="flex-1">
                          <p className="font-semibold">{p.topic}</p>
                          <p className="text-sm text-muted-foreground">{p.rationale}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant={p.likelihood > 75 ? 'destructive' : p.likelihood > 50 ? 'default' : 'secondary'}>
                                {p.likelihood}%
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent><p>Likelihood</p></TooltipContent>
                          </Tooltip>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {predictionData && (
          <FeedbackSection sectionName="Predictions" />
        )}

        <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3 w-3 text-amber-500" aria-hidden="true" />
          <span>Predictions are a guide and not a guarantee of exam content.</span>
        </div>

        {/* Prediction Modal */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-headline text-xl">{selectedPrediction?.topic}</DialogTitle>
              <DialogDescription>Likelihood: {selectedPrediction?.likelihood}%</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4 text-sm">
              <div>
                <h4 className="font-semibold text-primary">Rationale</h4>
                <p className="text-muted-foreground">{selectedPrediction?.rationale}</p>
              </div>
              <div>
                <h4 className="font-semibold text-primary">Common Mistake</h4>
                <p className="text-muted-foreground">{selectedPrediction?.commonMistake}</p>
              </div>
              <div>
                <h4 className="font-semibold text-primary">Examiner Tip</h4>
                <p className="text-muted-foreground">{selectedPrediction?.examTip}</p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </TooltipProvider>
  );
}
