import { useState, useCallback } from 'react';
import { generatePracticeExam, generatePredictions } from '@/lib/api/exams';
import { getDocumentText } from '@/lib/api/documents';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import type { GeneratePracticeExamOutput, GenerateExamPredictionsOutput } from '@shared/schemas';

export function useAuExams(selectedDocId: string | null) {
  const [user] = useSupabaseUser();
  const [session] = useSupabaseSession();
  const { toast } = useToast();
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [examData, setExamData] = useState<GeneratePracticeExamOutput | null>(null);
  const [predictions, setPredictions] = useState<GenerateExamPredictionsOutput | null>(null);

  const startExamGeneration = useCallback(async (pastQuestionIds: string[] = []) => {
    if (!selectedDocId || !user) return;
    
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
        session?.access_token
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
  }, [selectedDocId, user, session, toast]);

  const startPredictionGeneration = useCallback(async (pastQuestionIds: string[]) => {
    if (!selectedDocId || !user || pastQuestionIds.length === 0) return;
    
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
        session?.access_token
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
  }, [selectedDocId, user, session, toast]);

  return {
    isGenerating,
    examData,
    predictions,
    startExamGeneration,
    startPredictionGeneration
  };
}
