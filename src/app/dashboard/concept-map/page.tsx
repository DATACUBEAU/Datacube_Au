'use client';

import 'reactflow/dist/style.css';

import { useEffect, useMemo, useState } from 'react';
import { useAuDocuments } from '@/hooks/api/use-au-documents';
import { useStore } from '@/hooks/use-store';
import { useConceptGraphStore } from '@/hooks/use-concept-graph-store';
import { ConceptGraphCanvas } from '@/components/concept-graph/ConceptGraphCanvas';
import { ConceptInspector } from '@/components/concept-graph/ConceptInspector';
import { ConceptGraphToolbar, type GraphToolMode } from '@/components/concept-graph/ConceptGraphToolbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import { BrainCircuit, Loader2, Wand2 } from 'lucide-react';
import { ReactFlowProvider } from 'reactflow';

export default function ConceptMapPage() {
  const { documents: allDocuments, loading: docsLoading } = useAuDocuments();
  const documents = useMemo(() => allDocuments.filter(d => d.document_type === 'main_textbook'), [allDocuments]);

  const knowledgeData = useStore(s => s.knowledgeData);
  const rehydrateFromCache = useStore(s => s.rehydrateFromCache);

  const setActiveDoc = useConceptGraphStore(s => s.setActiveDoc);
  const importFromKnowledge = useConceptGraphStore(s => s.importFromKnowledge);
  const activeDocId = useConceptGraphStore(s => s.activeDocId);
  const docState = useConceptGraphStore(s => (activeDocId ? s.docs[activeDocId] : null));

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [toolMode, setToolMode] = useState<GraphToolMode>('select');
  const [canvasApi, setCanvasApi] = useState<{ fitView: () => void; centerSelection: () => void } | null>(null);

  useEffect(() => {
    if (docsLoading || documents.length === 0) return;
    if (!selectedDocId) {
      setSelectedDocId(documents[0].id);
    }
  }, [docsLoading, documents, selectedDocId]);

  useEffect(() => {
    if (!selectedDocId) return;
    setActiveDoc(selectedDocId);
    rehydrateFromCache(selectedDocId);
  }, [rehydrateFromCache, selectedDocId, setActiveDoc]);

  useEffect(() => {
    if (!selectedDocId) return;
    if (!knowledgeData) return;
    if (!docState || Object.keys(docState.graph.nodes).length > 0) return;
    importFromKnowledge(selectedDocId, knowledgeData);
  }, [docState, importFromKnowledge, knowledgeData, selectedDocId]);

  const hasGraph = !!(docState && Object.keys(docState.graph.nodes).length > 0);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <BrainCircuit className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-headline text-2xl font-semibold">Concept Map</h1>
            <p className="text-sm text-muted-foreground">A living concept graph connected to predictions and practice.</p>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto md:items-end">
          <div className="min-w-[260px]">
            <Select value={selectedDocId || ''} onValueChange={setSelectedDocId} disabled={docsLoading}>
              <SelectTrigger aria-label="Select document">
                <SelectValue placeholder={docsLoading ? 'Loading...' : 'Select a document...'} />
              </SelectTrigger>
              <SelectContent>
                {documents.map(d => (
                  <SelectItem key={d.id} value={d.id} disabled={d.status !== 'completed'}>
                    <div className="flex items-center gap-2">
                      <span className="max-w-[200px] truncate">{d.file_name}</span>
                      {d.status !== 'completed' && (
                        <Badge variant="outline" className="h-4 px-1 text-[10px] animate-pulse">
                          {d.status}...
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button asChild variant="secondary" className="gap-2">
            <Link href="/dashboard/knowledge">
              <Wand2 className="h-4 w-4" />
              Open Knowledge
            </Link>
          </Button>
        </div>
      </div>

      {!selectedDocId ? (
        <Card>
          <CardHeader>
            <CardTitle>Pick a document</CardTitle>
            <CardDescription>Select a completed textbook to build its concept graph.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
            {docsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {docsLoading ? 'Loading documents...' : 'No documents available.'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[320px_1fr_360px]">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Tools</CardTitle>
                <CardDescription>Build, explore, and connect concepts.</CardDescription>
              </CardHeader>
              <CardContent>
                <ConceptGraphToolbar
                  docId={selectedDocId}
                  toolMode={toolMode}
                  onToolModeChange={setToolMode}
                  onFitView={() => canvasApi?.fitView()}
                  onCenterSelection={() => canvasApi?.centerSelection()}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Graph status</CardTitle>
                <CardDescription>Source and sync state for this document.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nodes</span>
                  <span className="font-semibold">{docState ? Object.keys(docState.graph.nodes).length : 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Edges</span>
                  <span className="font-semibold">{docState ? docState.graph.edges.length : 0}</span>
                </div>
                <Separator />
                <div className="text-xs text-muted-foreground">
                  This graph is built from cached Knowledge outputs (unchanged) plus your edits and session results.
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="min-h-[600px]">
            {!hasGraph ? (
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>No graph loaded yet</CardTitle>
                  <CardDescription>Generate Knowledge for this document, then return here to visualize it as a graph.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div>Knowledge generation logic remains unchanged.</div>
                  <Button asChild className="gap-2">
                    <Link href="/dashboard/knowledge">
                      <Wand2 className="h-4 w-4" />
                      Go to Knowledge
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="relative h-full">
                <ReactFlowProvider>
                  <ConceptGraphCanvas
                    docId={selectedDocId}
                    toolMode={toolMode}
                    onToolModeChange={setToolMode}
                    onApiReady={setCanvasApi}
                  />
                </ReactFlowProvider>
              </div>
            )}
          </div>

          <div className="min-h-[600px]">
            <ConceptInspector docId={selectedDocId} />
          </div>
        </div>
      )}
    </main>
  );
}
