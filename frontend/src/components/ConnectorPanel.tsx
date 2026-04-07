import { useState, useEffect, useRef } from 'react';
import {
  FolderSync,
  Loader2,
  CheckCircle,
  XCircle,
  RefreshCw,
  FolderSearch,
  HardDrive,
  Mail,
} from 'lucide-react';
import {
  getGoogleAuthUrl,
  scanDrive,
  getConnectorStatus,
  listConnectors,
  type ConnectorStatus,
  type Language,
} from '../services/api';

interface Props {
  agentId: string;
  language: Language;
}

export default function ConnectorPanel({ agentId, language }: Props) {
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    loadConnectors();

    const params = new URLSearchParams(window.location.search);
    if (params.get('drive_connected') === 'true') {
      window.history.replaceState({}, '', window.location.pathname);
      loadConnectors();
    }
    if (params.get('error')) {
      const err = params.get('error');
      const detail = params.get('detail') || '';
      setAuthError(`${err}${detail ? ': ' + detail : ''}`);
      window.history.replaceState({}, '', window.location.pathname);
    }

    return () => {
      pollTimers.current.forEach(t => clearInterval(t));
    };
  }, [agentId]);

  const loadConnectors = async () => {
    setIsLoading(true);
    try {
      const list = await listConnectors(agentId);
      setConnectors(list);
    } catch {}
    setIsLoading(false);
  };

  const handleConnectGoogle = async () => {
    setIsAuthenticating(true);
    try {
      const { auth_url } = await getGoogleAuthUrl(agentId);
      window.location.href = auth_url;
    } catch (err) {
      console.error('Failed to get auth URL:', err);
      setIsAuthenticating(false);
    }
  };

  const handleScan = async (connectorId: string, folderUrl?: string) => {
    try {
      await scanDrive(connectorId, agentId, folderUrl || undefined);

      setConnectors(prev =>
        prev.map(c => c.id === connectorId ? { ...c, status: 'scanning' } : c)
      );

      const timer = setInterval(async () => {
        try {
          const updated = await getConnectorStatus(connectorId, agentId);
          setConnectors(prev => prev.map(c => c.id === connectorId ? updated : c));
          if (updated.status === 'completed' || updated.status === 'error') {
            clearInterval(timer);
            pollTimers.current.delete(connectorId);
          }
        } catch {}
      }, 3000);
      pollTimers.current.set(connectorId, timer);
    } catch (err) {
      console.error('Scan failed:', err);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle size={18} className="text-green-500" />;
      case 'error':
        return <XCircle size={18} className="text-red-500" />;
      case 'connected':
        return <CheckCircle size={18} className="text-indigo-400" />;
      default:
        return <Loader2 size={18} className="animate-spin text-indigo-400" />;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800/40">
        <div>
          <h2 className="text-[15px] font-semibold text-white">Google Drive</h2>
          <p className="text-xs text-zinc-500 mt-1">
            {language === 'fi'
              ? 'Kirjaudu Google-tilillesi ja tuo kaikki dokumentit'
              : 'Sign in with your Google account and import all documents'}
          </p>
        </div>
        <button onClick={loadConnectors} className="text-zinc-600 hover:text-zinc-400 p-2">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {authError && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            <p className="font-medium mb-1">Connection failed</p>
            <p className="break-all">{authError}</p>
          </div>
        )}

        {/* Connect Button */}
        <button
          onClick={handleConnectGoogle}
          disabled={isAuthenticating}
          className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 rounded-xl text-zinc-200 text-sm font-medium transition-all border border-zinc-700/60 hover:border-zinc-600"
        >
          {isAuthenticating ? (
            <Loader2 size={18} className="animate-spin text-zinc-400" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
          )}
          {language === 'fi' ? 'Kirjaudu Google-tilillä' : 'Sign in with Google'}
        </button>

        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 size={20} className="animate-spin text-blue-400" />
          </div>
        )}

        {/* Connected Accounts */}
        {connectors.map((c) => (
          <ConnectedDrive
            key={c.id}
            connector={c}
            language={language}
            statusIcon={statusIcon}
            onScan={handleScan}
          />
        ))}

        {!isLoading && connectors.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500">
            <FolderSync size={48} className="mb-3 opacity-50" />
            <p className="text-sm text-center">
              {language === 'fi'
                ? 'Ei yhdistettyjä Google Drive -tilejä.\nKirjaudu sisään aloittaaksesi.'
                : 'No Google Drive accounts connected.\nSign in to get started.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectedDrive({
  connector,
  language,
  statusIcon,
  onScan,
}: {
  connector: ConnectorStatus;
  language: Language;
  statusIcon: (s: string) => React.ReactNode;
  onScan: (id: string, folderUrl?: string) => void;
}) {
  const [folderUrl, setFolderUrl] = useState('');
  const [mode, setMode] = useState<'idle' | 'folder'>('idle');
  const isActive = ['scanning', 'processing'].includes(connector.status);

  return (
    <div className="p-4 bg-slate-800 rounded-xl border border-slate-700 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center">
          <Mail size={18} className="text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">
            {connector.google_email || 'Google Drive'}
          </p>
          <p className="text-xs text-slate-500">
            {connector.status === 'connected' && (language === 'fi' ? 'Yhdistetty, valmis skannaukseen' : 'Connected, ready to scan')}
            {connector.status === 'scanning' && (language === 'fi' ? 'Skannataan tiedostoja...' : 'Scanning files...')}
            {connector.status === 'processing' && (language === 'fi' ? 'Käsitellään dokumentteja...' : 'Processing documents...')}
            {connector.status === 'completed' && (language === 'fi' ? 'Valmis' : 'Complete')}
            {connector.status === 'error' && (language === 'fi' ? 'Virhe' : 'Error')}
          </p>
        </div>
        {statusIcon(connector.status)}
      </div>

      {/* Progress */}
      {connector.total_files > 0 && isActive && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{connector.processed_files}/{connector.total_files} {language === 'fi' ? 'tiedostoa' : 'files'}</span>
            <span>{Math.round((connector.processed_files / connector.total_files) * 100)}%</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all"
              style={{ width: `${(connector.processed_files / connector.total_files) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Completed Stats */}
      {connector.status === 'completed' && connector.total_files > 0 && (
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>{connector.total_files} {language === 'fi' ? 'tiedostoa tuotu' : 'files imported'}</span>
          {connector.last_sync && (
            <span>{language === 'fi' ? 'Synkronoitu' : 'Synced'}: {new Date(connector.last_sync).toLocaleString()}</span>
          )}
        </div>
      )}

      {connector.error && (
        <p className="text-xs text-red-400">{connector.error}</p>
      )}

      {/* Action Buttons */}
      {(connector.status === 'connected' || connector.status === 'completed') && !isActive && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => onScan(connector.id)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-all"
            >
              <HardDrive size={16} />
              {language === 'fi' ? 'Skannaa koko Drive' : 'Scan Entire Drive'}
            </button>
            <button
              onClick={() => setMode(mode === 'folder' ? 'idle' : 'folder')}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-all"
            >
              <FolderSearch size={16} />
              {language === 'fi' ? 'Kansio' : 'Folder'}
            </button>
          </div>

          {mode === 'folder' && (
            <div className="flex gap-2">
              <input
                type="text"
                value={folderUrl}
                onChange={e => setFolderUrl(e.target.value)}
                placeholder={language === 'fi' ? 'Google Drive -kansion URL...' : 'Paste folder URL...'}
                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500"
              />
              <button
                onClick={() => { onScan(connector.id, folderUrl); setFolderUrl(''); setMode('idle'); }}
                disabled={!folderUrl.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white rounded-lg text-sm font-medium transition-all"
              >
                {language === 'fi' ? 'Skannaa' : 'Scan'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
