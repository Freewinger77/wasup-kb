import type { Language } from '../services/api';

interface Props {
  language: Language;
  onChange: (lang: Language) => void;
}

export default function LanguageSelector({ language, onChange }: Props) {
  return (
    <div className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
      <button
        onClick={() => onChange('en')}
        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
          language === 'en'
            ? 'bg-zinc-700 text-white shadow-sm'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        EN
      </button>
      <button
        onClick={() => onChange('fi')}
        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
          language === 'fi'
            ? 'bg-zinc-700 text-white shadow-sm'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        FI
      </button>
    </div>
  );
}
