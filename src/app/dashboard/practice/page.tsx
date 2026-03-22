'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
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
import { Loader2, SquarePen, CheckCircle, XCircle, Lightbulb, RefreshCw, Info, WifiOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from '@/components/icons';
import { useOnlineStatus } from '@/hooks/use-online-status';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { FileNameText } from '@/components/FileNameText';
import { DocumentSelectValue } from '@/components/document-select-value';
import { Badge } from '@/components/ui/badge';
import { useAuDocuments } from '@/hooks/api/use-au-documents';
import { useAuExams } from '@/hooks/api/use-au-exams';
import { useStore } from '@/hooks/use-store';
import { useFeatureFlags } from '@/components/feature-flag-provider';
import { useEffectiveEntitlements } from '@/hooks/use-effective-entitlements';
import { FeatureGatePanel } from '@/components/feature-gate-panel';
import { getDashboardFeatureAccess } from '@/lib/feature-access';
import { safeFetch } from '@/lib/api/safe-fetch';
import { useFeatureOutput } from '@/hooks/api/use-feature-output';


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

function shuffleArray<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function buildQuestionStatePack(questionPack: PracticeQuestion[]): QuestionState[] {
  return shuffleArray(questionPack).map((question) => ({
    ...question,
    options: shuffleArray(question.options),
    userAnswer: undefined,
    answerState: 'unanswered' as const,
  }));
}

export default function PracticePage() {
  const { records: featureFlagRecords } = useFeatureFlags();
  const { entitlements, loading: entitlementsLoading } = useEffectiveEntitlements();
  const access = useMemo(
    () => getDashboardFeatureAccess('practice_exam_generation', entitlements, featureFlagRecords),
    [entitlements, featureFlagRecords],
  );

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
        title="Practice Exam Center unavailable"
        description={access.message}
        mode="disabled"
      />
    );
  }

  return <PracticePageContent />;
}

function PracticePageContent() {
  const [user] = useSupabaseUser();
  const { session } = useSupabaseSession();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  const upgradeBlocked = useStore((s) => s.upgradeBlocked);

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
  const selectedDoc = useMemo(() => {
    if (!selectedDocId) return null;
    return documents.find((doc) => doc.id === selectedDocId) || null;
  }, [documents, selectedDocId]);
  const selectedDocReady = selectedDoc?.status === 'completed';

  const [questions, setQuestions] = useState<QuestionState[]>([]);
  const [questionPack, setQuestionPack] = useState<PracticeQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [examFinished, setExamFinished] = useState(false);
  const [score, setScore] = useState(0);
  const [attemptCycle, setAttemptCycle] = useState(0);
  const submittedAttemptRef = useRef<string | null>(null);
  const practiceOutput = useFeatureOutput<GeneratePracticeExamOutput>({
    feature: 'practice_exam_generation',
    documentId: selectedDocId,
    enabled: Boolean(selectedDocId && user && session?.access_token),
  });

  const getDocumentExpiryMs = useCallback((docId: string): number | null => {
    const doc = allDocuments.find((item) => item.id === docId);
    if (!doc?.expires_at) return null;
    const expiryMs = new Date(doc.expires_at).getTime();
    return Number.isFinite(expiryMs) ? expiryMs : null;
  }, [allDocuments]);

  const restoreCachedExam = useCallback((docId: string): boolean => {
    if (!user || !isOnline) return false;
    const cacheKey = getCacheKey(user.id, docId);
    const storedJSON = localStorage.getItem(cacheKey);
    if (!storedJSON) return false;

    try {
      const stored: StoredExamHistory = JSON.parse(storedJSON);
      const expiryMs = getDocumentExpiryMs(docId);
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

        setQuestionPack(stored.data.questions);
        setQuestions(buildQuestionStatePack(stored.data.questions));
        toast({ title: 'Loaded from history', description: 'Restored your practice exam from the last session.' });
        return true;
    } catch (e) {
      console.error("Failed to parse exam history from localStorage", e);
      localStorage.removeItem(cacheKey);
      return false;
    }
  }, [getDocumentExpiryMs, isOnline, toast, user]);

  // Sync examData from hook to local questions state
  useEffect(() => {
    if (examData) {
      setQuestionPack(examData.questions);
      setQuestions(buildQuestionStatePack(examData.questions));
      
      // Cache the result
      if (user && selectedDocId) {
        const historyToStore: StoredExamHistory = { timestamp: Date.now(), data: examData };
        localStorage.setItem(getCacheKey(user.id, selectedDocId), JSON.stringify(historyToStore));
      }
    }
  }, [examData, user, selectedDocId]);

  useEffect(() => {
    if (practiceOutput.status !== 'ready' || !practiceOutput.output || questionPack.length > 0) {
      return;
    }
    setQuestionPack(practiceOutput.output.questions);
    setQuestions(buildQuestionStatePack(practiceOutput.output.questions));
    setCurrentQuestionIndex(0);
    setExamFinished(false);
    setScore(0);
    submittedAttemptRef.current = null;
  }, [practiceOutput.output, practiceOutput.status, questionPack.length]);

  const handleDocSelectionChange = useCallback((docId: string) => {
    setSelectedDocId(docId);
    setQuestionPack([]);
    setQuestions([]);
    setCurrentQuestionIndex(0);
    setExamFinished(false);
    setScore(0);
    submittedAttemptRef.current = null;
    setAttemptCycle((value) => value + 1);

    restoreCachedExam(docId);
  }, [restoreCachedExam]);
  
  useEffect(() => {
    if (docsLoading || !documents.length) return;
    const completedDocIds = documents.filter((doc) => doc.status === 'completed').map((doc) => doc.id);
    const docIds = completedDocIds.length > 0 ? completedDocIds : documents.map((doc) => doc.id);
    if (!selectedDocId || !docIds.includes(selectedDocId)) {
      const newSelectedId = docIds[0] || null;
      if (newSelectedId) {
        handleDocSelectionChange(newSelectedId);
      }
    }
  }, [documents, docsLoading, selectedDocId, handleDocSelectionChange]);

  const triggerGeneration = async () => {
    if (!selectedDocId || !user) {
        toast({ variant: 'destructive', title: 'Error', description: 'Please select a document first.' });
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

    if (upgradeBlocked) {
      return;
    }
    
     if (!isOnline) {
        toast({ variant: 'destructive', title: 'You are offline', description: 'This action requires an internet connection.' });
        return;
    }
    
    if (restoreCachedExam(selectedDocId)) {
        setExamFinished(false);
        setCurrentQuestionIndex(0);
        setScore(0);
        submittedAttemptRef.current = null;
        setAttemptCycle((value) => value + 1);
        return;
    }
     
    setQuestionPack([]);
    setQuestions([]);
    setCurrentQuestionIndex(0);
    setExamFinished(false);
    setScore(0);
    submittedAttemptRef.current = null;
    setAttemptCycle((value) => value + 1);
     
    try {
        const attachedPQs = allDocuments
          .filter(d => d.parent_id === selectedDocId && (d.document_type === 'past_questions' || d.document_type === 'exam_questions') && d.status === 'completed')
          .map(d => d.id);
        
        await startExamGeneration(attachedPQs);
    } catch (error: any) {
        // Error handled by hook
    }
  };

  const showPracticeExplanation = useCallback(() => {
    toast({
      title: 'Already generated',
      description: 'This practice exam pack is already saved for the current document. Use Retry This Exam without extra token cost, or upload a new version to generate again.',
    });
  }, [toast]);

  const handleGenerateClick = async () => {
    if (practiceOutput.status === 'ready' || questionPack.length > 0) {
      showPracticeExplanation();
      return;
    }
    if (practiceOutput.status === 'running' || practiceOutput.status === 'loading') {
      toast({
        title: 'Generating in progress',
        description: 'Practice Exam is already generating for this document.',
      });
      return;
    }
    if (practiceOutput.status === 'failed') {
      toast({
        variant: 'destructive',
        title: 'Generation locked',
        description: 'This document has a failed cached exam pack. Upload a new version or ask an admin to clear the cache before retrying.',
      });
      return;
    }
    await triggerGeneration();
    void practiceOutput.refresh();
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
      if (questionPack.length === 0) return;
      setQuestions(buildQuestionStatePack(questionPack));
      setCurrentQuestionIndex(0);
      setExamFinished(false);
      setScore(0);
      submittedAttemptRef.current = null;
      setAttemptCycle((value) => value + 1);
  };

  useEffect(() => {
    if (!examFinished || !selectedDocId || !session?.access_token || questions.length === 0) {
      return;
    }

    const submissionKey = `${selectedDocId}:${attemptCycle}`;
    if (submittedAttemptRef.current === submissionKey) {
      return;
    }
    submittedAttemptRef.current = submissionKey;

    const answers = questions.map((question, index) => ({
      index,
      questionText: question.questionText,
      userAnswer: question.userAnswer || null,
      correctAnswer: question.correctAnswer,
      isCorrect: question.userAnswer === question.correctAnswer,
    }));

    void safeFetch('/api/au/practice-attempts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      timeout: 10_000,
      silent: true,
      body: JSON.stringify({
        documentId: selectedDocId,
        answers,
        score,
        metadata: {
          totalQuestions: questions.length,
        },
      }),
    }).catch((error) => {
      console.warn('[practice] Failed to persist attempt', error);
      submittedAttemptRef.current = null;
    });
  }, [attemptCycle, examFinished, questions, score, selectedDocId, session?.access_token]);
  
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
                Retry This Exam
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
        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row md:ml-auto md:w-auto">
          <Select
            onValueChange={handleDocSelectionChange}
            value={selectedDocId || ''}
            disabled={docsLoading || isGenerating}
          >
            <SelectTrigger
              className="min-w-0 flex-1 md:min-w-[250px]"
              title={selectedDoc?.file_name || undefined}
            >
              <DocumentSelectValue
                text={selectedDoc?.file_name}
                placeholder={docsLoading ? 'Loading...' : 'Select a document...'}
              />
            </SelectTrigger>
            <SelectContent>
              {docsLoading ? (
                <div className="flex items-center justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : (
                documents.map((doc) => (
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
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            onClick={() => void handleGenerateClick()}
            disabled={isGenerating || !selectedDocId || !isOnline || upgradeBlocked || !selectedDocReady || practiceOutput.status === 'loading' || practiceOutput.status === 'running'}
            aria-disabled={practiceOutput.status === 'ready' || practiceOutput.status === 'running' || practiceOutput.status === 'loading'}
          >
            {isGenerating || practiceOutput.status === 'loading' || practiceOutput.status === 'running'
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <SquarePen className="mr-2 h-4 w-4" />}
            <span>{practiceOutput.status === 'ready' || questionPack.length > 0 ? 'Already Generated' : 'Generate Exam'}</span>
          </Button>
        </div>
      </div>
      
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
          Generated exams are cached until the source document expires.
        </span>
      </div>
      {practiceOutput.status === 'ready' && (
        <div className="text-center text-xs text-muted-foreground">
          Saved exam pack loaded. Retrying questions does not regenerate or spend extra tokens.
        </div>
      )}
    </main>
  );
}
