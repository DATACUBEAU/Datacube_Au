'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GenerateKnowledgeOutput, GeneratePredictionsOutput } from '@/app/actions';
import { toast } from '@/hooks/use-toast';
import { safeFetch } from '@/lib/api/safe-fetch';
import { invokeEdgeFunction } from '@/lib/supabase-client/client';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

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
  auThinkingSteps: { label: string, status: 'pending' | 'active' | 'completed' }[];
  setAuAnimationState: (state: 'idle' | 'thinking' | 'responding' | 'error') => void;
  setAuThinkingStatus: (status: string) => void;
  setAuThinkingSteps: (steps: { label: string, status: 'pending' | 'active' | 'completed' }[]) => void;
  updateAuThinkingStep: (index: number, status: 'pending' | 'active' | 'completed') => void;

  // Actions
  setKnowledgeData: (data: GenerateKnowledgeOutput) => void;
  setPredictionData: (data: GeneratePredictionsOutput) => void;
  generateKnowledge: (docId: string, docContent: string, pastQuestionsContent?: string) => Promise<void>;
  generatePredictions: (pastQuestionsContent: string, mainTextbookContent?: string) => Promise<void>;

  // Utility to clear data on doc selection change
  clearKnowledgeAndPredictions: () => void;
  rehydrateFromCache: (docId: string) => void;

  // Upgrade Modal
  upgradeModalOpen: boolean;
  upgradeContext: any;
  upgradeBlocked: boolean;
  upgradeBlockedUntil: number | null;
  lastUpgradeKey: string | null;
  lastUpgradeShownAt: number;
  setUpgradeModalOpen: (open: boolean, context?: any) => void;
  clearUpgradeBlock: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial State
      upgradeModalOpen: false,
      upgradeContext: null,
      upgradeBlocked: false,
      upgradeBlockedUntil: null,
      lastUpgradeKey: null,
      lastUpgradeShownAt: 0,
      setUpgradeModalOpen: (open, context) => {
        const nextContext = context || null;
        if (open) {
          const key = nextContext ? JSON.stringify({ code: nextContext.code, reason: nextContext.reason, limit: nextContext.limit }) : null;
          const now = Date.now();
          const state = get();
          if (state.upgradeModalOpen && state.lastUpgradeKey === key && now - state.lastUpgradeShownAt < 5000) return;
          const blockedUntil = nextContext?.resetsAt ? new Date(nextContext.resetsAt).getTime() : null;
          set({
            upgradeModalOpen: true,
            upgradeContext: nextContext,
            upgradeBlocked: true,
            upgradeBlockedUntil: blockedUntil,
            lastUpgradeKey: key,
            lastUpgradeShownAt: now,
          });
          return;
        }
        set({ upgradeModalOpen: false, upgradeContext: null });
      },
      clearUpgradeBlock: () => set({ upgradeBlocked: false, upgradeBlockedUntil: null, lastUpgradeKey: null, lastUpgradeShownAt: 0 }),

      knowledgeData: null,
      isGeneratingKnowledge: false,
      predictionData: null,
      isGeneratingPredictions: false,
      auAnimationState: 'idle',
      auThinkingStatus: 'AU is thinking...',
      auThinkingSteps: [],

      setAuAnimationState: (state) => set({ auAnimationState: state }),
      setAuThinkingStatus: (status) => set({ auThinkingStatus: status }),
      setAuThinkingSteps: (steps) => set({ auThinkingSteps: steps }),
      updateAuThinkingStep: (index, status) => set((state) => {
        const newSteps = [...state.auThinkingSteps];
        if (newSteps[index]) {
            newSteps[index] = { ...newSteps[index], status };
        }
        return { auThinkingSteps: newSteps };
      }),

      setKnowledgeData: (data: GenerateKnowledgeOutput) => {
        set({ knowledgeData: data });
      },

      setPredictionData: (data: GeneratePredictionsOutput) => {
        set({ predictionData: data });
      },

      rehydrateFromCache: (docId: string) => {
        const cached = localStorage.getItem(`knowledge_history_user_${docId}`);
        if (cached) {
          try {
            const { data } = JSON.parse(cached);
            set({ knowledgeData: data });
          } catch (e) {
            console.error('[store] Failed to rehydrate from cache:', e);
          }
        }
      },

      // Action to generate knowledge materials
      generateKnowledge: async (docId: string, docContent: string, pastQuestionsContent?: string) => {
        if (get().isGeneratingKnowledge) return;

        set({ isGeneratingKnowledge: true, knowledgeData: null });
        
        try {
          const { data, error } = await invokeEdgeFunction<GenerateKnowledgeOutput>('generate-knowledge', {
            method: 'POST',
            requireAuth: true,
            timeoutMs: 120_000,
            silent: false,
            body: { documentContent: docContent, pastQuestionsContent: pastQuestionsContent || '' },
          });
          if (error) throw error;
          if (!data) throw new Error('Failed to generate knowledge');
          const result = data;

          set({ knowledgeData: result });

          // Cache the result in localStorage (keeping legacy cache for redundancy)
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
      generatePredictions: async (pastQuestionsContent: string, mainTextbookContent?: string) => {
        if (get().isGeneratingPredictions) return;

        set({ isGeneratingPredictions: true, predictionData: null });

        try {
          const { data, error } = await invokeEdgeFunction<GeneratePredictionsOutput>('prediction-engine', {
            method: 'POST',
            requireAuth: true,
            timeoutMs: 120_000,
            silent: false,
            body: { pastQuestionsContent, mainTextbookContent },
          });
          if (error) throw error;
          if (!data) throw new Error('Failed to generate predictions');
          const result = data;

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
    }),
    {
      name: 'au-app-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        knowledgeData: state.knowledgeData,
        predictionData: state.predictionData,
      }),
    }
  )
);
