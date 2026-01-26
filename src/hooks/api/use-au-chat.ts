import { useState, useCallback, useEffect, useRef } from 'react';
import { 
  sendChatMessage, 
  generatePromptStarters, 
  fetchChatHistory, 
  saveChatMessage, 
  ensureChatSession, 
  fetchSessionMetadata,
  updateSessionMetadata,
  clearChatHistory,
  type ChatMessage 
} from '@/lib/api/chat';
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
  const [guide, setGuide] = useState<string>('');
  const [summaryMode, setSummaryMode] = useState<'short' | 'mid' | 'detailed' | null>(null);
  const [hasGreeted, setHasGreeted] = useState<boolean>(false);
  const [draftInput, setDraftInput] = useState<string>('');
  const [scrollPosition, setScrollPosition] = useState<number>(0);
  const [dbPromptStarters, setDbPromptStarters] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // --- HYDRATION: Load history and metadata from Supabase on mount or doc change ---
  useEffect(() => {
    let isMounted = true;

    async function hydrate() {
      if (selectedDocId) {
        // Ensure session exists first
        await ensureChatSession(selectedDocId, user);
        
        const [dbHistory, metadata] = await Promise.all([
          fetchChatHistory(selectedDocId, user),
          fetchSessionMetadata(selectedDocId, user)
        ]);

        if (isMounted) {
          if (dbHistory.length > 0) {
            setHistory(dbHistory);
          } else {
            // Check localStorage as fallback/migration path
            const legacyKey = `au_chat_history_${user?.id || 'guest'}_${selectedDocId}`;
            const savedHistory = localStorage.getItem(legacyKey);
            if (savedHistory) {
              try {
                const parsed = JSON.parse(savedHistory);
                setHistory(parsed);
                // Optionally migrate to DB
                for (const msg of parsed) {
                  await saveChatMessage(selectedDocId, msg, user);
                }
                localStorage.removeItem(legacyKey);
              } catch (e) {
                setHistory([]);
              }
            } else {
              setHistory([]);
            }
          }

          // Hydrate metadata
          if (metadata) {
            setGuide(metadata.guide || '');
            setSummaryMode(metadata.summaryMode || null);
            setHasGreeted(metadata.hasGreeted || false);
            setDraftInput(metadata.draftInput || '');
            setScrollPosition(metadata.scrollPosition || 0);
            setDbPromptStarters(metadata.promptStarters || []);
          }
        }
      } else {
        setHistory([]);
        setGuide('');
        setSummaryMode(null);
        setHasGreeted(false);
        setDraftInput('');
        setDbPromptStarters([]);
      }
    }

    hydrate();
    return () => { isMounted = false; };
  }, [selectedDocId, user]);

  const updateMetadata = useCallback(async (updates: { guide?: string; summaryMode?: any; hasGreeted?: boolean; draftInput?: string; scrollPosition?: number; promptStarters?: string[] }) => {
    if (!selectedDocId) return;
    
    const newMetadata = {
      guide: updates.guide !== undefined ? updates.guide : guide,
      summaryMode: updates.summaryMode !== undefined ? updates.summaryMode : summaryMode,
      hasGreeted: updates.hasGreeted !== undefined ? updates.hasGreeted : hasGreeted,
      draftInput: updates.draftInput !== undefined ? updates.draftInput : draftInput,
      scrollPosition: updates.scrollPosition !== undefined ? updates.scrollPosition : scrollPosition,
      promptStarters: updates.promptStarters !== undefined ? updates.promptStarters : dbPromptStarters,
      documentId: selectedDocId
    };

    await updateSessionMetadata(selectedDocId, newMetadata, user);
    
    if (updates.guide !== undefined) setGuide(updates.guide);
    if (updates.summaryMode !== undefined) setSummaryMode(updates.summaryMode);
    if (updates.hasGreeted !== undefined) setHasGreeted(updates.hasGreeted);
    if (updates.draftInput !== undefined) setDraftInput(updates.draftInput);
    if (updates.scrollPosition !== undefined) setScrollPosition(updates.scrollPosition);
    if (updates.promptStarters !== undefined) setDbPromptStarters(updates.promptStarters);
  }, [selectedDocId, user, guide, summaryMode, hasGreeted, draftInput, scrollPosition, dbPromptStarters]);

  const clearHistory = useCallback(async () => {
    if (!selectedDocId) return;
    await clearChatHistory(selectedDocId, user);
    setHistory([]);
    setPromptStarters([]);
    // Optionally reset metadata? Usually we keep guide/mode but clear greeted.
    await updateMetadata({ hasGreeted: false, draftInput: '' });
  }, [selectedDocId, user, updateMetadata]);

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
    if (!selectedDocId) return;

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    const userMessage: ChatMessage = { id: nanoid(), role: 'user', content };
    const loadingId = nanoid();
    
    setHistory(prev => [...prev, userMessage, { id: loadingId, role: 'assistant', content: '', isLoading: true } as any]);
    setIsResponding(true);
    setAuAnimationState('thinking');
    setAuThinkingStatus('AU is initializing analytical context...');

    // Persist user message immediately
    await saveChatMessage(selectedDocId, userMessage, user);

    let thinkingInterval: any = null;
    try {
      // Step 1: Simulated "Steps" to mimic Trae's thinking behavior
      const thinkingSteps = [
        'Searching document index...',
        'Extracting relevant knowledge chunks...',
        'Synthesizing cross-references...',
        'Applying user guide preferences...',
        'Formulating analytical response...'
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
        browsingMode: options?.browsingMode
      }, session?.access_token);

      if (thinkingInterval) clearInterval(thinkingInterval);
      setAuAnimationState('responding');
      setAuThinkingStatus('Response ready.');

      const assistantMessage: ChatMessage = {
        id: loadingId,
        role: 'assistant',
        content: result.answer,
        citations: result.citations,
        thought: result.thought
      };

      // Persist assistant message
      await saveChatMessage(selectedDocId, assistantMessage, user);

      setHistory(prev => prev.map(m => m.id === loadingId ? assistantMessage : m));
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
  }, [selectedDocId, user, session, history]);

  const scanAndGreet = useCallback(async () => {
    if (!selectedDocId) return;
    
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
            action: 'scan_and_greet'
        }, session?.access_token);

        if (thinkingInterval) clearInterval(thinkingInterval);
        setAuAnimationState('responding');
        setAuThinkingStatus('Analysis complete.');

        const greetingMessage: ChatMessage = {
          id: nanoid(),
          role: 'assistant',
          content: result.answer,
          thought: result.thought
        };

        // Persist greeting
        await saveChatMessage(selectedDocId, greetingMessage, user);

        // Replace loading message with greeting
        setHistory(prev => {
            const filtered = prev.filter(m => m.id !== loadingId);
            return [...filtered, greetingMessage];
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

  const fetchPromptStartersAction = useCallback(async (title: string, content: string, idea?: string) => {
    if (!selectedDocId) return;
    
    try {
      let prompts: string[] = [];
      if (idea) {
        prompts = await generatePromptStarters(title, content, idea, session?.access_token);
      } else {
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
          if (Array.isArray(parsed)) {
            prompts = parsed;
          }
        } catch (e) {
          // Fallback to legacy
          prompts = await generatePromptStarters(title, content, undefined, session?.access_token);
        }
      }

      if (prompts.length > 0) {
        await updateMetadata({ promptStarters: prompts });
      }
      return prompts;
    } catch (err: any) {
      console.error('[useAuChat] Prompt generation failed:', err);
      return [];
    }
  }, [selectedDocId, session, history, updateMetadata]);

  return {
    history,
    setHistory,
    isResponding,
    sendMessage,
    stopGeneration,
    scanAndGreet,
    promptStarters: dbPromptStarters,
    fetchPrompts: fetchPromptStartersAction,
    guide,
    summaryMode,
    hasGreeted,
    updateMetadata,
    clearHistory,
    draftInput,
    scrollPosition,
  };
}
