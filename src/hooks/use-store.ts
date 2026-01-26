'use client';
import { create } from 'zustand';
import type { GenerateKnowledgeOutput, GeneratePredictionsOutput } from '@/app/actions';
import { toast } from '@/hooks/use-toast';
import { safeFetch } from '@/lib/api/safe-fetch';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

import { fetchLatestKnowledge } from '@/lib/api/knowledge';
import { fetchLatestPredictions } from '@/lib/api/exams';

interface AppState {
  // Knowledge Engine State
  knowledgeData: GenerateKnowledgeOutput | null;
  isGeneratingKnowledge: boolean;
  
  // Predictions Engine State
  predictionData: GeneratePredictionsOutput | null;
  isGeneratingPredictions: boolean;

  // Global Animation State (AU Context)
  auAnimationState: 'idle' | 'thinking' | 'responding' | 'error';
  auThinkingStatus: string;
  setAuAnimationState: (state: 'idle' | 'thinking' | 'responding' | 'error') => void;
  setAuThinkingStatus: (status: string) => void;

  // Actions
  setKnowledgeData: (data: GenerateKnowledgeOutput) => void;
  generateKnowledge: (docId: string, docContent: string, idToken?: string, pastQuestionsContent?: string) => Promise<void>;
  generatePredictions: (docId: string, pastQuestionsContent: string, idToken?: string, mainTextbookContent?: string) => Promise<void>;

  // Utility to clear data on doc selection change
  clearKnowledgeAndPredictions: () => void;
  rehydrateFromSupabase: (docId: string) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  // Initial State
  knowledgeData: null,
  isGeneratingKnowledge: false,
  predictionData: null,
  isGeneratingPredictions: false,
  auAnimationState: 'idle',
  auThinkingStatus: 'AU is thinking...',

  setAuAnimationState: (state) => set({ auAnimationState: state }),
  setAuThinkingStatus: (status) => set({ auThinkingStatus: status }),

  setKnowledgeData: (data: GenerateKnowledgeOutput) => {
    set({ knowledgeData: data });
  },

  rehydrateFromSupabase: async (docId: string) => {
    try {
      const [knowledge, predictions] = await Promise.all([
        fetchLatestKnowledge(docId),
        fetchLatestPredictions(docId)
      ]);
      
      set({ 
        knowledgeData: knowledge,
        predictionData: predictions as any
      });
    } catch (e) {
      console.error('[store] Failed to rehydrate from Supabase:', e);
    }
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
        body: JSON.stringify({ documentId: docId, documentContent: docContent, pastQuestionsContent }),
      });

      set({ knowledgeData: result });
      
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
  generatePredictions: async (docId: string, pastQuestionsContent: string, idToken?: string, mainTextbookContent?: string) => {
    if (get().isGeneratingPredictions) return;

    set({ isGeneratingPredictions: true, predictionData: null });

    try {
      const result = await safeFetch(`${SUPABASE_URL}/functions/v1/prediction-engine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ documentId: docId, pastQuestionsContent, mainTextbookContent }),
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

