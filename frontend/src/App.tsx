import { useState, useEffect } from 'react';
import {
  SignedIn,
  SignedOut,
  UserButton,
  OrganizationSwitcher,
  useOrganization,
  useAuth,
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
        <h2 className="text-xl font-semibold text-white">Create or Join an Organization</h2>
        <p className="text-sm text-zinc-400">
          You need to be part of an organization to use Wasup KB.
          Each organization gets its own shared knowledge base.
        </p>
        <div className="flex justify-center">
          <OrganizationSwitcher
            hidePersonal
            afterCreateOrganizationUrl="/"
            afterSelectOrganizationUrl="/"
            appearance={{
              elements: {
                rootBox: 'w-full',
                organizationSwitcherTrigger: 'w-full justify-center bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2.5 text-sm',
              },
            }}
          />
        </div>
      </div>
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
          <div className="flex items-center gap-3">
            <OrganizationSwitcher
              hidePersonal
              afterCreateOrganizationUrl="/"
              afterSelectOrganizationUrl="/"
              appearance={{
                elements: {
                  rootBox: '',
                  organizationSwitcherTrigger: 'bg-zinc-800/60 hover:bg-zinc-700/60 text-zinc-300 rounded-md px-2.5 py-1 text-xs border border-zinc-700/50',
                },
              }}
            />
          </div>
          <div className="flex items-center gap-3">
            <LanguageSelector language={language} onChange={setLanguage} />
            <UserButton
              appearance={{
                elements: {
                  avatarBox: 'w-7 h-7',
                },
              }}
            />
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
