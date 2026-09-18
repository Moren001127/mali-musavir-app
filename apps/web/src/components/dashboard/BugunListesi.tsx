'use client';

/**
 * BUGÜNÜN İŞ LİSTESİ — eski "AI brifing" kartının yerini alır.
 *
 * Muzaffer Bey (2026-09-18): "bakınca bugün ne yapacağımı, ne geçtiğini, nelere
 * dikkat edeceğimi göreyim; karışık olmasın." → Üç sütun: BUGÜN · GECİKEN · DİKKAT.
 * Satırlar veri kaynağına göre değil aciliyete göre dizilir; kaynak küçük etikettir.
 * Üstte saate göre selam + saatte bir değişen kısa motivasyon cümlesi (motivasyon.ts).
 * Veri /bugun ucundan (AI yok, 3 dk önbellek).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ListChecks, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { motivasyon, selam } from './motivasyon';

type Vurgu = 'kritik' | 'uyari' | 'normal';
type Satir = { id: string; kaynak: string; metin: string; alt?: string; sayi?: number | null; sayiEtiket?: string; vurgu: Vurgu; href?: string };
type Bolum = { key: 'bugun' | 'geciken' | 'dikkat'; baslik: string; satirlar: Satir[]; bosMetin: string };
type Bugun = { tarih: string; gun: number; saat: number; bolumler: Bolum[]; uretimZamani: string; onbellekten: boolean };

const MINT = '#8fd7bd';
const GOLD = '#d8bd86';
const ROSE = '#ef8a8a';
const NOKTA: Record<Vurgu, string> = { kritik: ROSE, uyari: GOLD, normal: 'rgba(250,250,249,0.35)' };
const BOLUM_RENK: Record<Bolum['key'], string> = { bugun: MINT, geciken: ROSE, dikkat: GOLD };
const SATIR_USTU = 6; // sütun başına açık satır; fazlası yerinde açılır

const TARIH = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

function neKadarOnce(iso: string) {
  const dk = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (dk < 1) return 'az önce';
  if (dk < 60) return `${dk} dk önce`;
  return `${Math.round(dk / 60)} sa önce`;
}

function Sayi({ s }: { s: Satir }) {
  if (s.sayi == null) return null;
  const n = s.sayiEtiket === 'TL' ? s.sayi.toLocaleString('tr-TR') : String(s.sayi);
  return (
    <span className="shrink-0 text-right leading-none whitespace-nowrap">
      <span className="text-[14px] font-bold tabular-nums" style={{ color: 'rgba(250,250,249,0.9)' }}>{n}</span>
      {s.sayiEtiket && <span className="ml-1 text-[10px] font-semibold" style={{ color: 'rgba(250,250,249,0.42)' }}>{s.sayiEtiket}</span>}
    </span>
  );
}

function SatirGorunum({ s }: { s: Satir }) {
  const ic = (
    <div className="group flex items-center gap-2.5 px-3 py-2 transition hover:bg-white/[0.03]" style={{ borderTop: '1px solid rgba(255,255,255,0.055)' }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: NOKTA[s.vurgu], boxShadow: s.vurgu === 'kritik' ? '0 0 8px rgba(239,138,138,0.6)' : 'none' }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight" title={s.metin} style={{ color: 'rgba(250,250,249,0.9)' }}>{s.metin}</span>
        <span className="flex items-center gap-1.5 min-w-0 mt-0.5">
          <span className="shrink-0 text-[8.5px] uppercase font-bold tracking-[.12em] px-1.5 py-[1px] rounded" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.48)', border: '1px solid rgba(255,255,255,0.07)' }}>{s.kaynak}</span>
          {s.alt && <span className="truncate text-[11.5px]" title={s.alt} style={{ color: 'rgba(250,250,249,0.48)' }}>{s.alt}</span>}
        </span>
      </span>
      <Sayi s={s} />
      {s.href && <ChevronRight size={13} className="shrink-0 opacity-30 transition group-hover:opacity-90" style={{ color: MINT }} />}
    </div>
  );
  return s.href ? <Link href={s.href} className="block">{ic}</Link> : ic;
}

function BolumGorunum({ b }: { b: Bolum }) {
  const [acik, setAcik] = useState(false);
  const renk = BOLUM_RENK[b.key];
  const gorunen = acik ? b.satirlar : b.satirlar.slice(0, SATIR_USTU);
  const fazla = b.satirlar.length - gorunen.length;
  return (
    <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: 'rgba(255,255,255,0.016)', border: '1px solid rgba(255,255,255,0.07)', boxShadow: `inset 0 2px 0 ${renk}55` }}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: renk }} />
          <span className="text-[10px] uppercase font-bold tracking-[.2em]" style={{ color: 'rgba(250,250,249,0.72)' }}>{b.baslik}</span>
        </span>
        <span className="text-[11px] font-bold tabular-nums px-2 py-[1px] rounded-md" style={{ color: renk, background: `${renk}14`, border: `1px solid ${renk}33` }}>{b.satirlar.length}</span>
      </div>
      {gorunen.length ? gorunen.map((s) => <SatirGorunum key={s.id} s={s} />) : (
        <div className="px-3 py-2.5 text-[12px]" style={{ borderTop: '1px solid rgba(255,255,255,0.055)', color: 'rgba(250,250,249,0.42)' }}>{b.bosMetin}</div>
      )}
      {b.satirlar.length > SATIR_USTU && (
        <button
          onClick={() => setAcik(!acik)}
          className="flex items-center justify-center gap-1 px-3 py-1.5 text-[11px] font-semibold transition hover:bg-white/[0.03]"
          style={{ borderTop: '1px solid rgba(255,255,255,0.055)', color: GOLD }}
        >
          {acik ? 'daha az göster' : `${fazla} satır daha`} <ChevronDown size={12} style={{ transform: acik ? 'rotate(180deg)' : 'none' }} />
        </button>
      )}
    </div>
  );
}

export function BugunListesi({ hitap }: { hitap?: string }) {
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery<Bugun>({
    queryKey: ['bugun'],
    queryFn: () => api.get('/bugun').then((r) => r.data),
    staleTime: 3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const yenile = async () => {
    const r = await api.get('/bugun?force=1').then((res) => res.data);
    qc.setQueryData(['bugun'], r);
  };
  const saat = data?.saat ?? new Date().getHours();

  return (
    <div
      className="rounded-2xl overflow-hidden relative h-full"
      style={{
        background:
          'radial-gradient(circle at 7% 0%, rgba(143,215,189,0.11), transparent 34%), radial-gradient(circle at 95% 10%, rgba(216,189,134,0.08), transparent 31%), linear-gradient(180deg, rgba(8,14,13,0.96), rgba(5,7,7,0.94))',
        border: '1px solid rgba(143,215,189,0.14)',
        boxShadow: '0 18px 44px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.035)',
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(143,215,189,0.65), rgba(216,189,134,0.38), transparent)' }} />
      <div className="pointer-events-none absolute inset-y-5 left-0 w-[3px] rounded-r-full" style={{ background: `linear-gradient(180deg, ${MINT}, ${GOLD})`, boxShadow: '0 0 18px rgba(143,215,189,0.22)' }} />

      {/* Başlık şeridi */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid rgba(143,215,189,0.08)' }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <ListChecks size={14} style={{ color: MINT }} />
          <span className="text-[10px] uppercase font-bold tracking-[.22em]" style={{ color: 'rgba(221,246,238,0.72)' }}>Bugünün İş Listesi</span>
          <span className="text-[11.5px] truncate" style={{ color: 'rgba(250,250,249,0.45)' }}>{TARIH}</span>
        </div>
        <div className="flex items-center gap-2">
          {data?.uretimZamani && <span className="text-[10.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.4)' }}>↻ {neKadarOnce(data.uretimZamani)}</span>}
          <button
            onClick={yenile}
            disabled={isFetching}
            title="Listeyi yeniden hesapla"
            className="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition disabled:opacity-50"
            style={{ background: 'rgba(143,215,189,0.055)', border: '1px solid rgba(143,215,189,0.14)', color: 'rgba(221,246,238,0.72)' }}
          >
            {isFetching ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Yenile
          </button>
        </div>
      </div>

      {/* Selam + motivasyon — tek satır, sade */}
      <div className="px-5 pt-3.5 pb-1 flex items-baseline gap-x-3 gap-y-1 flex-wrap">
        <span className="text-[19px] font-semibold leading-tight" style={{ color: '#f4efe5' }}>
          {selam(saat)}{hitap ? `, ${hitap}` : ''}.
        </span>
        <span className="text-[13px] italic" style={{ color: 'rgba(250,250,249,0.52)' }}>{motivasyon()}</span>
      </div>

      {/* Üç sütun */}
      <div className="px-5 pt-3 pb-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-[13px] py-2" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Loader2 size={13} className="animate-spin" /> Bugünün listesi hazırlanıyor…
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
            {(data?.bolumler ?? []).map((b) => <BolumGorunum key={b.key} b={b} />)}
          </div>
        )}
      </div>
    </div>
  );
}
