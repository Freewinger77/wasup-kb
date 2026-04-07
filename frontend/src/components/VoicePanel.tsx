import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Mic, Square, Copy, Check, Volume2, VolumeX, Sparkles, User } from 'lucide-react';
import { streamChat, synthesizeSpeech, type Language } from '../services/api';

interface Props {
  agentId: string;
  language: Language;
}

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Entry {
  role: 'user' | 'assistant';
  text: string;
  partial?: boolean;
}

const LANG_MAP: Record<string, string> = { en: 'en-US', fi: 'fi-FI' };
const VAD_THRESHOLD = 15;
const SILENCE_MS = 1400;
const INTERRUPT_FRAMES = 5;

export default function VoicePanel({ agentId, language }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [liveText, setLiveText] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);

  const phaseRef = useRef<Phase>('idle');
  const autoSpeakRef = useRef(true);
  const recognitionRef = useRef<any>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const vadRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastVoiceRef = useRef(0);
  const hadVoiceRef = useRef(false);
  const vadFiredRef = useRef(false);
  const pendingRef = useRef('');
  const interruptCountRef = useRef(0);

  const setP = useCallback((p: Phase) => { phaseRef.current = p; setPhase(p); }, []);
  useEffect(() => { autoSpeakRef.current = autoSpeak; }, [autoSpeak]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [entries, liveText]);

  // ---- Interrupt: stop TTS and resume listening ----
  function doInterrupt() {
    if (audioElRef.current) {
      audioElRef.current.onended = null;
      audioElRef.current.onerror = null;
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    interruptCountRef.current = 0;
    doResume();
  }

  // ---- TTS ----
  const doSpeak = useCallback(async (text: string) => {
    if (!text.trim()) { doResume(); return; }
    setP('speaking');
    interruptCountRef.current = 0;
    try {
      const blob = await synthesizeSpeech(text, language);
      if (phaseRef.current !== 'speaking') return;
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      audioElRef.current = a;
      const done = () => {
        URL.revokeObjectURL(url);
        audioElRef.current = null;
        if (phaseRef.current === 'speaking') doResume();
      };
      a.onended = done;
      a.onerror = done;
      await a.play();
    } catch {
      if (phaseRef.current === 'speaking') doResume();
    }
  }, [language]);
  const doSpeakRef = useRef(doSpeak);
  useEffect(() => { doSpeakRef.current = doSpeak; }, [doSpeak]);

  // ---- Send to RAG chat (with voice_mode) ----
  const doSend = useCallback((text: string) => {
    if (!text.trim()) return;
    setP('thinking');
    doPause();
    setLiveText('');
    pendingRef.current = '';

    setEntries(prev => [...prev, { role: 'user', text }]);
    let full = '';
    let aidx = -1;

    streamChat(
      { message: text, agent_id: agentId, session_id: sessionRef.current, language, voice_mode: true },
      (meta) => {
        sessionRef.current = meta.session_id;
        setEntries(prev => { aidx = prev.length; return [...prev, { role: 'assistant', text: '', partial: true }]; });
      },
      (tok) => {
        full += tok;
        setEntries(prev => {
          const u = [...prev];
          if (aidx >= 0 && aidx < u.length) u[aidx] = { ...u[aidx], text: full };
          return u;
        });
      },
      () => {
        setEntries(prev => {
          const u = [...prev];
          if (aidx >= 0 && aidx < u.length) u[aidx] = { role: 'assistant', text: full, partial: false };
          return u;
        });
        if (phaseRef.current === 'idle') return;
        if (autoSpeakRef.current && full.trim()) {
          doSpeakRef.current(full);
        } else {
          doResume();
        }
      },
    ).catch(() => {
      setEntries(prev => [...prev, { role: 'assistant', text: 'Error getting response.' }]);
      if (phaseRef.current !== 'idle') doResume();
    });
  }, [agentId, language]);
  const doSendRef = useRef(doSend);
  useEffect(() => { doSendRef.current = doSend; }, [doSend]);

  // ---- Recognition helpers ----
  function newRecognition() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = LANG_MAP[language] || 'en-US';
    r.onresult = (e: any) => {
      let fin = '', int = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript;
        else int += e.results[i][0].transcript;
      }
      pendingRef.current = fin + int;
      setLiveText(fin + int);
    };
    r.onerror = (e: any) => {
      if (e.error === 'not-allowed') { setError('Microphone access denied.'); doStop(); }
    };
    r.onend = () => {
      if (phaseRef.current === 'listening') { try { r.start(); } catch {} }
    };
    return r;
  }

  function doPause() {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
  }

  function doResume() {
    if (phaseRef.current === 'idle') return;
    setP('listening');
    setLiveText('');
    pendingRef.current = '';
    hadVoiceRef.current = false;
    vadFiredRef.current = false;
    lastVoiceRef.current = 0;
    interruptCountRef.current = 0;

    const r = newRecognition();
    if (r) { recognitionRef.current = r; try { r.start(); } catch {} }
  }

  // ---- VAD ----
  function startVAD(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.3;
      src.connect(an);
      ctxRef.current = ctx;

      const buf = new Uint8Array(an.frequencyBinCount);

      vadRef.current = setInterval(() => {
        an.getByteFrequencyData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += buf[i];
        const avg = s / buf.length;
        const now = Date.now();
        const currentPhase = phaseRef.current;

        // Interrupt: if user speaks while AI is talking
        if (currentPhase === 'speaking') {
          if (avg > VAD_THRESHOLD * 1.5) {
            interruptCountRef.current++;
            if (interruptCountRef.current >= INTERRUPT_FRAMES) {
              doInterrupt();
            }
          } else {
            interruptCountRef.current = Math.max(0, interruptCountRef.current - 1);
          }
          return;
        }

        if (currentPhase !== 'listening') return;

        if (avg > VAD_THRESHOLD) {
          lastVoiceRef.current = now;
          hadVoiceRef.current = true;
          vadFiredRef.current = false;
        }

        if (hadVoiceRef.current && !vadFiredRef.current && lastVoiceRef.current > 0 && now - lastVoiceRef.current > SILENCE_MS) {
          vadFiredRef.current = true;
          hadVoiceRef.current = false;
          const t = pendingRef.current.trim();
          if (t) {
            pendingRef.current = '';
            doSendRef.current(t);
          }
        }
      }, 60);
    } catch {}
  }

  function stopVAD() {
    if (vadRef.current) { clearInterval(vadRef.current); vadRef.current = null; }
    if (ctxRef.current) { ctxRef.current.close().catch(() => {}); ctxRef.current = null; }
  }

  // ---- Start / Stop ----
  const doStart = useCallback(async () => {
    setError('');
    setEntries([]);
    setLiveText('');
    pendingRef.current = '';
    sessionRef.current = undefined;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setError('Speech recognition not supported. Use Chrome or Edge.'); return; }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startVAD(stream);
      setP('listening');
      const rec = newRecognition();
      if (rec) { recognitionRef.current = rec; rec.start(); }
    } catch {
      setError('Could not access microphone.');
    }
  }, [language]);

  function doStop() {
    setP('idle');
    setLiveText('');
    pendingRef.current = '';
    doPause();
    stopVAD();
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (audioElRef.current) { audioElRef.current.onended = null; audioElRef.current.pause(); audioElRef.current = null; }
  }

  const toggleRef = useRef(() => {});
  toggleRef.current = () => { if (phaseRef.current === 'idle') doStart(); else doStop(); };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey) && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => () => doStop(), []);

  const active = phase !== 'idle';
  const isMac = useMemo(() => /(Mac|iPhone)/i.test(navigator.userAgent), []);
  const sc = isMac ? '⌘K' : 'Ctrl+K';

  const handleCopy = () => {
    const t = entries.map(e => `${e.role === 'user' ? 'You' : 'AI'}: ${e.text}`).join('\n');
    navigator.clipboard.writeText(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative flex flex-col h-full overflow-hidden bg-zinc-950">
      {active && (
        <div className="absolute inset-0 pointer-events-none">
          <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[350px] rounded-full blur-[140px] transition-colors duration-1000 ${
            phase === 'speaking' ? 'bg-indigo-600/40' :
            phase === 'thinking' ? 'bg-amber-600/30' :
            'bg-indigo-500/20'
          }`} />
        </div>
      )}

      <div className="relative z-10 flex flex-col h-full">
        {active ? (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
              <div className="max-w-2xl mx-auto space-y-4">
                {entries.length === 0 && !liveText && (
                  <div className="flex flex-col items-center justify-center h-[40vh]">
                    <div className="relative mb-6">
                      <div className="w-3 h-3 rounded-full bg-emerald-500" />
                      <div className="absolute inset-0 w-3 h-3 rounded-full bg-emerald-500 animate-ping opacity-40" />
                    </div>
                    <p className="text-sm text-zinc-400">
                      {language === 'fi' ? 'Kuuntelen... puhu nyt' : 'Listening... speak now'}
                    </p>
                  </div>
                )}

                {entries.map((e, i) => (
                  <div key={i} className="animate-fade-in">
                    <div className="flex gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                        e.role === 'user' ? 'bg-white/10 ring-1 ring-white/20' : 'bg-indigo-500/20 ring-1 ring-indigo-500/30'
                      }`}>
                        {e.role === 'user'
                          ? <User size={13} className="text-white/70" />
                          : <Sparkles size={13} className="text-indigo-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-zinc-500 mb-1 uppercase tracking-wider">
                          {e.role === 'user' ? (language === 'fi' ? 'Sinä' : 'You') : 'AI'}
                        </p>
                        <p className={`text-[14px] leading-relaxed ${e.role === 'user' ? 'text-white/90' : 'text-zinc-300'}`}>
                          {e.text}
                          {e.partial && <span className="inline-block w-1.5 h-4 bg-indigo-400 ml-0.5 animate-pulse rounded-sm" />}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}

                {liveText && (
                  <div className="animate-fade-in">
                    <div className="flex gap-3">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-white/10 ring-1 ring-white/20">
                        <User size={13} className="text-white/70" />
                      </div>
                      <div className="flex-1">
                        <p className="text-[11px] font-medium text-zinc-500 mb-1 uppercase tracking-wider">
                          {language === 'fi' ? 'Sinä' : 'You'}
                        </p>
                        <p className="text-[14px] leading-relaxed text-white/60">
                          {liveText}
                          <span className="inline-block w-1.5 h-4 bg-white/40 ml-0.5 animate-pulse rounded-sm" />
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="relative z-10 flex items-center justify-between px-6 py-4 border-t border-white/5">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                  phase === 'listening' ? 'bg-emerald-500' :
                  phase === 'thinking' ? 'bg-amber-500' :
                  phase === 'speaking' ? 'bg-indigo-500' : 'bg-zinc-600'
                }`} />
                <span className="text-xs text-zinc-400">
                  {phase === 'listening' && (language === 'fi' ? 'Kuuntelen...' : 'Listening...')}
                  {phase === 'thinking' && (language === 'fi' ? 'Ajatellaan...' : 'Thinking...')}
                  {phase === 'speaking' && (language === 'fi' ? 'Puhuu... (keskeytä puhumalla)' : 'Speaking... (interrupt by talking)')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setAutoSpeak(!autoSpeak)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    autoSpeak ? 'bg-indigo-500/15 text-indigo-400 ring-1 ring-indigo-500/30' : 'bg-white/5 text-zinc-500 ring-1 ring-white/10'
                  }`}>
                  {autoSpeak ? <Volume2 size={12} /> : <VolumeX size={12} />}
                  TTS
                </button>
                {entries.length > 0 && (
                  <button onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:bg-white/10 transition-all">
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
                <button onClick={doStop}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400 ring-1 ring-red-500/30 hover:bg-red-500/25 transition-all">
                  <Square size={10} className="fill-current" />
                  Stop
                  <span className="text-[10px] opacity-60 ml-1 font-mono">{sc}</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <button onClick={doStart}
              className="flex items-center gap-3 px-10 py-4 rounded-full bg-white text-zinc-900 font-medium text-sm hover:bg-zinc-100 active:scale-95 transition-all">
              <Mic size={18} />
              {language === 'fi' ? 'Aloita puhuminen' : 'Start Talking'}
              <span className="text-xs opacity-40 font-mono">{sc}</span>
            </button>
            {error && (
              <div className="absolute bottom-20 px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
