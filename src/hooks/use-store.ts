'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GenerateKnowledgeOutput, GeneratePredictionsOutput } from '@/app/actions';
import { toast } from '@/hooks/use-toast';
import { safeFetch } from '@/lib/api/safe-fetch';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

export type AiModel = {
  id: string;
  provider: string;
  endpoint: string;
  isFree: true;
  status: 'unknown' | 'active' | 'down';
};

export const AI_MODEL_DISPLAY_NAMES: Record<string, string> = {
  'gemini-2': 'Gemini 2.0 Flash',
  'llama-3-70b': 'Llama 3.3 70B',
  'deepseek-r1': 'DeepSeek R1',
  'mistral-small': 'Mistral Small',
  'phi-3': 'Phi-3 Medium',
};

type ModelDiagnostics = {
  lastCheckedAt?: number;
  lastFailureAt?: number;
  lastFailureReason?: string;
  lastHttpStatus?: number;
  retryCount: number;
};

const MODEL_REGISTRY: AiModel[] = [
  { id: 'gemini-2', provider: 'Google', endpoint: 'google/gemini-2.0-flash-exp:free', isFree: true, status: 'unknown' },
  { id: 'llama-3-70b', provider: 'Meta', endpoint: 'meta-llama/llama-3.3-70b-instruct:free', isFree: true, status: 'unknown' },
  { id: 'deepseek-r1', provider: 'DeepSeek', endpoint: 'deepseek/deepseek-r1:free', isFree: true, status: 'unknown' },
  { id: 'mistral-small', provider: 'Mistral', endpoint: 'mistralai/mistral-small-3.1-24b:free', isFree: true, status: 'unknown' },
  { id: 'phi-3', provider: 'Microsoft', endpoint: 'microsoft/phi-3-medium-128k-instruct:free', isFree: true, status: 'unknown' },
];

function isValidRegistry(models: AiModel[] | undefined | null): models is AiModel[] {
  if (!models || !Array.isArray(models) || models.length !== 5) return false;
  return models.every(m => !!m && typeof m.id === 'string' && typeof m.provider === 'string' && typeof m.endpoint === 'string' && m.isFree === true);
}

interface AppState {
  models: AiModel[];
  activeModelId: string | null;
  modelDiagnostics: Record<string, ModelDiagnostics>;
  modelRetryCount: number;
  nextRetryAt: number | null;

  isCheckingKnowledgeModel: boolean;
  
  knowledgeData: GenerateKnowledgeOutput | null;
  isGeneratingKnowledge: boolean;
  
  // Predictions Engine State
  predictionData: GeneratePredictionsOutput | null;
  isGeneratingPredictions: boolean;

  auAnimationState: 'idle' | 'thinking' | 'responding' | 'error';
  auThinkingStatus: string;
  setAuAnimationState: (state: 'idle' | 'thinking' | 'responding' | 'error') => void;
  setAuThinkingStatus: (status: string) => void;

  setKnowledgeData: (data: GenerateKnowledgeOutput) => void;
  generateKnowledge: (docId: string, docContent: string, idToken?: string, pastQuestionsContent?: string) => Promise<void>;
  checkKnowledgeModel: (idToken?: string) => Promise<{ defaultModel: string; reachable: boolean; status?: number } | null>;
  generatePredictions: (pastQuestionsContent: string, idToken?: string, mainTextbookContent?: string) => Promise<void>;

  clearKnowledgeAndPredictions: () => void;
  rehydrateFromCache: (docId: string) => void;

  initializeModelRegistry: () => void;
  setModelStatus: (modelId: string, status: AiModel['status'], diagnostics?: Partial<ModelDiagnostics>) => void;
  checkModelHealth: (options?: { force?: boolean }) => Promise<void>;
  selectActiveModel: () => string | null;
  setActiveModelId: (modelId: string | null) => void;
  markRetryScheduled: (nextRetryAt: number | null, retryCount: number) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      models: MODEL_REGISTRY,
      activeModelId: null,
      modelDiagnostics: {
        'gemini-2': { retryCount: 0 },
        'llama-3-70b': { retryCount: 0 },
        'deepseek-r1': { retryCount: 0 },
        'mistral-small': { retryCount: 0 },
        'phi-3': { retryCount: 0 },
      },
      modelRetryCount: 0,
      nextRetryAt: null,

      isCheckingKnowledgeModel: false,

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

      checkKnowledgeModel: async (idToken?: string) => {
        if (get().isCheckingKnowledgeModel) return null;
        set({ isCheckingKnowledgeModel: true });
        try {
          const result = await safeFetch(`${SUPABASE_URL}/functions/v1/generate-knowledge`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({ action: 'ping' }),
          });

          const defaultModel = typeof result?.defaultModel === 'string' ? result.defaultModel : 'unknown';
          const reachable = result?.reachable === true;
          const status = typeof result?.status === 'number' ? result.status : undefined;

          toast({
            title: 'Knowledge generation model',
            description: reachable
              ? `Ready: ${defaultModel}`
              : `Default model unavailable (${defaultModel}${status ? `, HTTP ${status}` : ''}).`,
          });

          return { defaultModel, reachable, status };
        } catch (error: any) {
          toast({
            variant: 'destructive',
            title: 'Model check failed',
            description: error?.message || 'Could not check knowledge generation model.',
          });
          return null;
        } finally {
          set({ isCheckingKnowledgeModel: false });
        }
      },

      // Action to generate exam predictions
      generatePredictions: async (pastQuestionsContent: string, idToken?: string, mainTextbookContent?: string) => {
        if (get().isGeneratingPredictions) return;

        set({ isGeneratingPredictions: true, predictionData: null });

        try {
          // Use local API route instead of direct edge function
          const result = await safeFetch(`/api/predictions`, {
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

      initializeModelRegistry: () => {
        const current = get().models;
        if (!isValidRegistry(current)) {
          set({
            models: MODEL_REGISTRY,
            activeModelId: null,
            modelDiagnostics: {
              'gemini-2': { retryCount: 0 },
              'llama-3-70b': { retryCount: 0 },
              'deepseek-r1': { retryCount: 0 },
              'mistral-small': { retryCount: 0 },
              'phi-3': { retryCount: 0 },
            },
            modelRetryCount: 0,
            nextRetryAt: null,
          });
        }
      },

      setModelStatus: (modelId, status, diagnostics) => {
        set(state => ({
          models: state.models.map(m => (m.id === modelId ? { ...m, status } : m)),
          modelDiagnostics: {
            ...state.modelDiagnostics,
            [modelId]: {
              ...(state.modelDiagnostics[modelId] || { retryCount: 0 }),
              ...(diagnostics || {}),
            },
          },
        }));
      },

      selectActiveModel: () => {
        const state = get();
        if (state.activeModelId) {
          const selected = state.models.find(m => m.id === state.activeModelId);
          if (selected && selected.status === 'active') return selected.id;
        }

        const firstActive = state.models.find(m => m.status === 'active');
        if (firstActive) {
          set({ activeModelId: firstActive.id });
          return firstActive.id;
        }

        set({ activeModelId: null });
        return null;
      },

      setActiveModelId: (modelId) => {
        set({ activeModelId: modelId });
      },

      markRetryScheduled: (nextRetryAt, retryCount) => {
        set({ nextRetryAt, modelRetryCount: retryCount });
      },

      checkModelHealth: async (options) => {
        const force = options?.force ?? false;
        const state = get();
        const now = Date.now();

        const anyRecent = Object.values(state.modelDiagnostics).some(d => d.lastCheckedAt && now - d.lastCheckedAt < 60_000);
        if (!force && anyRecent) {
          state.selectActiveModel();
          return;
        }

        const pingOne = async (model: AiModel) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          try {
            const res = await fetch('/api/chat/fallback', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'ping', model: model.endpoint }),
              signal: controller.signal,
            });
            const body = await res.json().catch(() => ({}));
            const ok = res.ok && body && typeof body === 'object' && body.ok === true;
            if (ok) {
              get().setModelStatus(model.id, 'active', { lastCheckedAt: Date.now(), lastHttpStatus: 200 });
            } else {
              const status = body?.status ?? 0;
              get().setModelStatus(model.id, 'down', {
                lastCheckedAt: Date.now(),
                lastFailureAt: Date.now(),
                lastFailureReason: body?.error || (status ? `HTTP ${status}` : 'Empty response'),
                lastHttpStatus: status || undefined,
              });
            }
          } catch (e: any) {
            get().setModelStatus(model.id, 'down', {
              lastCheckedAt: Date.now(),
              lastFailureAt: Date.now(),
              lastFailureReason: e?.name === 'AbortError' ? 'Timeout' : (e?.message || 'Unknown error'),
            });
          } finally {
            clearTimeout(timeoutId);
          }
        };

        await Promise.all(state.models.map(pingOne));

        get().selectActiveModel();
      },
    }),
    {
      name: 'au-app-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        knowledgeData: state.knowledgeData,
        predictionData: state.predictionData,
        models: state.models,
        activeModelId: state.activeModelId,
        modelDiagnostics: state.modelDiagnostics,
        modelRetryCount: state.modelRetryCount,
        nextRetryAt: state.nextRetryAt,
      }),
    }
  )
);
