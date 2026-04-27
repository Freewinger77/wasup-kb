import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
import {
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Plus,
  Film,
  Tv,
  X,
} from 'lucide-react';
import type { Language } from '../services/api';
import type { Customer, KnowledgeScope } from '../services/api';

interface VideoResult {
  video_id: string;
  title: string;
  status: string;
  chunks_created: number;
  transcript_length: number;
}

interface ChannelJob {
  job_id: string;
  channel_url: string;
  status: string;
  total_videos: number;
  processed_videos: number;
  results: VideoResult[];
  error?: string | null;
}

interface Props {
  agentId: string;
  language: Language;
  customers?: Customer[];
  selectedCustomerId?: string;
  selectedAgentId?: string;
}

export default function YouTubePanel({ agentId, language, customers = [], selectedCustomerId, selectedAgentId }: Props) {
  const { getToken } = useAuth();
  const [tab, setTab] = useState<'video' | 'channel'>('video');
  const [videoUrl, setVideoUrl] = useState('');
  const [channelUrl, setChannelUrl] = useState('');
  const [maxVideos, setMaxVideos] = useState(30);
  const [isProcessing, setIsProcessing] = useState(false);
  const [videoResults, setVideoResults] = useState<VideoResult[]>([]);
  const [channelJobs, setChannelJobs] = useState<ChannelJob[]>([]);
  const [scope, setScope] = useState<KnowledgeScope>(selectedCustomerId ? 'customer' : 'org_wide');
  const [customerId, setCustomerId] = useState(selectedCustomerId || '');
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const getAuthHeaders = useCallback(async (contentType?: string): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, [getToken]);

  const startPolling = useCallback((jobId: string) => {
    if (pollTimers.current.has(jobId)) return;
    const timer = setInterval(async () => {
      try {
        const pollHeaders = await getAuthHeaders();
        const statusRes = await fetch(`/api/youtube/channel/${jobId}`, { headers: pollHeaders });
        if (statusRes.ok) {
          const updated: ChannelJob = await statusRes.json();
          setChannelJobs(prev => prev.map(j => j.job_id === jobId ? updated : j));
          if (updated.status === 'completed' || updated.status === 'error') {
            clearInterval(timer);
            pollTimers.current.delete(jobId);
          }
        }
      } catch { /* ignore */ }
    }, 4000);
    pollTimers.current.set(jobId, timer);
  }, [getAuthHeaders]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        const token = await getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('/api/youtube/channel-jobs', { headers });
        if (!res.ok || cancelled) return;
        const jobs: ChannelJob[] = await res.json();
        setChannelJobs(prev => {
          const ids = new Set(jobs.map(j => j.job_id));
          const pendingLocal = prev.filter(j => !ids.has(j.job_id));
          return [...pendingLocal, ...jobs];
        });
        for (const j of jobs) {
          if (j.status !== 'completed' && j.status !== 'error') {
            startPolling(j.job_id);
          }
        }
      } catch { /* ignore */ }
    })();
    return () => {
      cancelled = true;
      pollTimers.current.forEach(t => clearInterval(t));
      pollTimers.current.clear();
    };
  }, [agentId, getToken, startPolling]);

  const handleVideoSubmit = async () => {
    if (!videoUrl.trim()) return;
    if (scope === 'customer' && !customerId) return;
    setIsProcessing(true);
    try {
      const res = await fetch('/api/youtube/video', {
        method: 'POST',
        headers: await getAuthHeaders('application/json'),
        body: JSON.stringify({
          url: videoUrl,
          agent_id: agentId,
          language,
          scope,
          customer_id: scope === 'customer' ? customerId : null,
          agent_definition_id: selectedAgentId || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setVideoResults(prev => [{
          video_id: '', title: videoUrl,
          status: `error: ${err.detail || res.statusText}`,
          chunks_created: 0, transcript_length: 0,
        }, ...prev]);
      } else {
        const data: VideoResult = await res.json();
        setVideoResults(prev => [data, ...prev]);
      }
      setVideoUrl('');
    } catch (e: any) {
      setVideoResults(prev => [{
        video_id: '', title: videoUrl,
        status: `error: ${e.message}`,
        chunks_created: 0, transcript_length: 0,
      }, ...prev]);
    }
    setIsProcessing(false);
  };

  const handleChannelSubmit = async () => {
    if (!channelUrl.trim()) return;
    if (scope === 'customer' && !customerId) return;
    setIsProcessing(true);
    try {
      const res = await fetch('/api/youtube/channel', {
        method: 'POST',
        headers: await getAuthHeaders('application/json'),
        body: JSON.stringify({
          url: channelUrl,
          agent_id: agentId,
          language,
          max_videos: maxVideos,
          scope,
          customer_id: scope === 'customer' ? customerId : null,
          agent_definition_id: selectedAgentId || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: ChannelJob = await res.json();
      setChannelJobs(prev => [data, ...prev]);
      setChannelUrl('');

      startPolling(data.job_id);
    } catch {}
    setIsProcessing(false);
  };

  const statusIcon = (status: string) => {
    if (status === 'success') return <CheckCircle size={16} className="text-green-500" />;
    if (status.startsWith('error')) return <XCircle size={16} className="text-red-500" />;
    if (status === 'no_transcript') return <AlertTriangle size={16} className="text-yellow-500" />;
    return <Loader2 size={16} className="animate-spin text-blue-400" />;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-zinc-800/40">
        <h2 className="text-[15px] font-semibold text-white">
          {language === 'fi' ? 'YouTube-tuonti' : 'YouTube Import'}
        </h2>
        <p className="text-xs text-zinc-500 mt-1">
          {language === 'fi'
            ? 'Tuo videoiden tekstit tietokantaan'
            : 'Import video transcripts into the knowledge base'}
        </p>
      </div>

      <div className="flex gap-1 mx-6 mt-4 bg-zinc-800/60 rounded-lg p-1">
        <button
          onClick={() => setTab('video')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${
            tab === 'video' ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Film size={16} />
          {language === 'fi' ? 'Yksittäinen video' : 'Single Video'}
        </button>
        <button
          onClick={() => setTab('channel')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${
            tab === 'channel' ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Tv size={16} />
          {language === 'fi' ? 'Kanava' : 'Channel'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <div className="flex gap-3">
          <select value={scope} onChange={e => setScope(e.target.value as KnowledgeScope)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none">
            <option value="org_wide">{language === 'fi' ? 'Organisaation yhteinen' : 'Org-wide'}</option>
            <option value="customer">{language === 'fi' ? 'Asiakas' : 'Customer'}</option>
          </select>
          {scope === 'customer' && (
            <select value={customerId} onChange={e => setCustomerId(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none">
              <option value="">{language === 'fi' ? 'Valitse asiakas' : 'Select customer'}</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        {tab === 'video' && (
          <>
            <div className="flex gap-3">
              <input
                type="text"
                value={videoUrl}
                onChange={e => setVideoUrl(e.target.value)}
                placeholder={language === 'fi' ? 'YouTube-videon URL...' : 'Paste YouTube video URL...'}
                className="flex-1 bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition-all"
                onKeyDown={e => e.key === 'Enter' && handleVideoSubmit()}
              />
              <button
                onClick={handleVideoSubmit}
                disabled={!videoUrl.trim() || isProcessing}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-xl text-sm font-medium transition-all"
              >
                {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {language === 'fi' ? 'Tuo' : 'Import'}
              </button>
            </div>

            {videoResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-500">{videoResults.length} {language === 'fi' ? 'videota' : 'videos'}</span>
                  <button onClick={() => setVideoResults([])} className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors">
                    {language === 'fi' ? 'Tyhjennä' : 'Clear all'}
                  </button>
                </div>
                {videoResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-zinc-800/40 rounded-xl border border-zinc-800/60">
                    {statusIcon(r.status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{r.title}</p>
                      <p className="text-xs text-zinc-500">
                        {r.status === 'success'
                          ? `${r.chunks_created} chunks | ${(r.transcript_length / 1000).toFixed(1)}k chars`
                          : r.status}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {videoResults.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
                <Film size={48} className="mb-3 opacity-40" />
                <p className="text-sm">
                  {language === 'fi'
                    ? 'Liitä videon URL aloittaaksesi'
                    : 'Paste a video URL to import its transcript'}
                </p>
              </div>
            )}
          </>
        )}

        {tab === 'channel' && (
          <>
            <div className="space-y-3">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={channelUrl}
                  onChange={e => setChannelUrl(e.target.value)}
                  placeholder={language === 'fi' ? 'YouTube-kanavan URL...' : 'Paste YouTube channel URL...'}
                  className="flex-1 bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition-all"
                />
                <button
                  onClick={handleChannelSubmit}
                  disabled={!channelUrl.trim() || isProcessing}
                  className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-xl text-sm font-medium transition-all"
                >
                  {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  {language === 'fi' ? 'Skannaa' : 'Scan'}
                </button>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-zinc-500">
                  {language === 'fi' ? 'Max videoita:' : 'Max videos:'}
                </label>
                <input
                  type="number"
                  value={maxVideos}
                  onChange={e => setMaxVideos(Math.max(1, Math.min(500, parseInt(e.target.value) || 30)))}
                  className="w-20 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-red-500/50"
                />
              </div>
            </div>

            {channelJobs.some(j => !['completed', 'error'].includes(j.status)) && (
              <p className="text-[11px] text-zinc-600 text-center">
                {language === 'fi'
                  ? 'Käsittely jatkuu taustalla vaikka poistuisit sivulta'
                  : 'Processing continues in the background even if you leave this page'}
              </p>
            )}

            {channelJobs.map((job) => {
              const isDone = job.status === 'completed' || job.status === 'error';
              const successCount = job.results.filter(r => r.status === 'success').length;
              return (
                <div key={job.job_id} className="p-4 bg-zinc-800/40 rounded-xl border border-zinc-800/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Tv size={18} className="text-red-400 shrink-0" />
                      <span className="text-sm text-zinc-200 truncate">{job.channel_url}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isDone ? (
                        job.status === 'completed' ? <CheckCircle size={18} className="text-green-500" /> : <XCircle size={18} className="text-red-500" />
                      ) : (
                        <Loader2 size={18} className="animate-spin text-blue-400" />
                      )}
                      {isDone && (
                        <button
                          onClick={() => setChannelJobs(prev => prev.filter(j => j.job_id !== job.job_id))}
                          className="p-1 text-zinc-600 hover:text-zinc-400 transition-colors rounded"
                          title="Dismiss"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-zinc-500">
                    <span>{job.status}</span>
                    <span>{job.processed_videos}/{job.total_videos} videos</span>
                    <span>{successCount} transcribed</span>
                  </div>
                  {job.error && (
                    <p className="text-[11px] text-red-400/90 break-words">{job.error}</p>
                  )}

                  {job.total_videos > 0 && !isDone && (
                    <div className="w-full bg-zinc-700 rounded-full h-1.5">
                      <div
                        className="bg-red-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${(job.processed_videos / job.total_videos) * 100}%` }}
                      />
                    </div>
                  )}

                  {job.results.length > 0 && (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {job.results.map((r, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          {statusIcon(r.status)}
                          <span className="text-zinc-300 truncate flex-1">{r.title}</span>
                          {r.chunks_created > 0 && (
                            <span className="text-zinc-500">{r.chunks_created} chunks</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {channelJobs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
                <Tv size={48} className="mb-3 opacity-40" />
                <p className="text-sm">
                  {language === 'fi'
                    ? 'Liitä kanavan URL aloittaaksesi'
                    : 'Paste a channel URL to scan its videos'}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
