'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  beyannameTakipApi,
  ConfigRow,
  TaxpayerBeyanConfig,
  Period,
} from '@/lib/beyanname-takip';
import { ArrowLeft, Search, Save, FileCheck2 } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

/**
 * Mükellef Beyanname Takip Ayarları
 *
 * Her mükellef için hangi beyannameleri verir, dönemi ne ayarlanır.
 * Dashboard'daki Toplu Beyanname tablosu bu config'e göre hangi mükelleflerin
 * hangi dönem hangi beyannameyi vermesi gerektiğini hesaplar.
 */
export default function BeyannameTakipAyarlariPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [localChanges, setLocalChanges] = useState<Record<string, Partial<TaxpayerBeyanConfig>>>({});

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['beyanname-takip-configs'],
    queryFn: () => beyannameTakipApi.listConfigs(),
  });

  const upsert = useMutation({
    mutationFn: ({ taxpayerId, cfg }: { taxpayerId: string; cfg: Partial<TaxpayerBeyanConfig> }) =>
      beyannameTakipApi.upsertConfig(taxpayerId, cfg),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['beyanname-takip-configs'] });
      toast.success('Kaydedildi');
    },
    onError: (e: any) => toast.error(e?.message || 'Kaydedilemedi'),
  });

  // Arama filtresi
  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase().trim();
    return rows.filter((r) => r.ad.toLowerCase().includes(q));
  }, [rows, search]);

  const getCfg = (row: ConfigRow): TaxpayerBeyanConfig => ({
    ...row.config,
    ...(localChanges[row.taxpayerId] || {}),
  });

  const setCfg = (taxpayerId: string, patch: Partial<TaxpayerBeyanConfig>) => {
    setLocalChanges((prev) => ({
      ...prev,
      [taxpayerId]: { ...(prev[taxpayerId] || {}), ...patch },
    }));
  };

  const save = (taxpayerId: string) => {
    const changes = localChanges[taxpayerId];
    if (!changes || Object.keys(changes).length === 0) return;
    upsert.mutate({ taxpayerId, cfg: changes });
    setLocalChanges((prev) => {
      const next = { ...prev };
      delete next[taxpayerId];
      return next;
    });
  };

  const hasChanges = (taxpayerId: string) => !!localChanges[taxpayerId] && Object.keys(localChanges[taxpayerId]).length > 0;

  return (
    <div className="p-6 space-y-5">
      {/* Başlık */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/panel/ayarlar"
            className="p-2 rounded-lg hover:bg-stone-100 text-stone-500 hover:text-stone-800 transition"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: '#d4b876' }}>
              <FileCheck2 className="w-6 h-6" /> Mükellef Beyanname Takip
            </h1>
            <p className="text-sm text-stone-500 mt-1">
              Her mükellefin hangi beyannameleri verdiğini ve dönemini ayarla.
              İşe başlama/bırakma tarihleri mükellefler sayfasından düzenlenir.
            </p>
          </div>
        </div>
      </div>

      {/* Arama */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <input
          type="text"
          placeholder="Mükellef adı ile ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-amber-300"
        />
      </div>

      {isLoading && <div className="text-stone-500 text-sm">Yükleniyor...</div>}

      {/* Tablo */}
      {!isLoading && filtered.length === 0 && (
        <div className="bg-stone-50 border border-stone-200 rounded-lg p-12 text-center">
          <FileCheck2 className="w-10 h-10 text-stone-300 mx-auto mb-3" />
          <p className="text-stone-500">
            {search ? 'Aramaya uyan mükellef yok.' : 'Henüz mükellef eklenmemiş.'}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200 sticky top-0">
              <tr className="text-left text-[11px] font-medium text-stone-600 uppercase tracking-wider">
                <th className="px-3 py-3 min-w-[200px]">Mükellef</th>
                <th className="px-3 py-3">Gelir/Kurumlar</th>
                <th className="px-3 py-3">KDV1</th>
                <th className="px-3 py-3 text-center">KDV2</th>
                <th className="px-3 py-3">Muhtasar</th>
                <th className="px-3 py-3 text-center">Damga</th>
                <th className="px-3 py-3 text-center">Poşet</th>
                <th className="px-3 py-3 text-center">SGK Bildirge</th>
                <th className="px-3 py-3">E-Defter</th>
                <th className="px-3 py-3 text-right sticky right-0 bg-stone-50">Kaydet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtered.map((row) => {
                const cfg = getCfg(row);
                const changed = hasChanges(row.taxpayerId);
                return (
                  <tr key={row.taxpayerId} className={changed ? 'bg-amber-50/30' : 'hover:bg-stone-50/50'}>
                    <td className="px-3 py-2 text-stone-800 font-medium">
                      <div>{row.ad}</div>
                      {(row.startDate || row.endDate) && (
                        <div className="text-[10.5px] text-stone-500 mt-0.5">
                          {row.startDate && `Başl: ${new Date(row.startDate).toLocaleDateString('tr-TR')}`}
                          {row.endDate && ` · Bitiş: ${new Date(row.endDate).toLocaleDateString('tr-TR')}`}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={cfg.incomeTaxType || ''}
                        onChange={(v) => setCfg(row.taxpayerId, { incomeTaxType: (v || null) as any })}
                        options={[
                          { v: '', l: '—' },
                          { v: 'KURUMLAR', l: 'Kurumlar' },
                          { v: 'GELIR', l: 'Gelir' },
                          { v: 'BASIT_USUL', l: 'Basit Usul' },
                        ]}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <PeriodSelect
                        value={cfg.kdv1Period}
                        onChange={(v) => setCfg(row.taxpayerId, { kdv1Period: v })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Checkbox
                        checked={cfg.kdv2Enabled}
                        onChange={(v) => setCfg(row.taxpayerId, { kdv2Enabled: v })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <PeriodSelect
                        value={cfg.muhtasarPeriod}
                        onChange={(v) => setCfg(row.taxpayerId, { muhtasarPeriod: v })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Checkbox
                        checked={cfg.damgaEnabled}
                        onChange={(v) => setCfg(row.taxpayerId, { damgaEnabled: v })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Checkbox
                        checked={cfg.posetEnabled}
                        onChange={(v) => setCfg(row.taxpayerId, { posetEnabled: v })}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Checkbox
                        checked={cfg.sgkBildirgeEnabled}
                        onChange={(v) => setCfg(row.taxpayerId, { sgkBildirgeEnabled: v })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <PeriodSelect
                        value={cfg.eDefterPeriod}
                        onChange={(v) => setCfg(row.taxpayerId, { eDefterPeriod: v })}
                      />
                    </td>
                    <td className="px-3 py-2 text-right sticky right-0 bg-white">
                      <button
                        disabled={!changed || upsert.isPending}
                        onClick={() => save(row.taxpayerId)}
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition ${
                          changed
                            ? 'bg-amber-500 text-white hover:bg-amber-600'
                            : 'bg-stone-100 text-stone-400 cursor-not-allowed'
                        }`}
                      >
                        <Save size={13} />
                        Kaydet
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-stone-500 border-t border-stone-100 pt-3">
        <strong>Not:</strong> Aylık = her ay beyan; Üç Aylık = 3/6/9/12. aylarda (çeyrek sonu).
        Poşet beyannamesi 3 aylık olarak 1/4/7/10. aylarında verilir.
        Kurumlar yılda bir kez Nisan, Gelir Mart'ta beyan edilir — otomatik eklenir.
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Küçük yardımcı bileşenler
// ────────────────────────────────────────────────────────────

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs border border-stone-200 rounded px-2 py-1 bg-white hover:border-amber-300 focus:border-amber-400 focus:outline-none w-full"
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>{o.l}</option>
      ))}
    </select>
  );
}

function PeriodSelect({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
  return (
    <Select
      value={value || ''}
      onChange={(v) => onChange((v || null) as Period)}
      options={[
        { v: '', l: '—' },
        { v: 'AYLIK', l: 'Aylık' },
        { v: 'UCAYLIK', l: '3 Aylık' },
      ]}
    />
  );
}

function Checkbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 accent-amber-500 cursor-pointer"
    />
  );
}
