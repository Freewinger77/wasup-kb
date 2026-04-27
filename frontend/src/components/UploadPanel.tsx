import { useState, useCallback } from 'react';
import { Upload, FileText, CheckCircle, XCircle, Loader2, Trash2 } from 'lucide-react';
import { uploadDocuments, type Customer, type KnowledgeScope, type UploadResult, type Language } from '../services/api';

interface Props {
  agentId: string;
  language: Language;
  customers?: Customer[];
  selectedCustomerId?: string;
  selectedAgentId?: string;
}

export default function UploadPanel({ agentId, language, customers = [], selectedCustomerId, selectedAgentId }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [scope, setScope] = useState<KnowledgeScope>(selectedCustomerId ? 'customer' : 'org_wide');
  const [customerId, setCustomerId] = useState(selectedCustomerId || '');

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    if (scope === 'customer' && !customerId) return;
    setIsUploading(true);
    try {
      const res = await uploadDocuments(
        files,
        agentId,
        scope,
        scope === 'customer' ? customerId : undefined,
        selectedAgentId,
      );
      setResults(prev => [...res, ...prev]);
    } catch {}
    setIsUploading(false);
  }, [agentId, scope, customerId, selectedAgentId]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-zinc-800/40">
        <h2 className="text-[15px] font-semibold text-white">
          {language === 'fi' ? 'Lataa dokumentteja' : 'Upload Documents'}
        </h2>
        <p className="text-xs text-zinc-500 mt-1">PDF, DOCX, XLSX, CSV, TXT, MD, JSON</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
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

        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(Array.from(e.dataTransfer.files)); }}
          className={`relative border border-dashed rounded-xl p-10 text-center transition-all cursor-pointer ${
            isDragging ? 'border-indigo-500 bg-indigo-500/5' : 'border-zinc-800 hover:border-zinc-700'
          }`}
        >
          <input
            type="file" multiple
            accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.json"
            onChange={(e) => { handleFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
          <Upload size={36} className={`mx-auto mb-3 ${isDragging ? 'text-indigo-400' : 'text-zinc-600'}`} />
          <p className="text-sm text-zinc-400 font-medium">
            {language === 'fi' ? 'Vedä ja pudota tiedostoja' : 'Drag and drop files here'}
          </p>
          <p className="text-[11px] text-zinc-600 mt-1">
            {scope === 'customer' && customerId
              ? `${language === 'fi' ? 'Kohde' : 'Target'}: ${customers.find(c => c.id === customerId)?.name || customerId}`
              : language === 'fi' ? 'tai klikkaa selataksesi' : 'or click to browse'}
          </p>
        </div>

        {isUploading && (
          <div className="flex items-center gap-3 px-4 py-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
            <Loader2 size={16} className="animate-spin text-indigo-400" />
            <span className="text-xs text-indigo-300">{language === 'fi' ? 'Käsitellään...' : 'Processing...'}</span>
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">{language === 'fi' ? 'Tulokset' : 'Results'}</span>
              <button onClick={() => setResults([])} className="text-[11px] text-zinc-600 hover:text-zinc-400 flex items-center gap-1">
                <Trash2 size={10} /> {language === 'fi' ? 'Tyhjennä' : 'Clear'}
              </button>
            </div>
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-zinc-900 rounded-lg border border-zinc-800/60">
                <FileText size={15} className="text-zinc-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-zinc-300 truncate">{r.filename}</p>
                  <p className="text-[11px] text-zinc-600">{r.status === 'success' ? `${r.chunks_created} chunks` : r.status}</p>
                </div>
                {r.status === 'success' ? <CheckCircle size={15} className="text-green-500" /> : <XCircle size={15} className="text-red-500" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
