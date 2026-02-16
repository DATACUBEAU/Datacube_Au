'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useSupabaseUser } from '@/hooks/use-supabase-auth';
import { useNetworkStatus } from '@/components/providers/network-status-provider';

// --- TYPES ---

interface ChatJob {
  id: string;
  threadId: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  createdAt: any;
  updatedAt: any;
  error?: string;
  chat_type: 'global' | 'au_rag';
}

interface ChatRuntimeContextType {
  activeJobs: ChatJob[];
  enqueueMessage: (payload: any) => Promise<void>;
  isJobPending: (threadId: string) => boolean;
  unreadCount: number;
  unreadSupport: number;
  unreadBroadcasts: number;
  markSupportRead: () => Promise<void>;
  markBroadcastsRead: () => Promise<void>;
  connectionStatus: 'connected' | 'reconnecting' | 'offline';
  firebaseAuthStatus: 'idle' | 'pending' | 'ready' | 'failed';
}

const ChatRuntimeContext = createContext<ChatRuntimeContextType | undefined>(undefined);

export function ChatRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [user] = useSupabaseUser();
  const { isOnline } = useNetworkStatus();
  const [activeJobs, setActiveJobs] = useState<ChatJob[]>([]);
  
  // Notification State - Local only now
  const [unreadSupport, setUnreadSupport] = useState(0);
  const [unreadBroadcasts, setUnreadBroadcasts] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting' | 'offline'>('connected');
  
  // Sync connection status with global network status
  useEffect(() => {
      setConnectionStatus(isOnline ? 'connected' : 'offline');
  }, [isOnline]);

  // Mock Enqueue - purely for interface compatibility if needed, but consumers should switch to useAuChat
  const enqueueMessage = async (payload: any) => {
    console.warn("enqueueMessage is deprecated. Use useAuChat's sendMessage instead.");
  };

  const isJobPending = (threadId: string) => {
      return false;
  };

  const markSupportRead = async () => {
      setUnreadSupport(0);
  };

  const markBroadcastsRead = async () => {
      setUnreadBroadcasts(0);
  };

  return (
    <ChatRuntimeContext.Provider value={{ 
        activeJobs, 
        enqueueMessage, 
        isJobPending,
        unreadCount: unreadSupport + unreadBroadcasts,
        unreadSupport,
        unreadBroadcasts,
        markSupportRead,
        markBroadcastsRead,
        connectionStatus,
        firebaseAuthStatus: 'ready' // Mock ready since we removed Firebase Auth
    }}>
      {children}
    </ChatRuntimeContext.Provider>
  );
}

export function useChatRuntime() {
  const context = useContext(ChatRuntimeContext);
  if (!context) {
    throw new Error('useChatRuntime must be used within a ChatRuntimeProvider');
  }
  return context;
}
