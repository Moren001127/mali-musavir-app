'use client';

/**
 * BUGÜN MASANIZDA — gösterge paneli üst alanı (sol 2/3). KARAR: Muzaffer Bey (2026-09-18)
 * "B tasarımı, renk önceki (nane–altın)".
 *
 * Veri MÜKELLEF üzerinden kurulur: "kimle ilgilenmeliyim". Bir mali müşavirin günü mükellef
 * dosyası açarak geçer; o mükellefle ilgili her şey (e-Tebligat, takılı aşama, açık bakiye,
 * dolan belge, fatura yığını) tek kartta toplanır.
 *   1) Cam üst bant: selam + motivasyon + bağlam
 *   2) Nabız şeridi: ay akışı (aşama şeridi) · 7 gün belge akışı · tahsilat payı
 *   3) Mükellef kartları: aciliyet puanına göre; avatar + neden rozetleri
 *   4) Genel işler kapsülleri (mükellefe bağlı olmayanlar: görev, onay, ajan…)
 * Veri /bugun ucundan (AI yok, 3 dk önbellek). Renkler BugunTema.tsx (varsayılan nane).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { motivasyon, selam } from './motivasyon';
import { rgba, useTema, type Palet } from './BugunTema';

type Vurgu = 'kritik' | 'uyari' | 'normal';
type BolumKey = 'bugun' | 'geciken' | 'dikkat';
type Detay = { id: string; metin: string; alt?: string; sayi?: number | null; sayiEtiket?: string; href?: string; taxpayerId?: string };
type Konu = { id: string; bolum: BolumKey; kaynak: string; baslik: string; aciklama?: string; sayi?: number | null; sayiEtiket?: string; vurgu: Vurgu; href?: string; detay?: Detay[]; taxpayerId?: string };
type Asamalar = { evrakBekliyor: number; isleniyor: number; kontrol: number; beyan: number; tamam: number };
type Ay = { ad: string; toplam: number; tamam: number; yuzde: number; isGunuKaldi: number; kdvSonGun: string; kdvKalanGun: number; haftaninSonIsGunu: boolean; asamalar?: Asamalar };
type AkisGunu = { etiket: string; tarih: string; fatura: number; belge: number; bugun: boolean; haftaSonu: boolean };
type Bugun = { tarih: string; gun: number; saat: number; ay: Ay; akis?: AkisGunu[]; konular: Konu[]; uretimZamani: string; onbellekten: boolean };

const TARIH = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

type Ton = 'acil' | 'dikkat' | 'bilgi' | 'bekleme';
const ton = (P: Palet): Record<Ton, { bg: string; border: string; color: string }> => ({
  acil:    { bg: rgba(P.acil, 0.12), border: rgba(P.acil, 0.34), color: P.acil },
  dikkat:  { bg: rgba(P.b, 0.12),    border: rgba(P.b, 0.34),    color: P.b },
  bilgi:   { bg: rgba(P.a, 0.10),    border: rgba(P.a, 0.30),    color: P.a },
  bekleme: { bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.10)', color: 'rgba(250,250,249,0.6)' },
});
type Rozet = { metin: string; ton: Ton; puan: number };
type Mukellef = { id: string; ad: string; rozetler: Rozet[]; puan: number; href: string };

const tlKisa = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} M` : n.toLocaleString('tr-TR'));
function bas(ad: string) {
  const k = ad.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return (k.length >= 2 ? k[0][0] + k[1][0] : (k[0] || '?').slice(0, 2)).toLocaleUpperCase('tr-TR');
}
/** "Vekaletname — FAMCOFFEE" → { konu: 'Vekaletname', ad: 'FAMCOFFEE' } */
function ayir(metin: string) {
  const i = metin.lastIndexOf(' — ');
  return i > 0 ? { konu: metin.slice(0, i), ad: metin.slice(i + 3) } : { konu: '', ad: metin };
}

/** Konu/ayrıntı satırlarını mükellef başına rozetlere çevirir; puan = aciliyet */
function mukelleflereDagit(konular: Konu[]): { mukellefler: Mukellef[]; genel: Konu[] } {
  const m = new Map<string, Mukellef>();
  const genel: Konu[] = [];
  const ekle = (id: string, ad: string, r: Rozet) => {
    const x = m.get(id) || { id, ad, rozetler: [], puan: 0, href: `/panel/mukellefler/${id}` };
    if (ad.length > x.ad.length) x.ad = ad;
    x.rozetler.push(r); x.puan += r.puan; m.set(id, x);
  };
  const rozet = (k: Konu, d: Detay | null): Rozet => {
    const sayi = d ? d.sayi ?? null : k.sayi ?? null;
    const alt = (d ? d.alt : k.aciklama) || '';
    switch (k.kaynak) {
      case 'e-Tebligat': {
        const yeni = /(\d+) yeni/.exec(alt);
        return yeni ? { metin: `${yeni[1]} yeni e-Tebligat`, ton: 'acil', puan: 40 + Number(yeni[1]) * 2 } : { metin: `${sayi ?? ''} okunmamış e-Tebligat`, ton: 'dikkat', puan: 18 };
      }
      case 'Beyanname': return { metin: `${ayir(d ? d.metin : k.baslik).konu} GİB'de hatalı`, ton: 'acil', puan: 35 };
      case 'Mükellef': {
        if (/evrakı gelmedi/.test(k.baslik) || /bekleniyor/.test(alt)) return { metin: `evrak gelmedi · ${sayi}g`, ton: 'dikkat', puan: 12 };
        const asama = /KDV kontrol/.test(alt) ? 'KDV kontrolde' : /beyanname/.test(alt) ? 'beyanname bekliyor' : 'evrak işlenmedi';
        return { metin: `${sayi}g takılı · ${asama}`, ton: (sayi || 0) >= 10 ? 'acil' : 'dikkat', puan: 10 + (sayi || 0) };
      }
      case 'Belge': {
        const konu = ayir(d ? d.metin : k.baslik).konu || 'belge';
        if (/doldu/.test(alt)) return { metin: `${konu} süresi doldu`, ton: 'acil', puan: 30 };
        if (/doluyor/.test(alt)) return { metin: `${konu} ${sayi}g sonra doluyor`, ton: 'dikkat', puan: 6 };
        return { metin: konu ? `yeni: ${konu}` : 'yeni belge geldi', ton: 'bilgi', puan: 2 };
      }
      case 'Tahsilat': return { metin: `${tlKisa(sayi || 0)} TL açık bakiye`, ton: 'dikkat', puan: Math.min(15, Math.round((sayi || 0) / 10000)) };
      case 'Fatura': return /yeni/.test(alt) || k.bolum === 'bugun' ? { metin: `${sayi} yeni fatura`, ton: 'bilgi', puan: 2 } : { metin: `${sayi} fatura işlenmedi`, ton: 'bekleme', puan: Math.min(12, Math.round((sayi || 0) / 50)) };
      case 'Görev': {
        const konu = ayir(d ? d.metin : k.baslik).konu || 'görev';
        return /gecikti/.test(alt) ? { metin: `${konu} · ${sayi}g gecikti`, ton: 'acil', puan: 8 + Math.min(10, (sayi || 0) / 10) } : { metin: `${konu} · bugün`, ton: 'dikkat', puan: 15 };
      }
      default: return { metin: k.baslik, ton: 'bilgi', puan: 1 };
    }
  };
  for (const k of konular) {
    const detayli = k.detay?.filter((d) => d.taxpayerId) || [];
    if (detayli.length) {
      for (const d of detayli) ekle(d.taxpayerId!, ayir(d.metin).ad, rozet(k, d));
      if (k.detay!.length > detayli.length) genel.push(k);
    } else if (k.taxpayerId) {
      ekle(k.taxpayerId, ayir(k.baslik).ad, rozet(k, null));
    } else genel.push(k);
  }
  const mukellefler = [...m.values()].map((x) => ({ ...x, rozetler: x.rozetler.sort((a, b) => b.puan - a.puan) })).sort((a, b) => b.puan - a.puan);
  return { mukellefler, genel };
}

// ---------------- görsel parçalar ----------------
function AsamaSeridi({ a, toplam }: { a: Asamalar; toplam: number }) {
  const P = useTema();
  const parcalar = [
    { k: 'evrakBekliyor', ad: 'evrak bekliyor', renk: 'rgba(250,250,249,0.22)' },
    { k: 'isleniyor', ad: 'işleniyor', renk: P.c },
    { k: 'kontrol', ad: 'KDV kontrol', renk: P.d },
    { k: 'beyan', ad: 'beyanname', renk: P.b },
    { k: 'tamam', ad: 'tamamlandı', renk: P.a },
  ] as const;
  const t = Math.max(1, toplam);
  return (
    <div>
      <div className="flex h-[10px] w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
        {parcalar.map((p) => (a[p.k] > 0 ? <div key={p.k} title={`${a[p.k]} ${p.ad}`} style={{ width: `${(a[p.k] / t) * 100}%`, background: p.renk, boxShadow: p.k === 'tamam' ? `0 0 10px ${rgba(P.a, 0.4)}` : 'none' }} /> : null))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {parcalar.map((p) => (
          <span key={p.k} className="inline-flex items-center gap-1.5 text-[10.5px]" style={{ color: 'rgba(250,250,249,0.6)' }}>
            <span className="w-2 h-2 rounded-sm" style={{ background: p.renk }} />
            <span className="font-bold tabular-nums" style={{ color: 'rgba(250,250,249,0.9)' }}>{a[p.k]}</span> {p.ad}
          </span>
        ))}
      </div>
    </div>
  );
}

function AkisGrafigi({ gunler }: { gunler: AkisGunu[] }) {
  const P = useTema();
  const H = 38, W = 18, ARA = 7;
  const max = Math.max(1, ...gunler.map((g) => g.fatura + g.belge));
  return (
    <svg width={gunler.length * (W + ARA)} height={H + 14} className="block">
      {gunler.map((g, i) => {
        const x = i * (W + ARA);
        const hf = Math.round((g.fatura / max) * H), hb = Math.round((g.belge / max) * H);
        return (
          <g key={g.tarih} opacity={g.bugun ? 1 : g.haftaSonu ? 0.35 : 0.65}>
            <rect x={x} y={0} width={W} height={H} rx={3} fill="rgba(255,255,255,0.04)" />
            {hb > 0 && <rect x={x} y={H - hb} width={W} height={hb} rx={2} fill={P.b} />}
            {hf > 0 && <rect x={x} y={H - hb - hf} width={W} height={hf} rx={2} fill={P.a} />}
            <text x={x + W / 2} y={H + 11} textAnchor="middle" fontSize="8.5" fontWeight={g.bugun ? 800 : 600} fill={g.bugun ? '#f4efe5' : 'rgba(250,250,249,0.5)'}>{g.etiket}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Nabiz({ baslik, sag, children, vurguRenk }: { baslik: string; sag?: React.ReactNode; children: React.ReactNode; vurguRenk: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl px-4 py-3" style={{ background: `radial-gradient(circle at 0% 0%, ${rgba(vurguRenk, 0.08)}, transparent 55%), rgba(255,255,255,0.02)`, border: '1px solid rgba(255,255,255,0.07)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' }}>
      <span className="absolute top-0 left-4 right-4 h-px" style={{ background: `linear-gradient(90deg, transparent, ${vurguRenk}, transparent)`, opacity: 0.55 }} />
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="text-[10px] uppercase font-bold tracking-[.2em]" style={{ color: 'rgba(250,250,249,0.5)' }}>{baslik}</span>
        {sag}
      </div>
      {children}
    </div>
  );
}

function MukellefKarti({ m }: { m: Mukellef }) {
  const P = useTema();
  const enUst = m.rozetler[0]?.ton || 'bilgi';
  const grad = enUst === 'acil' ? `linear-gradient(135deg, ${P.acil}, ${P.b})` : enUst === 'dikkat' ? `linear-gradient(135deg, ${P.b}, ${P.a})` : `linear-gradient(135deg, ${P.a}, ${P.c})`;
  const halo = enUst === 'acil' ? rgba(P.acil, 0.35) : enUst === 'dikkat' ? rgba(P.b, 0.3) : rgba(P.a, 0.25);
  const gorunen = m.rozetler.slice(0, 4);
  const T = ton(P);
  return (
    <Link
      href={m.href}
      className="group relative block rounded-xl p-3.5 transition-all duration-300 hover:-translate-y-[2px]"
      style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.012))', border: '1px solid rgba(255,255,255,0.075)', boxShadow: '0 10px 26px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.03)' }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 14px 34px rgba(0,0,0,0.3), 0 0 0 1px ${halo}`; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 10px 26px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.03)'; }}
    >
      <span className="absolute top-0 left-4 right-4 h-px" style={{ background: grad, opacity: 0.6 }} />
      <div className="flex items-start gap-3">
        <span className="relative shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-[12px] font-black tracking-wide" style={{ background: grad, color: '#0f0d0b', boxShadow: `0 0 18px ${halo}` }}>
          {bas(m.ad)}
          {enUst === 'acil' && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full" style={{ background: P.acil, boxShadow: `0 0 8px ${P.acil}`, border: '2px solid #0a0f0e' }} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold leading-[1.25] line-clamp-2" style={{ color: 'rgba(250,250,249,0.92)' }} title={m.ad}>{m.ad}</span>
          <span className="mt-2 flex flex-wrap gap-1.5">
            {gorunen.map((r, i) => (
              <span key={i} className="inline-flex items-center rounded-full px-2 py-[2px] text-[10.5px] font-semibold leading-tight" style={{ background: T[r.ton].bg, border: `1px solid ${T[r.ton].border}`, color: T[r.ton].color }}>{r.metin}</span>
            ))}
            {m.rozetler.length > 4 && <span className="inline-flex items-center rounded-full px-2 py-[2px] text-[10.5px] font-semibold" style={{ color: 'rgba(250,250,249,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}>+{m.rozetler.length - 4}</span>}
          </span>
        </span>
        <ArrowUpRight size={14} className="shrink-0 opacity-30 transition group-hover:opacity-90" style={{ color: P.b }} />
      </div>
    </Link>
  );
}

const genelRenk = (P: Palet): Record<string, string> => ({ 'Görev': P.acil, 'Onay': P.b, 'Ajan': P.b, 'Fatura': P.a, 'Belge': P.a, 'e-Tebligat': P.acil, 'Beyanname': P.acil, 'Mükellef': P.b, 'Tahsilat': P.b });

export function BugunMasasi({ hitap }: { hitap?: string }) {
  const P = useTema();
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery<Bugun>({ queryKey: ['bugun'], queryFn: () => api.get('/bugun').then((r) => r.data), staleTime: 3 * 60 * 1000, refetchInterval: 5 * 60 * 1000 });
  const yenile = async () => { const r = await api.get('/bugun?force=1').then((res) => res.data); qc.setQueryData(['bugun'], r); };
  const [hepsi, setHepsi] = useState(false);
  const saat = data?.saat ?? new Date().getHours();
  const ay = data?.ay;
  const { mukellefler, genel } = useMemo(() => mukelleflereDagit(data?.konular ?? []), [data]);
  const tahsilat = data?.konular.find((k) => k.kaynak === 'Tahsilat');
  const USTE = 8;
  const gorunen = hepsi ? mukellefler : mukellefler.slice(0, USTE);
  const baglam = [TARIH, ay?.haftaninSonIsGunu ? 'haftanın son iş günü' : null, ay ? `KDV son günü ${ay.kdvSonGun} · ${ay.kdvKalanGun} gün` : null].filter(Boolean).join('  ·  ');

  return (
    <div className="rounded-2xl overflow-hidden relative" style={{ background: P.arka, border: `1px solid ${P.kenar}`, boxShadow: '0 18px 44px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.035)' }}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: P.cizgi }} />
      <div className="pointer-events-none absolute inset-y-5 left-0 w-[3px] rounded-r-full" style={{ background: P.serit, boxShadow: `0 0 18px ${P.glow}` }} />

      {/* Üst bant */}
      <div className="px-6 pt-5 pb-4 flex items-start justify-between gap-4 flex-wrap" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.025), transparent)' }}>
        <div className="min-w-0">
          <div className="text-[24px] font-semibold leading-tight tracking-tight" style={{ color: P.metin }}>{selam(saat)}{hitap ? `, ${hitap}` : ''}.</div>
          <div className="mt-1 text-[13.5px] italic" style={{ color: P.b, opacity: 0.85 }}>{motivasyon()}</div>
          <div className="mt-1.5 text-[12px]" style={{ color: 'rgba(250,250,249,0.5)' }}>{baglam}</div>
        </div>
        <div className="flex items-center gap-2">
          {data?.uretimZamani && <span className="text-[10.5px] tabular-nums" style={{ color: 'rgba(250,250,249,0.4)' }}>↻ {Math.max(0, Math.round((Date.now() - new Date(data.uretimZamani).getTime()) / 60000))} dk önce</span>}
          <button onClick={yenile} disabled={isFetching} title="Masayı yeniden hesapla" className="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition disabled:opacity-50" style={{ background: rgba(P.a, 0.055), border: `1px solid ${rgba(P.a, 0.14)}`, color: 'rgba(221,246,238,0.72)' }}>
            {isFetching ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Yenile
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[13px] px-6 py-5" style={{ color: 'rgba(250,250,249,0.5)' }}><Loader2 size={13} className="animate-spin" /> Masa hazırlanıyor…</div>
      ) : (
        <>
          {/* Nabız şeridi */}
          <div className="px-6 grid grid-cols-1 lg:grid-cols-[1.5fr_auto_1.2fr] gap-3">
            {ay?.asamalar && (
              <Nabiz baslik={`${ay.ad} akışı · ${ay.toplam} mükellef`} vurguRenk={P.a} sag={<span className="text-[11px] tabular-nums" style={{ color: 'rgba(250,250,249,0.6)' }}><b style={{ color: P.a }}>%{ay.yuzde}</b> tamam · {ay.isGunuKaldi} iş günü kaldı</span>}>
                <AsamaSeridi a={ay.asamalar} toplam={ay.toplam} />
              </Nabiz>
            )}
            {!!data?.akis?.length && (
              <Nabiz baslik="7 gün belge akışı" vurguRenk={P.b} sag={<span className="text-[11px] font-bold tabular-nums" style={{ color: '#f4efe5' }}>{data.akis.reduce((t, g) => t + g.fatura + g.belge, 0).toLocaleString('tr-TR')}</span>}>
                <AkisGrafigi gunler={data.akis} />
              </Nabiz>
            )}
            {tahsilat && (
              <Nabiz baslik="Tahsilat" vurguRenk={P.b} sag={<Link href="/panel/cari-kasa" className="text-[10.5px] font-bold inline-flex items-center gap-0.5" style={{ color: P.b }}>Cari Kasa <ArrowUpRight size={10} /></Link>}>
                <div className="text-[18px] font-bold tabular-nums leading-none" style={{ color: '#f4efe5' }}>{(tahsilat.sayi || 0).toLocaleString('tr-TR')} <span className="text-[11px] font-semibold" style={{ color: 'rgba(250,250,249,0.5)' }}>TL açık · {tahsilat.baslik.split(' ')[0]} mükellef</span></div>
                {!!tahsilat.detay?.length && (() => {
                  const toplam = tahsilat.sayi || 1; const ilk = tahsilat.detay!.slice(0, 5); const digerPay = Math.max(0, 1 - ilk.reduce((t, d) => t + (d.sayi || 0), 0) / toplam);
                  const tonlar = [P.b, rgba(P.b, 0.85), rgba(P.b, 0.7), rgba(P.b, 0.55), rgba(P.b, 0.4)];
                  return (
                    <>
                      <div className="mt-2 flex h-[8px] w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        {ilk.map((d, i) => <div key={d.id} title={`${d.metin} · ${(d.sayi || 0).toLocaleString('tr-TR')} TL`} style={{ width: `${((d.sayi || 0) / toplam) * 100}%`, background: tonlar[i] }} />)}
                        <div style={{ width: `${digerPay * 100}%`, background: 'rgba(255,255,255,0.12)' }} />
                      </div>
                      <div className="mt-1.5 text-[10.5px] truncate" style={{ color: 'rgba(250,250,249,0.55)' }}>{ilk.slice(0, 3).map((d) => `${d.metin.split(' ').slice(0, 2).join(' ')} ${tlKisa(d.sayi || 0)}`).join(' · ')}</div>
                    </>
                  );
                })()}
              </Nabiz>
            )}
          </div>

          {/* Mükellef kartları */}
          <div className="px-6 pt-5 pb-2 flex items-baseline justify-between gap-3">
            <span className="text-[10.5px] uppercase font-bold tracking-[.24em]" style={{ color: 'rgba(221,246,238,0.72)' }}>Bugün masanızda</span>
            <span className="text-[11px]" style={{ color: 'rgba(250,250,249,0.45)' }}>{mukellefler.length} mükellef · aciliyet sırasıyla</span>
          </div>
          {mukellefler.length ? (
            <div className="px-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
              {gorunen.map((m) => <MukellefKarti key={m.id} m={m} />)}
            </div>
          ) : (
            <div className="px-6 py-3 text-[12.5px]" style={{ color: 'rgba(250,250,249,0.45)' }}>Bugün ilgilenilecek mükellef yok — masa temiz.</div>
          )}
          {mukellefler.length > USTE && (
            <div className="px-6 pt-2">
              <button onClick={() => setHepsi(!hepsi)} className="w-full flex items-center justify-center gap-1 py-2 rounded-lg text-[11.5px] font-semibold transition hover:bg-white/[0.03]" style={{ border: `1px dashed ${rgba(P.b, 0.25)}`, color: P.b }}>
                {hepsi ? 'daha az göster' : `+${mukellefler.length - USTE} mükellef daha`} <ChevronDown size={12} style={{ transform: hepsi ? 'rotate(180deg)' : 'none' }} />
              </button>
            </div>
          )}

          {/* Genel işler */}
          {genel.length > 0 && (
            <div className="px-6 pt-4 pb-5">
              <div className="text-[10.5px] uppercase font-bold tracking-[.24em] mb-2" style={{ color: 'rgba(221,246,238,0.72)' }}>Genel işler</div>
              <div className="flex flex-wrap gap-2">
                {genel.map((k) => {
                  const renk = genelRenk(P)[k.kaynak] || P.b;
                  const ic = (
                    <span className="inline-flex items-center gap-2 rounded-full pl-2.5 pr-3 py-1.5 text-[12px] transition hover:brightness-125" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(250,250,249,0.86)' }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: renk, boxShadow: `0 0 6px ${rgba(renk, 0.55)}` }} />
                      <span className="font-semibold">{k.baslik}</span>
                      {k.aciklama && <span className="hidden xl:inline" style={{ color: 'rgba(250,250,249,0.45)' }}>· {k.aciklama.length > 48 ? k.aciklama.slice(0, 48) + '…' : k.aciklama}</span>}
                      {k.href && <ArrowUpRight size={11} style={{ color: P.b, opacity: 0.7 }} />}
                    </span>
                  );
                  return k.href ? <Link key={k.id} href={k.href}>{ic}</Link> : <span key={k.id}>{ic}</span>;
                })}
              </div>
            </div>
          )}
          {!genel.length && <div className="h-5" />}
        </>
      )}
    </div>
  );
}
