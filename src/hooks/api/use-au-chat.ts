import { useState, useCallback } from 'react';
import { sendChatMessage, generatePromptStarters, type ChatMessage } from '@/lib/api/chat';
import { useSupabaseSession, useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { nanoid } from 'nanoid';

export function useAuChat(selectedDocId: string | null) {
  const [user] = useSupabaseUser();
  const [session] = useSupabaseSession();
  const { toast } = useToast();
  
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [isResponding, setIsResponding] = useState(false);
  const [promptStarters, setPromptStarters] = useState<string[]>([]);

  const sendMessage = useCallback(async (
    content: string, 
    options?: { guide?: string; summaryMode?: 'short' | 'mid' | 'detailed' | null }
  ) => {
    if (!selectedDocId || !user) return;

    const userMessage: ChatMessage = { id: nanoid(), role: 'user', content };
    const loadingId = nanoid();
    
    setHistory(prev => [...prev, userMessage, { id: loadingId, role: 'assistant', content: '', isLoading: true } as any]);
    setIsResponding(true);

    try {
      const result = await sendChatMessage({
        messages: [...history, userMessage],
        selectedDocId,
        guide: options?.guide,
        summaryMode: options?.summaryMode
      }, session?.access_token);

      setHistory(prev => prev.map(m => m.id === loadingId ? {
        id: loadingId,
        role: 'assistant',
        content: result.answer,
        citations: result.citations,
        thought: result.thought
      } : m));
      return result;
    } catch (err: any) {
      console.error('[useAuChat] Message error:', err);
      setHistory(prev => prev.filter(m => m.id !== loadingId));
      throw err;
    } finally {
      setIsResponding(false);
    }
  }, [selectedDocId, user, session, history]);

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
    promptStarters,
    fetchPrompts
  };
}
