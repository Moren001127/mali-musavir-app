'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { FileCheck, Save, Loader2 } from 'lucide-react';

const GOLD = '#d4b876';

type Period = 'AYLIK' | 'UCAYLIK' | null;
type IncomeTaxType = 'KURUMLAR' | 'GELIR' | 'BASIT_USUL' | null;

interface BeyanConfig {
  taxpayerId?: string;
  incomeTaxType: IncomeTaxType;
  kdv1Period: Period;
  kdv2Enabled: boolean;
  muhtasarPeriod: Period;
  damgaEnabled: boolean;
  posetEnabled: boolean;
  sgkBildirgeEnabled: boolean;
  eDefterPeriod: Period;
}

const DEFAULT: BeyanConfig = {
  incomeTaxType: null,
  kdv1Period: null,
  kdv2Enabled: false,
  muhtasarPeriod: null,
  damgaEnabled: false,
  posetEnabled: false,
  sgkBildirgeEnabled: false,
  eDefterPeriod: null,
};

/**
 * v1.36.76: Mükellef Mükellefiyetleri kart bileşeni.
 * Hangi beyannamelerden sorumlu, dönemleri ne, e-defter durumu/dönemi.
 * Backend: PUT /beyanname-takip/configs/:taxpayerId (mevcut endpoint kullanılıyor).
 */
export function MukellefiyetlerCard({ taxpayerId }: { taxpayerId: string }) {
  const qc = useQueryClient();

  // Mevcut config'i çek (beyanname-takip listesinde geliyor)
  const { data: configData, isLoading } = useQuery<{ items: any[] }>({
    queryKey: ['beyan-config-list'],
    queryFn: () => api.get('/beyanname-takip/configs').then((r) => r.data).catch(() => ({ items: [] })),
  });

  const existingConfig = configData?.items?.find((i: any) => i.taxpayerId === taxpayerId)?.config;
  const [form, setForm] = useState<BeyanConfig>(DEFAULT);

  useEffect(() => {
    if (existingConfig) {
      setForm({
        incomeTaxType: existingConfig.incomeTaxType || null,
        kdv1Period: existingConfig.kdv1Period || null,
        kdv2Enabled: !!existingConfig.kdv2Enabled,
        muhtasarPeriod: existingConfig.muhtasarPeriod || null,
        damgaEnabled: !!existingConfig.damgaEnabled,
        posetEnabled: !!existingConfig.posetEnabled,
        sgkBildirgeEnabled: !!existingConfig.sgkBildirgeEnabled,
        eDefterPeriod: existingConfig.eDefterPeriod || null,
      });
    }
  }, [existingConfig]);

  const saveMut = useMutation({
    mutationFn: () => api.put(`/beyanname-takip/configs/${taxpayerId}`, form),
    onSuccess: () => {
      toast.success('Mükellefiyetler kaydedildi');
      qc.invalidateQueries({ queryKey: ['beyan-config-list'] });
      qc.invalidateQueries({ queryKey: ['taxpayer-completeness', taxpayerId] });
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || 'Kayıt başarısız');
    },
  });

  if (isLoading) return null;

  return (
    <div className="card mb-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(212,184,118,0.20)' }}>
      <div className="flex items-center gap-2 mb-4">
        <FileCheck size={16} style={{ color: GOLD }} />
        <h2 className="text-base font-semibold" style={{ color: GOLD }}>Mükellefiyetler & Dönemler</h2>
        <span className="text-[11px] ml-2" style={{ color: 'rgba(250,250,249,0.5)' }}>
          Hangi beyannameleri verir, dönemleri ne?
        </span>
      </div>

      <div className="space-y-3">
        {/* KDV1 */}
        <PeriodRow
          label="KDV1 (Katma Değer Vergisi)"
          desc="Aylık zorunlu (3 aylık seçenek bazı mükellefler için)"
          value={form.kdv1Period}
          onChange={(v) => setForm({ ...form, kdv1Period: v })}
        />

        {/* KDV2 (Tevkifat) */}
        <SimpleToggle
          label="KDV2 — Sorumlu Sıfatıyla (Tevkifat)"
          desc="Aylık zorunlu — sadece tevkifat sorumluluğu varsa"
          value={form.kdv2Enabled}
          onChange={(v) => setForm({ ...form, kdv2Enabled: v })}
        />

        {/* Muhtasar */}
        <PeriodRow
          label="Muhtasar (MUHSGK)"
          desc="Aylık veya 3 aylık (mükellef tipine göre)"
          value={form.muhtasarPeriod}
          onChange={(v) => setForm({ ...form, muhtasarPeriod: v })}
        />

        {/* Damga */}
        <SimpleToggle
          label="Damga Vergisi"
          desc="Sürekli damga vergisi mükellefiyse"
          value={form.damgaEnabled}
          onChange={(v) => setForm({ ...form, damgaEnabled: v })}
        />

        {/* SGK Bildirge */}
        <SimpleToggle
          label="SGK Aylık Prim ve Hizmet Belgesi"
          desc="Çalışanı olan mükellefler için (her ay 23'ü)"
          value={form.sgkBildirgeEnabled}
          onChange={(v) => setForm({ ...form, sgkBildirgeEnabled: v })}
        />

        {/* Poşet */}
        <SimpleToggle
          label="Poşet Beyannamesi"
          desc="3 aylık — plastik poşet kullananlar"
          value={form.posetEnabled}
          onChange={(v) => setForm({ ...form, posetEnabled: v })}
        />

        {/* E-Defter */}
        <PeriodRow
          label="E-Defter / E-Berat"
          desc="Aylık veya 3 aylık (bilanço usulü mükellefler için zorunlu)"
          value={form.eDefterPeriod}
          onChange={(v) => setForm({ ...form, eDefterPeriod: v })}
        />

        {/* Yıllık vergi tipi */}
        <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>
                Yıllık Beyanname Tipi
              </div>
              <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>
                Yıllık verilecek beyanname türü (Mart-Nisan)
              </div>
            </div>
            <select
              value={form.incomeTaxType || ''}
              onChange={(e) => setForm({ ...form, incomeTaxType: (e.target.value || null) as IncomeTaxType })}
              className="px-3 py-1.5 rounded-lg text-sm border outline-none"
              style={{ background: 'rgba(0,0,0,0.3)', borderColor: 'rgba(255,255,255,0.10)', color: '#fafaf9', minWidth: 150 }}
            >
              <option value="" style={{ background: '#0f0d0b' }}>— Yok —</option>
              <option value="KURUMLAR" style={{ background: '#0f0d0b' }}>Kurumlar Vergisi</option>
              <option value="GELIR" style={{ background: '#0f0d0b' }}>Gelir Vergisi</option>
              <option value="BASIT_USUL" style={{ background: '#0f0d0b' }}>Basit Usul</option>
            </select>
          </div>
        </div>
      </div>

      {/* Kaydet butonu */}
      <div className="flex justify-end mt-4">
        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold disabled:opacity-50"
          style={{ background: GOLD, color: '#0f0d0b' }}
        >
          {saveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Mükellefiyetleri Kaydet
        </button>
      </div>
    </div>
  );
}

function PeriodRow({ label, desc, value, onChange }: { label: string; desc: string; value: Period; onChange: (v: Period) => void }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{label}</div>
          <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>{desc}</div>
        </div>
        <div className="flex gap-2">
          <PeriodOption label="Yok" selected={value === null} onClick={() => onChange(null)} />
          <PeriodOption label="Aylık" selected={value === 'AYLIK'} onClick={() => onChange('AYLIK')} />
          <PeriodOption label="3 Aylık" selected={value === 'UCAYLIK'} onClick={() => onChange('UCAYLIK')} />
        </div>
      </div>
    </div>
  );
}

function PeriodOption({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1 rounded-md text-[11.5px] font-semibold transition"
      style={{
        background: selected ? GOLD : 'rgba(255,255,255,0.04)',
        color: selected ? '#0f0d0b' : 'rgba(250,250,249,0.7)',
        border: `1px solid ${selected ? GOLD : 'rgba(255,255,255,0.08)'}`,
      }}
    >
      {label}
    </button>
  );
}

function SimpleToggle({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <label className="flex items-start justify-between gap-3 cursor-pointer">
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>{label}</div>
          <div className="text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.5)' }}>{desc}</div>
        </div>
        <div className="shrink-0 flex items-center">
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => onChange(e.target.checked)}
            className="w-5 h-5 cursor-pointer"
            style={{ accentColor: GOLD }}
          />
        </div>
      </label>
    </div>
  );
}
