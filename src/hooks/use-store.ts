'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GenerateKnowledgeOutput, GeneratePredictionsOutput } from '@/app/actions';
import { toast } from '@/hooks/use-toast';
// invokeEdgeFunction removed — VPS ticket + direct fetch is the sole path.
import { describeApiErrorForUser } from '@/lib/api/user-facing-error';

const KNOWLEDGE_DOCUMENT_BUDGET = 12_000;
const KNOWLEDGE_PAST_QUESTIONS_BUDGET = 10_000;
const PREDICTION_DOCUMENT_BUDGET = 12_000;
const PREDICTION_PAST_QUESTIONS_BUDGET = 12_000;

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
    },
  ) => Promise<void>;
  generatePredictions: (options: {
    pastQuestionsContent?: string;
    mainTextbookContent?: string;
    documentId?: string | null;
    mainTextbookId?: string | null;
    pastQuestionIds?: string[];
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

      // Action to generate knowledge materials
      //
      // Payload optimization: docId is always supplied so the proxy hydrates
      // document content server-side. Raw text is only sent as fallback.
      generateKnowledge: async (
        docId: string,
        options?: {
          documentContent?: string;
          pastQuestionsContent?: string;
          pastQuestionIds?: string[];
        },
      ) => {
        if (get().isGeneratingKnowledge) return;

        set({ isGeneratingKnowledge: true, knowledgeData: null });

        const hasDocId = Boolean(docId);
        const hasPqIds = Array.isArray(options?.pastQuestionIds) && options!.pastQuestionIds.length > 0;
        
        try {
          
          const ticketRes = await fetch('/api/au/vps-ticket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feature: 'generate-knowledge' })
          });
          if (!ticketRes.ok) throw new Error('Ticket generation failed');

          const ticketData = await ticketRes.json();
          const { ticket, vpsUrl } = ticketData.data || ticketData;

          const res = await fetch(`${vpsUrl}/generate/knowledge`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${ticket}`,
            },
            body: JSON.stringify({
              documentContent: hasDocId ? undefined : (options?.documentContent ? String(options.documentContent).slice(0, KNOWLEDGE_DOCUMENT_BUDGET) : undefined),
              pastQuestionsContent: hasPqIds ? undefined : (options?.pastQuestionsContent ? String(options.pastQuestionsContent).slice(0, KNOWLEDGE_PAST_QUESTIONS_BUDGET) : undefined),
              pastQuestionIds: hasPqIds ? options!.pastQuestionIds : undefined,
              documentId: docId,
            }),
          });

          let data, error = null;
          if (!res.ok) {
            error = { message: await res.text() };
          } else {
            data = await res.json();
          }
  
          if (error) throw error;
          if (!data) throw new Error('Failed to generate knowledge');
          const result = data;

          set({ knowledgeData: result });

          // Cache the result in localStorage (keeping legacy cache for redundancy)
          const historyToStore = { timestamp: Date.now(), data: result };
          localStorage.setItem(`knowledge_history_user_${docId}`, JSON.stringify(historyToStore));
          
          toast({ title: 'Knowledge materials generated successfully!' });

        } catch (error: any) {
          const userFacingError = describeApiErrorForUser(error, { context: 'generation' });
          console.error('Failed to generate study materials:', error);
          toast({
            variant: 'destructive',
            title: userFacingError.title,
            description: userFacingError.description,
          });
          set({ knowledgeData: null });
        } finally {
          set({ isGeneratingKnowledge: false });
        }
      },

      // Action to generate exam predictions
      generatePredictions: async (options: {
        pastQuestionsContent?: string;
        mainTextbookContent?: string;
        documentId?: string | null;
        mainTextbookId?: string | null;
        pastQuestionIds?: string[];
      }) => {
        if (get().isGeneratingPredictions) return;

        set({ isGeneratingPredictions: true, predictionData: null });

        try {
          const hasTextbookId = Boolean(options?.mainTextbookId || options?.documentId);
          const hasPqIds = Array.isArray(options?.pastQuestionIds) && options!.pastQuestionIds.length > 0;

          // Get VPS ticket
          const ticketRes = await fetch('/api/au/vps-ticket', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feature: 'generate-exam-predictions' }),
          });
          if (!ticketRes.ok) throw new Error('Ticket generation failed: ' + await ticketRes.text());

          const ticketData = await ticketRes.json();
          const { ticket, vpsUrl } = ticketData.data || ticketData;

          const res = await fetch(`${vpsUrl}/generate/exam-predictions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${ticket}`,
            },
            body: JSON.stringify({
              pastQuestionsContent: hasPqIds ? undefined
                : (options?.pastQuestionsContent
                    ? String(options.pastQuestionsContent).slice(0, PREDICTION_PAST_QUESTIONS_BUDGET)
                    : undefined),
              mainTextbookContent: hasTextbookId ? undefined
                : (options?.mainTextbookContent
                    ? String(options.mainTextbookContent).slice(0, PREDICTION_DOCUMENT_BUDGET)
                    : undefined),
              pastQuestionIds: hasPqIds ? options!.pastQuestionIds : undefined,
              documentId: options?.documentId || options?.mainTextbookId || undefined,
              mainTextbookId: options?.mainTextbookId || undefined,
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || 'Prediction generation failed');
          }

          const result = await res.json() as GeneratePredictionsOutput;

          set({ predictionData: result });
          
          toast({ title: 'Exam intelligence briefing generated!' });
        } catch (error: any) {
          const userFacingError = describeApiErrorForUser(error, { context: 'generation' });
          console.error('Failed to generate exam predictions:', error);
          toast({
            variant: 'destructive',
            title: userFacingError.title,
            description: userFacingError.description,
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
