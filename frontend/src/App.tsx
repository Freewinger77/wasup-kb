import { useState, useEffect, useRef } from 'react';
import { Building2, ChevronDown, LogOut } from 'lucide-react';
import {
  SignedIn,
  SignedOut,
  OrganizationSwitcher,
  useOrganization,
  useAuth,
  useUser,
  AuthenticateWithRedirectCallback,
} from '@clerk/clerk-react';
import AuthPage from './components/AuthPage';
import Sidebar, { type View } from './components/Sidebar';
import LanguageSelector from './components/LanguageSelector';
import ChatPanel from './components/ChatPanel';
import VoicePanel from './components/VoicePanel';
import UploadPanel from './components/UploadPanel';
import ConnectorPanel from './components/ConnectorPanel';
import HistoryPanel from './components/HistoryPanel';
import YouTubePanel from './components/YouTubePanel';
import { setTokenGetter } from './services/api';
import type { Language } from './services/api';

function getInitialView(): View {
  const params = new URLSearchParams(window.location.search);
  if (params.get('drive_connected') === 'true' || params.get('error')) {
    return 'connectors';
  }
  return 'chat';
}

function NeedsOrg() {
  return (
    <div className="flex-1 flex items-center justify-center bg-zinc-950">
      <div className="text-center space-y-6 max-w-md px-6">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mx-auto shadow-lg shadow-green-500/20">
          <Building2 size={28} className="text-white" />
        </div>
        <h2 className="text-xl font-semibold text-white">Create or Join an Organization</h2>
        <p className="text-sm text-zinc-400">
          Each organization gets its own shared knowledge base.
          Create one to get started, or ask your team to invite you.
        </p>
        <div className="flex justify-center">
          <OrganizationSwitcher
            hidePersonal
            afterCreateOrganizationUrl="/"
            afterSelectOrganizationUrl="/"
            appearance={{
              elements: {
                rootBox: 'w-full',
                organizationSwitcherTrigger: 'w-full justify-center bg-green-600 hover:bg-green-500 text-white rounded-full px-4 py-2.5 text-sm font-medium transition-all',
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}

function UserMenu() {
  const { user } = useUser();
  const { organization } = useOrganization();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowOrgSwitcher(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const imgUrl = user?.imageUrl;
  const displayName = user?.firstName || user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] || 'User';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); setShowOrgSwitcher(false); }}
        className="flex items-center gap-2 rounded-full hover:bg-zinc-800/60 transition-colors pl-1 pr-2 py-1"
      >
        {imgUrl ? (
          <img src={imgUrl} alt="" className="w-7 h-7 rounded-full" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center text-white text-xs font-semibold">
            {displayName[0]?.toUpperCase()}
          </div>
        )}
        <ChevronDown size={14} className="text-zinc-500" />
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-64 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl shadow-black/50 py-1.5 z-50 animate-fade-in">
          <div className="px-3 py-2 border-b border-zinc-800/60">
            <p className="text-sm text-white font-medium truncate">{displayName}</p>
            <p className="text-[11px] text-zinc-500 truncate">{user?.emailAddresses?.[0]?.emailAddress}</p>
          </div>

          {organization && (
            <div className="px-3 py-2 border-b border-zinc-800/60">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Organization</p>
              <button
                onClick={() => setShowOrgSwitcher(!showOrgSwitcher)}
                className="w-full flex items-center gap-2 text-sm text-zinc-300 hover:text-white transition-colors"
              >
                <Building2 size={14} className="text-green-500" />
                <span className="truncate flex-1 text-left">{organization.name}</span>
                <ChevronDown size={12} className={`text-zinc-600 transition-transform ${showOrgSwitcher ? 'rotate-180' : ''}`} />
              </button>
              {showOrgSwitcher && (
                <div className="mt-2">
                  <OrganizationSwitcher
                    hidePersonal
                    afterCreateOrganizationUrl="/"
                    afterSelectOrganizationUrl="/"
                    appearance={{
                      elements: {
                        rootBox: 'w-full',
                        organizationSwitcherTrigger: 'w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg px-3 py-2 text-xs border border-zinc-700/50',
                        organizationSwitcherPopoverCard: 'bg-zinc-900 border-zinc-800',
                      },
                    }}
                  />
                </div>
              )}
            </div>
          )}

          <div className="px-1 py-1">
            <button
              onClick={() => signOut()}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/60 rounded-lg transition-colors"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MainApp() {
  const [view, setView] = useState<View>(getInitialView);
  const [language, setLanguage] = useState<Language>('en');
  const { organization } = useOrganization();
  const { getToken } = useAuth();

  useEffect(() => {
    setTokenGetter(getToken);
  }, [getToken]);

  if (!organization) return <NeedsOrg />;

  const orgName = organization.name;

  return (
    <div className="flex h-screen bg-zinc-950">
      <Sidebar active={view} onChange={setView} />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-6 h-12 bg-zinc-950 border-b border-zinc-800/40">
          <div className="flex items-center gap-2">
            <Building2 size={14} className="text-green-500" />
            <span className="text-xs font-medium text-zinc-400">{orgName}</span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSelector language={language} onChange={setLanguage} />
            <UserMenu />
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          {view === 'chat' && <ChatPanel agentId={orgName} language={language} />}
          {view === 'voice' && <VoicePanel agentId={orgName} language={language} />}
          {view === 'upload' && <UploadPanel agentId={orgName} language={language} />}
          {view === 'connectors' && <ConnectorPanel agentId={orgName} language={language} />}
          {view === 'youtube' && <YouTubePanel agentId={orgName} language={language} />}
          {view === 'history' && <HistoryPanel agentId={orgName} language={language} />}
        </div>
      </main>
    </div>
  );
}

function SSOCallback() {
  return (
    <div className="flex h-screen bg-zinc-950 items-center justify-center">
      <AuthenticateWithRedirectCallback />
    </div>
  );
}

export default function App() {
  const path = window.location.pathname;

  if (path === '/sso-callback') {
    return <SSOCallback />;
  }

  return (
    <>
      <SignedOut>
        <AuthPage />
      </SignedOut>
      <SignedIn>
        <MainApp />
      </SignedIn>
    </>
  );
}
