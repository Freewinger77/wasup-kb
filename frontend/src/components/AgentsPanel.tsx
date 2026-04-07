import { useState, useEffect } from 'react';
import { Users, Plus, Save, Loader2 } from 'lucide-react';
import { listAgents, createOrUpdateAgent, type Agent, type Language } from '../services/api';

interface Props { currentAgentId: string; language: Language; onSelectAgent: (id: string) => void; }

export default function AgentsPanel({ currentAgentId, language, onSelectAgent }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ agent_id: '', name: '', preferred_language: 'en' as Language });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);
  const load = async () => { setIsLoading(true); try { setAgents(await listAgents()); } catch {} setIsLoading(false); };

  const save = async () => {
    if (!form.agent_id.trim() || !form.name.trim()) return;
    setSaving(true);
    try { await createOrUpdateAgent(form); await load(); setShowForm(false); setForm({ agent_id: '', name: '', preferred_language: 'en' }); } catch {}
    setSaving(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800/40">
        <h2 className="text-[15px] font-semibold text-white">{language === 'fi' ? 'Myyntiedustajat' : 'Sales Agents'}</h2>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all">
          <Plus size={13} /> {language === 'fi' ? 'Lisää' : 'Add'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
        {showForm && (
          <div className="p-4 bg-zinc-900 rounded-xl border border-indigo-500/20 space-y-2.5">
            <input placeholder={language === 'fi' ? 'Tunnus' : 'Agent ID'} value={form.agent_id} onChange={e => setForm(p => ({ ...p, agent_id: e.target.value }))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-indigo-500/50" />
            <input placeholder={language === 'fi' ? 'Nimi' : 'Name'} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-indigo-500/50" />
            <select value={form.preferred_language} onChange={e => setForm(p => ({ ...p, preferred_language: e.target.value as Language }))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50">
              <option value="en">English</option><option value="fi">Suomi</option>
            </select>
            <button onClick={save} disabled={saving} className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 text-white rounded-lg text-sm font-medium transition-all">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {language === 'fi' ? 'Tallenna' : 'Save'}
            </button>
          </div>
        )}
        {isLoading && <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-indigo-400" /></div>}
        {!isLoading && agents.length === 0 && !showForm && (
          <div className="flex flex-col items-center py-16 text-zinc-600"><Users size={40} className="mb-3 opacity-40" /><p className="text-sm">{language === 'fi' ? 'Ei edustajia' : 'No agents yet'}</p></div>
        )}
        {agents.map(a => (
          <button key={a.agent_id} onClick={() => onSelectAgent(a.agent_id)}
            className={`w-full flex items-center gap-3 p-3.5 rounded-xl border transition-all text-left ${a.agent_id === currentAgentId ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-zinc-900 border-zinc-800/60 hover:border-zinc-700'}`}>
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm font-semibold text-white">{a.name.charAt(0).toUpperCase()}</div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-white">{a.name}</p>
              <p className="text-[11px] text-zinc-600">{a.agent_id} · {a.preferred_language === 'fi' ? 'Suomi' : 'English'}</p>
            </div>
            {a.agent_id === currentAgentId && <span className="text-[10px] text-indigo-400 font-medium uppercase tracking-wide">Active</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
