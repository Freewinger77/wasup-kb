import { useState, useRef, useEffect } from 'react';
import { Send, Volume2, RotateCcw, FileText, Sparkles, User } from 'lucide-react';
import { useChat, type Message } from '../hooks/useChat';
import { useVoice } from '../hooks/useVoice';
import type { Language } from '../services/api';

interface Props {
  agentId: string;
  language: Language;
}

export default function ChatPanel({ agentId, language }: Props) {
  const { messages, isLoading, sendMessage, clearChat } = useChat(agentId, language);
  const { speak, isSpeaking, stopSpeaking } = useVoice(agentId, language);
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-1">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center">
              <div className="w-14 h-14 rounded-2xl bg-zinc-800/80 flex items-center justify-center mb-5">
                <Sparkles size={24} className="text-indigo-400" />
              </div>
              <h3 className="text-lg font-medium text-zinc-200">
                {language === 'fi' ? 'Kysy mitä tahansa' : 'Ask anything'}
              </h3>
              <p className="text-sm text-zinc-500 mt-2 max-w-sm">
                {language === 'fi'
                  ? 'Vastaukset perustuvat tietokantaasi ladattuihin dokumentteihin'
                  : 'Answers are grounded in the documents from your knowledge base'}
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageRow
              key={i}
              message={msg}
              isLoading={isLoading && i === messages.length - 1 && msg.role === 'assistant'}
              onSpeak={() => (isSpeaking ? stopSpeaking() : speak(msg.content))}
              isSpeaking={isSpeaking}
            />
          ))}
          <div ref={endRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800/60 bg-zinc-950/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <div className="flex items-center gap-2">
            <button
              onClick={clearChat}
              className="p-2.5 text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/60 rounded-xl transition-all"
              title={language === 'fi' ? 'Uusi keskustelu' : 'New chat'}
            >
              <RotateCcw size={16} />
            </button>
            <div className="flex-1 flex items-center bg-zinc-900 border border-zinc-800 rounded-xl focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/20 transition-all">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                placeholder={language === 'fi' ? 'Kirjoita viestisi...' : 'Type a message...'}
                className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 px-4 py-3 outline-none"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
                className="p-2 mr-1.5 text-zinc-500 hover:text-white disabled:text-zinc-700 hover:bg-indigo-600 disabled:hover:bg-transparent rounded-lg transition-all"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  isLoading,
  onSpeak,
  isSpeaking,
}: {
  message: Message;
  isLoading: boolean;
  onSpeak: () => void;
  isSpeaking: boolean;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 py-3 fade-in ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
        isUser ? 'bg-indigo-600' : 'bg-zinc-800 ring-1 ring-zinc-700'
      }`}>
        {isUser
          ? <User size={14} className="text-white" />
          : <Sparkles size={14} className="text-indigo-400" />
        }
      </div>

      {/* Content */}
      <div className={`max-w-[80%] ${isUser ? 'text-right' : ''}`}>
        <div className={`inline-block text-[14px] leading-relaxed ${
          isUser
            ? 'bg-indigo-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-md'
            : 'text-zinc-200'
        }`}>
          {isLoading && !message.content ? (
            <span className="shimmer-text text-sm">Thinking...</span>
          ) : (
            <span className="whitespace-pre-wrap">{message.content}</span>
          )}
        </div>

        {/* Actions for assistant messages */}
        {!isUser && message.content && !isLoading && (
          <div className="flex items-center gap-3 mt-1.5">
            <button
              onClick={onSpeak}
              className="flex items-center gap-1 text-[11px] text-zinc-600 hover:text-indigo-400 transition-colors"
            >
              <Volume2 size={12} className={isSpeaking ? 'text-indigo-400' : ''} />
              {isSpeaking ? 'Stop' : 'Listen'}
            </button>
            {message.sources && message.sources.length > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-zinc-600">
                <FileText size={11} />
                {message.sources.length} source{message.sources.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
