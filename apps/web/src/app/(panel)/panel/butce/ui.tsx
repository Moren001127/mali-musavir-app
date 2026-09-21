'use client';
import { portalStyle } from '@/lib/portal-theme';


import React from 'react';
import { X, Loader2 } from 'lucide-react';

/* ===== Palet — portal imzası (koyu zemin + altın aksan) =====
 * Satır içi renkler KOYU tema (A) içindir. Beyaz temada (D) görünüm `data-butce-*` /
 * `data-ton` kancaları + butce-white.css ile verilir (bilgi/BEYAZ-TEMA-TASARIM-DILI.md):
 * altın → çivit, yeşil gelir, kırmızı/kehribar gider, mor kart/AI, mavi bilgi, kurşuni nötr.
 */
export const GOLD = '#e6c878';
export const GOLD_SOFT = '#d4b876';
export const OK = '#5ad18a';
export const KIRMIZI = '#e0697a';
export const TURUNCU = '#d9a06c';
export const MAVI = '#8cbde8';
export const MOR = '#b0a0e0';
export const TEXT = '#e7e7ea';
export const MUTED = '#71717a';
export const CARD_BG = 'rgba(255,255,255,0.018)';
export const CARD_BORDER = 'rgba(255,255,255,0.06)';
export const ROW_SEP = 'rgba(255,255,255,0.05)';

/* ===== Ton adı (beyaz tema kancası) =====
 * Rengi anlam ailesine çevirir; CSS bu adı rehber paletine bağlar. Bilinen sabitler
 * doğrudan, kullanıcı seçimi renkler (hesap/kart/kategori) ise ton açısına göre eşlenir.
 */
const TON_HARITASI: Record<string, string> = {
  '#e6c878': 'civit', '#d4b876': 'civit', '#5ad18a': 'yesil', '#e0697a': 'kirmizi', '#d9a06c': 'kehribar',
  '#8cbde8': 'mavi', '#b0a0e0': 'mor', '#71717a': 'kursun', '#e7e7ea': 'kursun', '#f09aa8': 'gul', '#9da8b7': 'kursun',
  '#d8ad70': 'kehribar', '#6aa9e8': 'mavi', '#ff5f6d': 'kirmizi', '#8b8b93': 'kursun',
};
export function tonAdi(renk?: string | null): string {
  const r = String(renk || '').trim().toLowerCase();
  if (!r) return 'civit';
  if (TON_HARITASI[r]) return TON_HARITASI[r];
  const m = /^#([\da-f]{3}|[\da-f]{6})$/.exec(r);
  if (!m) return 'civit';
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [cr, cg, cb] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const max = Math.max(cr, cg, cb);
  const min = Math.min(cr, cg, cb);
  const fark = max - min;
  if (fark < 24 || fark / (max || 1) < 0.1) return 'kursun';
  let hue = max === cr ? ((cg - cb) / fark) % 6 : max === cg ? (cb - cr) / fark + 2 : (cr - cg) / fark + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 335) return 'kirmizi';
  if (hue < 70) return 'kehribar';
  if (hue < 165) return 'yesil';
  if (hue < 195) return 'deniz';
  if (hue < 255) return 'mavi';
  if (hue < 300) return 'mor';
  return 'gul';
}

/* ===== Kutu ===== */
export function Kutu({
  baslik,
  aciklama,
  renk = GOLD,
  sag,
  children,
  className = '',
  style,
}: {
  baslik?: React.ReactNode;
  /** Kısa açıklama; Ekip iş panelinde durum satırı (ReactNode) da geçer. */
  aciklama?: React.ReactNode;
  renk?: string;
  sag?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section data-portal-card data-butce-kutu data-ton={tonAdi(renk)}
      className={`relative overflow-hidden rounded-2xl ${className}`}
      style={portalStyle({
        background: CARD_BG,
        border: `1px solid ${CARD_BORDER}`,
        boxShadow: '0 18px 44px rgba(0,0,0,0.24)',
        ...style,
      })}
    >
      <div data-butce-parilti
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={portalStyle({ background: `linear-gradient(90deg, transparent, ${renk}66, transparent)` })}
      />
      {baslik && (
        <header data-portal-band data-butce-kutu-baslik className="flex items-start justify-between gap-3 px-5 pt-4 pb-3" style={{ '--band-tone': portalStyle({ color: renk }).color } as React.CSSProperties}>
          <div data-butce-kutu-metin>
            <h3 className="text-[13px] font-semibold tracking-wide" style={portalStyle({ color: TEXT })}>
              {baslik}
            </h3>
            {aciklama && (
              <p className="mt-0.5 text-[11px]" style={portalStyle({ color: MUTED })}>
                {aciklama}
              </p>
            )}
          </div>
          {sag}
        </header>
      )}
      <div data-butce-kutu-govde className={baslik ? 'px-5 pb-5' : 'p-5'}>{children}</div>
    </section>
  );
}

/* ===== KPI kartı ===== */
export function KPI({
  etiket,
  deger,
  altBilgi,
  renk = GOLD,
  ikon,
  vurgu,
}: {
  etiket: string;
  deger: string;
  altBilgi?: string;
  renk?: string;
  ikon?: React.ReactNode;
  vurgu?: boolean;
}) {
  return (
    <div
      data-portal-kpi data-butce-kpi data-ton={tonAdi(renk)} data-vurgu={vurgu ? 'true' : 'false'}
      className="relative overflow-hidden rounded-2xl px-4 py-3.5"
      style={portalStyle({
        ...({ '--kpi-tone': portalStyle({ color: renk }).color } as React.CSSProperties),
        background: vurgu
          ? `linear-gradient(140deg, ${renk}1f, rgba(255,255,255,0.01) 60%)`
          : CARD_BG,
        border: `1px solid ${vurgu ? `${renk}3d` : CARD_BORDER}`,
        boxShadow: '0 14px 32px rgba(0,0,0,0.20)',
      })}
    >
      <div data-butce-parilti
        className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-[0.16]"
        style={portalStyle({ background: `radial-gradient(circle, ${renk}, transparent 68%)` })}
      />
      <div data-butce-kpi-ust className="flex items-center gap-2">
        {ikon && <span data-butce-kpi-ikon style={portalStyle({ color: renk })}>{ikon}</span>}
        <span data-butce-kpi-etiket className="text-[11px] uppercase tracking-wider" style={portalStyle({ color: MUTED })}>
          {etiket}
        </span>
      </div>
      <div data-butce-kpi-deger className="mt-1.5 text-[21px] font-semibold tabular-nums" style={portalStyle({ color: renk })}>
        {deger}
      </div>
      {altBilgi && (
        <div data-butce-kpi-alt className="mt-0.5 text-[11px]" style={portalStyle({ color: MUTED })}>
          {altBilgi}
        </div>
      )}
    </div>
  );
}

/* ===== Rozet ===== */
export function Rozet({ metin, renk = GOLD }: { metin: string; renk?: string }) {
  return (
    <span
      data-butce-rozet data-ton={tonAdi(renk)}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={portalStyle({ background: `${renk}1f`, border: `1px solid ${renk}44`, color: renk })}
    >
      {metin}
    </span>
  );
}

/* ===== Düğme ===== */
export function Dugme({
  children,
  onClick,
  tur = 'ikincil',
  renk = GOLD,
  yukleniyor,
  disabled,
  type = 'button',
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tur?: 'birincil' | 'ikincil' | 'sade' | 'tehlike';
  renk?: string;
  yukleniyor?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  const c = tur === 'tehlike' ? KIRMIZI : renk;
  const stiller: React.CSSProperties =
    tur === 'birincil'
      ? { background: `linear-gradient(140deg, ${c}dd, ${c}99)`, color: '#0b0b0d', border: `1px solid ${c}` }
      : tur === 'sade'
        ? { background: 'transparent', color: MUTED, border: '1px solid transparent' }
        : { background: `${c}14`, color: c, border: `1px solid ${c}3d` };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || yukleniyor}
      data-butce-dugme={tur} data-ton={tonAdi(c)}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      style={portalStyle(stiller)}
    >
      {yukleniyor && <Loader2 size={13} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ===== Form alanı ===== */
export function Alan({
  etiket,
  children,
  ipucu,
  genis,
}: {
  etiket: string;
  children: React.ReactNode;
  ipucu?: string;
  genis?: boolean;
}) {
  return (
    <label data-butce-alan className={`block ${genis ? 'sm:col-span-2' : ''}`}>
      <span data-butce-alan-etiket className="mb-1 block text-[11px] font-medium" style={portalStyle({ color: MUTED })}>
        {etiket}
      </span>
      {children}
      {ipucu && (
        <span data-butce-alan-ipucu className="mt-1 block text-[10px]" style={portalStyle({ color: 'rgba(113,113,122,0.85)' })}>
          {ipucu}
        </span>
      )}
    </label>
  );
}

export const girdiStil: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.03)',
  border: `1px solid ${CARD_BORDER}`,
  borderRadius: 10,
  padding: '7px 10px',
  fontSize: 13,
  color: TEXT,
  outline: 'none',
};

export function Girdi(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input data-butce-girdi {...props} style={portalStyle({ ...girdiStil, ...(props.style || {}) })} />;
}

export function Secim(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      data-butce-girdi
      {...props}
      style={portalStyle({ ...girdiStil, ...(props.style || {}) })}
      className={`[&>option]:bg-[#0c0c0e] ${props.className || ''}`}
    />
  );
}

/* ===== Modal ===== */
export function Modal({
  baslik,
  aciklama,
  kapat,
  children,
  genislik = 560,
}: {
  baslik: string;
  aciklama?: string;
  kapat: () => void;
  children: React.ReactNode;
  genislik?: number;
}) {
  return (
    <div
      data-butce data-butce-modal-perde
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={portalStyle({ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' })}
      onClick={kapat}
    >
      <div
        data-butce-modal
        className="relative w-full rounded-2xl"
        style={portalStyle({
          maxWidth: genislik,
          background: 'linear-gradient(160deg, #0f0f12, #0a0a0c)',
          border: `1px solid ${CARD_BORDER}`,
          boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
        })}
        onClick={(e) => e.stopPropagation()}
      >
        <div data-butce-parilti
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={portalStyle({ background: `linear-gradient(90deg, transparent, ${GOLD}55, transparent)` })}
        />
        <header data-butce-modal-baslik className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div>
            <h3 className="text-[14px] font-semibold" style={portalStyle({ color: TEXT })}>
              {baslik}
            </h3>
            {aciklama && (
              <p className="mt-0.5 text-[11px]" style={portalStyle({ color: MUTED })}>
                {aciklama}
              </p>
            )}
          </div>
          <button
            onClick={kapat}
            data-butce-ikon-dugme
            className="rounded-lg p-1 transition hover:bg-white/[0.06]"
            style={portalStyle({ color: MUTED })}
            aria-label="Kapat"
          >
            <X size={16} />
          </button>
        </header>
        <div data-butce-modal-govde className="px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

/* ===== Boş durum ===== */
export function Bos({ metin, ikon }: { metin: string; ikon?: React.ReactNode }) {
  return (
    <div
      data-butce-bos
      className="flex flex-col items-center justify-center gap-2 rounded-xl py-10 text-center"
      style={portalStyle({ border: `1px dashed ${CARD_BORDER}`, color: MUTED })}
    >
      {ikon}
      <span className="text-[12px]">{metin}</span>
    </div>
  );
}

/* ===== Yükleniyor ===== */
export function Yukleniyor({ metin = 'Yükleniyor…' }: { metin?: string }) {
  return (
    <div data-butce data-butce-yukleniyor className="flex items-center justify-center gap-2 py-10 text-[12px]" style={portalStyle({ color: MUTED })}>
      <Loader2 size={15} className="animate-spin" />
      {metin}
    </div>
  );
}

/* ===== Basit çubuk grafik (gelir/gider trendi) ===== */
export function TrendGrafik({
  veri,
  yukseklik = 132,
}: {
  veri: Array<{ donem: string; gelir: number; gider: number }>;
  yukseklik?: number;
}) {
  const max = Math.max(1, ...veri.flatMap((v) => [v.gelir, v.gider]));
  const genislikBirim = 100 / Math.max(veri.length, 1);
  return (
    <div className="w-full">
      <svg data-butce-grafik viewBox={`0 0 100 ${yukseklik}`} preserveAspectRatio="none" style={portalStyle({ width: '100%', height: yukseklik })}>
        {[0.25, 0.5, 0.75].map((o) => (
          <line
            key={o}
            x1="0"
            x2="100"
            y1={yukseklik * o}
            y2={yukseklik * o}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth="0.5"
          />
        ))}
        {veri.map((v, i) => {
          const x = i * genislikBirim;
          const bar = genislikBirim * 0.3;
          const gy = (v.gelir / max) * (yukseklik - 18);
          const gdy = (v.gider / max) * (yukseklik - 18);
          return (
            <g key={v.donem}>
              <rect
                data-seri="gelir"
                x={x + genislikBirim * 0.14}
                y={yukseklik - 14 - gy}
                width={bar}
                height={Math.max(gy, 0.6)}
                rx="1"
                fill={OK}
                opacity="0.85"
              />
              <rect
                data-seri="gider"
                x={x + genislikBirim * 0.5}
                y={yukseklik - 14 - gdy}
                width={bar}
                height={Math.max(gdy, 0.6)}
                rx="1"
                fill={KIRMIZI}
                opacity="0.85"
              />
            </g>
          );
        })}
      </svg>
      <div data-butce-grafik-eksen className="mt-1 flex justify-between text-[9.5px]" style={portalStyle({ color: MUTED })}>
        {veri.map((v) => (
          <span key={v.donem} className="flex-1 text-center">
            {v.donem.slice(5)}.{v.donem.slice(2, 4)}
          </span>
        ))}
      </div>
      <div data-butce-grafik-aciklama className="mt-2 flex items-center justify-center gap-4 text-[10px]" style={portalStyle({ color: MUTED })}>
        <span className="flex items-center gap-1">
          <i data-seri="gelir" className="inline-block h-2 w-2 rounded-sm" style={portalStyle({ background: OK })} /> Gelir
        </span>
        <span className="flex items-center gap-1">
          <i data-seri="gider" className="inline-block h-2 w-2 rounded-sm" style={portalStyle({ background: KIRMIZI })} /> Gider
        </span>
      </div>
    </div>
  );
}

/* ===== Yatay oran çubuğu (kategori kırılımı) ===== */
export function OranCubugu({
  kalemler,
}: {
  kalemler: Array<{ ad: string; tutar: number; renk: string }>;
}) {
  const toplam = kalemler.reduce((t, k) => t + k.tutar, 0) || 1;
  return (
    <div className="space-y-2">
      <div data-butce-cubuk className="flex h-2.5 w-full overflow-hidden rounded-full" style={portalStyle({ background: 'rgba(255,255,255,0.04)' })}>
        {kalemler.map((k) => (
          <div key={k.ad} style={portalStyle({ width: `${(k.tutar / toplam) * 100}%`, background: k.renk })} title={k.ad} />
        ))}
      </div>
    </div>
  );
}

/* ===== Para girdisi =====
 * Yazarken binlik ayracını (1.234.567,89) canlı uygular. Kullanıcı yalnız rakam
 * ve virgül yazar; nokta otomatik yerleşir. Değer dışarı biçimli metin olarak
 * çıkar, kaydederken paraCoz() ile sayıya dönüşür.
 */
export function paraBicimle(ham: string): string {
  const temiz = String(ham ?? '').replace(/[^\d,]/g, '');
  if (!temiz) return '';
  const [tamHam, ...kalan] = temiz.split(',');
  const tam = tamHam.replace(/^0+(?=\d)/, '');
  const tamBicimli = tam.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const ondalik = kalan.length ? ',' + kalan.join('').slice(0, 2) : '';
  return (tamBicimli || '0') + ondalik;
}

/** Biçimli metni sayıya çevirir: "1.234,56" → 1234.56 */
export function paraCoz(bicimli: string | number | null | undefined): number {
  if (typeof bicimli === 'number') return Number.isFinite(bicimli) ? bicimli : 0;
  const s = String(bicimli ?? '').replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Sayıyı forma yerleştirmek için biçimli metne çevirir: 1234.56 → "1.234,56" */
export function paraGiris(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '';
  const v = Number(n);
  if (v === 0) return '';
  return paraBicimle(String(v).replace('.', ','));
}

export function ParaGirdi({
  value,
  onChange,
  placeholder = '0,00',
  autoFocus,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <input
        data-butce-girdi
        value={value}
        onChange={(e) => onChange(paraBicimle(e.target.value))}
        placeholder={placeholder}
        inputMode="decimal"
        autoFocus={autoFocus}
        disabled={disabled}
        style={portalStyle({ ...girdiStil, paddingRight: 26, textAlign: 'right', fontVariantNumeric: 'tabular-nums' })}
      />
      <span
        data-butce-girdi-ek
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px]"
        style={portalStyle({ color: MUTED })}
      >
        ₺
      </span>
    </div>
  );
}

/* ===== Anahtar (aç/kapa) ===== */
export function Anahtar({
  acik,
  degistir,
  renk = GOLD,
}: {
  acik: boolean;
  degistir: (v: boolean) => void;
  renk?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={acik}
      onClick={() => degistir(!acik)}
      data-butce-anahtar data-ton={tonAdi(renk)}
      className="relative inline-flex h-[22px] w-[40px] flex-shrink-0 items-center rounded-full transition-colors"
      style={portalStyle({
        background: acik ? renk + '33' : 'rgba(255,255,255,0.06)',
        border: '1px solid ' + (acik ? renk + '66' : CARD_BORDER),
      })}
    >
      <span
        data-butce-anahtar-top
        className="absolute h-[15px] w-[15px] rounded-full transition-all"
        style={portalStyle({
          left: acik ? 21 : 3,
          background: acik ? renk : '#6b6b73',
          boxShadow: acik ? '0 0 10px ' + renk + '88' : 'none',
        })}
      />
    </button>
  );
}

/* ===== Renk seçici (hazır palet + serbest seçim) ===== */
export const PALET = ['#e6c878', '#5ad18a', '#e0697a', '#d9a06c', '#8cbde8', '#b0a0e0', '#f09aa8', '#9da8b7'];

export function RenkSecici({ deger, degistir }: { deger: string; degistir: (v: string) => void }) {
  return (
    <div data-butce-renkler className="flex items-center gap-1.5">
      {PALET.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => degistir(r)}
          data-butce-renk data-ton={tonAdi(r)} data-secili={deger === r ? 'true' : 'false'}
          className="h-5 w-5 rounded-full transition-transform hover:scale-110"
          style={portalStyle({
            background: r,
            border: deger === r ? '2px solid #fff' : '1px solid rgba(255,255,255,0.15)',
            boxShadow: deger === r ? '0 0 0 2px ' + r + '55' : 'none',
          })}
          aria-label={r}
        />
      ))}
      <label data-butce-renk-ozel className="relative h-5 w-5 cursor-pointer overflow-hidden rounded-full" style={portalStyle({ border: '1px dashed rgba(255,255,255,0.28)' })}>
        <input
          type="color"
          value={deger}
          onChange={(e) => degistir(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        <span
          className="pointer-events-none absolute inset-0"
          style={portalStyle({ background: 'conic-gradient(#e6c878,#5ad18a,#8cbde8,#b0a0e0,#e0697a,#e6c878)', opacity: 0.75 })}
        />
      </label>
    </div>
  );
}
