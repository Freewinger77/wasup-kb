import { useEffect, useState } from 'react';
import { Building2, Loader2, Plus } from 'lucide-react';
import { createCustomer, listCustomers, type Customer, type Language } from '../services/api';

interface Props {
  language: Language;
  selectedCustomerId?: string;
  onSelectCustomer: (customerId?: string) => void;
  onCustomersLoaded: (customers: Customer[]) => void;
}

export default function CustomersPanel({ language, selectedCustomerId, onSelectCustomer, onCustomersLoaded }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await listCustomers();
      setCustomers(data);
      onCustomersLoaded(data);
    } catch {}
    setIsLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const customer = await createCustomer({ name: name.trim(), industry: industry.trim() || undefined });
      const next = [customer, ...customers];
      setCustomers(next);
      onCustomersLoaded(next);
      onSelectCustomer(customer.id);
      setName('');
      setIndustry('');
    } catch {}
    setIsSaving(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-zinc-800/40">
        <h2 className="text-[15px] font-semibold text-white">{language === 'fi' ? 'Asiakkaat' : 'Customers'}</h2>
        <p className="text-xs text-zinc-500 mt-1">
          {language === 'fi' ? 'Luo asiakaskohtaiset tietokantakorit' : 'Create customer-specific knowledge buckets'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800/60 space-y-3">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={language === 'fi' ? 'Asiakkaan nimi' : 'Customer name'}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50"
          />
          <input
            value={industry}
            onChange={e => setIndustry(e.target.value)}
            placeholder={language === 'fi' ? 'Toimiala' : 'Industry'}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50"
          />
          <button
            onClick={save}
            disabled={!name.trim() || isSaving}
            className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 text-white rounded-lg text-sm font-medium"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {language === 'fi' ? 'Luo asiakas' : 'Create customer'}
          </button>
        </div>

        <button
          onClick={() => onSelectCustomer(undefined)}
          className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left ${
            !selectedCustomerId ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-zinc-900 border-zinc-800/60'
          }`}
        >
          <Building2 size={18} className="text-indigo-400" />
          <div>
            <p className="text-sm text-white">{language === 'fi' ? 'Organisaation yhteinen' : 'Org-wide knowledge'}</p>
            <p className="text-xs text-zinc-500">{language === 'fi' ? 'Näkyy kaikille asiakkaille' : 'Shared across all customers'}</p>
          </div>
        </button>

        {isLoading && <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-indigo-400" /></div>}

        {customers.map(customer => (
          <button
            key={customer.id}
            onClick={() => onSelectCustomer(customer.id)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left ${
              selectedCustomerId === customer.id ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-zinc-900 border-zinc-800/60 hover:border-zinc-700'
            }`}
          >
            <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center text-sm font-semibold text-white">
              {customer.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-white truncate">{customer.name}</p>
              <p className="text-xs text-zinc-500 truncate">{customer.industry || customer.slug || customer.id}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
