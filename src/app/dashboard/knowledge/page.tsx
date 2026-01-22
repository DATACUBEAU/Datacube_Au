'use client';
import { useState, useEffect } from 'react';
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
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Wand2, Info, WifiOff, BrainCircuit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { useStore } from '@/hooks/use-store';
import type { GenerateKnowledgeOutput } from '@/app/actions';
import { motion } from 'framer-motion';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import type { AuDocumentRow } from '@/lib/au/types';
import { getAuDocumentChunksText, listAuDocumentsForUser } from '@/lib/au/documents';
import { TruncatedText } from '@/components/TruncatedText';
import { Badge } from '@/components/ui/badge';

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


export default function KnowledgePage() {
  const [user] = useSupabaseUser();
  const [session] = useSupabaseSession();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<AuDocumentRow[]>([]);
  const [allDocuments, setAllDocuments] = useState<AuDocumentRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  // Zustand state
  const {
    knowledgeData,
    isGeneratingKnowledge,
    generateKnowledge,
    clearKnowledgeAndPredictions,
    setKnowledgeData,
  } = useStore();

  useEffect(() => {
    if (!user) {
      setDocuments([]);
      setAllDocuments([]);
      setDocsLoading(false);
      return;
    }
    if (!isOnline) {
      setDocsLoading(false);
      return;
    }
    setDocsLoading(true);
    listAuDocumentsForUser(user)
      .then((docs) => {
        setAllDocuments(docs);
        // Only show main textbooks for knowledge generation
        // Filter out "No expiry" completed documents
        const textbooks = docs.filter(d => 
          d.document_type === 'main_textbook' && 
          (d.expires_at || d.status !== 'completed')
        );
        setDocuments(textbooks);
      })
      .catch(() => {
        setDocuments([]);
        setAllDocuments([]);
      })
      .finally(() => setDocsLoading(false));
  }, [user, isOnline]);

  const handleDocSelectionChange = (docId: string) => {
    setSelectedDocId(docId);
    clearKnowledgeAndPredictions(); // Clear global state immediately

    if (user && isOnline) {
      const cacheKey = `knowledge_history_user_${docId}`;
      const storedJSON = localStorage.getItem(cacheKey);
      if (storedJSON) {
        try {
          const stored: StoredKnowledgeHistory = JSON.parse(storedJSON);
          const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;

          if (stored.timestamp > threeDaysAgo) {
            setKnowledgeData(stored.data); // Directly set the data in the store
            toast({ title: 'Loaded from history', description: 'Showing cached knowledge materials.' });
          } else {
            localStorage.removeItem(cacheKey); // Stale data
          }
        } catch (e) {
          console.error('Failed to parse knowledge history from localStorage', e);
          localStorage.removeItem(cacheKey);
        }
      }
    }
  };

  useEffect(() => {
    if (docsLoading || !documents.length) return;
    const docIds = documents.map((doc) => doc.id);
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
    
    if (!isOnline) {
        toast({ variant: 'destructive', title: 'You are offline', description: 'This action requires an internet connection.' });
        return;
    }

    try {
        const documentContent = await getAuDocumentChunksText(user, selectedDocId);
        
        // Check for attached past questions
        const attachedPQs = allDocuments.filter(d => d.parent_id === selectedDocId && d.document_type === 'past_questions' && d.status === 'completed');
        
        let pastQuestionsContent = '';
        if (attachedPQs.length > 0) {
          const contents = await Promise.all(attachedPQs.map(pq => getAuDocumentChunksText(user, pq.id)));
          pastQuestionsContent = contents.join('\n\n---\n\n');
        }

        await generateKnowledge(selectedDocId, documentContent, session?.access_token, pastQuestionsContent);

    } catch (error: any) {
      console.error('Failed to prepare for study material generation:', error);
      toast({
        variant: 'destructive',
        title: 'Preparation Failed',
        description: 'Could not fetch document content to start generation.',
      });
    }
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
    if (!isOnline && !knowledgeData) {
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

    if (!knowledgeData) {
      return (
         <div className="flex h-full min-h-[400px] flex-col items-center justify-center">
              <div className="space-y-2 text-center text-muted-foreground">
                <Wand2 className="mx-auto h-10 w-10 text-primary/30" aria-hidden="true" />
                <p className="text-lg font-semibold">{selectedDocId ? "Ready to unlock A U insights?" : "Please select a document"}</p>
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
                    {AnimatedText && <AnimatedText text={knowledgeData.summary} />}
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
                  {knowledgeData.keyPoints.split('\n').filter(p => p.trim()).map((point, index) => (
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
                    <CardDescription>Click a highlighted keyword to explore its details.</CardDescription>
                </CardHeader>
                <CardContent>
                     <div className="pr-6">
                        {InteractiveConceptMap && <InteractiveConceptMap content={knowledgeData.conceptMap} />}
                     </div>
                </CardContent>
            </Card>
        </TabsContent>

        <TabsContent value="relationships" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="font-headline">Topic Relationships</CardTitle><CardDescription>How different topics in the document relate to each other.</CardDescription></CardHeader>
            <CardContent>
                <div className="pr-6">
                    {AnimatedText && <AnimatedText text={knowledgeData.topicRelationships} />}
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
                {knowledgeData.studyRoadmap.split('\n').filter(s => s.trim().length > 0).map((item, index) => {
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
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <BrainCircuit className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-headline text-2xl font-bold">Knowledge Hub</h1>
            <p className="text-sm text-muted-foreground">Deep analysis and study materials for your documents.</p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {docsLoading ? (
             <div className="flex items-center gap-2 text-sm text-muted-foreground">
               <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
               Loading documents...
             </div>
          ) : (
            <Select value={selectedDocId || undefined} onValueChange={handleDocSelectionChange}>
              <SelectTrigger className="w-full sm:w-[250px]" aria-label="Select document">
                <SelectValue placeholder="Select a textbook" />
              </SelectTrigger>
              <SelectContent>
                {documents.map((doc) => (
                  <SelectItem key={doc.id} value={doc.id} disabled={doc.status !== 'completed'}>
                    <div className="flex items-center gap-2">
                      <TruncatedText text={doc.file_name} maxWidthClass="max-w-[200px]" />
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
          )}

          <Button 
            onClick={triggerGeneration} 
            disabled={!selectedDocId || isGeneratingKnowledge || !isOnline}
            className="shrink-0 gap-2 shadow-md hover:shadow-lg transition-all"
          >
            {isGeneratingKnowledge ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Wand2 className="h-4 w-4" aria-hidden="true" />
            )}
            Generate
          </Button>
        </div>
      </div>
        <div className="mt-4 flex-1">
          {renderContent()}
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3 w-3" />
          <span>
            {user?.is_anonymous 
              ? "Guest mode self-destruct in 24 hours." 
              : "Generated materials are cached for 3 days to ensure freshness."}
          </span>
        </div>
      </main>
    </>
  );
}
