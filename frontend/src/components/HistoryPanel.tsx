import { useState, useEffect } from 'react';
import { History, MessageSquare, Trash2, Loader2, ChevronLeft, Sparkles, User } from 'lucide-react';
import { listSessions, getSession, deleteSession, type Session, type Language } from '../services/api';

interface Props { agentId: string; language: Language; }

export default function HistoryPanel({ agentId, language }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => { load(); }, [agentId]);

  const load = async () => { setIsLoading(true); try { setSessions(await listSessions(agentId)); } catch {} setIsLoading(false); };

  if (selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 h-14 border-b border-zinc-800/40">
          <button onClick={() => setSelected(null)} className="p-1.5 hover:bg-zinc-800 rounded-lg"><ChevronLeft size={16} className="text-zinc-400" /></button>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-white truncate">{selected.title}</p>
            <p className="text-[10px] text-zinc-600">{new Date(selected.created_at).toLocaleString()}</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-1">
            {selected.messages?.map((msg, i) => (
              <div key={i} className={`flex gap-3 py-2 fade-in ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-600' : 'bg-zinc-800 ring-1 ring-zinc-700'}`}>
                  {msg.role === 'user' ? <User size={12} className="text-white" /> : <Sparkles size={12} className="text-indigo-400" />}
                </div>
                <div className={`max-w-[75%] text-[13px] leading-relaxed ${msg.role === 'user' ? 'bg-indigo-600 text-white px-3.5 py-2 rounded-2xl rounded-tr-md' : 'text-zinc-300'}`}>
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-zinc-800/40">
        <h2 className="text-[15px] font-semibold text-white">{language === 'fi' ? 'Keskusteluhistoria' : 'Chat History'}</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-1">
        {isLoading && <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-indigo-400" /></div>}
        {!isLoading && sessions.length === 0 && (
          <div className="flex flex-col items-center py-16 text-zinc-600">
            <History size={40} className="mb-3 opacity-40" />
            <p className="text-sm">{language === 'fi' ? 'Ei keskusteluja vielä' : 'No conversations yet'}</p>
          </div>
        )}
        {sessions.map(s => (
          <div key={s.id} onClick={() => getSession(s.id, agentId).then(setSelected)} className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-800/50 cursor-pointer transition-all">
            <MessageSquare size={14} className="text-zinc-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-zinc-300 truncate">{s.title}</p>
              <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                <span>{new Date(s.updated_at || s.created_at).toLocaleDateString()}</span>
                <span className="px-1 py-px bg-zinc-800 rounded text-[9px] uppercase">{s.language || 'en'}</span>
              </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id, agentId); setSessions(p => p.filter(x => x.id !== s.id)); }}
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all">
              <Trash2 size={12} className="text-red-400" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
