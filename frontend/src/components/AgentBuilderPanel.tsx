import { useEffect, useMemo, useState } from 'react';
import { Bot, FlaskConical, Loader2, MessageSquare, Play, Plus, Send, Wrench, type LucideIcon } from 'lucide-react';
import {
  createAgentDefinition,
  createWhatsAppTestDeploy,
  generatePrompt,
  generateTestCases,
  generateTools,
  generateWorkSpec,
  getPromptfooConfig,
  listAgents,
  listPrompts,
  listTestCases,
  listTools,
  listWorkSpecs,
  runTestCases,
  streamChat,
  type AgentDefinition,
  type Customer,
  type Language,
  type PromptVersion,
  type TestCase,
  type TestRun,
  type ToolDefinition,
  type WorkSpec,
} from '../services/api';

interface Props {
  orgId: string;
  language: Language;
  customers: Customer[];
  selectedCustomerId?: string;
  selectedAgentId?: string;
  onSelectAgent: (agentId?: string) => void;
}

export default function AgentBuilderPanel({
  orgId,
  language,
  customers,
  selectedCustomerId,
  selectedAgentId,
  onSelectAgent,
}: Props) {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [workSpecs, setWorkSpecs] = useState<WorkSpec[]>([]);
  const [prompts, setPrompts] = useState<PromptVersion[]>([]);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [tests, setTests] = useState<TestCase[]>([]);
  const [lastRun, setLastRun] = useState<TestRun | null>(null);
  const [agentName, setAgentName] = useState('');
  const [discoveryText, setDiscoveryText] = useState('');
  const [sandboxInput, setSandboxInput] = useState('');
  const [sandboxMessages, setSandboxMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [sandboxSessionId, setSandboxSessionId] = useState<string | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const activeAgent = agents.find(a => a.id === selectedAgentId);
  const activeSpec = workSpecs[0];
  const activePrompt = prompts[0];
  const activeCustomer = customers.find(c => c.id === (activeAgent?.customer_id || selectedCustomerId));

  const load = async (agentId = selectedAgentId) => {
    setBusy('loading');
    try {
      const nextAgents = await listAgents();
      setAgents(nextAgents);
      const effective = agentId || nextAgents[0]?.id;
      if (!selectedAgentId && effective) onSelectAgent(effective);
      if (effective) {
        const [specList, promptList, toolList, testList] = await Promise.all([
          listWorkSpecs(effective),
          listPrompts(effective),
          listTools(effective),
          listTestCases(effective),
        ]);
        setWorkSpecs(specList);
        setPrompts(promptList);
        setTools(toolList);
        setTests(testList);
      }
    } catch (e: any) { setError(e.message || 'Failed to load builder data'); }
    setBusy(null);
  };

  useEffect(() => { load(); }, [selectedAgentId]);

  const createAgent = async () => {
    if (!agentName.trim()) return;
    setBusy('agent');
    try {
      const agent = await createAgentDefinition({
        name: agentName.trim(),
        customer_id: selectedCustomerId || null,
        preferred_language: language,
        instructions: '',
      });
      setAgentName('');
      onSelectAgent(agent.id);
      await load(agent.id);
    } catch (e: any) { setError(e.message || 'Failed to create agent'); }
    setBusy(null);
  };

  const makeSpec = async () => {
    if (!activeAgent || !discoveryText.trim()) return;
    setBusy('spec');
    try {
      const spec = await generateWorkSpec({
        agent_definition_id: activeAgent.id,
        customer_id: activeAgent.customer_id || selectedCustomerId || null,
        discovery_text: discoveryText,
        customer_name: activeCustomer?.name || activeAgent.name,
        industry_hint: activeCustomer?.industry,
      });
      setWorkSpecs([spec, ...workSpecs]);
    } catch (e: any) { setError(e.message || 'Failed to generate work spec'); }
    setBusy(null);
  };

  const makePromptAndTools = async () => {
    if (!activeAgent || !activeSpec) return;
    setBusy('prompt');
    try {
      const [prompt, generatedTools] = await Promise.all([
        generatePrompt(activeAgent.id, activeSpec.id),
        generateTools(activeAgent.id, activeSpec.id),
      ]);
      setPrompts([prompt, ...prompts]);
      setTools(generatedTools);
      await load(activeAgent.id);
    } catch (e: any) { setError(e.message || 'Failed to generate prompt/tools'); }
    setBusy(null);
  };

  const makeTests = async () => {
    if (!activeAgent || !activeSpec) return;
    setBusy('tests');
    try {
      const generated = await generateTestCases(activeAgent.id, activeSpec.id, activePrompt?.id);
      setTests(generated);
      await load(activeAgent.id);
    } catch (e: any) { setError(e.message || 'Failed to generate tests'); }
    setBusy(null);
  };

  const runTests = async () => {
    if (!activeAgent) return;
    setBusy('run');
    try {
      setLastRun(await runTestCases(activeAgent.id, activePrompt?.id));
    } catch (e: any) { setError(e.message || 'Failed to run tests'); }
    setBusy(null);
  };

  const deployWhatsApp = async () => {
    if (!activeAgent) return;
    setBusy('whatsapp');
    try {
      await createWhatsAppTestDeploy(activeAgent.id, activePrompt?.id);
    } catch (e: any) { setError(e.message || 'Failed to create WhatsApp deploy'); }
    setBusy(null);
  };

  const downloadPromptfoo = async () => {
    if (!activeAgent) return;
    setBusy('promptfoo');
    try {
      const config = await getPromptfooConfig(activeAgent.id, activePrompt?.id);
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeAgent.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-promptfoo.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setError(e.message || 'Failed to export promptfoo config'); }
    setBusy(null);
  };

  const sandbox = async () => {
    if (!sandboxInput.trim()) return;
    const userText = sandboxInput.trim();
    setSandboxMessages(prev => [...prev, { role: 'user', content: userText }, { role: 'assistant', content: '' }]);
    setSandboxInput('');
    setBusy('sandbox');
    try {
      await streamChat(
        {
          message: userText,
          agent_id: orgId,
          session_id: sandboxSessionId,
          language,
          customer_id: activeAgent?.customer_id || selectedCustomerId,
          agent_definition_id: activeAgent?.id,
        },
        meta => setSandboxSessionId(meta.session_id),
        token => setSandboxMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant') last.content += token;
          return next;
        }),
        () => setBusy(null),
      );
    } catch {
      setSandboxMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') last.content = 'Sandbox request failed.';
        return next;
      });
      setBusy(null);
    }
  };

  const specPreview = useMemo(() => activeSpec ? JSON.stringify(activeSpec.spec, null, 2) : '', [activeSpec]);

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="w-80 border-r border-zinc-800/50 bg-zinc-950 p-4 space-y-4 overflow-y-auto">
        <div>
          <h2 className="text-[15px] font-semibold text-white">{language === 'fi' ? 'Agenttirakentaja' : 'Agent Builder'}</h2>
          <p className="text-xs text-zinc-500 mt-1">{activeCustomer ? activeCustomer.name : 'Org-wide'}</p>
        </div>
        <div className="p-3 bg-zinc-900 rounded-xl border border-zinc-800 space-y-2">
          <input
            value={agentName}
            onChange={e => setAgentName(e.target.value)}
            placeholder={language === 'fi' ? 'Agentin nimi' : 'Agent name'}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none"
          />
          <button onClick={createAgent} disabled={!agentName.trim() || busy === 'agent'} className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 text-white rounded-lg px-3 py-2 text-sm">
            {busy === 'agent' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {language === 'fi' ? 'Luo agentti' : 'Create agent'}
          </button>
        </div>
        {agents.map(agent => (
          <button
            key={agent.id}
            onClick={() => onSelectAgent(agent.id)}
            className={`w-full text-left p-3 rounded-xl border ${agent.id === selectedAgentId ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'}`}
          >
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-indigo-400" />
              <p className="text-sm text-white truncate">{agent.name}</p>
            </div>
            <p className="text-xs text-zinc-500 mt-1 truncate">{agent.customer_id ? customers.find(c => c.id === agent.customer_id)?.name || agent.customer_id : 'Org-wide'}</p>
          </button>
        ))}
      </aside>

      <main className="flex-1 overflow-y-auto p-6 space-y-5">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm flex items-start justify-between gap-3">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-300/70 hover:text-red-200">Dismiss</button>
          </div>
        )}
        {!activeAgent && (
          <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
            {language === 'fi' ? 'Luo agentti aloittaaksesi.' : 'Create an agent to start.'}
          </div>
        )}

        {activeAgent && (
          <>
            <section className="grid grid-cols-2 gap-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">1. Discovery to work spec</h3>
                <textarea
                  value={discoveryText}
                  onChange={e => setDiscoveryText(e.target.value)}
                  placeholder="Paste meeting summary, transcript, or customer brief..."
                  className="w-full h-40 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-white outline-none"
                />
                <button onClick={makeSpec} disabled={!discoveryText.trim() || busy === 'spec'} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 text-white rounded-lg px-4 py-2 text-sm">
                  {busy === 'spec' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Generate spec
                </button>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-white mb-3">Latest work spec</h3>
                <pre className="h-56 overflow-auto text-xs text-zinc-300 whitespace-pre-wrap bg-zinc-950 rounded-lg p-3 border border-zinc-800">{specPreview || 'No spec yet.'}</pre>
              </div>
            </section>

            <section className="grid grid-cols-3 gap-4">
              <ActionCard icon={MessageSquare} title="2. Prompt + tools" count={`${prompts.length} prompts / ${tools.length} tools`} onClick={makePromptAndTools} disabled={!activeSpec || busy === 'prompt'} busy={busy === 'prompt'} />
              <ActionCard icon={FlaskConical} title="3. Generate tests" count={`${tests.length} cases`} onClick={makeTests} disabled={!activeSpec || !activePrompt || busy === 'tests'} busy={busy === 'tests'} />
              <ActionCard icon={Play} title="4. Run tests" count={lastRun ? `${lastRun.pass_count} passed / ${lastRun.fail_count} failed` : 'No run yet'} onClick={runTests} disabled={!tests.length || busy === 'run'} busy={busy === 'run'} />
            </section>

            <section className="grid grid-cols-2 gap-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">Generated test cases</h3>
                <div className="max-h-72 overflow-y-auto space-y-2">
                  {tests.length === 0 && <p className="text-xs text-zinc-600">No tests generated yet.</p>}
                  {tests.map(test => (
                    <div key={test.id} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-zinc-200 truncate">{test.scenario || 'Untitled scenario'}</p>
                        <span className="text-[10px] uppercase tracking-wide text-indigo-300 bg-indigo-500/10 rounded-full px-2 py-0.5">{test.category}</span>
                      </div>
                      <p className="text-xs text-zinc-500 mt-2">{test.pass_criteria?.slice(0, 2).join(' · ')}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">Latest test run</h3>
                {!lastRun && <p className="text-xs text-zinc-600">Run tests to see transcripts and judge output.</p>}
                {lastRun && (
                  <div className="space-y-3 max-h-72 overflow-y-auto">
                    <div className="text-xs text-zinc-400">
                      {lastRun.pass_count} passed / {lastRun.fail_count} failed
                    </div>
                    {lastRun.results.map((result: any, idx: number) => (
                      <div key={idx} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className={result.passed ? 'text-green-400 text-xs' : 'text-red-400 text-xs'}>
                            {result.passed ? 'Passed' : 'Failed'}
                          </span>
                          <span className="text-xs text-zinc-600">Score {result.judge?.score_0_to_5 ?? '-'}/5</span>
                        </div>
                        {(result.conversation_log || []).map((turn: any, turnIdx: number) => (
                          <div key={turnIdx} className="space-y-1">
                            <p className="text-xs text-indigo-300">User: {turn.user}</p>
                            <p className="text-xs text-zinc-300 whitespace-pre-wrap">Agent: {turn.assistant}</p>
                          </div>
                        ))}
                        {result.judge?.reasoning && <p className="text-xs text-zinc-500">{result.judge.reasoning}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="grid grid-cols-2 gap-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Sandbox playground</h3>
                  <button
                    onClick={() => { setSandboxMessages([]); setSandboxSessionId(undefined); }}
                    className="text-[11px] text-zinc-600 hover:text-zinc-400"
                  >
                    New memory
                  </button>
                </div>
                <div className="h-64 overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-3">
                  {sandboxMessages.length === 0 && (
                    <p className="text-xs text-zinc-600">Chat with the generated agent. This keeps memory until you click New memory.</p>
                  )}
                  {sandboxMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                        msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-md' : 'bg-zinc-900 text-zinc-200 border border-zinc-800 rounded-tl-md'
                      }`}>
                        {msg.content || (busy === 'sandbox' && idx === sandboxMessages.length - 1 ? 'Thinking...' : '')}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={sandboxInput}
                    onChange={e => setSandboxInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sandbox()}
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none"
                    placeholder="Ask the generated agent..."
                  />
                  <button onClick={sandbox} disabled={busy === 'sandbox'} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg"><Send size={15} /></button>
                </div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">Deploy</h3>
                <p className="text-xs text-zinc-500">Creates a WhatsApp deployment record for the provider adapter to claim.</p>
                <button onClick={downloadPromptfoo} disabled={!tests.length || busy === 'promptfoo'} className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 text-white rounded-lg px-4 py-2 text-sm">
                  {busy === 'promptfoo' ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} Export promptfoo config
                </button>
                <button onClick={deployWhatsApp} disabled={!activePrompt || busy === 'whatsapp'} className="flex items-center gap-2 bg-green-600 hover:bg-green-500 disabled:bg-zinc-800 text-white rounded-lg px-4 py-2 text-sm">
                  {busy === 'whatsapp' ? <Loader2 size={14} className="animate-spin" /> : <Wrench size={14} />} Create WhatsApp test deploy
                </button>
                {lastRun?.blind_spot_report && (
                  <pre className="max-h-48 overflow-auto text-xs text-zinc-300 whitespace-pre-wrap bg-zinc-950 rounded-lg p-3 border border-zinc-800">{JSON.stringify(lastRun.blind_spot_report, null, 2)}</pre>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function ActionCard({
  icon: Icon,
  title,
  count,
  onClick,
  disabled,
  busy,
}: {
  icon: LucideIcon;
  title: string;
  count: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className="text-left bg-zinc-900 border border-zinc-800 hover:border-zinc-700 disabled:opacity-50 rounded-xl p-4">
      <div className="flex items-center gap-2 text-white text-sm font-semibold">
        {busy ? <Loader2 size={16} className="animate-spin text-indigo-400" /> : <Icon size={16} className="text-indigo-400" />}
        {title}
      </div>
      <p className="text-xs text-zinc-500 mt-2">{count}</p>
    </button>
  );
}
