import { useState, useCallback, useEffect } from 'react';
import { 
  generatePracticeExam, 
  generatePredictions,
  fetchLatestExam,
  fetchLatestPredictions 
} from '@/lib/api/exams';
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

  // Hydrate from Supabase on document selection
  useEffect(() => {
    if (!selectedDocId) {
      setExamData(null);
      setPredictions(null);
      return;
    }

    async function hydrate() {
      const [exam, pred] = await Promise.all([
        fetchLatestExam(selectedDocId!),
        fetchLatestPredictions(selectedDocId!)
      ]);
      setExamData(exam);
      setPredictions(pred);
    }

    hydrate();
  }, [selectedDocId]);

  const startExamGeneration = useCallback(async (pastQuestionIds: string[] = []) => {
    if (!selectedDocId || !user) return;
    
    setIsGenerating(true);
    try {
      const documentContent = await getDocumentText(user, selectedDocId);
      
      let pastQuestionsContent = '';
      if (pastQuestionIds.length > 0) {
        const contents = await Promise.all(
          pastQuestionIds.map(id => getDocumentText(user, id))
        );
        pastQuestionsContent = contents.join('\n\n---\n\n');
      }

      const result = await generatePracticeExam(
        selectedDocId,
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
        selectedDocId,
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
