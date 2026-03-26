import { useState, useCallback } from 'react';
import { generatePracticeExam, generatePredictions } from '@/lib/api/exams';
import { getDocumentText } from '@/lib/api/documents';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { useToast } from '@/hooks/use-toast';
import type { GeneratePracticeExamOutput, GenerateExamPredictionsOutput } from '@shared/schemas';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { logOnce } from '@/lib/log/dedupe';
import { guardRequest } from '@/lib/api/request-guard';

export function useAuExams(selectedDocId: string | null) {
  const [user] = useSupabaseUser();
  const { session } = useSupabaseSession();
  const { toast } = useToast();
  const { isOnline } = useNetworkStatus();
  const { isLoading: isAuthLoading, isRestoringAuth, isAuthLocked } = useSmartAuth();
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [examData, setExamData] = useState<GeneratePracticeExamOutput | null>(null);
  const [predictions, setPredictions] = useState<GenerateExamPredictionsOutput | null>(null);

  const startExamGeneration = useCallback(async (pastQuestionIds: string[] = []) => {
    if (!selectedDocId || !user) return;
    if (isAuthLoading || isRestoringAuth || isAuthLocked) return;
    const gate = guardRequest({
      isOnline,
      requireAuth: true,
      accessToken: session?.access_token ?? '__cookie_session__',
      warnKey: 'exams:practice',
      context: 'practice exam',
    });
    if (!gate.ok) {
      if (gate.reason === 'offline') {
        logOnce('warn', 'exams:practice:offline', '[exams] Practice exam blocked (offline)');
      } else {
        logOnce('warn', 'exams:practice:no_token', '[exams] Practice exam blocked (no access token)');
        toast({ variant: 'destructive', title: 'Sign in required', description: 'Sign in to generate a practice exam.' });
      }
      return;
    }
    
    setIsGenerating(true);
    try {
      // Truncate content to avoid payload size limits
      const rawDocContent = await getDocumentText(user, selectedDocId);
      const documentContent = rawDocContent.substring(0, 20000); // 20k chars limit
      
      let pastQuestionsContent = '';
      if (pastQuestionIds.length > 0) {
        const contents = await Promise.all(
          pastQuestionIds.map(id => getDocumentText(user, id))
        );
        // Join and truncate past questions
        pastQuestionsContent = contents.join('\n\n---\n\n').substring(0, 15000);
      }

      const result = await generatePracticeExam(
        documentContent,
        pastQuestionsContent,
        { documentId: selectedDocId }
      );
      setExamData(result);
      toast({ title: 'Practice exam generated!' });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Generation failed',
        description: err.message
      });
    } finally {
      setIsGenerating(false);
    }
  }, [isAuthLoading, isAuthLocked, isOnline, isRestoringAuth, selectedDocId, user, session?.access_token, toast]);

  const startPredictionGeneration = useCallback(async (pastQuestionIds: string[]) => {
    if (!selectedDocId || !user || pastQuestionIds.length === 0) return;
    if (isAuthLoading || isRestoringAuth || isAuthLocked) return;
    const gate = guardRequest({
      isOnline,
      requireAuth: true,
      accessToken: session?.access_token ?? '__cookie_session__',
      warnKey: 'exams:predictions',
      context: 'predictions',
    });
    if (!gate.ok) {
      if (gate.reason === 'offline') {
        logOnce('warn', 'exams:predictions:offline', '[exams] Predictions blocked (offline)');
      } else {
        logOnce('warn', 'exams:predictions:no_token', '[exams] Predictions blocked (no access token)');
        toast({ variant: 'destructive', title: 'Sign in required', description: 'Sign in to generate predictions.' });
      }
      return;
    }
    
    setIsGenerating(true);
    try {
      const documentContent = await getDocumentText(user, selectedDocId);
      const contents = await Promise.all(
        pastQuestionIds.map(id => getDocumentText(user, id))
      );
      const pastQuestionsContent = contents.join('\n\n---\n\n');

      const result = await generatePredictions(
        documentContent,
        pastQuestionsContent,
        { documentId: selectedDocId, mainTextbookId: selectedDocId }
      );
      setPredictions(result);
      toast({ title: 'Predictions generated!' });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Prediction failed',
        description: err.message
      });
    } finally {
      setIsGenerating(false);
    }
  }, [isAuthLoading, isAuthLocked, isOnline, isRestoringAuth, selectedDocId, user, session?.access_token, toast]);

  return {
    isGenerating,
    examData,
    predictions,
    startExamGeneration,
    startPredictionGeneration
  };
}
