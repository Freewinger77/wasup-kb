import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import {
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Plus,
  Film,
  Tv,
  Cookie,
  Upload,
} from 'lucide-react';
import type { Language } from '../services/api';

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
}

interface Props {
  agentId: string;
  language: Language;
}

export default function YouTubePanel({ agentId, language }: Props) {
  const { getToken } = useAuth();
  const [tab, setTab] = useState<'video' | 'channel'>('video');
  const [videoUrl, setVideoUrl] = useState('');
  const [channelUrl, setChannelUrl] = useState('');
  const [maxVideos, setMaxVideos] = useState(30);
  const [isProcessing, setIsProcessing] = useState(false);
  const [videoResults, setVideoResults] = useState<VideoResult[]>([]);
  const [channelJobs, setChannelJobs] = useState<ChannelJob[]>([]);
  const [hasCookies, setHasCookies] = useState<boolean | null>(null);
  const [cookieText, setCookieText] = useState('');
  const [cookieStatus, setCookieStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  async function getAuthHeaders(contentType?: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  useEffect(() => {
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fetch('/api/youtube/cookies/status', { headers });
        const d = await r.json();
        setHasCookies(d.has_cookies);
      } catch {}
    })();
    return () => {
      pollTimers.current.forEach(t => clearInterval(t));
    };
  }, []);

  const handleCookieUpload = async () => {
    if (!cookieText.trim()) return;
    setCookieStatus('saving');
    try {
      const res = await fetch('/api/youtube/cookies', {
        method: 'POST',
        headers: await getAuthHeaders('application/json'),
        body: JSON.stringify({ cookies_txt: cookieText }),
      });
      if (res.ok) {
        setCookieStatus('saved');
        setHasCookies(true);
        setCookieText('');
      } else {
        setCookieStatus('error');
      }
    } catch {
      setCookieStatus('error');
    }
  };

  const handleCookieFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCookieText(reader.result as string);
    reader.readAsText(file);
  };

  const handleVideoSubmit = async () => {
    if (!videoUrl.trim()) return;
    setIsProcessing(true);
    try {
      const res = await fetch('/api/youtube/video', {
        method: 'POST',
        headers: await getAuthHeaders('application/json'),
        body: JSON.stringify({ url: videoUrl, agent_id: agentId, language }),
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
    setIsProcessing(true);
    try {
      const res = await fetch('/api/youtube/channel', {
        method: 'POST',
        headers: await getAuthHeaders('application/json'),
        body: JSON.stringify({ url: channelUrl, agent_id: agentId, language, max_videos: maxVideos }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: ChannelJob = await res.json();
      setChannelJobs(prev => [data, ...prev]);
      setChannelUrl('');

      const timer = setInterval(async () => {
        try {
          const pollHeaders = await getAuthHeaders();
          const statusRes = await fetch(`/api/youtube/channel/${data.job_id}`, { headers: pollHeaders });
          if (statusRes.ok) {
            const updated: ChannelJob = await statusRes.json();
            setChannelJobs(prev => prev.map(j => j.job_id === data.job_id ? updated : j));
            if (updated.status === 'completed' || updated.status === 'error') {
              clearInterval(timer);
              pollTimers.current.delete(data.job_id);
            }
          }
        } catch {}
      }, 4000);
      pollTimers.current.set(data.job_id, timer);
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
      <div className="px-6 py-4 border-b border-slate-700">
        <h2 className="text-lg font-semibold text-white">
          {language === 'fi' ? 'YouTube-tuonti' : 'YouTube Import'}
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          {language === 'fi'
            ? 'Tuo videoiden tekstit tietokantaan'
            : 'Import video transcripts into the knowledge base'}
        </p>
      </div>

      {/* Cookie Auth */}
      {hasCookies === false && (
        <div className="mx-6 mt-4 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-3">
          <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
            <Cookie size={16} />
            {language === 'fi' ? 'YouTube-evästeet vaaditaan' : 'YouTube Cookies Required'}
          </div>
          <p className="text-xs text-slate-400">
            {language === 'fi'
              ? 'YouTube estää palvelinpyynnöt. Lataa evästetiedosto selaimestasi (kirjautuneena YouTubeen) mahdollistaaksesi transkription.'
              : 'YouTube blocks server requests. Upload a cookies.txt file from your browser (while logged into YouTube) to enable transcription.'}
          </p>
          <ol className="text-xs text-slate-500 list-decimal list-inside space-y-1">
            <li>{language === 'fi' ? 'Asenna' : 'Install'} <a href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc" target="_blank" rel="noreferrer" className="text-amber-400 underline">Get cookies.txt LOCALLY</a> {language === 'fi' ? 'Chrome-laajennus' : 'Chrome extension'}</li>
            <li>{language === 'fi' ? 'Mene' : 'Go to'} youtube.com {language === 'fi' ? 'ja kirjaudu sisään' : 'and make sure you are logged in'}</li>
            <li>{language === 'fi' ? 'Napsauta laajennusta ja vie evästeet' : 'Click the extension and export cookies'}</li>
            <li>{language === 'fi' ? 'Lataa .txt-tiedosto tähän' : 'Upload the .txt file here'}</li>
          </ol>
          <div className="flex gap-2">
            <label className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm text-slate-300 cursor-pointer transition-all">
              <Upload size={14} />
              {language === 'fi' ? 'Valitse tiedosto' : 'Choose file'}
              <input type="file" accept=".txt" className="hidden" onChange={handleCookieFile} />
            </label>
            {cookieText && (
              <button
                onClick={handleCookieUpload}
                disabled={cookieStatus === 'saving'}
                className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              >
                {cookieStatus === 'saving' ? 'Saving...' : language === 'fi' ? 'Tallenna' : 'Save'}
              </button>
            )}
          </div>
          {cookieStatus === 'saved' && (
            <p className="text-xs text-green-400">Cookies saved successfully!</p>
          )}
          {cookieStatus === 'error' && (
            <p className="text-xs text-red-400">Failed to save cookies</p>
          )}
        </div>
      )}
      {hasCookies === true && (
        <div className="mx-6 mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-xl flex items-center gap-2 text-green-400 text-xs">
          <CheckCircle size={14} />
          {language === 'fi' ? 'YouTube-evästeet konfiguroitu' : 'YouTube cookies configured'}
        </div>
      )}

      {/* Tab Toggle */}
      <div className="flex gap-1 mx-6 mt-4 bg-slate-800 rounded-lg p-1">
        <button
          onClick={() => setTab('video')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${
            tab === 'video' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Film size={16} />
          {language === 'fi' ? 'Yksittäinen video' : 'Single Video'}
        </button>
        <button
          onClick={() => setTab('channel')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${
            tab === 'channel' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Tv size={16} />
          {language === 'fi' ? 'Kanava' : 'Channel'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {tab === 'video' && (
          <>
            <div className="flex gap-3">
              <input
                type="text"
                value={videoUrl}
                onChange={e => setVideoUrl(e.target.value)}
                placeholder={language === 'fi' ? 'YouTube-videon URL...' : 'YouTube video URL...'}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500 transition-all"
                onKeyDown={e => e.key === 'Enter' && handleVideoSubmit()}
              />
              <button
                onClick={handleVideoSubmit}
                disabled={!videoUrl.trim() || isProcessing}
                className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-all"
              >
                {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                {language === 'fi' ? 'Tuo' : 'Import'}
              </button>
            </div>

            {videoResults.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-300">
                  {language === 'fi' ? 'Tuodut videot' : 'Imported Videos'}
                </h3>
                {videoResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg border border-slate-700">
                    {statusIcon(r.status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 truncate">{r.title}</p>
                      <p className="text-xs text-slate-500">
                        {r.status === 'success'
                          ? `${r.chunks_created} chunks | ${(r.transcript_length / 1000).toFixed(1)}k chars`
                          : r.status}
                      </p>
                    </div>
                  </div>
                ))}
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
                  placeholder={language === 'fi' ? 'YouTube-kanavan URL...' : 'YouTube channel URL...'}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500 transition-all"
                />
                <button
                  onClick={handleChannelSubmit}
                  disabled={!channelUrl.trim() || isProcessing}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-all"
                >
                  {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  {language === 'fi' ? 'Skannaa' : 'Scan'}
                </button>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs text-slate-400">
                  {language === 'fi' ? 'Max videoita:' : 'Max videos:'}
                </label>
                <input
                  type="number"
                  value={maxVideos}
                  onChange={e => setMaxVideos(Math.max(1, Math.min(200, parseInt(e.target.value) || 30)))}
                  className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {channelJobs.map((job) => (
              <div key={job.job_id} className="p-4 bg-slate-800 rounded-xl border border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Tv size={18} className="text-red-400" />
                    <span className="text-sm text-slate-200 truncate">{job.channel_url}</span>
                  </div>
                  {job.status === 'completed' ? (
                    <CheckCircle size={18} className="text-green-500" />
                  ) : job.status === 'error' ? (
                    <XCircle size={18} className="text-red-500" />
                  ) : (
                    <Loader2 size={18} className="animate-spin text-blue-400" />
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span>{job.status}</span>
                  <span>{job.processed_videos}/{job.total_videos} videos</span>
                  <span>
                    {job.results.filter(r => r.status === 'success').length} transcribed
                  </span>
                </div>

                {job.total_videos > 0 && job.status !== 'completed' && job.status !== 'error' && (
                  <div className="w-full bg-slate-700 rounded-full h-1.5">
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
                        <span className="text-slate-300 truncate flex-1">{r.title}</span>
                        {r.chunks_created > 0 && (
                          <span className="text-slate-500">{r.chunks_created} chunks</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {channelJobs.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                <Tv size={48} className="mb-3 opacity-50" />
                <p className="text-sm">
                  {language === 'fi'
                    ? 'Liitä kanavan URL aloittaaksesi'
                    : 'Paste a channel URL to get started'}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
