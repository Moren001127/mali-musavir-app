'use client';
import { portalStyle } from '@/lib/portal-theme';
import './dashboard-white.css';

/**
 * BUGÜNÜN İŞ LİSTESİ — gösterge paneli üst alanı (sol 2/3).
 *
 * Muzaffer Bey (2026-09-18): "bakınca bugün ne yapacağımı, ne geçtiğini, nelere dikkat
 * edeceğimi göreyim; karışık olmasın; güzel bir şey olsun." Üç dar sütun REDDEDİLDİ.
 *
 * Yapı:
 *   1) Cam üst bant: saate göre selam + saatte bir değişen motivasyon + bağlam satırı
 *      (gün · haftanın son iş günü · KDV'ye kaç gün) + sağda AY İLERLEME HALKASI.
 *   2) Tek geniş liste: BUGÜN / GECİKEN / DİKKAT bantları; konu başına TEK satır,
 *      tam isimler, sağda sayı + "Aç"; ayrıntı ▾ ile satırın altında açılır.
 * Veri /bugun ucundan (AI yok, 3 dk önbellek).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { motivasyon, selam } from './motivasyon';
import { rgba, useTema, type Palet } from './BugunTema';

type Vurgu = 'kritik' | 'uyari' | 'normal';
type BolumKey = 'bugun' | 'geciken' | 'dikkat';
type Detay = { id: string; metin: string; alt?: string; sayi?: number | null; sayiEtiket?: string; href?: string };
type Konu = { id: string; bolum: BolumKey; kaynak: string; baslik: string; aciklama?: string; sayi?: number | null; sayiEtiket?: string; vurgu: Vurgu; href?: string; detay?: Detay[] };
type Ay = { ad: string; toplam: number; tamam: number; yuzde: number; isGunuKaldi: number; kdvSonGun: string; kdvKalanGun: number; haftaninSonIsGunu: boolean };
type AkisGunu = { etiket: string; tarih: string; fatura: number; belge: number; bugun: boolean; haftaSonu: boolean };
type Bugun = { tarih: string; gun: number; saat: number; ay: Ay; akis?: AkisGunu[]; konular: Konu[]; uretimZamani: string; onbellekten: boolean };

const nokta = (P: Palet): Record<Vurgu, string> => ({ kritik: P.acil, uyari: P.b, normal: 'rgba(250,250,249,0.32)' });
const bolum = (P: Palet): Record<BolumKey, { baslik: string; renk: string; bos: string }> => ({
  bugun:   { baslik: 'Bugün',   renk: P.a,    bos: 'Bugün için bekleyen iş yok' },
  geciken: { baslik: 'Geciken', renk: P.acil, bos: 'Süresi geçmiş iş yok' },
  dikkat:  { baslik: 'Dikkat',  renk: P.b,    bos: 'Dikkat gerektiren bir şey yok' },
});

const TARIH = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

function neKadarOnce(iso: string) {
  const dk = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (dk < 1) return 'az önce';
  if (dk < 60) return `${dk} dk önce`;
  return `${Math.round(dk / 60)} sa önce`;
}
const fmtSayi = (n: number, etiket?: string) => (etiket === 'TL' ? n.toLocaleString('tr-TR') : String(n));

/** Ay ilerleme halkası — altın gradyan, ortada yüzde */
function Halka({ yuzde }: { yuzde: number }) {
  const P = useTema(); const MINT = P.a, GOLD = P.b, ROSE = P.acil;
  const r = 26, c = 2 * Math.PI * r, dolu = Math.max(0, Math.min(100, yuzde)) / 100;
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" className="shrink-0">
      <defs>
        <linearGradient id="bugun-halka" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={MINT} />
          <stop offset="100%" stopColor={GOLD} />
        </linearGradient>
      </defs>
      <circle cx="34" cy="34" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
      <circle cx="34" cy="34" r={r} fill="none" stroke="url(#bugun-halka)" strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${c * dolu} ${c}`} transform="rotate(-90 34 34)" style={portalStyle({ filter: `drop-shadow(0 0 6px ${rgba(GOLD,0.35)})` })} />
      <text x="34" y="38" textAnchor="middle" fontSize="14" fontWeight="800" fill="#f4efe5" style={portalStyle({ fontVariantNumeric: 'tabular-nums' })}>%{yuzde}</text>
    </svg>
  );
}

/** Son 7 gün belge akışı — yığılmış mini çubuklar (fatura mint, belge altın); bugün parlak */
function AkisGrafigi({ gunler }: { gunler: AkisGunu[] }) {
  const P = useTema(); const MINT = P.a, GOLD = P.b, ROSE = P.acil;
  const H = 34, W = 16, ARA = 6;
  const max = Math.max(1, ...gunler.map((g) => g.fatura + g.belge));
  const toplam = gunler.reduce((t, g) => t + g.fatura + g.belge, 0);
  return (
    <div className="rounded-xl px-3.5 py-2.5" style={portalStyle({ background: 'rgba(255,255,255,0.025)', border: `1px solid ${rgba(MINT,0.16)}` })}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase font-bold tracking-[.18em]" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>Son 7 gün belge akışı</span>
        <span className="text-[11px] font-bold tabular-nums" style={portalStyle({ color: '#f4efe5' })}>{toplam.toLocaleString('tr-TR')}</span>
      </div>
      <svg width={gunler.length * (W + ARA)} height={H + 14} className="mt-1.5 block">
        {gunler.map((g, i) => {
          const x = i * (W + ARA);
          const hf = Math.round((g.fatura / max) * H), hb = Math.round((g.belge / max) * H);
          const op = g.bugun ? 1 : g.haftaSonu ? 0.35 : 0.65;
          return (
            <g key={g.tarih} opacity={op}>
              <rect x={x} y={0} width={W} height={H} rx={3} fill="rgba(255,255,255,0.04)" />
              {hb > 0 && <rect x={x} y={H - hb} width={W} height={hb} rx={2} fill={GOLD} />}
              {hf > 0 && <rect x={x} y={H - hb - hf} width={W} height={hf} rx={2} fill={MINT} />}
              <text x={x + W / 2} y={H + 11} textAnchor="middle" fontSize="8.5" fontWeight={g.bugun ? 800 : 600} fill={g.bugun ? '#f4efe5' : 'rgba(250,250,249,0.5)'}>{g.etiket}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex items-center gap-3 text-[9.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: MINT }} /> fatura</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: GOLD }} /> belge</span>
      </div>
    </div>
  );
}

function KonuSatiri({ k }: { k: Konu }) {
  const P = useTema(); const MINT = P.a, GOLD = P.b, ROSE = P.acil;
  const [acik, setAcik] = useState(false);
  const acilir = !!k.detay?.length;
  return (
    <div style={portalStyle({ borderTop: '1px solid rgba(255,255,255,0.06)' })}>
      <div
        className={`group flex items-center gap-3 px-4 py-2.5 transition ${acilir ? 'cursor-pointer' : ''} hover:bg-white/[0.025]`}
        onClick={acilir ? () => setAcik(!acik) : undefined}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: nokta(P)[k.vurgu], boxShadow: k.vurgu === 'kritik' ? `0 0 8px ${rgba(ROSE,0.6)}` : k.vurgu === 'uyari' ? `0 0 6px ${rgba(GOLD,0.4)}` : 'none' }} />
        <span className="w-[86px] shrink-0 text-[9.5px] uppercase font-bold tracking-[.14em]" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>{k.kaynak}</span>
        <span className="min-w-0 flex-1 leading-snug">
          <span className="text-[13.5px] font-semibold" style={portalStyle({ color: 'rgba(250,250,249,0.92)' })}>{k.baslik}</span>
          {k.aciklama && <span className="text-[12.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.48)' })}> — {k.aciklama}</span>}
        </span>
        {k.sayi != null && (
          <span className="shrink-0 whitespace-nowrap leading-none">
            <span className="text-[15px] font-bold tabular-nums" style={portalStyle({ color: '#f4efe5' })}>{fmtSayi(k.sayi, k.sayiEtiket)}</span>
            {k.sayiEtiket && <span className="ml-1 text-[10px] font-semibold" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>{k.sayiEtiket}</span>}
          </span>
        )}
        {k.href && (
          <Link
            href={k.href}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 inline-flex items-center gap-0.5 text-[11px] font-bold px-2 py-[3px] rounded-md transition hover:brightness-125"
            style={portalStyle({ color: GOLD, background: `${rgba(GOLD,0.08)}`, border: `1px solid ${rgba(GOLD,0.2)}` })}
          >
            Aç <ArrowUpRight size={11} />
          </Link>
        )}
        <span className="w-4 shrink-0 flex justify-center">
          {acilir && <ChevronDown size={14} style={portalStyle({ color: 'rgba(250,250,249,0.45)', transform: acik ? 'rotate(180deg)' : 'none', transition: 'transform .15s' })} />}
        </span>
      </div>
      {acilir && acik && (
        <div className="pb-1.5" style={portalStyle({ background: 'rgba(0,0,0,0.18)' })}>
          {(() => {
            // ≥3 sayılı ayrıntı → oransal çubuk (tahsilat, fatura yığını, e-Tebligat dağılımı)
            const sayili = k.detay!.filter((d) => d.sayi != null);
            const cubuk = sayili.length >= 3;
            const max = Math.max(1, ...sayili.map((d) => d.sayi as number));
            return k.detay!.map((d) => {
            const oran = cubuk && d.sayi != null ? Math.max(2, Math.round(((d.sayi as number) / max) * 100)) : 0;
            const ic = (
              <div className="flex items-center gap-3 py-1.5 pr-4 transition hover:bg-white/[0.025]" style={portalStyle({ paddingLeft: 122 })}>
                <span className="w-1 h-1 rounded-full shrink-0" style={portalStyle({ background: 'rgba(250,250,249,0.3)' })} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.82)' })}>
                    {d.metin}{d.alt && <span style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}> · {d.alt}</span>}
                  </span>
                  {cubuk && (
                    <span className="mt-1 block h-[3px] rounded-full overflow-hidden" style={portalStyle({ background: 'rgba(255,255,255,0.05)' })}>
                      <span className="block h-full rounded-full" style={portalStyle({ width: `${oran}%`, background: `linear-gradient(90deg, ${MINT}, ${GOLD})`, opacity: 0.75 })} />
                    </span>
                  )}
                </span>
                {d.sayi != null && (
                  <span className="shrink-0 text-[12.5px] font-bold tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.85)' })}>
                    {fmtSayi(d.sayi, d.sayiEtiket)}{d.sayiEtiket && <span className="ml-1 text-[10px] font-semibold" style={portalStyle({ color: 'rgba(250,250,249,0.42)' })}>{d.sayiEtiket}</span>}
                  </span>
                )}
                {d.href && <ArrowUpRight size={12} className="shrink-0 opacity-40" style={portalStyle({ color: GOLD })} />}
                <span className="w-4 shrink-0" />
              </div>
            );
            return d.href ? <Link key={d.id} href={d.href} className="block">{ic}</Link> : <div key={d.id}>{ic}</div>;
            });
          })()}
        </div>
      )}
    </div>
  );
}

function BolumBandi({ k, adet }: { k: BolumKey; adet: number }) {
  const P = useTema(); const MINT = P.a, GOLD = P.b, ROSE = P.acil;
  const b = bolum(P)[k];
  return (
    <div
      className="flex items-center gap-2.5 px-4 py-[7px]"
      style={portalStyle({ background: `linear-gradient(90deg, ${b.renk}14, transparent 55%)`, borderTop: `1px solid ${b.renk}33` })}
    >
      <span className="w-2 h-2 rounded-full" style={{ background: b.renk, boxShadow: `0 0 10px ${b.renk}88` }} />
      <span className="text-[10.5px] uppercase font-bold tracking-[.24em]" style={portalStyle({ color: b.renk })}>{b.baslik}</span>
      <span className="text-[10.5px] font-bold tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>{adet}</span>
    </div>
  );
}

export function BugunListesi({ hitap }: { hitap?: string }) {
  const P = useTema(); const MINT = P.a, GOLD = P.b, ROSE = P.acil;
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
  const ay = data?.ay;
  const baglam = [
    TARIH,
    ay?.haftaninSonIsGunu ? 'haftanın son iş günü' : null,
    ay ? `KDV son günü ${ay.kdvSonGun} · ${ay.kdvKalanGun} gün` : null,
  ].filter(Boolean).join('  ·  ');

  return (
    <div
      data-dashboard-surface data-dashboard-root className="rounded-2xl overflow-hidden relative"
      style={portalStyle({
        background:
          P.arka,
        border: `1px solid ${rgba(MINT,0.14)}`,
        boxShadow: '0 18px 44px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.035)',
      })}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: P.cizgi }} />
      <div className="pointer-events-none absolute inset-y-5 left-0 w-[3px] rounded-r-full" style={{ background: P.serit, boxShadow: `0 0 18px ${P.glow}` }} />

      {/* Cam üst bant: selam · motivasyon · bağlam · ay halkası */}
      <div data-dashboard-band="mint" className="px-6 pt-5 pb-4 flex items-center gap-5 flex-wrap" style={portalStyle({ borderBottom: `1px solid ${rgba(MINT,0.10)}`, background: 'linear-gradient(180deg, rgba(255,255,255,0.025), transparent)' })}>
        <div className="min-w-0 flex-1">
          <div className="text-[24px] font-semibold leading-tight tracking-tight" style={portalStyle({ color: P.metin })}>
            {selam(saat)}{hitap ? `, ${hitap}` : ''}.
          </div>
          <div className="mt-1 text-[13.5px] italic" style={portalStyle({ color: GOLD, opacity: 0.85 })}>{motivasyon()}</div>
          <div className="mt-1.5 text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>{baglam}</div>
        </div>
        {!!data?.akis?.length && <AkisGrafigi gunler={data.akis} />}
        {ay && (
          <div className="flex items-center gap-3 rounded-xl px-3.5 py-2.5" style={portalStyle({ background: 'rgba(255,255,255,0.025)', border: `1px solid ${rgba(GOLD,0.16)}` })}>
            <Halka yuzde={ay.yuzde} />
            <div className="leading-tight">
              <div className="text-[10px] uppercase font-bold tracking-[.18em]" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>{ay.ad} ilerlemesi</div>
              <div className="mt-1 text-[13.5px] font-semibold tabular-nums" style={portalStyle({ color: '#f4efe5' })}>{ay.tamam} / {ay.toplam} <span className="font-normal" style={portalStyle({ color: 'rgba(250,250,249,0.55)' })}>mükellef tamamlandı</span></div>
              <div className="text-[11.5px] tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>ay sonuna {ay.isGunuKaldi} iş günü</div>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 self-start">
          {data?.uretimZamani && <span className="text-[10.5px] tabular-nums" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })}>↻ {neKadarOnce(data.uretimZamani)}</span>}
          <button
            onClick={yenile}
            disabled={isFetching}
            title="Listeyi yeniden hesapla"
            className="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition disabled:opacity-50"
            style={portalStyle({ background: `${rgba(MINT,0.055)}`, border: `1px solid ${rgba(MINT,0.14)}`, color: `${rgba(MINT,0.72)}` })}
          >
            {isFetching ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Yenile
          </button>
        </div>
      </div>

      {/* Liste */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-[13px] px-6 py-5" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>
          <Loader2 size={13} className="animate-spin" /> Bugünün listesi hazırlanıyor…
        </div>
      ) : (
        (['bugun', 'geciken', 'dikkat'] as BolumKey[]).map((key) => {
          const satirlar = (data?.konular ?? []).filter((k) => k.bolum === key);
          return (
            <div key={key}>
              <BolumBandi k={key} adet={satirlar.length} />
              {satirlar.length ? satirlar.map((k) => <KonuSatiri key={k.id} k={k} />) : (
                <div className="px-4 py-2.5 text-[12.5px]" style={portalStyle({ borderTop: '1px solid rgba(255,255,255,0.06)', color: 'rgba(250,250,249,0.4)', paddingLeft: 122 })}>{bolum(P)[key].bos}</div>
              )}
            </div>
          );
        })
      )}
      <div className="h-2" />
    </div>
  );
}
