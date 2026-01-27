'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import type { PracticeQuestion, GeneratePracticeExamOutput } from '@shared/schemas';
import { FeedbackSection } from "@/components/au-feedback";
import { Loader2, SquarePen, CheckCircle, XCircle, Lightbulb, RefreshCw, Info, WifiOff, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from '@/components/icons';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { TruncatedText } from '@/components/TruncatedText';
import { Badge } from '@/components/ui/badge';
import { useAuDocuments } from '@/hooks/api/use-au-documents';
import { useAuExams } from '@/hooks/api/use-au-exams';
import { useConceptGraphStore } from '@/hooks/use-concept-graph-store';
import { useRouter } from 'next/navigation';
import Link from 'next/link';


type AnswerState = 'unanswered' | 'correct' | 'incorrect';

interface QuestionState extends PracticeQuestion {
  userAnswer?: string;
  answerState: AnswerState;
}

interface StoredExamHistory {
  timestamp: number;
  data: GeneratePracticeExamOutput;
}

const getCacheKey = (userId: string, docId: string) => `practice_exam_history_${userId}_${docId}`;

export default function PracticePage() {
  const router = useRouter();
  const [user] = useSupabaseUser();
  const [session] = useSupabaseSession();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();

  const setActiveDoc = useConceptGraphStore(s => s.setActiveDoc);
  const ensureDoc = useConceptGraphStore(s => s.ensureDoc);
  const applyPracticeAnswer = useConceptGraphStore(s => s.applyPracticeAnswer);
  const graphDoc = useConceptGraphStore(s => (selectedDocId ? s.docs[selectedDocId] : null));
  const setSelectedNodeIds = useConceptGraphStore(s => s.setSelectedNodeIds);

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const { documents: allDocuments, loading: docsLoading } = useAuDocuments();
  const { 
    isGenerating, 
    examData, 
    startExamGeneration 
  } = useAuExams(selectedDocId);

  const documents = useMemo(() => 
    allDocuments.filter(d => d.document_type === 'main_textbook'),
    [allDocuments]
  );

  const [questions, setQuestions] = useState<QuestionState[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [examFinished, setExamFinished] = useState(false);
  const [score, setScore] = useState(0);

  // Sync examData from hook to local questions state
  useEffect(() => {
    if (examData) {
      const initialQuestions = examData.questions.map(q => ({
        ...q,
        answerState: 'unanswered' as AnswerState,
      }));
      setQuestions(initialQuestions);
      
      // Cache the result
      if (user && selectedDocId) {
        const historyToStore: StoredExamHistory = { timestamp: Date.now(), data: examData };
        localStorage.setItem(getCacheKey(user.id, selectedDocId), JSON.stringify(historyToStore));
      }
    }
  }, [examData, user, selectedDocId]);

  const handleDocSelectionChange = useCallback((docId: string) => {
    setSelectedDocId(docId);
    setActiveDoc(docId);
    ensureDoc(docId);
    setQuestions([]);
    setCurrentQuestionIndex(0);
    setExamFinished(false);
    setScore(0);

    if (user && isOnline) {
      const cacheKey = getCacheKey(user.id, docId);
      const storedJSON = localStorage.getItem(cacheKey);
      if (storedJSON) {
        try {
          const stored: StoredExamHistory = JSON.parse(storedJSON);
          const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;

          if (stored.timestamp > threeDaysAgo) {
            const cachedQuestions = stored.data.questions.map(q => ({ ...q, answerState: 'unanswered' as AnswerState }));
            setQuestions(cachedQuestions);
            toast({ title: 'Loaded from history', description: 'Restored your practice exam from the last session.' });
          } else {
            localStorage.removeItem(cacheKey); // Stale data
          }
        } catch (e) {
          console.error("Failed to parse exam history from localStorage", e);
          localStorage.removeItem(cacheKey);
        }
      }
    }
  }, [user, toast, isOnline]);
  
  useEffect(() => {
    if (docsLoading || !documents.length) return;
    const docIds = documents.map(doc => doc.id);
    if (!selectedDocId || !docIds.includes(selectedDocId)) {
      const newSelectedId = docIds[0] || null;
      if (newSelectedId) {
        handleDocSelectionChange(newSelectedId);
      }
    }
  }, [documents, docsLoading, selectedDocId, handleDocSelectionChange]);

  const triggerGeneration = async (forceNew = false) => {
    if (!selectedDocId || !user) {
        toast({ variant: 'destructive', title: 'Error', description: 'Please select a document first.' });
        return;
    }
    
     if (!isOnline) {
        toast({ variant: 'destructive', title: 'You are offline', description: 'This action requires an internet connection.' });
        return;
    }
    
    if (!forceNew) {
        const cacheKey = getCacheKey(user.id, selectedDocId);
        const storedJSON = localStorage.getItem(cacheKey);
        if (storedJSON) {
            const stored: StoredExamHistory = JSON.parse(storedJSON);
            const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
            if (stored.timestamp > threeDaysAgo) {
                const cachedQuestions = stored.data.questions.map(q => ({ ...q, answerState: 'unanswered' as AnswerState }));
                setQuestions(cachedQuestions);
                toast({ title: 'Loaded from history', description: 'Restored your practice exam from the last session.' });
                setExamFinished(false);
                setCurrentQuestionIndex(0);
                setScore(0);
                return;
            }
        }
    }
    
    setQuestions([]);
    setCurrentQuestionIndex(0);
    setExamFinished(false);
    setScore(0);
    
    try {
        const attachedPQs = allDocuments
          .filter(d => d.parent_id === selectedDocId && (d.document_type === 'past_questions' || d.document_type === 'exam_questions') && d.status === 'completed')
          .map(d => d.id);
        
        await startExamGeneration(attachedPQs);
    } catch (error: any) {
        // Error handled by hook
    }
  };
  
  const handleAnswerSelect = (questionIndex: number, answer: string) => {
    if (questions[questionIndex].answerState !== 'unanswered') return;

    const updatedQuestions = [...questions];
    const question = updatedQuestions[questionIndex];
    
    question.userAnswer = answer;
    
    if (answer === question.correctAnswer) {
      question.answerState = 'correct';
      setScore(s => s + 1);
    } else {
      question.answerState = 'incorrect';
    }

    if (selectedDocId) {
      applyPracticeAnswer(selectedDocId, question, answer === question.correctAnswer);
    }

    setQuestions(updatedQuestions);
  };
  
  const handleNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(i => i + 1);
    } else {
      setExamFinished(true);
    }
  };
  
  const handleRestart = () => {
      // We trigger generation and force a new one
      triggerGeneration(true);
  }
  
  const currentQuestion = questions[currentQuestionIndex];
  const progress = questions.length > 0 ? ((currentQuestionIndex + 1) / questions.length) * 100 : 0;
  
  const renderInitialState = () => {
    if (!isOnline) {
      return (
        <div className="flex flex-col items-center justify-center text-center h-full min-h-[400px]">
          <WifiOff className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">Feature Unavailable Offline</h2>
          <p className="text-muted-foreground max-w-md mx-auto mt-2">
            Practice exams are generated online. Please connect to the internet to create or take an exam.
          </p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center text-center h-full min-h-[400px]">
        <SquarePen className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">Practice Exam Center</h2>
        <p className="text-muted-foreground max-w-md mx-auto mt-2">
          Select one of your completed documents and let the AU generate a practice exam to test your knowledge.
        </p>
      </div>
    );
  };
  
  const renderLoadingState = () => (
    <div className="flex flex-col items-center justify-center text-center h-full min-h-[400px]">
       <div className="relative flex h-16 w-16 items-center justify-center">
            <div className="absolute h-12 w-12 animate-spin rounded-full border-2 border-dashed border-primary/50"></div>
            <div className="absolute h-16 w-16 animate-[spin_3s_linear_infinite_reverse] rounded-full border-2 border-dashed border-accent/50"></div>
            <Icons.logo className="h-8 w-8 text-primary drop-shadow-[0_0_5px_hsl(var(--primary)/0.7)]" />
        </div>
        <h2 className="text-xl font-semibold mt-4">The AU is crafting your exam...</h2>
        <p className="text-muted-foreground">This may take a moment.</p>
    </div>
  );
  
  const renderExamFinishedState = () => {
      const percentage = Math.round((score / questions.length) * 100);
      let feedback = { title: "Great Job!", message: "You have a solid understanding of the material." };
      if (percentage < 50) feedback = { title: "Needs Improvement", message: "Review the explanations and try again." };
      else if (percentage < 80) feedback = { title: "Good Effort!", message: "You're getting there. Keep practicing!" };

      return (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <h2 className="text-2xl font-bold font-headline mb-2">{feedback.title}</h2>
            <p className="text-muted-foreground mb-6">{feedback.message}</p>
            <Card className="max-w-sm mx-auto">
                <CardHeader>
                    <CardTitle>Your Score</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-4">
                    <div className="text-6xl font-bold text-primary">{percentage}%</div>
                    <p className="font-semibold">{score} out of {questions.length} correct</p>
                    <Progress value={percentage} className="w-full" />
                </CardContent>
            </Card>
             <Button onClick={handleRestart} className="mt-8">
                <RefreshCw className="mr-2 h-4 w-4" />
                Generate a New Exam
             </Button>
             <Button
               variant="secondary"
               onClick={() => {
                 if (selectedDocId) {
                   setActiveDoc(selectedDocId);
                   ensureDoc(selectedDocId);
                 }
                 router.push('/dashboard/concept-map');
               }}
               className="mt-2"
             >
               View progress on Concept Map
             </Button>
        </motion.div>
      );
  }
  
  const renderQuestion = () => (
    <AnimatePresence mode="wait">
      <motion.div
        key={currentQuestionIndex}
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -50 }}
        transition={{ duration: 0.3 }}
      >
        <CardHeader>
          <CardTitle className="font-headline text-xl leading-relaxed">{currentQuestion.questionText}</CardTitle>
          <CardDescription>Question {currentQuestionIndex + 1} of {questions.length}</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup 
            onValueChange={(value) => handleAnswerSelect(currentQuestionIndex, value)}
            value={currentQuestion.userAnswer}
            disabled={currentQuestion.answerState !== 'unanswered'}
            className="space-y-3"
          >
            {currentQuestion.options.map((option, i) => {
              const isSelected = currentQuestion.userAnswer === option;
              const isCorrect = currentQuestion.correctAnswer === option;
              
              let stateIndicator = null;
              if (currentQuestion.answerState !== 'unanswered' && isSelected) {
                  stateIndicator = isCorrect ? <CheckCircle className="h-5 w-5 text-green-500" /> : <XCircle className="h-5 w-5 text-red-500" />;
              } else if (currentQuestion.answerState !== 'unanswered' && isCorrect) {
                  stateIndicator = <CheckCircle className="h-5 w-5 text-green-500" />;
              }
              
              return (
                <Label key={i} htmlFor={`option-${i}`} className={
                    `flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-all
                    ${isSelected && currentQuestion.answerState === 'correct' ? 'border-green-500 bg-green-500/10' : ''}
                    ${isSelected && currentQuestion.answerState === 'incorrect' ? 'border-red-500 bg-red-500/10' : ''}
                    ${!isSelected && currentQuestion.answerState !== 'unanswered' && isCorrect ? 'border-green-500/50 bg-green-500/5' : ''}
                    ${currentQuestion.answerState === 'unanswered' ? 'hover:bg-muted' : 'cursor-default'}
                `}>
                  <span className="flex-1 mr-4">{option}</span>
                  <div className="flex items-center gap-4">
                    {stateIndicator}
                    <RadioGroupItem value={option} id={`option-${i}`} className="border-primary" />
                  </div>
                </Label>
              );
            })}
          </RadioGroup>

          <AnimatePresence>
            {currentQuestion.answerState !== 'unanswered' && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ delay: 0.2 }}>
                <Alert className="mt-6 bg-primary/5 border-primary/20">
                  <Lightbulb className="h-4 w-4 text-primary" />
                  <AlertTitle className="font-semibold text-primary">Explanation</AlertTitle>
                  <AlertDescription>
                    {currentQuestion.explanation}
                  </AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>
          
           {currentQuestion.answerState !== 'unanswered' && (
                <div className="mt-6 text-center">
                    <Button onClick={handleNextQuestion}>
                        {currentQuestionIndex === questions.length - 1 ? 'Finish Exam' : 'Next Question'}
                    </Button>
                </div>
            )}
        </CardContent>
      </motion.div>
    </AnimatePresence>
  );

  return (
    <main id="practice-section" className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="font-headline text-2xl font-semibold">Practice Exam</h1>
        <div className="flex w-full flex-col gap-2 sm:flex-row md:ml-auto md:w-auto">
          <Select
            onValueChange={handleDocSelectionChange}
            value={selectedDocId || ''}
            disabled={docsLoading || isGenerating}
          >
            <SelectTrigger className="flex-1 md:min-w-[250px]">
              <SelectValue placeholder={docsLoading ? 'Loading...' : 'Select a document...'} />
            </SelectTrigger>
            <SelectContent>
              {docsLoading ? (
                <div className="flex items-center justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : (
                documents.map((doc) => (
                  <SelectItem key={doc.id} value={doc.id} disabled={doc.status !== 'completed'}>
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
                ))
              )}
            </SelectContent>
          </Select>
          <Button onClick={() => triggerGeneration()} disabled={isGenerating || !selectedDocId || !isOnline}>
            {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SquarePen className="mr-2 h-4 w-4" />}
            <span>{questions.length > 0 && !isGenerating ? 'Restart Exam' : 'Generate Exam'}</span>
          </Button>
        </div>
      </div>

      {selectedDocId && (graphDoc?.selectedNodeIds?.length ?? 0) > 0 && (
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
                      onClick={() => setSelectedNodeIds(selectedDocId, graphDoc.selectedNodeIds.filter(x => x !== id))}
                      className="rounded p-0.5 hover:bg-muted"
                      aria-label="Remove concept"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                );
              })}
              <Button type="button" size="sm" variant="outline" onClick={() => setSelectedNodeIds(selectedDocId, [])} className="ml-auto">
                Clear
              </Button>
              <Button asChild type="button" size="sm" variant="secondary">
                <Link href="/dashboard/concept-map">Edit selection</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      <div className="flex-1 rounded-xl border bg-card text-card-foreground shadow flex flex-col justify-center mt-4">
        {isGenerating ? renderLoadingState() : (
            <>
                {questions.length === 0 && !examFinished && renderInitialState()}
                {questions.length > 0 && !examFinished && (
                    <>
                        <Progress value={progress} className="w-full rounded-none rounded-t-xl" />
                        <div className="p-4 md:p-8 flex-1">
                            {renderQuestion()}
                        </div>
                    </>
                )}
                {examFinished && (
                    <div className="p-4 md:p-8 flex-1 flex items-center justify-center">
                       {renderExamFinishedState()}
                    </div>
                )}
            </>
        )}
      </div>

      {(questions.length > 0 || examFinished) && (
        <FeedbackSection sectionName="Practice" />
      )}

      <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Info className="h-3 w-3" />
        <span>
          {user?.is_anonymous 
            ? "Guest mode self-destruct in 24 hours." 
            : "Generated exams are cached for 3 days to save you time."}
        </span>
      </div>
    </main>
  );
}
