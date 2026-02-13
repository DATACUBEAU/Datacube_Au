import { type ChatMessage } from '@/lib/api/chat';

export interface StoredChat {
  messages: ChatMessage[];
  updatedAt: number;
}

const STORAGE_PREFIX = 'dcau';

// Helper to get key
const getKey = (type: 'au' | 'global', userId: string, threadId: string) => 
  `${STORAGE_PREFIX}:${type}:${userId}:${threadId}`;

export const LocalChatStorage = {
  /**
   * Save full transcript to LocalStorage
   */
  saveTranscript: (type: 'au' | 'global', userId: string, threadId: string, messages: ChatMessage[]) => {
    if (typeof window === 'undefined') return;
    const key = getKey(type, userId, threadId);
    const data: StoredChat = {
      messages,
      updatedAt: Date.now()
    };
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn('LocalStorage full or error:', e);
      // Optional: Trim old messages if full?
    }
  },

  /**
   * Load transcript
   */
  loadTranscript: (type: 'au' | 'global', userId: string, threadId: string): ChatMessage[] => {
    if (typeof window === 'undefined') return [];
    const key = getKey(type, userId, threadId);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    try {
      const data = JSON.parse(raw) as StoredChat;
      return data.messages || [];
    } catch {
      return [];
    }
  },

  /**
   * Get a rolling summary (last N turns) for sending to server
   */
  getRollingContext: (type: 'au' | 'global', userId: string, threadId: string, limit = 6): ChatMessage[] => {
    const messages = LocalChatStorage.loadTranscript(type, userId, threadId);
    // Return last N messages, preserving system prompt if exists?
    // Usually system prompt is injected by server, so we just send last N user/assistant turns.
    return messages.slice(-limit);
  },

  /**
   * Clear specific thread
   */
  clearThread: (type: 'au' | 'global', userId: string, threadId: string) => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(getKey(type, userId, threadId));
  },

  /**
   * Auto-cleanup expired AU chats (older than 3 days)
   * This relies on checking all keys in localStorage
   */
  cleanupExpiredAUChats: (userId: string) => {
    if (typeof window === 'undefined') return;
    const prefix = `${STORAGE_PREFIX}:au:${userId}:`;
    const now = Date.now();
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const data = JSON.parse(raw) as StoredChat;
            if (now - data.updatedAt > THREE_DAYS_MS) {
              localStorage.removeItem(key);
              console.log('[LocalChatStorage] Removed expired AU chat:', key);
            }
          }
        } catch {
          // If parse fails, maybe just remove it?
        }
      }
    }
  },

  /**
   * Clear ALL Global Chat history for a user
   * (Used by Global Chat Prompt)
   */
  clearAllGlobalChats: (userId: string): { removedCount: number, removedKeys: string[] } => {
    if (typeof window === 'undefined') return { removedCount: 0, removedKeys: [] };
    const prefix = `${STORAGE_PREFIX}:global:${userId}:`;
    const keysToRemove: string[] = [];

    // 1. Collect keys first (avoid mutation during iteration)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }

    // 2. Remove keys
    keysToRemove.forEach(key => {
        localStorage.removeItem(key);
    });

    // Dev-only logging
    if (process.env.NODE_ENV === 'development') {
        keysToRemove.forEach(key => console.log('[LocalChatStorage] Removed global chat:', key));
        return { removedCount: keysToRemove.length, removedKeys: keysToRemove };
    }

    // Production: Return count but hide keys
    return { removedCount: keysToRemove.length, removedKeys: [] };
  }
};
