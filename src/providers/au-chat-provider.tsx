'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

// Define the shape of the context (extensible for future)
interface AuChatContextType {
  isChatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  toggleChat: () => void;
}

const AuChatContext = createContext<AuChatContextType | undefined>(undefined);

export function AuChatProvider({ children }: { children: ReactNode }) {
  const [isChatOpen, setChatOpen] = useState(false);

  const toggleChat = () => setChatOpen((prev) => !prev);

  return (
    <AuChatContext.Provider value={{ isChatOpen, setChatOpen, toggleChat }}>
      {children}
    </AuChatContext.Provider>
  );
}

export function useAuChatContext() {
  const context = useContext(AuChatContext);
  if (context === undefined) {
    throw new Error('useAuChatContext must be used within an AuChatProvider');
  }
  return context;
}
