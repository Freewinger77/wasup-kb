import { useState, useEffect, useRef } from 'react';
import { Building2, ChevronDown, LogOut, ArrowRight, Sparkles, Users, Database, Loader2, X, Settings } from 'lucide-react';
import {
  SignedIn,
  SignedOut,
  OrganizationSwitcher,
  OrganizationProfile,
  useOrganization,
  useOrganizationList,
  useAuth,
  useUser,
  useClerk,
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
import CustomersPanel from './components/CustomersPanel';
import AgentBuilderPanel from './components/AgentBuilderPanel';
import { listCustomers, setTokenGetter } from './services/api';
import type { Customer, Language } from './services/api';

function getInitialView(): View {
  const params = new URLSearchParams(window.location.search);
  if (params.get('drive_connected') === 'true' || params.get('error')) {
    return 'connectors';
  }
  return 'chat';
}

function NeedsOrg() {
  const { user } = useUser();
  const { createOrganization, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const [orgName, setOrgName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const displayName = user?.firstName || user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] || 'there';
  const hasMemberships = (userMemberships?.data?.length ?? 0) > 0;

  const handleCreate = async () => {
    if (!orgName.trim() || !createOrganization) return;
    setCreating(true);
    setError('');
    try {
      const org = await createOrganization({ name: orgName.trim() });
      await setActive?.({ organization: org.id });
    } catch (e: any) {
      setError(e?.errors?.[0]?.longMessage || e?.message || 'Failed to create organization');
      setCreating(false);
    }
  };

  const handleSelectExisting = async (orgId: string) => {
    await setActive?.({ organization: orgId });
  };

  return (
    <div className="flex h-screen bg-zinc-950 items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 mb-6">
            <Sparkles size={13} className="text-green-400" />
            <span className="text-xs font-medium text-green-400">Welcome to Wasup KB</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">
            Hey {displayName} 👋
          </h1>
          <p className="text-zinc-400 text-sm leading-relaxed max-w-sm mx-auto">
            Create your organization to get started. Your team's knowledge base, documents, and AI assistant live here.
          </p>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-2xl p-6 backdrop-blur-sm">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2">Organization name</label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="e.g. Acme Sales Team"
                className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/20 transition-all"
                autoFocus
                disabled={creating}
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              onClick={handleCreate}
              disabled={!orgName.trim() || creating}
              className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-xl px-4 py-3 text-sm font-medium transition-all group"
            >
              {creating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <>
                  Create Organization
                  <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </div>

          {hasMemberships && (
            <div className="mt-6 pt-5 border-t border-zinc-800/60">
              <p className="text-xs text-zinc-500 mb-3">Or switch to an existing organization:</p>
              <div className="space-y-2">
                {userMemberships?.data?.map((mem) => (
                  <button
                    key={mem.organization.id}
                    onClick={() => handleSelectExisting(mem.organization.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 bg-zinc-800/40 hover:bg-zinc-800 border border-zinc-800/60 hover:border-zinc-700/60 rounded-xl transition-all text-left group"
                  >
                    {mem.organization.imageUrl ? (
                      <img src={mem.organization.imageUrl} alt="" className="w-8 h-8 rounded-lg" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-green-600/20 flex items-center justify-center">
                        <Building2 size={14} className="text-green-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 font-medium truncate">{mem.organization.name}</p>
                      <p className="text-[11px] text-zinc-500 capitalize">{mem.role?.replace('org:', '')}</p>
                    </div>
                    <ArrowRight size={14} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-6 mt-8">
          <div className="flex items-center gap-2 text-zinc-600">
            <Users size={13} />
            <span className="text-xs">Team collaboration</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-600">
            <Database size={13} />
            <span className="text-xs">Shared knowledge base</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrgProfileModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[85vh] overflow-auto rounded-2xl shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 text-zinc-600 hover:text-zinc-900 transition-colors shadow"
        >
          <X size={16} />
        </button>
        <OrganizationProfile />
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
  const [showOrgProfile, setShowOrgProfile] = useState(false);
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
    <>
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
              {organization && (
                <button
                  onClick={() => { setShowOrgProfile(true); setOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/60 rounded-lg transition-colors"
                >
                  <Settings size={14} />
                  Organization Settings
                </button>
              )}
              <button
                onClick={() => signOut()}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>

      {showOrgProfile && <OrgProfileModal onClose={() => setShowOrgProfile(false)} />}
    </>
  );
}

function MainApp() {
  const [view, setView] = useState<View>(getInitialView);
  const [language, setLanguage] = useState<Language>('en');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenGetter(getToken);
  }, [getToken]);

  useEffect(() => {
    if (!organization) return;
    listCustomers().then(setCustomers).catch(() => {});
  }, [organization?.id]);

  if (!organization) return <NeedsOrg />;

  const orgId = organization.id;

  return (
    <div className="flex h-screen bg-zinc-950">
      <Sidebar active={view} onChange={setView} />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-end px-6 h-12 bg-zinc-950 border-b border-zinc-800/40">
          <div className="flex items-center gap-3">
            <LanguageSelector language={language} onChange={setLanguage} />
            <UserMenu />
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          {view === 'chat' && <ChatPanel agentId={orgId} language={language} customerId={selectedCustomerId} agentDefinitionId={selectedAgentId} />}
          {view === 'voice' && <VoicePanel agentId={orgId} language={language} />}
          {view === 'customers' && (
            <CustomersPanel
              language={language}
              selectedCustomerId={selectedCustomerId}
              onSelectCustomer={setSelectedCustomerId}
              onCustomersLoaded={setCustomers}
            />
          )}
          {view === 'builder' && (
            <AgentBuilderPanel
              orgId={orgId}
              language={language}
              customers={customers}
              selectedCustomerId={selectedCustomerId}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
            />
          )}
          {view === 'upload' && (
            <UploadPanel
              agentId={orgId}
              language={language}
              customers={customers}
              selectedCustomerId={selectedCustomerId}
              selectedAgentId={selectedAgentId}
            />
          )}
          {view === 'connectors' && <ConnectorPanel agentId={orgId} language={language} customers={customers} selectedCustomerId={selectedCustomerId} selectedAgentId={selectedAgentId} />}
          {view === 'youtube' && <YouTubePanel agentId={orgId} language={language} customers={customers} selectedCustomerId={selectedCustomerId} selectedAgentId={selectedAgentId} />}
          {view === 'history' && <HistoryPanel agentId={orgId} language={language} />}
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
  const { loaded } = useClerk();

  if (path === '/sso-callback') {
    return <SSOCallback />;
  }

  if (!loaded) {
    return (
      <div className="flex h-screen bg-zinc-950 items-center justify-center">
        <Loader2 size={28} className="animate-spin text-green-500" />
      </div>
    );
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
