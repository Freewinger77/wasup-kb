import {
  MessageSquare,
  Mic,
  FolderSync,
  Upload,
  History,
  CirclePlay,
  Sparkles,
  Building2,
  Bot,
} from 'lucide-react';

export type View = 'chat' | 'voice' | 'customers' | 'builder' | 'connectors' | 'upload' | 'youtube' | 'history';

interface Props {
  active: View;
  onChange: (view: View) => void;
}

const NAV_ITEMS: { id: View; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'customers', label: 'Customers', icon: Building2 },
  { id: 'builder', label: 'Agent Builder', icon: Bot },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'connectors', label: 'Google Drive', icon: FolderSync },
  { id: 'youtube', label: 'YouTube', icon: CirclePlay },
  { id: 'history', label: 'History', icon: History },
];

export default function Sidebar({ active, onChange }: Props) {
  return (
    <aside className="w-[260px] bg-zinc-950 border-r border-zinc-800/60 flex flex-col h-screen">
      <div className="px-5 pt-6 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-white tracking-tight">Wasup KB</h1>
            <p className="text-[11px] text-zinc-500 leading-none">Knowledge Base</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-0.5">
        {NAV_ITEMS.map(item => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                isActive
                  ? 'bg-zinc-800/80 text-white'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'
              }`}
            >
              <Icon size={16} strokeWidth={isActive ? 2 : 1.5} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-zinc-800/40">
        <p className="text-[10px] text-zinc-600 text-center tracking-wide uppercase">Powered by Azure AI</p>
      </div>
    </aside>
  );
}
