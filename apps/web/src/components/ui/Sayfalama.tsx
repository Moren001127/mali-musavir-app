'use client';

// Ortak sayfalama şeridi — Beyanname İndirme / e-Tebligat / SGK (2026-09-14).
//   "1–50 / 2.567" · sayfa boyutu (25/50/100) · ilk / önceki / 1 2 … 7 / sonraki / son.
//   Tamamen kontrollü: sayfa ve sayfa boyutu üst bileşende tutulur (adres çubuğuna yazılabilir).
import type { CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export const SAYFA_BOYUTLARI = [25, 50, 100] as const;
export type SayfaBoyutu = (typeof SAYFA_BOYUTLARI)[number];

const METIN = '#fafaf9';
const IKINCIL = 'rgba(250,250,249,.55)';
const SONUK = 'rgba(250,250,249,.38)';
const KENAR = 'rgba(255,255,255,0.08)';
const ZEMIN = 'rgba(255,255,255,0.03)';

export function sayfaSayisi(toplam: number, sayfaBoyutu: number): number {
  return Math.max(1, Math.ceil(Math.max(0, toplam) / Math.max(1, sayfaBoyutu)));
}

/** Gösterilecek sayfa numaraları: 1 … (aktif−1 aktif aktif+1) … son; boşluklar `null`. */
export function sayfaNumaralari(aktif: number, toplamSayfa: number): Array<number | null> {
  if (toplamSayfa <= 7) return Array.from({ length: toplamSayfa }, (_, i) => i + 1);
  const set = new Set<number>([1, toplamSayfa, aktif - 1, aktif, aktif + 1]);
  if (aktif <= 3) [2, 3, 4].forEach((n) => set.add(n));
  if (aktif >= toplamSayfa - 2) [toplamSayfa - 3, toplamSayfa - 2, toplamSayfa - 1].forEach((n) => set.add(n));
  const sirali = [...set].filter((n) => n >= 1 && n <= toplamSayfa).sort((a, b) => a - b);
  const out: Array<number | null> = [];
  for (let i = 0; i < sirali.length; i++) {
    if (i > 0 && sirali[i] - sirali[i - 1] > 1) out.push(null);
    out.push(sirali[i]);
  }
  return out;
}

export function Sayfalama({
  sayfa,
  sayfaBoyutu,
  toplam,
  onSayfa,
  onSayfaBoyutu,
  birim = 'kayıt',
  renk = '#d4b876',
  yukleniyor = false,
  className = '',
}: {
  sayfa: number;
  sayfaBoyutu: number;
  toplam: number;
  onSayfa: (sayfa: number) => void;
  onSayfaBoyutu?: (boyut: SayfaBoyutu) => void;
  /** "kayıt" / "tebligat" / "belge" — aralık metninde kullanılır. */
  birim?: string;
  /** Aktif sayfa rengi (modül vurgu rengi). */
  renk?: string;
  yukleniyor?: boolean;
  className?: string;
}) {
  const toplamSayfa = sayfaSayisi(toplam, sayfaBoyutu);
  const aktif = Math.min(Math.max(1, sayfa), toplamSayfa);
  const bas = toplam === 0 ? 0 : (aktif - 1) * sayfaBoyutu + 1;
  const son = Math.min(aktif * sayfaBoyutu, toplam);
  const git = (n: number) => { const hedef = Math.min(Math.max(1, n), toplamSayfa); if (hedef !== aktif) onSayfa(hedef); };

  const dugme = (aktifMi = false): CSSProperties => ({
    background: aktifMi ? `${renk}22` : ZEMIN,
    border: `1px solid ${aktifMi ? `${renk}66` : KENAR}`,
    color: aktifMi ? renk : IKINCIL,
  });

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${className}`} style={{ borderTop: `1px solid ${KENAR}` }}>
      <div className="flex items-center gap-3 text-[12px]" style={{ color: IKINCIL }}>
        <span className="tabular-nums">
          {toplam === 0 ? `0 ${birim}` : <><b style={{ color: METIN }}>{bas.toLocaleString('tr-TR')}–{son.toLocaleString('tr-TR')}</b> / {toplam.toLocaleString('tr-TR')} {birim}</>}
          {yukleniyor && <span style={{ color: SONUK }}> · yükleniyor…</span>}
        </span>
        {onSayfaBoyutu && (
          <label className="inline-flex items-center gap-1.5" style={{ color: SONUK }}>
            Sayfada
            <select
              value={sayfaBoyutu}
              onChange={(e) => onSayfaBoyutu(Number(e.target.value) as SayfaBoyutu)}
              aria-label="Sayfa boyutu"
              className="h-7 appearance-none rounded-md text-[12px] font-semibold outline-none"
              style={{ width: 'auto', padding: '0 22px 0 8px', background: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238a8a86' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>") no-repeat right 6px center, ${ZEMIN}`, border: `1px solid ${KENAR}`, color: METIN, borderRadius: 6, fontSize: 12 }}
            >
              {SAYFA_BOYUTLARI.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
        )}
      </div>

      {toplamSayfa > 1 && (
        <nav className="flex items-center gap-1" aria-label="Sayfalar">
          <button type="button" onClick={() => git(1)} disabled={aktif === 1} title="İlk sayfa" className="flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-35" style={dugme()}><ChevronsLeft size={14} /></button>
          <button type="button" onClick={() => git(aktif - 1)} disabled={aktif === 1} title="Önceki sayfa" className="flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-35" style={dugme()}><ChevronLeft size={14} /></button>
          {sayfaNumaralari(aktif, toplamSayfa).map((n, i) =>
            n === null ? (
              <span key={`b${i}`} className="px-1 text-[12px]" style={{ color: SONUK }}>…</span>
            ) : (
              <button key={n} type="button" onClick={() => git(n)} aria-current={n === aktif ? 'page' : undefined}
                className="flex h-7 min-w-[28px] items-center justify-center rounded-md px-1.5 text-[12px] font-semibold tabular-nums"
                style={dugme(n === aktif)}>
                {n}
              </button>
            ),
          )}
          <button type="button" onClick={() => git(aktif + 1)} disabled={aktif === toplamSayfa} title="Sonraki sayfa" className="flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-35" style={dugme()}><ChevronRight size={14} /></button>
          <button type="button" onClick={() => git(toplamSayfa)} disabled={aktif === toplamSayfa} title="Son sayfa" className="flex h-7 w-7 items-center justify-center rounded-md disabled:opacity-35" style={dugme()}><ChevronsRight size={14} /></button>
        </nav>
      )}
    </div>
  );
}

/** Adres çubuğundaki `sayfa` / `boyut` değerlerini güvenli sayıya çevirir. */
export function sayfaParamOku(raw: string | null | undefined, varsayilan = 1): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : varsayilan;
}
export function boyutParamOku(raw: string | null | undefined, varsayilan: SayfaBoyutu = 50): SayfaBoyutu {
  const n = Number(raw);
  return (SAYFA_BOYUTLARI as readonly number[]).includes(n) ? (n as SayfaBoyutu) : varsayilan;
}
