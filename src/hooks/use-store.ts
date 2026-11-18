'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GenerateKnowledgeOutput, GeneratePredictionsOutput } from '@/app/actions';
import { toast } from '@/hooks/use-toast';
import { describeApiErrorForUser } from '@/lib/api/user-facing-error';
import { mobileAppRequiredError } from '@/lib/api/mobile-app-required';

function notifyNativeAppRequired(feature: string): void {
  const error = mobileAppRequiredError(feature);
  const userFacingError = describeApiErrorForUser(error, { context: 'generation' });
  toast({
    variant: 'destructive',
    title: userFacingError.title,
    description: userFacingError.description,
  });
}

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
  generateKnowledge: (
    docId: string,
    options?: {
      documentContent?: string;
      pastQuestionsContent?: string;
      pastQuestionIds?: string[];
      accessToken?: string | null;
    },
  ) => Promise<void>;
  generatePredictions: (options: {
    pastQuestionsContent?: string;
    mainTextbookContent?: string;
    documentId?: string | null;
    mainTextbookId?: string | null;
    pastQuestionIds?: string[];
    accessToken?: string | null;
  }) => Promise<void>;

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

      // Browser generation is retired. Documents and study workflows are native-app only.
      generateKnowledge: async (_docId, _options) => {
        if (get().isGeneratingKnowledge) return;
        set({ knowledgeData: null, isGeneratingKnowledge: false });
        notifyNativeAppRequired('Knowledge generation');
      },

      generatePredictions: async (_options) => {
        if (get().isGeneratingPredictions) return;
        set({ predictionData: null, isGeneratingPredictions: false });
        notifyNativeAppRequired('Exam predictions');
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
