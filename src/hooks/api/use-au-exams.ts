import { useState, useCallback } from 'react';
import { generatePracticeExam, generatePredictions } from '@/lib/api/exams';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { useToast } from '@/hooks/use-toast';
import type { GeneratePracticeExamOutput, GenerateExamPredictionsOutput } from '@shared/schemas';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { logOnce } from '@/lib/log/dedupe';
import { guardRequest } from '@/lib/api/request-guard';
import { describeApiErrorForUser } from '@/lib/api/user-facing-error';
import { getSupabaseAccessToken } from '@/lib/supabase-client/client';

export function useAuExams(selectedDocId: string | null) {
  const [user] = useSupabaseUser();
  const { toast } = useToast();
  const { isOnline } = useNetworkStatus();
  const { isLoading: isAuthLoading, isRestoringAuth, isAuthLocked } = useSmartAuth();
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [examData, setExamData] = useState<GeneratePracticeExamOutput | null>(null);
  const [predictions, setPredictions] = useState<GenerateExamPredictionsOutput | null>(null);

  const startExamGeneration = useCallback(async (pastQuestionIds: string[] = []) => {
    if (!selectedDocId || !user) return;
    if (isAuthLoading || isRestoringAuth || isAuthLocked) return;
    const accessToken = await getSupabaseAccessToken();
    const gate = guardRequest({
      isOnline,
      requireAuth: true,
      accessToken,
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
      const result = await generatePracticeExam(
        '',
        '',
        { documentId: selectedDocId, pastQuestionIds, accessToken }
      );
      setExamData(result);
      toast({ title: 'Practice exam generated!' });
    } catch (err: any) {
      const userFacingError = describeApiErrorForUser(err, { context: 'generation' });
      toast({
        variant: 'destructive',
        title: userFacingError.title,
        description: userFacingError.description,
      });
    } finally {
      setIsGenerating(false);
    }
  }, [isAuthLoading, isAuthLocked, isOnline, isRestoringAuth, selectedDocId, user, toast]);

  const startPredictionGeneration = useCallback(async (pastQuestionIds: string[]) => {
    if (!selectedDocId || !user || pastQuestionIds.length === 0) return;
    if (isAuthLoading || isRestoringAuth || isAuthLocked) return;
    const accessToken = await getSupabaseAccessToken();
    const gate = guardRequest({
      isOnline,
      requireAuth: true,
      accessToken,
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
      const result = await generatePredictions(
        '',
        '',
        { documentId: selectedDocId, mainTextbookId: selectedDocId, pastQuestionIds, accessToken }
      );
      setPredictions(result);
      toast({ title: 'Predictions generated!' });
    } catch (err: any) {
      const userFacingError = describeApiErrorForUser(err, { context: 'generation' });
      toast({
        variant: 'destructive',
        title: userFacingError.title,
        description: userFacingError.description,
      });
    } finally {
      setIsGenerating(false);
    }
  }, [isAuthLoading, isAuthLocked, isOnline, isRestoringAuth, selectedDocId, user, toast]);

  return {
    isGenerating,
    examData,
    predictions,
    startExamGeneration,
    startPredictionGeneration
  };
}
