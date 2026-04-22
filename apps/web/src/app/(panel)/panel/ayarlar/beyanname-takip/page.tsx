'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  beyannameTakipApi,
  ConfigRow,
  TaxpayerBeyanConfig,
  Period,
} from '@/lib/beyanname-takip';
import { ArrowLeft, Search, Save, FileCheck2, Check } from 'lucide-react';
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

  const totalConfigured = rows.filter((r) => {
    const cfg = r.config;
    return cfg.kdv1Period || cfg.muhtasarPeriod || cfg.eDefterPeriod || cfg.kdv2Enabled
      || cfg.damgaEnabled || cfg.posetEnabled || cfg.sgkBildirgeEnabled || cfg.incomeTaxType;
  }).length;

  return (
    <div className="p-6 space-y-5">
      {/* Başlık */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/panel/ayarlar"
            className="p-2 rounded-lg hover:bg-stone-800/40 text-stone-400 hover:text-stone-200 transition"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: '#d4b876' }}>
              <FileCheck2 className="w-6 h-6" /> Mükellef Beyanname Takip
            </h1>
            <p className="text-sm text-stone-400 mt-1">
              Her mükellefin hangi beyannameleri verdiğini ayarla. Yalnızca <strong className="text-amber-400">aktif</strong> mükellefler görünür.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <div className="px-3 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300">
            <strong>{rows.length}</strong> aktif mükellef · <strong>{totalConfigured}</strong> tanesi yapılandırılmış
          </div>
        </div>
      </div>

      {/* Arama */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
        <input
          type="text"
          placeholder="Mükellef adı ile ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 rounded-md text-sm outline-none"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }}
        />
      </div>

      {isLoading && <div className="text-stone-400 text-sm">Yükleniyor...</div>}

      {!isLoading && filtered.length === 0 && (
        <div className="rounded-lg p-12 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <FileCheck2 className="w-10 h-10 text-stone-600 mx-auto mb-3" />
          <p className="text-stone-400">
            {search ? 'Aramaya uyan mükellef yok.' : 'Aktif mükellef bulunamadı.'}
          </p>
        </div>
      )}

      {/* Kart listesi — her mükellef için ayrı kart, buton grupları ile seçim */}
      {filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((row) => {
            const cfg = getCfg(row);
            const changed = hasChanges(row.taxpayerId);
            return (
              <div
                key={row.taxpayerId}
                className="rounded-xl p-4 transition-all"
                style={{
                  background: changed ? 'rgba(212,184,118,0.06)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${changed ? 'rgba(212,184,118,0.35)' : 'rgba(255,255,255,0.06)'}`,
                }}
              >
                {/* Üst: mükellef adı + kaydet butonu */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[14px] font-semibold truncate" style={{ color: '#fafaf9' }}>{row.ad}</h3>
                    {(row.startDate || row.endDate) && (
                      <div className="text-[11px] text-stone-500 mt-0.5">
                        {row.startDate && `Başl: ${new Date(row.startDate).toLocaleDateString('tr-TR')}`}
                        {row.endDate && ` · Bitiş: ${new Date(row.endDate).toLocaleDateString('tr-TR')}`}
                      </div>
                    )}
                  </div>
                  <button
                    disabled={!changed || upsert.isPending}
                    onClick={() => save(row.taxpayerId)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed"
                    style={changed ? {
                      background: 'linear-gradient(135deg, #d4b876, #b8a06f)',
                      color: '#0a0906',
                    } : {
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: 'rgba(250,250,249,0.4)',
                    }}
                  >
                    <Save size={13} />
                    {changed ? 'Kaydet' : 'Değişiklik yok'}
                  </button>
                </div>

                {/* Orta: Gelir/Kurumlar türü (tek satır başı) */}
                <div className="mb-3 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <Label>Gelir / Kurumlar Vergisi</Label>
                  <ButtonGroup
                    value={cfg.incomeTaxType || ''}
                    onChange={(v) => setCfg(row.taxpayerId, { incomeTaxType: (v || null) as any })}
                    options={[
                      { v: '', l: 'Yok' },
                      { v: 'KURUMLAR', l: 'Kurumlar V.' },
                      { v: 'GELIR', l: 'Gelir V.' },
                      { v: 'BASIT_USUL', l: 'Basit Usul' },
                    ]}
                  />
                </div>

                {/* Alt: Aylık beyannameler — 2 kolonda grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                  <div>
                    <Label>KDV1 (Katma Değer)</Label>
                    <PeriodButtons
                      value={cfg.kdv1Period}
                      onChange={(v) => setCfg(row.taxpayerId, { kdv1Period: v })}
                    />
                  </div>

                  <div>
                    <Label>Muhtasar (MUHSGK)</Label>
                    <PeriodButtons
                      value={cfg.muhtasarPeriod}
                      onChange={(v) => setCfg(row.taxpayerId, { muhtasarPeriod: v })}
                    />
                  </div>

                  <div>
                    <Label>E-Defter</Label>
                    <PeriodButtons
                      value={cfg.eDefterPeriod}
                      onChange={(v) => setCfg(row.taxpayerId, { eDefterPeriod: v })}
                    />
                  </div>

                  <div>
                    <Label>Ek Yükümlülükler</Label>
                    <div className="flex flex-wrap gap-2">
                      <Toggle
                        checked={cfg.kdv2Enabled}
                        onChange={(v) => setCfg(row.taxpayerId, { kdv2Enabled: v })}
                        label="KDV2 Tevkifat"
                      />
                      <Toggle
                        checked={cfg.damgaEnabled}
                        onChange={(v) => setCfg(row.taxpayerId, { damgaEnabled: v })}
                        label="Damga"
                      />
                      <Toggle
                        checked={cfg.posetEnabled}
                        onChange={(v) => setCfg(row.taxpayerId, { posetEnabled: v })}
                        label="Poşet (3A)"
                      />
                      <Toggle
                        checked={cfg.sgkBildirgeEnabled}
                        onChange={(v) => setCfg(row.taxpayerId, { sgkBildirgeEnabled: v })}
                        label="SGK Bildirge"
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-xs text-stone-500 border-t border-stone-800 pt-3 mt-5">
        <strong>Not:</strong> <span className="text-stone-400">Aylık</span> = her ay beyan verilir; <span className="text-stone-400">3 Aylık</span> = yalnızca 3/6/9/12. aylarda (çeyrek sonu).
        Poşet beyannamesi 1/4/7/10. aylarında verilir.
        Kurumlar yılda bir kez Nisan, Gelir Mart'ta otomatik eklenir.
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Yardımcı bileşenler
// ────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
      {children}
    </div>
  );
}

function ButtonGroup({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
      {options.map((o, i) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className="text-[12px] font-medium px-3 py-1.5 transition-all"
            style={{
              background: active ? 'rgba(212,184,118,0.16)' : 'transparent',
              color: active ? '#d4b876' : 'rgba(250,250,249,0.6)',
              borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
            }}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function PeriodButtons({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
  return (
    <ButtonGroup
      value={value || ''}
      onChange={(v) => onChange((v || null) as Period)}
      options={[
        { v: '', l: 'Yok' },
        { v: 'AYLIK', l: 'Aylık' },
        { v: 'UCAYLIK', l: '3 Aylık' },
      ]}
    />
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-md transition-all"
      style={{
        background: checked ? 'rgba(212,184,118,0.16)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${checked ? 'rgba(212,184,118,0.4)' : 'rgba(255,255,255,0.08)'}`,
        color: checked ? '#d4b876' : 'rgba(250,250,249,0.6)',
      }}
    >
      <span
        className="w-3.5 h-3.5 rounded-[3px] flex items-center justify-center flex-shrink-0"
        style={{
          background: checked ? '#d4b876' : 'transparent',
          border: `1.5px solid ${checked ? '#d4b876' : 'rgba(250,250,249,0.3)'}`,
        }}
      >
        {checked && <Check size={10} strokeWidth={3.5} style={{ color: '#0a0906' }} />}
      </span>
      {label}
    </button>
  );
}
