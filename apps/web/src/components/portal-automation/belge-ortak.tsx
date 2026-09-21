'use client';
import { portalStyle, portalCss } from '@/lib/portal-theme';
import './portal-automation-white.css';


// e-Tebligat / SGK ortak parçaları (2026-09-14, sayfalama sözleşmesi §6):
//   iletim rozeti · tebliğ rozeti · mükellef seçici · PDF önizleme modalı · gece sorgu hatası modalı
//   · hata şeridi · adres çubuğu sayfa/boyut kancası · gecikmeli arama kancası.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle, ChevronDown, Download, FileText, KeyRound, Mail, MessageCircle, Users, X,
  Clock3,
} from 'lucide-react';
import { boyutParamOku, sayfaParamOku, type SayfaBoyutu } from '@/components/ui/Sayfalama';
import type {
  BelgeMukellefi, BelgeSatiri, IletimBilgisi, PortalGeceHatasi, PortalSifreBekleyen,
} from '@/lib/portal-automation';

export const GOLD = '#d4b876';
export const METIN = '#fafaf9';

// Rozet renk dili: yeşil (iletildi) · kırmızı (iletilemedi/hata) · sarı (yaklaşan) · gri (edildi/olmayan).
export const TON = {
  yesil: { fg: '#5cbf8a', bg: 'rgba(92,191,138,0.12)', bd: 'rgba(92,191,138,0.35)' },
  kirmizi: { fg: '#e2706f', bg: 'rgba(226,112,111,0.12)', bd: 'rgba(226,112,111,0.4)' },
  sari: { fg: '#d4a85f', bg: 'rgba(212,168,95,0.12)', bd: 'rgba(212,168,95,0.4)' },
  gri: { fg: 'rgba(250,250,249,.38)', bg: 'rgba(255,255,255,0.03)', bd: 'rgba(255,255,255,0.1)' },
} as const;
export type Ton = keyof typeof TON;

// Araç çubuğu alanları (arama kutusu / seçici) ortak görünümü.
export const ALAN_STILI: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: METIN };

export function mukellefAdi(tp?: BelgeSatiri['taxpayer'] | null): string {
  if (!tp) return '—';
  if (tp.companyName) return tp.companyName;
  const ad = [tp.firstName, tp.lastName].filter(Boolean).join(' ').trim();
  return ad || tp.taxNumber || '—';
}

// "20/05/2026 09:25:51" -> "20/05/2026 09:25"; ISO ise gün/ay/yıl saat:dakika.
export function fmtTrTarih(v: unknown): string {
  if (!v) return '—';
  const s = String(v).trim();
  const tr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (tr) return `${tr[1]}/${tr[2]}/${tr[3]} ${tr[4]}:${tr[5]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (iso) {
    // ISO ise yerel saate çevir (sunucu UTC yazar).
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return `${iso[3]}/${iso[2]}/${iso[1]} ${iso[4]}:${iso[5]}`;
  }
  return s.slice(0, 16);
}

// ISO -> "12 Eyl" (rozetlerde).
export function kisaTarih(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

// 690.09 -> "690,09 ₺"
export function tutarBicimle(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
}

// Takvim günü farkı (yerel): bugün=0, yarın=1 …
function takvimGunFarki(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const hedef = new Date(iso);
  if (Number.isNaN(hedef.getTime())) return null;
  const simdi = new Date();
  const a = new Date(hedef.getFullYear(), hedef.getMonth(), hedef.getDate()).getTime();
  const b = new Date(simdi.getFullYear(), simdi.getMonth(), simdi.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

// Kenarlıklı küçük hap (11px).
export function Hap({ ton, title, children, className = '', sar = false }: { ton: Ton; title?: string; children: React.ReactNode; className?: string; /** dar hücrede metin alt satıra sarabilsin */ sar?: boolean }) {
  const t = TON[ton];
  return (
    <span
      title={title}
      data-pa-hap={ton}
      className={`inline-flex items-center gap-1 px-2 py-[2px] rounded-md text-[11px] font-semibold ${sar ? 'whitespace-normal text-center leading-snug max-w-[150px]' : 'whitespace-nowrap'} ${className}`}
      style={portalStyle({ background: t.bg, border: `1px solid ${t.bd}`, color: t.fg })}
    >
      {children}
    </span>
  );
}

// İletim göstergesi — YALNIZ İKON (Muzaffer Bey 2026-09-14): kanal başına küçük yuvarlak simge.
//   WhatsApp yeşil · e-posta mavi · iletilemedi kırmızı · sırada sarı saat · test modu altın nokta; ayrıntı ipucunda.
//   Hiç kayıt yoksa soluk "—" (hücre boş kalmasın, dar sütun).
export function IletimRozeti({ iletim }: { iletim?: IletimBilgisi[] | null }) {
  const map = new Map<IletimBilgisi['channel'], IletimBilgisi>();
  for (const i of iletim || []) if (!map.has(i.channel)) map.set(i.channel, i);
  const kayitlar = (['WHATSAPP', 'EMAIL'] as const).map((k) => map.get(k)).filter((x): x is IletimBilgisi => !!x);
  if (!kayitlar.length) return <span data-pa-faint className="text-[11.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.25)' })}>—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {kayitlar.map((k) => {
        const kanal = k.channel === 'WHATSAPP' ? 'WhatsApp' : 'E-posta';
        const Ikon = k.status === 'PENDING' ? Clock3 : k.channel === 'EMAIL' ? Mail : MessageCircle;
        const ipucu = k.status === 'SENT'
          ? `${kanal} ile iletildi${k.sentAt ? ` · ${fmtTrTarih(k.sentAt)}` : ''}${k.testMode ? ' (test modu)' : ''}`
          : k.status === 'FAILED' ? `${kanal}: iletilemedi${k.error ? ` — ${k.error}` : ''}`
            : k.status === 'PENDING' ? `${kanal} gönderimi sırada` : `${kanal} gönderimi atlandı`;
        const renk = k.status === 'SENT'
          ? (k.channel === 'EMAIL' ? { bg: 'rgba(127,166,221,0.16)', bd: 'rgba(127,166,221,0.5)', fg: '#9cc0ee' } : { bg: 'rgba(92,191,138,0.16)', bd: 'rgba(92,191,138,0.5)', fg: '#5cbf8a' })
          : k.status === 'FAILED' ? { bg: 'rgba(226,112,111,0.16)', bd: 'rgba(226,112,111,0.5)', fg: '#e2706f' }
            : k.status === 'PENDING' ? { bg: 'rgba(212,168,95,0.16)', bd: 'rgba(212,168,95,0.5)', fg: '#d4a85f' }
              : { bg: 'rgba(255,255,255,0.05)', bd: 'rgba(255,255,255,0.14)', fg: 'rgba(250,250,249,0.45)' };
        return (
          <span key={k.channel} data-pa-iletim={k.status} data-pa-kanal={k.channel} className="relative inline-flex h-7 w-7 items-center justify-center rounded-full" title={ipucu} aria-label={ipucu}
            style={portalStyle({ background: renk.bg, border: `1px solid ${renk.bd}`, color: renk.fg })}>
            <Ikon size={13} strokeWidth={2.3} />
            {k.testMode && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" title="test modu" style={portalStyle({ background: '#d4b876', boxShadow: '0 0 0 2px #0f0d0b' })} />}
          </span>
        );
      })}
    </span>
  );
}

// Tebliğ rozeti: yaklasiyor → sarı "yarın / 2 gün içinde tebliğ sayılacak"; edildi → gri "tebliğ edildi"; bekliyor → yok.
export function TebligRozeti({ durum, tebligTarihi, sar = false }: { durum?: BelgeSatiri['ozet']['tebligDurumu']; tebligTarihi?: string | null; sar?: boolean }) {
  if (durum === 'edildi') return <Hap ton="gri">tebliğ edildi</Hap>;
  if (durum === 'yaklasiyor') {
    const kalan = takvimGunFarki(tebligTarihi);
    const metin = kalan === null ? '2 gün içinde tebliğ sayılacak'
      : kalan <= 0 ? 'bugün tebliğ sayılacak'
        : kalan === 1 ? 'yarın tebliğ sayılacak'
          : `${kalan} gün içinde tebliğ sayılacak`;
    return <Hap ton="sari" sar={sar} title={tebligTarihi ? `Tebliğ tarihi: ${fmtTrTarih(tebligTarihi)}` : undefined}>{metin}</Hap>;
  }
  return null;
}

// Mükellef seçici — liste sunucudan (belgeSayisi ile "AD (12)").
export function MukellefSecici({ value, onChange, rows, yukleniyor = false, className = '' }: {
  value: string;
  onChange: (id: string) => void;
  rows: BelgeMukellefi[];
  yukleniyor?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Mükellef"
        data-pa-field
        className="h-[38px] w-full pl-9 pr-8 rounded-[10px] text-[13px] outline-none border appearance-none truncate"
        style={portalStyle(ALAN_STILI)}
      >
        <option value="">{yukleniyor && rows.length === 0 ? 'Mükellefler yükleniyor…' : `Tüm mükellefler (${rows.length})`}</option>
        {rows.map((m) => (
          <option key={m.id} value={m.id}>
            {m.ad} ({m.belgeSayisi}){!m.sifreVar ? ' · şifre yok' : m.sifreHatasi ? ' · şifre hatalı' : ''}
          </option>
        ))}
      </select>
      <Users size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })} />
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })} />
    </div>
  );
}

export type PdfModalDurumu = { url: string; title: string } | null;

// PDF önizleme modalı — createPortal ile body'ye; her zaman ekran ortasında açılır.
export function PdfOnizlemeModali({ modal, onClose }: { modal: PdfModalDurumu; onClose: () => void }) {
  if (!modal || typeof document === 'undefined') return null;
  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center p-3 md:p-8"
      style={portalStyle({ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' })}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-pa-modal="pdf"
        className="relative w-full max-w-5xl h-[90vh] rounded-2xl overflow-hidden border shadow-2xl"
        style={portalStyle({ background: '#1a1410', borderColor: 'rgba(212,184,118,0.25)', animation: 'belgeZoom .22s ease-out' })}
      >
        <div data-pa-modal-head className="flex items-center justify-between px-4 py-2.5 border-b" style={portalStyle({ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' })}>
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={15} style={portalStyle({ color: GOLD, flexShrink: 0 })} />
            <span className="text-[13px] font-semibold truncate" style={portalStyle({ color: METIN })}>{modal.title}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <a
              href={modal.url}
              target="_blank"
              rel="noopener noreferrer"
              data-pa-btn="ikincil"
              className="h-8 px-2.5 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 border hover:brightness-110"
              style={portalStyle({ borderColor: 'rgba(255,255,255,0.12)', color: 'rgba(250,250,249,0.85)' })}
            >
              <Download size={13} /> İndir
            </a>
            <button
              onClick={onClose}
              data-pa-btn="ikincil"
              className="h-8 w-8 grid place-items-center rounded-lg border hover:brightness-110"
              style={portalStyle({ borderColor: 'rgba(255,255,255,0.12)', color: METIN })}
              aria-label="Kapat"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <iframe src={modal.url} title={modal.title} className="w-full" style={portalStyle({ height: 'calc(90vh - 45px)', border: 'none', background: '#fff' })} />
      </div>
      <style>{portalCss(`@keyframes belgeZoom { from { transform: scale(.9); opacity: 0 } to { transform: scale(1); opacity: 1 } }`)}</style>
    </div>,
    document.body,
  );
}

// Gece sorgu hatası satırı: sade metin + küçük gri ham hata (tıkla-aç) + mükellef.
function GeceHataSatiri({ h }: { h: PortalGeceHatasi }) {
  const [hamAcik, setHamAcik] = useState(false);
  const sade = h.hata?.metin || h.reason || 'Sorgu başarısız (sebep belirtilmedi).';
  const ham = h.hata?.ham && h.hata.ham !== sade ? h.hata.ham : '';
  return (
    <div data-pa-hata-satir className="px-3 py-2.5" style={portalStyle({ borderBottom: '1px solid rgba(255,255,255,0.05)' })}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-semibold text-[13px]" style={portalStyle({ color: METIN })}>{h.name}</div>
        {h.taxNumber && <div className="text-[10.5px] tabular-nums flex-shrink-0" style={portalStyle({ color: 'rgba(250,250,249,0.4)' })}>{h.taxNumber}</div>}
      </div>
      <div className="text-[12px] mt-1" style={portalStyle({ color: h.hata?.tur === 'sifre' ? '#ef9a9a' : 'rgba(250,250,249,0.75)' })}>{sade}</div>
      {ham && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setHamAcik((o) => !o)}
            className="text-[10.5px] hover:brightness-125"
            style={portalStyle({ color: 'rgba(250,250,249,0.38)' })}
          >
            {hamAcik ? 'ham hatayı gizle' : 'ham hatayı göster'}
          </button>
          {hamAcik && (
            <pre className="mt-1 whitespace-pre-wrap break-words text-[10.5px] leading-snug rounded-md px-2 py-1.5" style={portalStyle({ color: 'rgba(250,250,249,0.45)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', fontFamily: 'ui-monospace, monospace' })}>
              {ham}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// "Gece sorgusunda sorun" modalı: üstte şifre bekleyenler (3 gece kuralı), altta hata alan mükellefler.
export function GeceHataModali({ acik, onClose, hatalar, sifreBekleyen, altNot }: {
  acik: boolean;
  onClose: () => void;
  hatalar: PortalGeceHatasi[];
  sifreBekleyen: PortalSifreBekleyen[];
  altNot: string;
}) {
  if (!acik || typeof document === 'undefined') return null;
  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={portalStyle({ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)' })}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-pa-modal="hata"
        className="relative w-full max-w-lg max-h-[80vh] rounded-2xl overflow-hidden border shadow-2xl flex flex-col"
        style={portalStyle({ background: '#1a1410', borderColor: 'rgba(226,112,111,0.3)', animation: 'belgeZoom .22s ease-out' })}
      >
        <div data-pa-modal-head className="flex items-center justify-between px-4 py-3 border-b" style={portalStyle({ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(226,112,111,0.06)' })}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} style={portalStyle({ color: TON.kirmizi.fg })} />
            <span className="text-[13px] font-semibold" style={portalStyle({ color: METIN })}>Gece sorgusunda sorun</span>
          </div>
          <button onClick={onClose} data-pa-btn="ikincil" className="h-8 w-8 grid place-items-center rounded-lg border hover:brightness-110" style={portalStyle({ borderColor: 'rgba(255,255,255,0.12)', color: METIN })} aria-label="Kapat"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto p-2">
          {sifreBekleyen.length > 0 && (
            <div data-pa-sifre-kutusu className="mb-2 rounded-xl border" style={portalStyle({ borderColor: 'rgba(212,168,95,0.3)', background: 'rgba(212,168,95,0.06)' })}>
              <div className="px-3 pt-2.5 pb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.1em]" style={portalStyle({ color: TON.sari.fg })}>
                <KeyRound size={12} /> Şifre bekliyor ({sifreBekleyen.length})
              </div>
              {sifreBekleyen.map((s, i) => (
                <div key={`${s.provider}-${s.taxpayerId || i}`} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1" style={portalStyle({ borderTop: '1px solid rgba(255,255,255,0.05)' })}>
                  <span className="font-semibold text-[13px]" style={portalStyle({ color: METIN })}>{s.ad}</span>
                  <span className="text-[11.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.55)' })}>{s.geceSayisi} gecedir sorgu dışı</span>
                  <Link
                    href={s.taxpayerId ? `/panel/mukellefler/${s.taxpayerId}` : '/panel/ayarlar/entegrasyonlar'}
                    className="ml-auto text-[11.5px] font-semibold hover:brightness-125"
                    style={portalStyle({ color: GOLD })}
                  >
                    Şifre Ayarları →
                  </Link>
                  {s.hata?.metin && <div className="w-full text-[11px]" style={portalStyle({ color: 'rgba(250,250,249,0.5)' })}>{s.hata.metin}</div>}
                </div>
              ))}
              <div className="px-3 py-1.5 text-[10.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.4)', borderTop: '1px solid rgba(255,255,255,0.05)' })}>
                3 gece üst üste şifre hatası; şifre güncellenince gece sorgusu kendiliğinden yeniden başlar. "Şimdi sorgula" bu kuraldan bağımsızdır.
              </div>
            </div>
          )}
          {hatalar.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px]" style={portalStyle({ color: 'rgba(250,250,249,0.45)' })}>
              {sifreBekleyen.length > 0 ? 'Son gece başka hata yok.' : 'Hata kaydı yok.'}
            </div>
          ) : hatalar.map((h, i) => <GeceHataSatiri key={h.taxpayerId || i} h={h} />)}
        </div>
        <div data-pa-modal-foot className="px-4 py-2 text-[11px] border-t flex-shrink-0" style={portalStyle({ borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(250,250,249,0.4)' })}>{altNot}</div>
      </div>
      <style>{portalCss(`@keyframes belgeZoom { from { transform: scale(.9); opacity: 0 } to { transform: scale(1); opacity: 1 } }`)}</style>
    </div>,
    document.body,
  );
}

// Kırmızı hata şeridi: "N mükellefte gece sorgu hatası · M şifre bekliyor — görmek için tıkla".
export function HataSeridi({ hataSayisi, sifreBekleyenSayisi, onClick }: { hataSayisi: number; sifreBekleyenSayisi: number; onClick: () => void }) {
  if (hataSayisi <= 0 && sifreBekleyenSayisi <= 0) return null;
  const parcalar: string[] = [];
  if (hataSayisi > 0) parcalar.push(`${hataSayisi} mükellefte gece sorgu hatası`);
  if (sifreBekleyenSayisi > 0) parcalar.push(`${sifreBekleyenSayisi} mükellef şifre bekliyor`);
  return (
    <button
      type="button"
      onClick={onClick}
      data-pa-hata-seridi
      className="w-full rounded-2xl border px-4 py-3 flex items-center gap-2.5 text-left hover:brightness-110 transition"
      style={portalStyle({ background: 'rgba(226,112,111,0.1)', borderColor: 'rgba(226,112,111,0.4)' })}
    >
      <AlertTriangle size={18} style={portalStyle({ color: TON.kirmizi.fg, flexShrink: 0 })} />
      <span className="text-[13px] font-semibold" style={portalStyle({ color: '#ef9a9a' })}>{parcalar.join(' · ')}</span>
      <span className="text-[12px]" style={portalStyle({ color: 'rgba(239,154,154,0.7)' })}>— görmek için tıkla</span>
    </button>
  );
}

// Sayfa + sayfa boyutu adres çubuğunda: ?sayfa=2&boyut=50 (Next useSearchParams + router.replace).
export function useSayfaAdresi(varsayilanBoyut: SayfaBoyutu = 50) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sayfa = sayfaParamOku(searchParams.get('sayfa'));
  const boyut = boyutParamOku(searchParams.get('boyut'), varsayilanBoyut);

  const yaz = useCallback((yeniSayfa: number, yeniBoyut: SayfaBoyutu) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set('sayfa', String(Math.max(1, Math.floor(yeniSayfa))));
    p.set('boyut', String(yeniBoyut));
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }, [router, pathname, searchParams]);

  const setSayfa = useCallback((n: number) => yaz(n, boyut), [yaz, boyut]);
  // Boyut değişince 1. sayfaya dön.
  const setBoyut = useCallback((b: SayfaBoyutu) => yaz(1, b), [yaz]);
  return { sayfa, boyut, setSayfa, setBoyut };
}

// Süzgeç anahtarı DEĞİŞİNCE (ilk yükleme hariç) sayfayı 1'e çeker. Döndürdüğü "etkin sayfa" aynı çizimde 1 olur;
// böylece adres çubuğu güncellenene kadar eski sayfa numarasıyla gereksiz istek gitmez.
export function useSuzgecSayfaSifirla(anahtar: string, sayfa: number, setSayfa: (n: number) => void): number {
  const onceki = useRef(anahtar);
  // Adres çubuğu güncellenene kadar (router.replace eşzamansız) etkin sayfa 1'de tutulur.
  const [sifirlaniyor, setSifirlaniyor] = useState(false);
  const eskiSayfa = useRef<number | null>(null);
  useEffect(() => {
    if (onceki.current === anahtar) return;
    onceki.current = anahtar;
    if (sayfa !== 1) { eskiSayfa.current = sayfa; setSifirlaniyor(true); setSayfa(1); }
  }, [anahtar, sayfa, setSayfa]);
  useEffect(() => {
    if (sifirlaniyor && sayfa !== eskiSayfa.current) setSifirlaniyor(false);
  }, [sifirlaniyor, sayfa]);
  const degisti = onceki.current !== anahtar;
  return degisti || sifirlaniyor ? 1 : sayfa;
}

// 300 ms gecikmeli değer (arama kutusu için).
export function useGecikmeliDeger<T>(deger: T, ms = 300): T {
  const [gecikmeli, setGecikmeli] = useState(deger);
  useEffect(() => {
    const t = setTimeout(() => setGecikmeli(deger), ms);
    return () => clearTimeout(t);
  }, [deger, ms]);
  return gecikmeli;
}
