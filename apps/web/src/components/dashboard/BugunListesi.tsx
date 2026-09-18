'use client';

/**
 * BUGÜNÜN İŞ LİSTESİ — eski "AI brifing" kartının yerini alır.
 *
 * Fark: cümle değil, isimli ve tıklanabilir satırlar. Her satır = bir aksiyon.
 * Veri /bugun ucundan gelir (AI yok, 3 dk önbellek) — bayat kart derdi biter.
 * Görsel dil: Günün Gündemi kartıyla aynı aile (mint + altın), kenarlıklı satırlar,
 * şiddet yalnız renkli nokta + sağdaki sayı ile anlatılır.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, ListChecks, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';

type Vurgu = 'kritik' | 'uyari' | 'normal' | 'tamam';
type Satir = { id: string; metin: string; alt?: string; sayi?: number | null; sayiEtiket?: string; vurgu: Vurgu; href?: string };
type Grup = { key: 'takilan' | 'tahsilat' | 'gorev' | 'dun'; baslik: string; satirlar: Satir[]; toplam?: number; ozet?: string; bosMetin: string; href?: string };
type Bugun = { tarih: string; gun: number; odak: string | null; odakHref?: string; gruplar: Grup[]; uretimZamani: string; onbellekten: boolean };

const MINT = '#8fd7bd';
const GOLD = '#d8bd86';
const NOKTA: Record<Vurgu, string> = { kritik: '#ef8a8a', uyari: GOLD, normal: 'rgba(250,250,249,0.35)', tamam: MINT };
const SATIR_USTU = 4; // grup başına gösterilen satır; fazlası "+N" ile modüle gider

const TARIH = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

function neKadarOnce(iso: string) {
  const dk = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (dk < 1) return 'az önce';
  if (dk < 60) return `${dk} dk önce`;
  return `${Math.round(dk / 60)} sa önce`;
}

function sayiMetni(s: Satir) {
  if (s.sayi == null) return null;
  const n = s.sayiEtiket === 'TL' ? s.sayi.toLocaleString('tr-TR') : String(s.sayi);
  return (
    <span className="shrink-0 text-right leading-none">
      <span className="text-[15px] font-bold tabular-nums" style={{ color: s.vurgu === 'tamam' ? MINT : 'rgba(250,250,249,0.9)' }}>{n}</span>
      {s.sayiEtiket && <span className="ml-1 text-[10px] font-semibold" style={{ color: 'rgba(250,250,249,0.42)' }}>{s.sayiEtiket}</span>}
    </span>
  );
}

function SatirGorunum({ s }: { s: Satir }) {
  const ic = (
    <div
      className="group flex items-center gap-3 px-3.5 py-2 transition hover:bg-white/[0.03]"
      style={{ borderTop: '1px solid rgba(255,255,255,0.055)' }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: NOKTA[s.vurgu], boxShadow: s.vurgu === 'kritik' ? '0 0 8px rgba(239,138,138,0.6)' : 'none' }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight" style={{ color: 'rgba(250,250,249,0.9)' }}>{s.metin}</span>
        {s.alt && <span className="block truncate text-[11.5px] mt-0.5" style={{ color: 'rgba(250,250,249,0.48)' }}>{s.alt}</span>}
      </span>
      {sayiMetni(s)}
      {s.href && <ChevronRight size={13} className="shrink-0 opacity-30 transition group-hover:opacity-90" style={{ color: MINT }} />}
    </div>
  );
  return s.href ? <Link href={s.href} className="block">{ic}</Link> : ic;
}

function GrupGorunum({ g }: { g: Grup }) {
  const gorunen = g.satirlar.slice(0, SATIR_USTU);
  const fazla = (g.toplam ?? g.satirlar.length) - gorunen.length;
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.016)', border: '1px solid rgba(143,215,189,0.10)' }}>
      <div className="flex items-center justify-between gap-2 px-3.5 py-2">
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={{ color: 'rgba(221,246,238,0.62)' }}>{g.baslik}</span>
          {g.ozet && <span className="truncate text-[10.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.42)' }}>{g.ozet}</span>}
        </span>
        {g.href && (
          <Link href={g.href} className="inline-flex items-center gap-1 text-[10.5px] font-semibold transition hover:brightness-125" style={{ color: GOLD }}>
            {fazla > 0 ? `+${fazla} tümü` : 'tümü'} <ArrowRight size={10} />
          </Link>
        )}
      </div>
      {gorunen.length ? (
        gorunen.map((s) => <SatirGorunum key={s.id} s={s} />)
      ) : (
        <div className="px-3.5 py-2 text-[12px]" style={{ borderTop: '1px solid rgba(255,255,255,0.055)', color: 'rgba(250,250,249,0.42)' }}>
          {g.bosMetin}
        </div>
      )}
    </div>
  );
}

export function BugunListesi({ userName }: { userName?: string }) {
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

  const grup = (k: Grup['key']) => data?.gruplar.find((g) => g.key === k);
  // Son tarihler grubu yok: alttaki "Bu Hafta Takvim" zaten gösteriyor (Muzaffer Bey, 2026-09-18)
  const sol = [grup('dun'), grup('gorev')].filter(Boolean) as Grup[];
  const sag = [grup('takilan'), grup('tahsilat')].filter(Boolean) as Grup[];

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

      {/* Başlık */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid rgba(143,215,189,0.08)' }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <ListChecks size={14} style={{ color: MINT }} />
          <span className="text-[10px] uppercase font-bold tracking-[.22em]" style={{ color: 'rgba(221,246,238,0.72)' }}>Bugünün İş Listesi</span>
          <span className="text-[11.5px] truncate" style={{ color: 'rgba(250,250,249,0.45)' }}>{TARIH}{userName ? ` · ${userName}` : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          {data?.uretimZamani && (
            <span className="text-[10.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.4)' }}>↻ {neKadarOnce(data.uretimZamani)}</span>
          )}
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

      {/* Odak — tek satır: bugün önce ne? */}
      {data?.odak && (
        <div className="px-5 pt-3">
          {(() => {
            const ic = (
              <div
                className="group flex items-center gap-3 rounded-xl px-4 py-2.5 transition hover:brightness-110"
                style={{ background: 'linear-gradient(90deg, rgba(216,189,134,0.09), rgba(255,255,255,0.018) 65%)', border: '1px solid rgba(216,189,134,0.20)', boxShadow: `inset 3px 0 0 ${GOLD}` }}
              >
                <span className="text-[14px] font-semibold leading-snug flex-1 min-w-0" style={{ color: 'rgba(250,250,249,0.92)' }}>{data.odak}</span>
                {data.odakHref && <ArrowRight size={14} className="shrink-0 opacity-50 transition group-hover:opacity-100" style={{ color: GOLD }} />}
              </div>
            );
            return data.odakHref ? <Link href={data.odakHref} className="block">{ic}</Link> : ic;
          })()}
        </div>
      )}

      {/* Gruplar — iki sütun */}
      <div className="px-5 pt-3 pb-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-[13px] py-2" style={{ color: 'rgba(250,250,249,0.5)' }}>
            <Loader2 size={13} className="animate-spin" /> Bugünün listesi hazırlanıyor…
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-3">{sol.map((g) => <GrupGorunum key={g.key} g={g} />)}</div>
            <div className="space-y-3">{sag.map((g) => <GrupGorunum key={g.key} g={g} />)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
