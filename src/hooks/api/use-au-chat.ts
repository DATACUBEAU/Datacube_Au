
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { toApiRequestError, type ApiRequestError } from '@/lib/api/api-contract';
import { sendChatMessage, sendChatMessageStream, generatePromptStarters, getAvailableModels, type ChatMessage } from '@/lib/api/chat';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { useStore } from '@/hooks/use-store';
import { nanoid } from 'nanoid';
import { getMemorySummary, upsertMemorySummary } from '@/lib/api/memory-summaries';
import { appendTurn, clearWorkingMemory, docMemoryKey, globalMemoryKey, loadWorkingMemory, saveWorkingMemory, type WorkingMemoryPayload } from '@/lib/memory/working-memory';
import { useNetworkStatus } from '@/components/providers/network-status-provider';
import { logOnce, shouldDedupe } from '@/lib/log/dedupe';
import { logEvent } from '@/lib/analytics';
import { guardRequest } from '@/lib/api/request-guard';
import { useSmartAuth } from '@/hooks/use-smart-auth';
import { classifyAuthFailure } from '@/lib/auth/auth-error-classification';
import { mergeDocumentContext, normalizeDocumentContext, type ChatDocumentContext } from '@shared/document-chat-context';
import {
  formatAssistantResponseText,
  formatAssistantThought,
  normalizeAssistantCitations,
} from '@/lib/chat/assistant-response';

const CHAT_EVENT_STARTED = 'au-chat:started';
const CHAT_EVENT_COMPLETED = 'au-chat:completed';
const CHAT_EVENT_FAILED = 'au-chat:failed';
const CHAT_EVENT_CANCELED = 'au-chat:canceled';

type ChatLifecycleDetail = {
  requestId: string;
  route: '/dashboard/chat' | '/dashboard/global-chat';
  selectedDocId: string | null;
  prompt?: string;
  preview?: string;
  error?: string;
};

function emitChatLifecycleEvent(eventName: string, detail: ChatLifecycleDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

// Simple string hash for local cache keys
const simpleHash = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
};

type UseAuChatOptions = {
  activeDocumentName?: string | null;
  lastUploadedDocumentId?: string | null;
  documentCountInScope?: number | null;
};

const MAX_RECENT_SNIPPET_TURNS = 8;
const MAX_RECENT_SNIPPET_CHARS = 300;
const MAX_RECENT_SUMMARY_CHARS = 600;

function buildDocumentContextSeed(input: {
  selectedDocId: string | null;
  activeDocumentName?: string | null;
  lastUploadedDocumentId?: string | null;
  documentCountInScope?: number | null;
}): ChatDocumentContext | null {
  if (!input.selectedDocId || input.selectedDocId === 'global') return null;
  return normalizeDocumentContext({
    active_document_id: input.selectedDocId,
    active_document_name: input.activeDocumentName ?? null,
    last_uploaded_document_id: input.lastUploadedDocumentId ?? input.selectedDocId,
    document_count_in_scope: input.documentCountInScope ?? null,
  });
}

function truncateSnippetText(value: unknown, maxChars: number): string {
  return String(value || '').trim().slice(0, maxChars);
}

function buildRecentSnippetFromMemory(memory: WorkingMemoryPayload | null | undefined) {
  const recentTurns = (memory?.turns ?? [])
    .slice(-MAX_RECENT_SNIPPET_TURNS)
    .map((turn) => ({
      role: turn.role,
      content: truncateSnippetText(turn.text, MAX_RECENT_SNIPPET_CHARS),
    }))
    .filter((turn) => turn.content.length > 0);

  if (recentTurns.length > 0) {
    return {
      mode: 'turns' as const,
      turns: recentTurns,
    };
  }

  return {
    mode: 'summary' as const,
    summary: truncateSnippetText(memory?.summary, MAX_RECENT_SUMMARY_CHARS),
  };
}

export function useAuChat(selectedDocId: string | null, config: UseAuChatOptions = {}) {
  const [user, session] = useSupabaseUser();
  const { toast } = useToast();
  const setAuAnimationState = useStore(state => state.setAuAnimationState);
  const setAuThinkingStatus = useStore(state => state.setAuThinkingStatus);
  const setAuThinkingSteps = useStore(state => state.setAuThinkingSteps);
  const updateAuThinkingStep = useStore(state => state.updateAuThinkingStep);
  const { isOnline } = useNetworkStatus();
  const { isAuthLocked, isLoading: isAuthLoading, isRestoringAuth } = useSmartAuth();
  
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [isResponding, setIsResponding] = useState(false);
  const [promptStarters, setPromptStarters] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const rateLimitCooldownUntilRef = useRef<number>(0);
  const lastSubmitRef = useRef<{ hash: string; at: number }>({ hash: '', at: 0 });
  const activePromptHashRef = useRef<string | null>(null);
  const activeRequestRef = useRef<{
    requestId: string;
    route: '/dashboard/chat' | '/dashboard/global-chat';
    selectedDocId: string | null;
  } | null>(null);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const [isInitialized, setIsInitialized] = useState(false);
  const [documentContext, setDocumentContext] = useState<ChatDocumentContext | null>(null);
  const [lastError, setLastError] = useState<ApiRequestError | null>(null);
  const documentContextRef = useRef<ChatDocumentContext | null>(null);

  const updateDocumentContext = useCallback((updates: Partial<ChatDocumentContext> | null) => {
    setDocumentContext((prev) => {
      const next = mergeDocumentContext(prev, updates);
      documentContextRef.current = next;
      return next;
    });
  }, []);

  const persistHistory = useCallback(async (nextHistory: ChatMessage[]) => {
    if (!selectedDocId || !user?.id) return;
    const scope = selectedDocId === 'global' ? 'global' : 'doc';
    const key = scope === 'global' ? globalMemoryKey(user.id) : docMemoryKey(user.id, selectedDocId);
    const current = await loadWorkingMemory(key).catch(() => null);

    const byId = new Map<string, any>();
    const existingTurns = current?.turns ?? [];
    for (const t of existingTurns) byId.set(t.id, t);

    const turns = nextHistory
      .filter((m) => !m.isLoading && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => {
        const prev = byId.get(m.id);
        return { id: m.id, ts: typeof prev?.ts === 'number' ? prev.ts : Date.now(), role: m.role, text: m.content };
      });

    const nextPayload: WorkingMemoryPayload = {
      turns,
      summary: current?.summary ?? '',
      pinnedFacts: current?.pinnedFacts ?? [],
      documentContext: mergeDocumentContext(current?.documentContext, documentContextRef.current),
      lastUpdatedAt: current?.lastUpdatedAt ?? Date.now(),
      expiresAt: current?.expiresAt,
      serverUpdatedAt: current?.serverUpdatedAt,
      turnsSinceServerSync: current?.turnsSinceServerSync,
    };

    await saveWorkingMemory(
      key,
      nextPayload,
      scope === 'global' ? { scope: 'global' } : { scope: 'doc', userId: user.id, docId: selectedDocId }
    );
  }, [selectedDocId, user?.id]);

  // Helper: Generate Dynamic Thinking Steps
  const generateThinkingSteps = (content: string, type: 'chat' | 'scan' = 'chat') => {
    if (type === 'scan') {
        return [
            { label: 'Mapping document architecture...', status: 'pending' },
            { label: 'Identifying core themes & concepts...', status: 'pending' },
            { label: 'Building analytical roadmap...', status: 'pending' },
            { label: 'Finalizing orchestration guide...', status: 'pending' }
        ];
    }

    const lower = content.toLowerCase();
    const steps: { label: string, status: 'pending' | 'active' | 'completed' }[] = [];

    if (lower.includes('summary') || lower.includes('summarize')) {
        steps.push(
            { label: 'Parsing document structure...', status: 'pending' },
            { label: 'Extracting key themes...', status: 'pending' },
            { label: 'Synthesizing summary...', status: 'pending' }
        );
    } else if (lower.match(/exam|quiz|test|question/)) {
        steps.push(
            { label: 'Analyzing exam patterns...', status: 'pending' },
            { label: 'Retrieving relevant past questions...', status: 'pending' },
            { label: 'Formulating prediction...', status: 'pending' }
        );
    } else {
        // Generic Question
        // Try to extract a keyword
        const words = content.split(' ').filter(w => w.length > 4);
        const keyword = words.length > 0 ? words[Math.floor(Math.random() * words.length)].replace(/[^a-zA-Z]/g, '') : 'context';
        
        steps.push(
            { label: 'Parsing query intent...', status: 'pending' },
            { label: `Scanning for "${keyword}"...`, status: 'pending' },
            { label: 'Cross-referencing context...', status: 'pending' },
            { label: 'Formulating response...', status: 'pending' }
        );
    }
    return steps;
  };

  // ... (Load Models & Persistence Effects) ...
  useEffect(() => {
    if (!user) return;
    if (isAuthLoading || isRestoringAuth) return;
    if (isAuthLocked) return;
    if (!isOnline) return;

    getAvailableModels()
      .then(models => setAvailableModels(models))
      .catch(err => console.error("Failed to load models:", err));
  }, [isAuthLoading, isAuthLocked, isOnline, isRestoringAuth, user]);

  useEffect(() => {
    const seed = buildDocumentContextSeed({
      selectedDocId,
      activeDocumentName: config.activeDocumentName,
      lastUploadedDocumentId: config.lastUploadedDocumentId,
      documentCountInScope: config.documentCountInScope,
    });

    if (!seed) {
      documentContextRef.current = null;
      setDocumentContext(null);
      return;
    }

    updateDocumentContext(seed);
  }, [
    config.activeDocumentName,
    config.documentCountInScope,
    config.lastUploadedDocumentId,
    selectedDocId,
    updateDocumentContext,
  ]);

  // --- PERSISTENCE: Load history on mount or doc change ---
  useEffect(() => {
    if (!selectedDocId || !user?.id) {
      setHistory([]);
      documentContextRef.current = null;
      setDocumentContext(null);
      setIsInitialized(true);
      return;
    }

    const key = selectedDocId === 'global' ? globalMemoryKey(user.id) : docMemoryKey(user.id, selectedDocId);

    loadWorkingMemory(key)
      .then(payload => {
        const messages = payload?.turns?.map(t => ({ id: t.id, role: t.role, content: t.text } as ChatMessage)) ?? [];
        setHistory(messages);
        const seededContext = buildDocumentContextSeed({
          selectedDocId,
          activeDocumentName: config.activeDocumentName,
          lastUploadedDocumentId: config.lastUploadedDocumentId,
          documentCountInScope: config.documentCountInScope,
        });
        const nextContext = seededContext
          ? mergeDocumentContext(payload?.documentContext, seededContext)
          : normalizeDocumentContext(payload?.documentContext || {});
        documentContextRef.current = nextContext;
        setDocumentContext(nextContext);
        setIsInitialized(true);
      })
      .catch(() => {
        setHistory([]);
        documentContextRef.current = buildDocumentContextSeed({
          selectedDocId,
          activeDocumentName: config.activeDocumentName,
          lastUploadedDocumentId: config.lastUploadedDocumentId,
          documentCountInScope: config.documentCountInScope,
        });
        setDocumentContext(documentContextRef.current);
        setIsInitialized(true);
      });
  }, [
    config.activeDocumentName,
    config.documentCountInScope,
    config.lastUploadedDocumentId,
    selectedDocId,
    user?.id,
  ]);

  const clearChat = useCallback(async () => {
    setHistory([]);
    if (!user?.id || !selectedDocId) return;
    const key = selectedDocId === 'global' ? globalMemoryKey(user.id) : docMemoryKey(user.id, selectedDocId);
    await clearWorkingMemory(key).catch(() => {});
  }, [user?.id, selectedDocId]);

  const expiresAt = session?.expires_at ? session.expires_at * 1000 : undefined;

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      const activeRequest = activeRequestRef.current;
      if (activeRequest) {
        emitChatLifecycleEvent(CHAT_EVENT_CANCELED, {
          requestId: activeRequest.requestId,
          route: activeRequest.route,
          selectedDocId: activeRequest.selectedDocId,
        });
      }
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsResponding(false);
    }
  }, []);

  const sendMessage = useCallback(async (
    content: string, 
    options?: { 
      guide?: string; 
      summaryMode?: 'short' | 'mid' | 'detailed' | null;
      browsingMode?: boolean;
      referenceDocId?: string;
    }
  ) => {
    if (!selectedDocId || !user) return;
    if (isAuthLoading || isRestoringAuth) return;
    if (isAuthLocked) return;
    const normalizedPrompt = String(content || '').trim().toLowerCase();
    const promptHash = `${selectedDocId}:${normalizedPrompt}`;
    const now = Date.now();
    if (activePromptHashRef.current === promptHash) {
      return;
    }
    if (lastSubmitRef.current.hash === promptHash && now - lastSubmitRef.current.at < 1500) {
      return;
    }
    lastSubmitRef.current = { hash: promptHash, at: now };
    activePromptHashRef.current = promptHash;
    const gate = guardRequest({
      isOnline,
      requireAuth: true,
      accessToken: session?.access_token ?? '__cookie_session__',
      warnKey: 'chat:send',
      context: 'chat send',
    });
    if (!gate.ok) {
      if (gate.reason === 'offline') {
        logOnce('warn', 'chat:send:offline', '[chat] Send blocked (offline)');
      }
      return;
    }

    console.log('[useAuChat] Preparing to send message', {
      selectedDocId,
      userId: user.id,
      isAuthLoading,
      isRestoringAuth,
      isAuthLocked,
      hasSession: !!session,
      tokenExists: !!session?.access_token,
      tokenExpiresAt: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    });

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();
    const requestId = nanoid();
    const idempotencyKey = `chat_${nanoid()}`;
    const route: '/dashboard/chat' | '/dashboard/global-chat' =
      selectedDocId === 'global' ? '/dashboard/global-chat' : '/dashboard/chat';
    activeRequestRef.current = { requestId, route, selectedDocId };
    emitChatLifecycleEvent(CHAT_EVENT_STARTED, {
      requestId,
      route,
      selectedDocId,
      prompt: content.slice(0, 180),
    });
    setLastError(null);

    const userMessage: ChatMessage = { id: nanoid(), role: 'user', content };
    const loadingId = nanoid();
    
    setHistory(prev => [...prev, userMessage, { id: loadingId, role: 'assistant', content: '', isLoading: true } as any]);
    setIsResponding(true);
    setAuAnimationState('thinking');

    const scope = selectedDocId === 'global' ? 'global' : 'doc';
    const memoryKey = scope === 'global' ? globalMemoryKey(user.id) : docMemoryKey(user.id, selectedDocId);
    const existingMemory = await loadWorkingMemory(memoryKey).catch(() => null);
    const seededDocumentContext = buildDocumentContextSeed({
      selectedDocId,
      activeDocumentName: config.activeDocumentName,
      lastUploadedDocumentId: config.lastUploadedDocumentId,
      documentCountInScope: config.documentCountInScope,
    });
    const requestDocumentContext =
      scope === 'doc'
        ? mergeDocumentContext(existingMemory?.documentContext ?? documentContextRef.current, seededDocumentContext)
        : null;

    if (requestDocumentContext) {
      documentContextRef.current = requestDocumentContext;
      setDocumentContext(requestDocumentContext);
    }

    appendTurn(
      memoryKey,
      { id: userMessage.id, ts: Date.now(), role: 'user', text: userMessage.content },
      scope === 'global' ? { scope: 'global' } : { scope: 'doc', userId: user.id, docId: selectedDocId }
    ).catch(() => {});
    
    // Initialize Thinking Steps
    const steps = generateThinkingSteps(content, 'chat');
    // @ts-ignore
    setAuThinkingSteps(steps);
    setAuThinkingStatus(steps[0].label);

    let thinkingInterval: any = null;

    // --- OPTIMIZATION: Local Answer Cache Check ---
    const contentHash = simpleHash(content);
    const cacheKey = `au_answer_cache_${selectedDocId}_${contentHash}`;
    const cachedRaw = localStorage.getItem(cacheKey);
    let cachedResult: any = null;

    if (cachedRaw) {
        try {
            cachedResult = JSON.parse(cachedRaw);
            console.log('[useAuChat] Local cache hit');
        } catch (e) {
            localStorage.removeItem(cacheKey);
        }
    }

    try {
      // Step 1: Simulated "Steps" to mimic Trae's thinking behavior
      let currentStep = 0;
      
      // Set first step active immediately
      updateAuThinkingStep(0, 'active');

      thinkingInterval = setInterval(() => {
        if (currentStep < steps.length) {
            // Mark current as done
            updateAuThinkingStep(currentStep, 'completed');
            
            // Move to next
            currentStep++;
            
            if (currentStep < steps.length) {
                updateAuThinkingStep(currentStep, 'active');
                setAuThinkingStatus(steps[currentStep].label);
            }
        } else {
          clearInterval(thinkingInterval);
        }
      }, cachedResult ? 140 : 650); // Fast and readable cadence

      let result: any;
      let assistantTurnResult: Awaited<ReturnType<typeof appendTurn>> | null = null;

      if (cachedResult) {
          // Simulate brief network delay for UX smoothness
          await new Promise(resolve => setTimeout(resolve, 220));
          result = {
            ...cachedResult,
            answer: formatAssistantResponseText((cachedResult as any)?.answer),
            thought: formatAssistantThought((cachedResult as any)?.thought),
            citations: normalizeAssistantCitations((cachedResult as any)?.citations),
          };
          assistantTurnResult = await appendTurn(
            memoryKey,
            { id: loadingId, ts: Date.now(), role: 'assistant', text: String((result as any)?.answer || '') },
            scope === 'global' ? { scope: 'global' } : { scope: 'doc', userId: user.id, docId: selectedDocId }
          );
      } else {
          const existing = existingMemory;
          const recentSnippet = buildRecentSnippetFromMemory(existing);

          let streamedText = '';

          let secondarySnippet: any | undefined;
          if (options?.referenceDocId && user?.id) {
              try {
                  const { loadWorkingMemory, docMemoryKey } = await import('@/lib/memory/working-memory');
                  const docKey = docMemoryKey(user.id, options.referenceDocId);
                  const docMem = await loadWorkingMemory(docKey);
                  if (docMem) {
                     secondarySnippet = buildRecentSnippetFromMemory(docMem);
                  }
              } catch (e) { console.error('Failed to load secondary memory', e); }
          }

          const done = await sendChatMessageStream(
            {
              selectedDocId,
              doc_id: scope === 'doc' ? selectedDocId : undefined,
              user_input: content,
              clientMessageId: requestId,
              idempotencyKey,
              recent_snippet: recentSnippet as any,
              secondary_snippet: secondarySnippet,
              memory_pack: scope === 'global' ? { global_digest: existing?.summary || '' } : undefined,
              document_context: requestDocumentContext || undefined,
              guide: options?.guide,
              summaryMode: options?.summaryMode,
              browsingMode: options?.browsingMode,
              model: selectedModel === 'auto' ? undefined : selectedModel,
            },
            {
              onEvent: (evt) => {
                if (evt.type === 'delta') {
                  streamedText += evt.text;
                  setHistory(prev => prev.map(m => m.id === loadingId ? { ...m, content: streamedText } as any : m));
                }
              }
            },
            { signal: abortControllerRef.current?.signal }
          );

          result = {
            answer: formatAssistantResponseText(done.answer),
            citations: normalizeAssistantCitations((done as any).citations),
            thought: formatAssistantThought((done as any).thought),
            navAction: (done as any).navAction,
            documentContext: (done as any).documentContext,
          } as any;

          assistantTurnResult = await appendTurn(
            memoryKey,
            { id: loadingId, ts: Date.now(), role: 'assistant', text: String(result.answer || '') },
            scope === 'global' ? { scope: 'global' } : { scope: 'doc', userId: user.id, docId: selectedDocId }
          );
          const assistantTurnPayload = assistantTurnResult.payload;

          // --- SYNC TO SERVER (Long-term Memory) ---
          if ((assistantTurnPayload.turnsSinceServerSync ?? 0) >= 10) {
            upsertMemorySummary({
              scope: scope as any,
              docId: scope === 'doc' ? selectedDocId : undefined,
              summary: assistantTurnPayload.summary,
              pinnedFacts: assistantTurnPayload.pinnedFacts
            }).then(success => {
              if (success) {
                // Reset counter locally
                const next = { ...assistantTurnPayload, turnsSinceServerSync: 0, serverUpdatedAt: Date.now() };
                saveWorkingMemory(memoryKey, next, scope === 'global' ? { scope: 'global' } : { scope: 'doc', userId: user.id, docId: selectedDocId });
              }
            });
          }

          // --- OPTIMIZATION: Save to Local Cache ---
          try {
              localStorage.setItem(cacheKey, JSON.stringify(result));
          } catch (e) {
              // Ignore quota errors
           }
      }

      if (scope === 'doc') {
        const nextDocumentContext = mergeDocumentContext(
          requestDocumentContext,
          result?.documentContext || null,
        );
        documentContextRef.current = nextDocumentContext;
        setDocumentContext(nextDocumentContext);
        result.documentContext = nextDocumentContext;

        if (assistantTurnResult) {
          await saveWorkingMemory(
            memoryKey,
            {
              ...assistantTurnResult.payload,
              documentContext: nextDocumentContext,
            },
            { scope: 'doc', userId: user.id, docId: selectedDocId },
          ).catch(() => {});
        }
      }

      if (thinkingInterval) clearInterval(thinkingInterval);
      
      // Mark all steps complete just in case
      steps.forEach((_, idx) => updateAuThinkingStep(idx, 'completed'));

      setAuAnimationState('responding');
      setAuThinkingStatus('Response ready.');
      setHistory(prev => prev.map(m => m.id === loadingId ? {
        id: loadingId,
        role: 'assistant',
        content: result.answer,
        citations: result.citations,
        thought: result.thought,
        navAction: result.navAction,
      } : m));
      emitChatLifecycleEvent(CHAT_EVENT_COMPLETED, {
        requestId,
        route,
        selectedDocId,
        preview: String(result.answer || '').slice(0, 200),
      });
      return result;
    } catch (err: any) {
      if (thinkingInterval) clearInterval(thinkingInterval);
      setAuThinkingStatus('Analytical engine error.');
      setAuThinkingSteps([]); // Clear steps on error
      if (err.name === 'AbortError') {
        console.log('[useAuChat] Message aborted');
        setHistory(prev => prev.filter(m => m.id !== loadingId));
        setAuAnimationState('idle');
        emitChatLifecycleEvent(CHAT_EVENT_CANCELED, {
          requestId,
          route,
          selectedDocId,
        });
        setLastError(null);
        return;
      }
      const normalizedError = toApiRequestError(err, 'Unexpected chat error');
      const authFailure = classifyAuthFailure(normalizedError);
      const msg = normalizedError.message;
      const status = normalizedError.status;
      const aiUnavailable =
        normalizedError.code === 'MODEL_SERVICE_UNAVAILABLE' ||
        msg.toLowerCase().includes('all ai models are currently unavailable') ||
        msg.toLowerCase().includes('model service unavailable');
      setLastError(normalizedError);
      if (status === 429) {
        const retryAfterRaw = Number(normalizedError.retryAfter || (normalizedError.details as any)?.retry_after || 8);
        const retryAfterSeconds = Number.isFinite(retryAfterRaw) && retryAfterRaw > 0
          ? Math.ceil(retryAfterRaw)
          : 8;
        const cooldownUntil = Date.now() + retryAfterSeconds * 1000;
        rateLimitCooldownUntilRef.current = cooldownUntil;
        toast({
          variant: 'destructive',
          title: 'High demand / rate limited — retry shortly.',
          description: `Please wait about ${retryAfterSeconds}s before retrying.`,
          action: React.createElement(
            ToastAction,
            {
              altText: 'Retry',
              onClick: () => {
                const waitMs = rateLimitCooldownUntilRef.current - Date.now();
                if (waitMs > 0) {
                  toast({
                    title: 'Retry cooldown active',
                    description: `Please wait ${Math.ceil(waitMs / 1000)}s.`,
                  });
                  return;
                }
                void sendMessage(content, options);
              },
            },
            'Retry',
          ) as any,
        });
      }
      if (authFailure?.status === 401) {
        logOnce('warn', 'chat:send:unauthorized', '[useAuChat] Message unauthorized', {
          status,
          code: normalizedError.code,
          message: normalizedError.message,
          requestId: normalizedError.requestId,
          details: normalizedError.details,
        });
      } else if (authFailure?.status === 403) {
        logOnce('warn', 'chat:send:forbidden', '[useAuChat] Message forbidden', {
          status,
          code: normalizedError.code,
          message: normalizedError.message,
          requestId: normalizedError.requestId,
        });
      } else {
        console.error(
          `[useAuChat] Message error: ${JSON.stringify({
            code: normalizedError.code,
            status,
            message: normalizedError.message,
            retryable: normalizedError.retryable,
            requestId: normalizedError.requestId,
            correlationId: normalizedError.correlationId,
            details: normalizedError.details,
          })}`,
        );
      }
      if (!shouldDedupe(`event:chat:send:error:${status ?? 'unknown'}`)) {
        logEvent('au_chat_error', {
          status,
          code: normalizedError.code,
          message: msg.slice(0, 400),
          route: activeRequestRef.current?.route ?? null,
          selectedDocId,
        });
      }
      if (aiUnavailable && !shouldDedupe('event:chat:send:ai_unavailable')) {
        logEvent('ai_models_unavailable', {
          status,
          route: activeRequestRef.current?.route ?? null,
          selectedDocId,
          message: msg.slice(0, 400),
        });
      }
      setHistory(prev => prev.filter(m => m.id !== loadingId));
      setAuAnimationState('error');
      emitChatLifecycleEvent(CHAT_EVENT_FAILED, {
        requestId,
        route,
        selectedDocId,
        error: msg.slice(0, 220),
      });
      throw normalizedError;
    } finally {
      setIsResponding(false);
      abortControllerRef.current = null;
      activeRequestRef.current = null;
      if (activePromptHashRef.current === promptHash) {
        activePromptHashRef.current = null;
      }
      // Delay setting back to idle to allow animation to breathe
      setTimeout(() => {
        setAuAnimationState('idle');
        setAuThinkingSteps([]); // Clear steps after done
      }, 1200);
    }
  }, [
    config.activeDocumentName,
    config.documentCountInScope,
    config.lastUploadedDocumentId,
    isAuthLoading,
    isAuthLocked,
    isRestoringAuth,
    isOnline,
    selectedDocId,
    selectedModel,
    session?.access_token,
    setAuAnimationState,
    setAuThinkingStatus,
    setAuThinkingSteps,
    toast,
    updateAuThinkingStep,
    user,
  ]);

  const scanAndGreet = useCallback(async () => {
    if (!selectedDocId || !user) return;
    if (isAuthLoading || isRestoringAuth) return;
    if (isAuthLocked) return;
    const gate = guardRequest({
      isOnline,
      requireAuth: true,
      accessToken: session?.access_token ?? '__cookie_session__',
      warnKey: 'chat:greet',
      context: 'chat greet',
    });
    if (!gate.ok) {
      if (gate.reason === 'offline') {
        logOnce('warn', 'chat:greet:offline', '[chat] scanAndGreet blocked (offline)');
      }
      return;
    }

    abortControllerRef.current = new AbortController();
    setIsResponding(true);
    setAuAnimationState('thinking');
    
    // Initialize Scan Steps
    const steps = generateThinkingSteps('', 'scan');
    // @ts-ignore
    setAuThinkingSteps(steps);
    setAuThinkingStatus(steps[0].label);

    const loadingId = nanoid();
    // Add a temporary loading indicator if history is empty
    if (history.length === 0) {
        setHistory([{ id: loadingId, role: 'assistant', content: '', isLoading: true } as any]);
    }

    let thinkingInterval: any = null;
    try {
        let currentStep = 0;
        updateAuThinkingStep(0, 'active');

        thinkingInterval = setInterval(() => {
            if (currentStep < steps.length) {
                updateAuThinkingStep(currentStep, 'completed');
                currentStep++;
                if (currentStep < steps.length) {
                    updateAuThinkingStep(currentStep, 'active');
                    setAuThinkingStatus(steps[currentStep].label);
                }
            } else {
                clearInterval(thinkingInterval);
            }
        }, 700);

        const result = await sendChatMessage({
            messages: [{ id: 'system-init', role: 'user', content: 'INIT_GREETING' }], // Dummy message
            selectedDocId,
            action: 'scan_and_greet',
            model: selectedModel === 'auto' ? undefined : selectedModel
        }, { signal: abortControllerRef.current?.signal });

        if (thinkingInterval) clearInterval(thinkingInterval);
        setAuAnimationState('responding');
        setAuThinkingStatus('Analysis complete.');
        // Replace loading message with greeting
        setHistory(prev => {
            const filtered = prev.filter(m => m.id !== loadingId);
            const answer = formatAssistantResponseText(result.answer);
            return [...filtered, {
                id: nanoid(),
                role: 'assistant',
                content: answer,
                thought: formatAssistantThought(result.thought),
                citations: normalizeAssistantCitations((result as any).citations),
            }];
        });
    } catch (err: any) {
        if (thinkingInterval) clearInterval(thinkingInterval);
        setAuThinkingStatus('Analysis failed.');
        if (err.name === 'AbortError') {
            setHistory(prev => prev.filter(m => m.id !== loadingId));
            setAuAnimationState('idle');
            return;
        }
        console.error('[useAuChat] Greeting failed:', err);
        setHistory(prev => prev.filter(m => m.id !== loadingId));
        setAuAnimationState('error');
    } finally {
        setIsResponding(false);
        abortControllerRef.current = null;
        setTimeout(() => {
          setAuAnimationState('idle');
        }, 1200);
    }
  }, [history.length, isAuthLoading, isAuthLocked, isOnline, isRestoringAuth, selectedDocId, selectedModel, session?.access_token, setAuAnimationState, setAuThinkingStatus, setAuThinkingSteps, updateAuThinkingStep, user]);

  const setHistoryPersisted = useCallback((next: ChatMessage[]) => {
    setHistory(next);
    persistHistory(next).catch(() => {});
  }, [persistHistory]);

  const deleteMessagePersisted = useCallback((messageId: string) => {
    setHistory((prev) => {
      const next = prev.filter((m) => m.id !== messageId);
      persistHistory(next).catch(() => {});
      return next;
    });
  }, [persistHistory]);

  const fetchPrompts = useCallback(async (title: string, content: string, idea?: string) => {
    try {
      if (isAuthLoading || isRestoringAuth || isAuthLocked) {
        return [];
      }
      const gate = guardRequest({
        isOnline,
        requireAuth: true,
        accessToken: session?.access_token ?? '__cookie_session__',
        warnKey: 'chat:prompts',
        context: 'prompt generation',
      });
      if (!gate.ok) {
        if (gate.reason === 'offline') {
          logOnce('warn', 'chat:prompts:offline', '[chat] Prompt generation blocked (offline)');
        }
        return [];
      }

      if (idea) {
        return await generatePromptStarters(title, content, idea);
      }

      // Smart suggestion: Scan chat history and document patterns
      const historyContext = history.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n');
      
      try {
        const result = await sendChatMessage({
          messages: [{ 
            id: nanoid(),
            role: 'user', 
            content: `Based on the document "${title}" and the recent chat history:\n${historyContext}\n\nGenerate 4 smart and relevant next questions the user might want to ask. The questions should be accurate and tied to the document content. Return ONLY a JSON array of strings.` 
          }],
          selectedDocId: selectedDocId!
        });

        const parsed = JSON.parse(result.answer);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        // Fallback to legacy
      }

      return await generatePromptStarters(title, content);
    } catch (err: any) {
      console.error('[useAuChat] Prompt generation failed:', err);
      return [];
    }
  }, [history, isAuthLoading, isAuthLocked, isOnline, isRestoringAuth, selectedDocId, session?.access_token]);

  return {
    history,
    setHistory,
    setHistoryPersisted,
    deleteMessagePersisted,
    isResponding,
    sendMessage,
    stopGeneration,
    scanAndGreet,
    promptStarters,
    fetchPrompts,
    availableModels,
    selectedModel,
    setSelectedModel,
    isInitialized,
    clearChat,
    lastError,
    clearLastError: () => setLastError(null),
    expiresAt
  };
}
