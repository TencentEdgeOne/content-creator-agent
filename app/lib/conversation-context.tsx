'use client';

import { createContext, useContext, useState, useEffect } from 'react';

const ConversationContext = createContext<string>('');
const STORAGE_KEY = 'makers-conversation-id';

export function ConversationProvider({ children }: { children: React.ReactNode }) {
  const [conversationId, setConversationId] = useState<string>('');

  useEffect(() => {
    // SOP I-187: conversation_id is generated with crypto.randomUUID()
    // and persisted in localStorage (one ID, used across all AI endpoints)
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, id);
    }
    setConversationId(id);
  }, []);

  if (!conversationId) return null;

  return (
    <ConversationContext.Provider value={conversationId}>
      {children}
    </ConversationContext.Provider>
  );
}

export function useConversationId() {
  return useContext(ConversationContext);
}
