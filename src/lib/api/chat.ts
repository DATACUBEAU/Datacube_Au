import { safeFetch } from '@/lib/api/safe-fetch';
import { supabase, getEffectiveOwnershipConditions, decodeJWT, getGuestToken } from '@/lib/supabase/client';
import type { RagBasedQuestionAnsweringOutput } from '@shared/schemas';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');

if (!SUPABASE_URL) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not defined in environment variables.");
}

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thought?: string;
  citations?: string[];
  isLoading?: boolean;
  isSystem?: boolean;
  isError?: boolean;
  created_at?: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  selectedDocId: string;
  guide?: string;
  summaryMode?: 'short' | 'mid' | 'detailed' | null;
  action?: 'scan_and_greet' | 'chat';
  browsingMode?: boolean;
};

/**
 * Resolves a session ID, mapping 'global' to a deterministic UUID.
 */
export function resolveSessionId(id: string, user: any): string {
  if (id !== 'global') return id;
  
  // For global chat, use the user's own ID as the session ID.
  // This ensures each user has exactly one persistent global chat session.
  // Supabase User object has .id, decoded JWT has .sub
  const userId = user?.id || user?.sub;
  if (userId) return userId;
  
  // Fallback for guests
  const guestToken = getGuestToken();
  if (guestToken) {
      try {
        const decoded = decodeJWT(guestToken);
        const guestId = decoded?.guest_session_id || decoded?.sub;
        if (guestId) return guestId;
      } catch (e) {
        // ignore
      }
    }
  
  return '00000000-0000-0000-0000-000000000001'; // Ultimate fallback
}

/**
 * Sends a chat request to the au-chat Edge Function.
 */
export async function sendChatMessage(
  request: ChatRequest,
  accessToken?: string
): Promise<RagBasedQuestionAnsweringOutput & { thought?: string }> {
  const sessionId = resolveSessionId(request.selectedDocId, decodeJWT(accessToken || ''));

  return safeFetch(`${SUPABASE_URL}/functions/v1/au-chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      messages: request.messages,
      sessionId: sessionId,
      selectedDocId: request.selectedDocId, // Keep 'global' here for RAG logic if needed
      useRAG: true,
      guide: request.guide,
      summaryMode: request.summaryMode,
      action: request.action,
      browsingMode: request.browsingMode,
      currentPath: typeof window !== 'undefined' ? window.location.pathname : '',
    }),
  });
}

/**
 * Fetches session metadata from Supabase.
 */
export async function fetchSessionMetadata(sessionId: string, user: any): Promise<any> {
  const resolvedSessionId = resolveSessionId(sessionId, user);
  const { data, error } = await supabase
    .from('au_sessions')
    .select('metadata')
    .eq('id', resolvedSessionId)
    .maybeSingle();

  if (error) {
    console.error('[API] Error fetching session metadata:', error);
    return {};
  }
  return data?.metadata || {};
}

/**
 * Updates session metadata in Supabase.
 */
export async function updateSessionMetadata(sessionId: string, metadata: any, user: any): Promise<void> {
  const resolvedSessionId = resolveSessionId(sessionId, user);
  const { error } = await supabase
    .from('au_sessions')
    .update({ 
      metadata: metadata,
      updated_at: new Date().toISOString()
    })
    .eq('id', resolvedSessionId);

  if (error) {
    console.error('[API] Error updating session metadata:', error);
  }
}

/**
 * Fetches chat history for a session from Supabase.
 */
export async function fetchChatHistory(sessionId: string, user: any): Promise<ChatMessage[]> {
  const resolvedSessionId = resolveSessionId(sessionId, user);
  
  const { data, error } = await supabase
    .from('au_messages')
    .select('*')
    .eq('session_id', resolvedSessionId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[API] Error fetching chat history:', error);
    return [];
  }

  return (data || []).map(m => ({
    id: m.id,
    role: m.role,
    content: m.content,
    thought: m.metadata?.thought,
    citations: m.metadata?.citations,
    created_at: m.created_at
  }));
}

/**
 * Saves a chat message to Supabase.
 */
export async function saveChatMessage(
  sessionId: string,
  message: { role: string; content: string; thought?: string; citations?: string[] },
  user: any
): Promise<void> {
  const resolvedSessionId = resolveSessionId(sessionId, user);
  const guestToken = getGuestToken();
  const decoded = guestToken ? decodeJWT(guestToken) : null;
  const guestId = decoded?.guest_session_id || decoded?.sub;

  const { error } = await supabase
    .from('au_messages')
    .insert({
      session_id: resolvedSessionId,
      user_id: user?.id || null,
      guest_session_id: user?.id ? null : guestId,
      role: message.role,
      content: message.content,
      metadata: {
        thought: message.thought,
        citations: message.citations
      }
    });

  if (error) {
    console.error('[API] Error saving chat message:', error);
  }
}

/**
 * Clears chat history for a session in Supabase.
 */
export async function clearChatHistory(sessionId: string, user: any): Promise<void> {
  const resolvedSessionId = resolveSessionId(sessionId, user);
  
  const { error } = await supabase
    .from('au_messages')
    .delete()
    .eq('session_id', resolvedSessionId);

  if (error) {
    console.error('[API] Error clearing chat history:', error);
  }
}

/**
 * Ensures a chat session exists for a document.
 */
export async function ensureChatSession(documentId: string, user: any): Promise<void> {
  const resolvedSessionId = resolveSessionId(documentId, user);
  const guestToken = getGuestToken();
  const decoded = guestToken ? decodeJWT(guestToken) : null;
  const guestId = decoded?.guest_session_id || decoded?.sub;

  // Check if session exists
  const { data: existing } = await supabase
    .from('au_sessions')
    .select('id')
    .eq('id', resolvedSessionId)
    .single();

  if (!existing) {
    const { error } = await supabase
      .from('au_sessions')
      .insert({
        id: resolvedSessionId,
        user_id: user?.id || null,
        guest_session_id: user?.id ? null : guestId,
        title: documentId === 'global' ? 'Global Intelligence' : 'Document Chat',
        metadata: { documentId }
      });

    if (error) {
      console.error('[API] Error creating chat session:', error);
    }
  }
}

/**
 * Generates prompt starters for a given document.
 */
export async function generatePromptStarters(
  documentTitle: string,
  documentContent: string,
  userIdea?: string,
  accessToken?: string
): Promise<string[]> {
  const result = await safeFetch(`${SUPABASE_URL}/functions/v1/generate-prompt-starters`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({
      documentTitle,
      documentContent: documentContent.substring(0, 10000), // Efficiency limit
      userIdea,
    }),
  });
  return result.prompts || [];
}
