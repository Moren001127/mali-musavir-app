'use client';
import { portalStyle } from '@/lib/portal-theme';


import { Fragment, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { Building2, ChevronDown, ChevronRight, ImageOff, MessageCircle, ScanSearch } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sayfalama, type SayfaBoyutu } from '@/components/ui/Sayfalama';
import { SORGU_TURU_ADI, satirToplami, sorguMukellefAdi, type SorguSonucu, type SorguTuru } from '@/lib/genel-sorgular';
import {
  CIP_NOTR, GOLD, GRUP_CIZGI, GRUP_ZEMIN, HUCRE, HUCRE_BASLIK, IKINCIL, KENAR_NOTR, METIN, SONUK, TUR_RENK,
  anahtarAdi, degerMetni, donemEtiketi, para, tarihKisa, tarihSaat,
} from './ortak';

/*
 * Sonuç tablosu — GERÇEK <table>, tür başına AYRI grup: altın tonlu dolu grup bandı + altın büyük harf başlık +
 * soldaki 4px tür şeridi; satırda kısa olgu, tutar sağda; satıra tıklayınca altında detay (veri anahtar-değer).
 * Satır zeminleri tek ton (zebra yok), işlev hover'a saklanmıyor, yapışkan başlık yok.
 */

const BOS_METIN = "Bu sorgu türü henüz Dijital Vergi Dairesi'ne bağlanmadı; mükellef kartındaki Otomatik Sorgulama Ayarı açılınca ve sorgu yolu tanımlanınca burada görünecek.";

type Sutun = {
  baslik: string;
  genislik?: number;
  sag?: boolean;
  hucre: (s: SorguSonucu) => ReactNode;
};

const MUKELLEF: Sutun = {
  baslik: 'Mükellef',
  hucre: (s) => {
    const ad = sorguMukellefAdi(s.taxpayer) || s.taxpayerId;
    const vkn = s.taxpayer?.taxNumber;
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Link
          href={`/panel/mukellefler/${s.taxpayer?.id || s.taxpayerId}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium leading-5 hover:underline decoration-dotted underline-offset-4"
          style={portalStyle({ color: METIN })}
          title={`Mükellef kartını aç: ${ad}`}
        >
          <Building2 size={12} style={portalStyle({ color: IKINCIL, flexShrink: 0 })} />
          <span className="truncate">{ad}</span>
        </Link>
        {vkn && <span className="hidden text-[10.5px] tabular-nums sm:inline" style={portalStyle({ color: SONUK, fontFamily: 'JetBrains Mono, monospace' })}>{vkn}</span>}
      </div>
    );
  },
};
const DONEM: Sutun = { baslik: 'Dönem', genislik: 120, hucre: (s) => <span className="text-[12.5px]" style={portalStyle({ color: IKINCIL })}>{donemEtiketi(s.donem) || '—'}</span> };
const SORGU_TARIHI: Sutun = { baslik: 'Sorgu tarihi', genislik: 140, hucre: (s) => <span className="text-[12.5px] tabular-nums" style={portalStyle({ color: IKINCIL })}>{tarihSaat(s.sorguTarihi) || '—'}</span> };
const OZET: Sutun = { baslik: 'Özet', hucre: (s) => <span className="block truncate text-[12.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.8)' })} title={s.ozet || ''}>{s.ozet || '—'}</span> };
const tutarSutunu = (baslik: string): Sutun => ({
  baslik,
  genislik: 150,
  sag: true,
  hucre: (s) => {
    const n = satirToplami(s);
    return <span className="text-[13px] font-medium tabular-nums" style={portalStyle({ color: n === null ? SONUK : METIN })}>{para(n)}</span>;
  },
});

const SUTUNLAR: Record<SorguTuru, Sutun[]> = {
  VERGI_BORCU: [MUKELLEF, DONEM, SORGU_TARIHI, OZET, tutarSutunu('Toplam borç')],
  E_HACIZ: [
    MUKELLEF,
    SORGU_TARIHI,
    OZET,
    {
      baslik: 'Durum',
      genislik: 140,
      hucre: (s) => {
        const d = s.veri?.durum;
        return d ? <span className="inline-flex whitespace-nowrap rounded-md px-1.5 py-[2px] text-[10.5px] font-medium leading-4" style={portalStyle(CIP_NOTR)}>{degerMetni(d)}</span> : <span style={portalStyle({ color: SONUK })}>—</span>;
      },
    },
  ],
  YOKLAMA_DENETIM: [
    MUKELLEF,
    { baslik: 'Tutanak tarihi', genislik: 130, hucre: (s) => <span className="text-[12.5px] tabular-nums" style={portalStyle({ color: IKINCIL })}>{tarihKisa(typeof s.veri?.tarih === 'string' ? s.veri.tarih : null) || '—'}</span> },
    SORGU_TARIHI,
    OZET,
  ],
  POS: [MUKELLEF, DONEM, SORGU_TARIHI, tutarSutunu('Toplam tutar')],
  GELEN_EARSIV: [
    MUKELLEF,
    DONEM,
    SORGU_TARIHI,
    {
      baslik: 'Fatura sayısı',
      genislik: 110,
      sag: true,
      hucre: (s) => {
        const n = Array.isArray(s.veri?.faturalar) ? s.veri!.faturalar.length : null;
        return <span className="text-[12.5px] tabular-nums" style={portalStyle({ color: n === null ? SONUK : METIN })}>{n === null ? '—' : n.toLocaleString('tr-TR')}</span>;
      },
    },
    tutarSutunu('Toplam'),
  ],
};

export interface SonucGrubuProps {
  tur: SorguTuru;
  rows: SorguSonucu[];
  total: number;
  sayfa: number;
  sayfaBoyutu: SayfaBoyutu;
  onSayfa: (n: number) => void;
  onSayfaBoyutu: (b: SayfaBoyutu) => void;
  yukleniyor?: boolean;
  hata?: string | null;
}

/** Tek tür için grup başlıklı tablo (+ Gelen E-Arşiv'de ikinci sekme). */
export function SonucGrubu(p: SonucGrubuProps) {
  const [acik, setAcik] = useState<string | null>(null);
  const [sekme, setSekme] = useState<'sonuc' | 'eksik'>('sonuc');
  const renk = TUR_RENK[p.tur];
  const sutunlar = SUTUNLAR[p.tur];
  const SUTUN = sutunlar.length + 1; // + açma oku
  const earsiv = p.tur === 'GELEN_EARSIV';

  return (
    <section data-review-table className="mb-4 overflow-hidden rounded-xl" style={portalStyle({ border: `1px solid ${KENAR_NOTR}`, background: 'rgba(255,255,255,0.02)' })}>
      {/* Grup bandı */}
      <div data-review-heading className="flex flex-wrap items-center gap-2.5 px-3 py-2.5" style={portalStyle({ background: GRUP_ZEMIN, borderBottom: GRUP_CIZGI, borderLeft: `4px solid ${renk}` })}>
        <span className="text-[12px] font-extrabold uppercase" style={portalStyle({ color: GOLD, letterSpacing: '.16em' })}>
          {SORGU_TURU_ADI[p.tur]}
        </span>
        <span className="rounded-md px-1.5 text-[10.5px] font-bold tabular-nums leading-[18px]" style={portalStyle({ background: 'rgba(212,184,118,0.22)', color: GOLD })}>
          {p.total.toLocaleString('tr-TR')}
        </span>
        {p.yukleniyor && <span className="text-[11px]" style={portalStyle({ color: SONUK })}>· yükleniyor…</span>}
        {earsiv && (
          <div className="ml-auto inline-flex items-center rounded-full p-[3px]" style={portalStyle({ background: 'rgba(0,0,0,0.32)', border: '1px solid rgba(255,255,255,0.08)' })} role="tablist">
            {([['sonuc', 'Sorgu sonuçları'], ['eksik', 'Görseli eksik faturalar']] as const).map(([k, ad]) => {
              const aktif = sekme === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={aktif}
                  onClick={() => setSekme(k)}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[11.5px] font-semibold transition-[background-color,color] duration-150"
                  style={portalStyle(aktif ? { background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b' } : { background: 'transparent', color: IKINCIL })}
                >
                  {k === 'eksik' && <ImageOff size={12} />}
                  {ad}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {earsiv && sekme === 'eksik' ? (
        <EmptyState
          icon={<ImageOff size={24} />}
          title="Luca çekimiyle karşılaştırma yakında"
          description="Dijital Vergi Dairesi'nden gelen e-Arşiv listesi, Luca'dan indirilen görselli e-Arşivlerle karşılaştırılacak; görseli olmayan faturalar burada listelenecek."
        />
      ) : p.hata ? (
        <EmptyState icon={<ScanSearch size={24} />} title="Sonuçlar alınamadı" description={p.hata} />
      ) : p.total === 0 && !p.yukleniyor ? (
        <EmptyState icon={<ScanSearch size={24} />} title="Henüz sonuç yok" description={BOS_METIN} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full" style={portalStyle({ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 720 })}>
              <colgroup>
                <col style={portalStyle({ width: 32 })} />
                {sutunlar.map((s, i) => <col key={i} style={portalStyle(s.genislik ? { width: s.genislik } : undefined)} />)}
              </colgroup>
              <thead>
                <tr style={portalStyle({ background: 'rgba(212,184,118,0.07)' })}>
                  <th style={portalStyle({ ...HUCRE_BASLIK, padding: '7px 4px' })}><span className="sr-only">Detay</span></th>
                  {sutunlar.map((s) => (
                    <th key={s.baslik} style={portalStyle({ ...HUCRE_BASLIK, textAlign: s.sag ? 'right' : 'left' })}>{s.baslik}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.rows.map((s) => {
                  const acikMi = acik === s.id;
                  return (
                    <Fragment key={s.id}>
                      <tr
                        onClick={() => setAcik(acikMi ? null : s.id)}
                        className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                        style={portalStyle({ background: acikMi ? 'rgba(212,184,118,0.05)' : 'transparent', boxShadow: acikMi ? `inset 3px 0 0 ${GOLD}` : undefined })}
                        title={acikMi ? 'Detayı kapat' : 'Detayı aç'}
                      >
                        <td style={portalStyle({ ...HUCRE, padding: '8px 4px', textAlign: 'center', color: IKINCIL })}>
                          {acikMi ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </td>
                        {sutunlar.map((c) => (
                          <td key={c.baslik} style={portalStyle({ ...HUCRE, minWidth: 0, textAlign: c.sag ? 'right' : 'left' })}>{c.hucre(s)}</td>
                        ))}
                      </tr>
                      {acikMi && (
                        <tr>
                          <td colSpan={SUTUN} style={portalStyle({ ...HUCRE, padding: 0, background: 'rgba(0,0,0,0.18)' })}>
                            <Detay sonuc={s} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {p.rows.length === 0 && p.yukleniyor && (
                  <tr><td colSpan={SUTUN} style={portalStyle({ ...HUCRE, textAlign: 'center', color: SONUK, fontSize: 12 })}>Yükleniyor…</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Sayfalama sayfa={p.sayfa} sayfaBoyutu={p.sayfaBoyutu} toplam={p.total} onSayfa={p.onSayfa} onSayfaBoyutu={p.onSayfaBoyutu} birim="sorgu" renk={GOLD} yukleniyor={p.yukleniyor} />
        </>
      )}
    </section>
  );
}

/** Açılır detay: veri JSON'u okunur anahtar-değer listesi + WhatsApp / kaynak rozetleri. */
function Detay({ sonuc }: { sonuc: SorguSonucu }) {
  const veri = sonuc.veri && typeof sonuc.veri === 'object' ? sonuc.veri : {};
  const girdiler = Object.entries(veri);
  return (
    <div className="px-4 py-3" style={portalStyle({ borderLeft: `3px solid ${GOLD}55` })}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {sonuc.whatsappGonderildiMi ? (
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-[2px] text-[10.5px] font-medium leading-4" style={portalStyle({ background: 'rgba(37,211,102,0.10)', border: '1px solid rgba(37,211,102,0.35)', color: '#5fd38a' })} title="Sonuç mükellefe WhatsApp ile iletildi">
            <MessageCircle size={10} /> WhatsApp gönderildi
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-[2px] text-[10.5px] font-medium leading-4" style={portalStyle(CIP_NOTR)} title="Mükellefe WhatsApp gönderilmedi">
            <MessageCircle size={10} /> WhatsApp gönderilmedi
          </span>
        )}
        {sonuc.kaynak && <span className="inline-flex rounded-md px-1.5 py-[2px] text-[10.5px] font-medium leading-4" style={portalStyle(CIP_NOTR)} title="Kaynak">{sonuc.kaynak}</span>}
        {sonuc.ozet && <span className="text-[12px]" style={portalStyle({ color: IKINCIL })}>· {sonuc.ozet}</span>}
      </div>
      {girdiler.length === 0 ? (
        <div className="text-[12px]" style={portalStyle({ color: SONUK })}>Bu sorgu için ayrıntı verisi yok.</div>
      ) : (
        <AnahtarDeger girdiler={girdiler} />
      )}
    </div>
  );
}

const AD_STIL: CSSProperties = { color: SONUK, fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' };

/** Anahtar-değer listesi; iç içe nesne/dizi bir alt seviye açılır (en çok 3 seviye). */
function AnahtarDeger({ girdiler, seviye = 0 }: { girdiler: Array<[string, unknown]>; seviye?: number }) {
  return (
    <dl className="grid gap-x-4 gap-y-1.5" style={portalStyle({ gridTemplateColumns: 'minmax(120px, 200px) 1fr' })}>
      {girdiler.map(([k, v]) => {
        const nesne = v !== null && typeof v === 'object';
        if (nesne && seviye < 3) {
          const ic: Array<[string, unknown]> = Array.isArray(v)
            ? v.map((x, i) => [`${i + 1}`, x] as [string, unknown])
            : Object.entries(v as Record<string, unknown>);
          const hepsiBasit = ic.every(([, x]) => x === null || typeof x !== 'object');
          return (
            <Fragment key={k}>
              <dt style={portalStyle(AD_STIL)} className="pt-0.5">{anahtarAdi(k)}{Array.isArray(v) ? ` (${v.length})` : ''}</dt>
              <dd className="min-w-0">
                {ic.length === 0 ? (
                  <span className="text-[12.5px]" style={portalStyle({ color: SONUK })}>—</span>
                ) : hepsiBasit && Array.isArray(v) ? (
                  <span className="text-[12.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.85)' })}>{ic.map(([, x]) => degerMetni(x)).join(', ')}</span>
                ) : (
                  <div className="rounded-lg px-3 py-2" style={portalStyle({ border: `1px solid ${KENAR_NOTR}`, background: 'rgba(255,255,255,0.02)' })}>
                    <AnahtarDeger girdiler={ic} seviye={seviye + 1} />
                  </div>
                )}
              </dd>
            </Fragment>
          );
        }
        return (
          <Fragment key={k}>
            <dt style={portalStyle(AD_STIL)} className="pt-0.5">{anahtarAdi(k)}</dt>
            <dd className="min-w-0 break-words text-[12.5px]" style={portalStyle({ color: 'rgba(250,250,249,0.85)' })}>{degerMetni(v)}</dd>
          </Fragment>
        );
      })}
    </dl>
  );
}
