'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  Workflow, Calendar, Clock, ChevronRight, FileText, Receipt,
  FileCheck, Loader2, Bot, Building2, ArrowRight, AlertCircle,
} from 'lucide-react';

const GOLD = '#d4b876';

type Stage = 'EVRAK_BEKLIYOR' | 'ISLENMEYI_BEKLIYOR' | 'KONTROL_BEKLIYOR' | 'BEYANNAME_BEKLIYOR' | 'TAMAM';

interface QueueItem {
  statusId: string;
  taxpayerId: string;
  taxpayerName: string;
  taxNumber: string;
  type: string;
  stage: Stage;
  actionLabel: string;
  actionPath: string;
  bekleyenGun: number;
  updatedAt: string;
  evraklarGeldi: boolean;
  evraklarIslendi: boolean;
  kontrolEdildi: boolean;
  beyannameVerildi: boolean;
}

interface WorkflowData {
  year: number;
  month: number;
  donem: string;
  total: number;
  counts: { evrak: number; islenme: number; kontrol: number; beyanname: number; tamam: number };
  siradaki: QueueItem[];
  grouped: Record<Stage, QueueItem[]>;
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const STAGE_CONFIG: Record<Stage, { label: string; color: string; icon: any; bgRgba: string }> = {
  ISLENMEYI_BEKLIYOR: { label: 'İşlenmeyi Bekliyor', color: '#3b82f6', icon: Receipt, bgRgba: 'rgba(59,130,246,0.1)' },
  KONTROL_BEKLIYOR:   { label: 'KDV Kontrol Bekliyor', color: '#f59e0b', icon: FileCheck, bgRgba: 'rgba(245,158,11,0.1)' },
  BEYANNAME_BEKLIYOR: { label: 'Beyanname Hazırlanacak', color: '#a855f7', icon: FileText, bgRgba: 'rgba(168,85,247,0.1)' },
  EVRAK_BEKLIYOR:     { label: 'Evrak Bekleniyor', color: '#94a3b8', icon: Clock, bgRgba: 'rgba(148,163,184,0.1)' },
  TAMAM:              { label: 'Tamamlandı', color: '#22c55e', icon: FileCheck, bgRgba: 'rgba(34,197,94,0.1)' },
};

/**
 * v1.36.78: İş Akışı sayfası — FIFO sıralı görev listesi.
 * "Kim önce hazır geldiyse → o önce işlensin" mantığıyla sıralanır.
 * Aşamalar:
 *  1. KONTROL_BEKLIYOR (en acil — beyanname için sıradaki adım)
 *  2. ISLENMEYI_BEKLIYOR (evrak geldi, işlenmeyi bekliyor)
 *  3. BEYANNAME_BEKLIYOR (kontrol tamam, beyanname hazırlanacak)
 *  4. EVRAK_BEKLIYOR (evrak henüz gelmedi)
 */
export default function IsYukuPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data, isLoading } = useQuery<WorkflowData>({
    queryKey: ['workflow-queue', year, month],
    queryFn: () =>
      api.get('/taxpayers/workflow/queue', { params: { year, month } }).then((r) => r.data),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div className="pb-5 flex items-end justify-between flex-wrap gap-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-[26px] h-px" style={{ background: GOLD }} />
            <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: '#b8a06f' }}>
              <Workflow size={10} className="inline mr-1" /> İŞ AKIŞI
            </span>
          </div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 34, fontWeight: 600, color: '#fafaf9', letterSpacing: '-.03em' }}>
            İş Akışı — Sıralı Görev Listesi
          </h1>
          <p className="text-[13px] mt-1.5" style={{ color: 'rgba(250,250,249,0.42)' }}>
            Kimin evrakı önce hazır geldiyse o önce işlenir — sistem sırayı söylüyor
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="px-3 py-2 rounded-lg text-sm border outline-none cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
          >
            {AYLAR.map((a, i) => <option key={i} value={i + 1} style={{ background: '#0f0d0b' }}>{a}</option>)}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-3 py-2 rounded-lg text-sm border outline-none cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#fafaf9' }}
          >
            {[year - 1, year, year + 1].map((y) => (
              <option key={y} value={y} style={{ background: '#0f0d0b' }}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Aşama sayaçları */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <SayacKarti label="Bekliyor" value={data.counts.evrak} stage="EVRAK_BEKLIYOR" />
          <SayacKarti label="İşlenecek" value={data.counts.islenme} stage="ISLENMEYI_BEKLIYOR" pulse={data.counts.islenme > 0} />
          <SayacKarti label="Kontrol" value={data.counts.kontrol} stage="KONTROL_BEKLIYOR" pulse={data.counts.kontrol > 0} />
          <SayacKarti label="Beyanname" value={data.counts.beyanname} stage="BEYANNAME_BEKLIYOR" />
          <SayacKarti label="Tamam" value={data.counts.tamam} stage="TAMAM" />
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-16" style={{ color: 'rgba(250,250,249,0.4)' }}>
          <Loader2 className="inline animate-spin mr-2" size={16} /> Yükleniyor...
        </div>
      ) : !data ? (
        <div className="text-center py-16" style={{ color: 'rgba(250,250,249,0.4)' }}>Veri yok</div>
      ) : (
        <>
          {/* Sıradaki 10 İş — büyük öne çıkan kart */}
          {data.siradaki.length > 0 && (
            <div className="rounded-2xl overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(212,184,118,0.08), rgba(212,184,118,0.02))',
                border: '1px solid rgba(212,184,118,0.30)',
              }}>
              <div className="flex items-center gap-2.5 px-5 py-4"
                style={{ borderBottom: '1px solid rgba(212,184,118,0.20)' }}>
                <ArrowRight size={16} style={{ color: GOLD }} />
                <h3 className="text-[14px] font-bold" style={{ color: '#fafaf9', fontFamily: 'Fraunces, serif' }}>
                  SIRADAKİ {data.siradaki.length} İŞ — FIFO
                </h3>
                <span className="ml-auto text-[10.5px] uppercase tracking-wider"
                  style={{ color: 'rgba(250,250,249,0.5)' }}>
                  En uzun bekleyen önce
                </span>
              </div>
              <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                {data.siradaki.map((item, idx) => (
                  <SiraSatir key={item.statusId} item={item} sira={idx + 1} />
                ))}
              </div>
            </div>
          )}

          {/* Aşamaya göre detaylı liste */}
          <div className="space-y-4">
            {(['ISLENMEYI_BEKLIYOR', 'KONTROL_BEKLIYOR', 'BEYANNAME_BEKLIYOR', 'EVRAK_BEKLIYOR', 'TAMAM'] as Stage[]).map((stage) => {
              const items = data.grouped[stage];
              if (!items || items.length === 0) return null;
              const cfg = STAGE_CONFIG[stage];
              const Icon = cfg.icon;
              return (
                <div key={stage} className="rounded-xl overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-center gap-2.5 px-4 py-3"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <Icon size={14} style={{ color: cfg.color }} />
                    <h4 className="text-[12.5px] font-bold uppercase tracking-wider"
                      style={{ color: cfg.color }}>
                      {cfg.label}
                    </h4>
                    <span className="ml-auto text-[11px] tabular-nums px-2 py-0.5 rounded"
                      style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(250,250,249,0.6)' }}>
                      {items.length}
                    </span>
                  </div>
                  <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                    {items.slice(0, 10).map((item) => (
                      <SiraSatir key={item.statusId} item={item} sira={null} />
                    ))}
                    {items.length > 10 && (
                      <div className="px-5 py-2.5 text-[11.5px]" style={{ color: 'rgba(250,250,249,0.5)' }}>
                        +{items.length - 10} daha
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SayacKarti({ label, value, stage, pulse }: { label: string; value: number; stage: Stage; pulse?: boolean }) {
  const cfg = STAGE_CONFIG[stage];
  const Icon = cfg.icon;
  return (
    <div className="rounded-xl p-4"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex items-center gap-2 mb-2 text-[11px] font-medium uppercase tracking-wider"
        style={{ color: 'rgba(250,250,249,0.55)' }}>
        <Icon size={12} style={{ color: cfg.color }} />
        <span>{label}</span>
        {pulse && value > 0 && <span className="w-1.5 h-1.5 rounded-full ml-auto"
          style={{ background: cfg.color, boxShadow: `0 0 8px ${cfg.color}` }} />}
      </div>
      <p className="leading-none tabular-nums"
        style={{ fontFamily: 'Fraunces, serif', fontSize: 32, fontWeight: 700, color: '#fafaf9' }}>
        {value}
      </p>
    </div>
  );
}

function SiraSatir({ item, sira }: { item: QueueItem; sira: number | null }) {
  const cfg = STAGE_CONFIG[item.stage];
  const isGecikmis = item.bekleyenGun >= 5;
  return (
    <Link
      href={item.actionPath}
      className="grid items-center gap-3 px-5 py-3 hover:bg-white/[0.03] transition group"
      style={{ gridTemplateColumns: sira !== null ? '32px 1.5fr 1.2fr 100px 36px' : '4px 1.5fr 1.2fr 100px 36px' }}
    >
      {sira !== null ? (
        <span className="tabular-nums text-[16px] font-bold"
          style={{ fontFamily: 'Fraunces, serif', color: GOLD }}>
          {sira}
        </span>
      ) : (
        <span className="w-1 h-6 rounded-sm" style={{ background: cfg.color }} />
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Building2 size={11} style={{ color: 'rgba(250,250,249,0.4)' }} />
          <span className="text-[13.5px] font-semibold truncate" style={{ color: '#fafaf9' }}>
            {item.taxpayerName}
          </span>
          {isGecikmis && (
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded shrink-0"
              style={{ background: 'rgba(239,68,68,0.18)', color: '#ef4444' }}>
              {item.bekleyenGun}gün
            </span>
          )}
        </div>
        <div className="text-[11px] mt-0.5 truncate"
          style={{ color: 'rgba(250,250,249,0.4)', fontFamily: 'JetBrains Mono, monospace' }}>
          {item.taxNumber}
        </div>
      </div>
      <div className="min-w-0">
        <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded"
          style={{ background: cfg.bgRgba, color: cfg.color }}>
          <cfg.icon size={11} /> {cfg.label}
        </span>
      </div>
      <div className="text-[12px] font-semibold text-right"
        style={{ color: cfg.color }}>
        {item.actionLabel}
      </div>
      <ChevronRight size={14} className="opacity-30 group-hover:opacity-100 transition justify-self-end"
        style={{ color: GOLD }} />
    </Link>
  );
}
