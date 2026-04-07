import { useState, useCallback, useRef } from 'react';
import { streamChat, type Language, type ChatResponse } from '../services/api';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: ChatResponse['sources'];
}

export function useChat(agentId: string, language: Language) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef(false);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    abortRef.current = false;

    const assistantMsg: Message = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      await streamChat(
        { message: text, agent_id: agentId, session_id: sessionId, language },
        (meta) => {
          setSessionId(meta.session_id);
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              sources: meta.sources,
            };
            return updated;
          });
        },
        (token) => {
          if (abortRef.current) return;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: updated[updated.length - 1].content + token,
            };
            return updated;
          });
        },
        () => setIsLoading(false),
      );
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: 'Error: Failed to get response. Please try again.',
        };
        return updated;
      });
      setIsLoading(false);
    }
  }, [agentId, language, sessionId, isLoading]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSessionId(undefined);
  }, []);

  const loadSession = useCallback((session: { id: string; messages?: Message[] }) => {
    setSessionId(session.id);
    setMessages(session.messages || []);
  }, []);

  return { messages, sessionId, isLoading, sendMessage, clearChat, loadSession };
}
