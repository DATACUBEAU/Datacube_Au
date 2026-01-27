'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';

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
  SelectValue,
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
import { supabase } from '@/lib/supabase/client';
import { TruncatedText } from '@/components/TruncatedText';
import { useConceptGraphStore } from '@/hooks/use-concept-graph-store';
import { normalizeLabel } from '@/lib/concept-graph/utils';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { FeedbackSection } from "@/components/au-feedback";
import {
  Loader2,
  AlertTriangle,
  FileQuestion,
  BookOpen,
  BrainCircuit,
  ChevronRight,
  WifiOff,
  X,
} from 'lucide-react';
import type { GeneratePredictionsOutput } from '@/app/actions';

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

const chartConfig: ChartConfig = {
  weight: { label: 'Topic Weight (%)' },
  topic: { label: 'Topic', color: 'hsl(var(--chart-1))' },
};

export default function PredictionsPage() {
  const router = useRouter();
  const [user] = useSupabaseUser();
  const [session] = useSupabaseSession();
  const isOnline = useOnlineStatus();
  const { toast } = useToast();

  const [selectedPastQuestionsId, setSelectedPastQuestionsId] = useState<string | null>(null);
  const [selectedTextbookId, setSelectedTextbookId] = useState<string | null>(null);

  // Use the global Zustand store for state management
  const {
    predictionData,
    isGeneratingPredictions,
    generatePredictions,
    clearKnowledgeAndPredictions,
  } = useStore();

  const [formattedTopicWeights, setFormattedTopicWeights] = useState<FormattedTopicWeight[]>([]);
  const [selectedPrediction, setSelectedPrediction] = useState<PredictionDetail | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const setActiveDoc = useConceptGraphStore(s => s.setActiveDoc);
  const ensureDoc = useConceptGraphStore(s => s.ensureDoc);
  const applyPredictions = useConceptGraphStore(s => s.applyPredictions);
  const setSelectedNodeIds = useConceptGraphStore(s => s.setSelectedNodeIds);
  const graphDoc = useConceptGraphStore(s => (selectedTextbookId ? s.docs[selectedTextbookId] : null));
  const docGraph = graphDoc?.graph ?? null;

  // Use global hook
  const { documents: allDocuments, loading: docsLoading } = useAuDocuments();

  const textbookDocs = useMemo(() => allDocuments.filter(d => d.document_type === 'main_textbook'), [allDocuments]);
  const pastQuestionsDocs = useMemo(() => allDocuments.filter(d => d.document_type === 'past_questions' || d.document_type === 'exam_questions'), [allDocuments]);

  const mainTextbookIds = useMemo(() => textbookDocs.map((doc) => doc.id), [textbookDocs]);

  const parseTopicWeights = useCallback((weights: string) => {
    const parsed = weights
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

  // Update chart data when predictionData from the store changes
  useEffect(() => {
    if (predictionData?.topicWeights) {
      parseTopicWeights(predictionData.topicWeights);
    } else {
      setFormattedTopicWeights([]);
    }
  }, [predictionData, parseTopicWeights]);

  useEffect(() => {
    if (!selectedTextbookId || !predictionData) return;
    setActiveDoc(selectedTextbookId);
    ensureDoc(selectedTextbookId);
    applyPredictions(selectedTextbookId, predictionData);
  }, [applyPredictions, ensureDoc, predictionData, selectedTextbookId, setActiveDoc]);

  const findConceptIdsForTopic = useCallback((topic: string): string[] => {
    if (!docGraph) return [];
    const norm = normalizeLabel(topic);
    const matches = Object.values(docGraph.nodes)
      .map(n => ({ id: n.id, score: normalizeLabel(n.label) === norm ? 1000 : normalizeLabel(n.label).includes(norm) ? norm.length : norm.includes(normalizeLabel(n.label)) ? normalizeLabel(n.label).length : 0 }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(x => x.id);
    return matches;
  }, [docGraph]);

  const openTopicInConceptMap = useCallback((topic: string) => {
    if (!selectedTextbookId) return;
    const ids = findConceptIdsForTopic(topic);
    setActiveDoc(selectedTextbookId);
    ensureDoc(selectedTextbookId);
    if (ids.length > 0) setSelectedNodeIds(selectedTextbookId, [ids[0]]);
    router.push('/dashboard/concept-map');
  }, [ensureDoc, findConceptIdsForTopic, router, selectedTextbookId, setActiveDoc, setSelectedNodeIds]);


  const handlePastQuestionsChange = (docId: string) => {
    setSelectedPastQuestionsId(docId);
    const pqDoc = pastQuestionsDocs.find((d) => d.id === docId);
    setSelectedTextbookId(pqDoc?.parent_id || null);
    if (pqDoc?.parent_id) {
      setActiveDoc(pqDoc.parent_id);
      ensureDoc(pqDoc.parent_id);
    }
    clearKnowledgeAndPredictions(); // Clear global store data
  };

  const getDocContent = async (docId: string) => {
    if (!user) throw new Error('User not available');
    return getAuDocumentChunksText(user, docId);
  };

  const triggerGetPredictions = async () => {
    if (!selectedPastQuestionsId || !user || isGeneratingPredictions) return;

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

      await generatePredictions(pastQuestionsContent, session.access_token, mainTextbookContent);

    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Prediction Failed', description: `Could not retrieve document content. ${err.message}` });
    }
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[1fr_auto]">
            <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="past-questions"><FileQuestion className="mr-2 inline-block h-4 w-4" aria-hidden="true" />Past Questions</Label>
                <Select onValueChange={handlePastQuestionsChange} disabled={docsLoading || isGeneratingPredictions}>
                  <SelectTrigger id="past-questions" aria-label="Select past questions"><SelectValue placeholder={docsLoading ? 'Loading...' : 'Select questions...'} /></SelectTrigger>
                  <SelectContent>
                    {pastQuestionsDocs.map((doc) => (
                      <SelectItem key={doc.id} value={doc.id}>
                        <div className="flex items-center gap-2">
                          <TruncatedText
                            text={doc.file_name}
                            maxWidthClass="max-w-[180px]"
                          />
                          {doc.status !== 'completed' && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1 animate-pulse">
                              {doc.status}...
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="textbook"><BookOpen className="mr-2 inline-block h-4 w-4" aria-hidden="true" />Main Textbook (Auto-selected)</Label>
                <Select value={selectedTextbookId || ''} disabled>
                  <SelectTrigger id="textbook" aria-label="Selected textbook"><SelectValue placeholder={docsLoading ? 'Loading...' : 'Select textbook...'} /></SelectTrigger>
                  <SelectContent>
                    {textbookDocs.map((doc) => (
                      <SelectItem key={doc.id} value={doc.id}>
                        <div className="flex items-center gap-2">
                          <TruncatedText
                            text={doc.file_name}
                            maxWidthClass="max-w-[180px]"
                          />
                          {doc.status !== 'completed' && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1 animate-pulse">
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
              <Button onClick={triggerGetPredictions} disabled={!selectedPastQuestionsId || isGeneratingPredictions || !isOnline} className="w-full lg:w-auto">
                {isGeneratingPredictions ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <BrainCircuit className="mr-2 h-4 w-4" aria-hidden="true" />}
                Generate Briefing
              </Button>
            </div>
          </div>

          {selectedTextbookId && (graphDoc?.selectedNodeIds?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Active concepts</CardTitle>
                <CardDescription>These come from your Concept Map selection.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-2">
                  {graphDoc?.selectedNodeIds.map((id) => {
                    const label = graphDoc.graph.nodes[id]?.label || id;
                    return (
                      <span key={id} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs">
                        <span className="max-w-[220px] truncate">{label}</span>
                        <button
                          type="button"
                          onClick={() => setSelectedNodeIds(selectedTextbookId, graphDoc.selectedNodeIds.filter(x => x !== id))}
                          className="rounded p-0.5 hover:bg-muted"
                          aria-label="Remove concept"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    );
                  })}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedNodeIds(selectedTextbookId, [])}
                    className="ml-auto"
                  >
                    Clear
                  </Button>
                  <Button asChild type="button" size="sm" variant="secondary">
                    <Link href="/dashboard/concept-map">Edit selection</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
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
                      <div key={i} className="rounded-lg border p-4 transition-all hover:bg-muted">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPrediction(p);
                              setIsDialogOpen(true);
                            }}
                            className="flex-1 text-left"
                          >
                            <p className="font-semibold">{p.topic}</p>
                            <p className="text-sm text-muted-foreground">{p.rationale}</p>
                          </button>
                          <div className="flex shrink-0 items-center gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant={p.likelihood > 75 ? 'destructive' : p.likelihood > 50 ? 'default' : 'secondary'}>
                                  {p.likelihood}%
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent><p>Likelihood</p></TooltipContent>
                            </Tooltip>
                            <button
                              type="button"
                              onClick={() => openTopicInConceptMap(p.topic)}
                              className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-background/60"
                            >
                              View map
                            </button>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          </div>
                        </div>
                        {selectedTextbookId && findConceptIdsForTopic(p.topic).length > 0 && (
                          <div className="mt-3 text-xs text-muted-foreground">
                            Linked concepts: {findConceptIdsForTopic(p.topic).length}
                          </div>
                        )}
                      </div>
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
              {selectedPrediction?.topic && selectedTextbookId && (
                <div>
                  <h4 className="font-semibold text-primary">Graph linkage</h4>
                  <p className="text-muted-foreground">
                    {findConceptIdsForTopic(selectedPrediction.topic).length > 0
                      ? `This prediction is linked to ${findConceptIdsForTopic(selectedPrediction.topic).length} concept node(s) in your graph.`
                      : 'No matching concept node found yet. It will appear as a prediction-sourced concept in the Concept Map once you open it.'}
                  </p>
                  <div className="mt-2">
                    <Button type="button" variant="secondary" onClick={() => openTopicInConceptMap(selectedPrediction.topic)}>
                      View in Concept Map
                    </Button>
                  </div>
                </div>
              )}
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
