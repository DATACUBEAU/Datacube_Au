
import { useState, useCallback, useEffect, useRef } from 'react';
import { sendChatMessage, generatePromptStarters, getAvailableModels, type ChatMessage } from '@/lib/api/chat';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { useStore } from '@/hooks/use-store';
import { nanoid } from 'nanoid';

export function useAuChat(selectedDocId: string | null) {
  const [user] = useSupabaseUser();
  const [session] = useSupabaseSession();
  const { toast } = useToast();
  const setAuAnimationState = useStore(state => state.setAuAnimationState);
  const setAuThinkingStatus = useStore(state => state.setAuThinkingStatus);
  
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [isResponding, setIsResponding] = useState(false);
  const [promptStarters, setPromptStarters] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isInitialized, setIsInitialized] = useState(false);

  // --- Load Models ---
  useEffect(() => {
    if (!user) return;

    getAvailableModels(session?.access_token)
      .then(models => {
        setAvailableModels(models);
        setSelectedModel(prev => {
          if (prev && models.includes(prev)) return prev;
          return models[0] || '';
        });
      })
      .catch(err => console.error("Failed to load models:", err));
  }, [user, session]);

  // --- PERSISTENCE: Load history on mount or doc change ---
  useEffect(() => {
    if (selectedDocId && user?.id) {
      const savedHistory = localStorage.getItem(`au_chat_history_${user.id}_${selectedDocId}`);
      if (savedHistory) {
        try {
          setHistory(JSON.parse(savedHistory));
        } catch (e) {
          console.error('[useAuChat] Failed to parse saved history:', e);
          setHistory([]);
        }
      } else {
        setHistory([]);
      }
      setIsInitialized(true);
    } else if (!selectedDocId) {
      setHistory([]);
      setIsInitialized(true);
    }
  }, [selectedDocId, user?.id]);

  // --- PERSISTENCE: Save history on change ---
  useEffect(() => {
    if (selectedDocId && user?.id && history.length > 0) {
      localStorage.setItem(`au_chat_history_${user.id}_${selectedDocId}`, JSON.stringify(history));
    }
  }, [history, selectedDocId, user?.id]);

  const clearChat = useCallback(() => {
    setHistory([]);
    if (user?.id && selectedDocId) {
      localStorage.removeItem(`au_chat_history_${user.id}_${selectedDocId}`);
      // Also clear prompt starters cache if needed
      localStorage.removeItem(`chat_prompt_starters_${user.id}_${selectedDocId}`);
    }
  }, [user?.id, selectedDocId]);

  const expiresAt = session?.expires_at ? session.expires_at * 1000 : undefined;

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
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
    }
  ) => {
    if (!selectedDocId || !user) return;

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    const userMessage: ChatMessage = { id: nanoid(), role: 'user', content };
    const loadingId = nanoid();
    
    setHistory(prev => [...prev, userMessage, { id: loadingId, role: 'assistant', content: '', isLoading: true } as any]);
    setIsResponding(true);
    setAuAnimationState('thinking');
    setAuThinkingStatus('AU is initializing analytical context...');

    let thinkingInterval: any = null;
    try {
      // Step 1: Simulated "Steps" to mimic Trae's thinking behavior
      const thinkingSteps = [
        'Thinking...',
        'Analyzing request...',
        'Connecting ideas...',
        'Formulating response...'
      ];

      let currentStep = 0;
      thinkingInterval = setInterval(() => {
        if (currentStep < thinkingSteps.length) {
          setAuThinkingStatus(thinkingSteps[currentStep]);
          currentStep++;
        } else {
          clearInterval(thinkingInterval);
        }
      }, 1500);

      const result = await sendChatMessage({
        messages: [...history, userMessage],
        selectedDocId,
        guide: options?.guide,
        summaryMode: options?.summaryMode,
        browsingMode: options?.browsingMode,
        model: selectedModel || undefined
      }, session?.access_token);

      if (thinkingInterval) clearInterval(thinkingInterval);
      setAuAnimationState('responding');
      setAuThinkingStatus('Response ready.');

      // Parse JSON response if leaked into answer
      let finalAnswer = result.answer;
      let finalThought = result.thought;

      try {
        // Robust JSON extraction (handles Markdown blocks ```json ... ```)
        const jsonMatch = finalAnswer.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.thought && parsed.answer) {
                    finalThought = parsed.thought;
                    finalAnswer = parsed.answer;
                } else if (parsed.response && parsed.thinking) {
                    // Handle alternative keys just in case
                    finalThought = parsed.thinking;
                    finalAnswer = parsed.response;
                }
            } catch (e) {
                // Parsing failed, keep original
            }
        }
      } catch (e) {
        // Fallback to original text if parse fails
      }

      setHistory(prev => prev.map(m => m.id === loadingId ? {
        id: loadingId,
        role: 'assistant',
        content: finalAnswer,
        citations: result.citations,
        thought: finalThought
      } : m));
      return result;
    } catch (err: any) {
      if (thinkingInterval) clearInterval(thinkingInterval);
      setAuThinkingStatus('Analytical engine error.');
      if (err.name === 'AbortError') {
        console.log('[useAuChat] Message aborted');
        setHistory(prev => prev.filter(m => m.id !== loadingId));
        setAuAnimationState('idle');
        return;
      }
      console.error('[useAuChat] Message error:', err);
      setHistory(prev => prev.filter(m => m.id !== loadingId));
      setAuAnimationState('error');
      throw err;
    } finally {
      setIsResponding(false);
      abortControllerRef.current = null;
      // Delay setting back to idle to allow animation to breathe
      setTimeout(() => {
        setAuAnimationState('idle');
      }, 3000);
    }
  }, [selectedDocId, user, session, history, selectedModel]);

  const scanAndGreet = useCallback(async () => {
    if (!selectedDocId || !user) return;
    
    abortControllerRef.current = new AbortController();
    setIsResponding(true);
    setAuAnimationState('thinking');
    setAuThinkingStatus('AU is scanning document architecture...');
    const loadingId = nanoid();
    // Add a temporary loading indicator if history is empty
    if (history.length === 0) {
        setHistory([{ id: loadingId, role: 'assistant', content: '', isLoading: true } as any]);
    }

    let thinkingInterval: any = null;
    try {
        const thinkingSteps = [
            'Mapping document sections...',
            'Identifying core themes...',
            'Building analytical roadmap...',
            'Finalizing orchestration guide...'
        ];
        let currentStep = 0;
        thinkingInterval = setInterval(() => {
            if (currentStep < thinkingSteps.length) {
                setAuThinkingStatus(thinkingSteps[currentStep]);
                currentStep++;
            } else {
                clearInterval(thinkingInterval);
            }
        }, 1200);

        const result = await sendChatMessage({
            messages: [{ id: 'system-init', role: 'user', content: 'INIT_GREETING' }], // Dummy message
            selectedDocId,
            action: 'scan_and_greet',
            model: selectedModel || undefined
        }, session?.access_token);

        if (thinkingInterval) clearInterval(thinkingInterval);
        setAuAnimationState('responding');
        setAuThinkingStatus('Analysis complete.');
        // Replace loading message with greeting
        setHistory(prev => {
            const filtered = prev.filter(m => m.id !== loadingId);
            return [...filtered, {
                id: nanoid(),
                role: 'assistant',
                content: result.answer,
                thought: result.thought
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
        }, 3000);
    }
  }, [selectedDocId, user, session, history.length]);

  const fetchPrompts = useCallback(async (title: string, content: string, idea?: string) => {
    try {
      if (idea) {
        return await generatePromptStarters(title, content, idea, session?.access_token);
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
        }, session?.access_token);

        const parsed = JSON.parse(result.answer);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        // Fallback to legacy
      }

      return await generatePromptStarters(title, content, undefined, session?.access_token);
    } catch (err: any) {
      console.error('[useAuChat] Prompt generation failed:', err);
      return [];
    }
  }, [selectedDocId, session, history]);

  return {
    history,
    setHistory,
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
    expiresAt
  };
}
