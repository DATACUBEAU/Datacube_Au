'use client';
import { create } from 'zustand';
import type { GenerateKnowledgeOutput, GeneratePredictionsOutput } from '@/app/actions';
import { toast } from '@/hooks/use-toast';
import { safeFetch } from '@/lib/api/safe-fetch';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

interface AppState {
  // Knowledge Engine State
  knowledgeData: GenerateKnowledgeOutput | null;
  isGeneratingKnowledge: boolean;
  
  // Predictions Engine State
  predictionData: GeneratePredictionsOutput | null;
  isGeneratingPredictions: boolean;

  // Actions
  setKnowledgeData: (data: GenerateKnowledgeOutput) => void;
  generateKnowledge: (docId: string, docContent: string, idToken?: string, pastQuestionsContent?: string) => Promise<void>;
  generatePredictions: (pastQuestionsContent: string, idToken?: string, mainTextbookContent?: string) => Promise<void>;

  // Utility to clear data on doc selection change
  clearKnowledgeAndPredictions: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  // Initial State
  knowledgeData: null,
  isGeneratingKnowledge: false,
  predictionData: null,
  isGeneratingPredictions: false,

  setKnowledgeData: (data: GenerateKnowledgeOutput) => {
    set({ knowledgeData: data });
  },

  // Action to generate knowledge materials
  generateKnowledge: async (docId: string, docContent: string, idToken?: string, pastQuestionsContent?: string) => {
    if (get().isGeneratingKnowledge) return;

    set({ isGeneratingKnowledge: true, knowledgeData: null });
    
    try {
      const result = await safeFetch(`${SUPABASE_URL}/functions/v1/generate-knowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ documentContent: docContent, pastQuestionsContent }),
      });

      set({ knowledgeData: result });

      // Cache the result in localStorage
      const historyToStore = { timestamp: Date.now(), data: result };
      localStorage.setItem(`knowledge_history_user_${docId}`, JSON.stringify(historyToStore));
      
      toast({ title: 'Knowledge materials generated successfully!' });

    } catch (error: any) {
      console.error('Failed to generate study materials:', error);
      toast({
        variant: 'destructive',
        title: 'AU Generation Failed',
        description: error?.message || 'Could not generate study materials for this document.',
      });
      set({ knowledgeData: null });
    } finally {
      set({ isGeneratingKnowledge: false });
    }
  },

  // Action to generate exam predictions
  generatePredictions: async (pastQuestionsContent: string, idToken?: string, mainTextbookContent?: string) => {
    if (get().isGeneratingPredictions) return;

    set({ isGeneratingPredictions: true, predictionData: null });

    try {
      const result = await safeFetch(`${SUPABASE_URL}/functions/v1/prediction-engine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ pastQuestionsContent, mainTextbookContent }),
      });

      set({ predictionData: result });
      
      toast({ title: 'Exam intelligence briefing generated!' });
    } catch (error: any) {
      console.error('Failed to generate exam predictions:', error);
      toast({
        variant: 'destructive',
        title: 'AU Prediction Failed',
        description: error?.message || 'Could not generate predictions for this document.',
      });
      set({ predictionData: null });
    } finally {
      set({ isGeneratingPredictions: false });
    }
  },

  clearKnowledgeAndPredictions: () => {
    set({ knowledgeData: null, predictionData: null });
  },
}));
