'use client';
import { portalStyle } from '@/lib/portal-theme';

// Mükellefe göre gruplu tablolar: onay bekleyen raporlar · onaylanmış raporlar · hastane iş kazası bildirimleri.
// Gerçek <table>, görünür hücre kenarlıkları, grup başlığı ayrı bant (işyeri adı büyük harf); işyeri adı satırlarda
// tekrar yazılmaz. table-layout: fixed → minWidth = sabit sütunlar + esnek sütunların tabanı (taşma dersi, 2026-09-25).
import React from 'react';
import { Check } from 'lucide-react';
import { SGK_VAKA_ADLARI, type SgkIsKazasiSatiri, type SgkOnayParcasi, type SgkRaporSatiri } from '@mali-musavir/shared';
import { Hap, METIN } from '../belge-ortak';
import { IKINCIL, KENAR, SOLUK, aralikYaz, gunSirasi, gunYaz, zamanYaz, type Grup } from './ortak';

type Sutun = { ad: string; genislik?: number; /** esnek sütunun en dar hâli */ esnekEnAz?: number; hiza?: 'sag' };

const TC = { ad: 'TC Kimlik No', genislik: 110 };

// Genişlikler 1366 penceresinde (içerik ≈1094px) yatay kaydırma çıkmayacak şekilde; 1760'ta artan yer esnek sütuna gider.
export const BEKLEYEN_SUTUNLARI: Sutun[] = [
  TC,
  { ad: 'Ad Soyad', genislik: 172 },
  { ad: 'Vaka', genislik: 100 },
  { ad: 'Rapor Başlama', genislik: 100 },
  { ad: 'İşbaşı / Kontrol', genislik: 100 },
  { ad: 'Gün', genislik: 56, hiza: 'sag' },
  { ad: 'Açıklama', esnekEnAz: 200 },
  { ad: 'İşlem', genislik: 226 },
];

export const ONAYLANAN_SUTUNLARI: Sutun[] = [
  TC,
  { ad: 'Ad Soyad', esnekEnAz: 160 },
  { ad: 'Vaka', genislik: 100 },
  { ad: 'Poliklinik', genislik: 100 },
  { ad: 'İşbaşı / Kontrol', genislik: 100 },
  { ad: 'Onaylanan günler', genislik: 256 },
  { ad: 'İşlem tarihi', genislik: 100 },
  { ad: 'Ödeme', genislik: 80 },
];

export const IS_KAZASI_SUTUNLARI: Sutun[] = [
  TC,
  { ad: 'Ad Soyad', genislik: 176 },
  { ad: 'Kaza Tarihi', genislik: 100 },
  { ad: 'Provizyon Tarihi', genislik: 104 },
  { ad: 'Sağlık Tesisi', esnekEnAz: 200 },
  { ad: 'İşlem Türü', genislik: 120 },
  { ad: "SGK'ya Bildirim Son Gün", genislik: 190 },
];

const enAzGenislik = (sutunlar: Sutun[]) => sutunlar.reduce((t, s) => t + (s.genislik ?? s.esnekEnAz ?? 160), 0);

function Hucre({ children, hiza, sayi = false, className = '' }: { children: React.ReactNode; hiza?: 'sag'; sayi?: boolean; className?: string }) {
  return (
    <td
      data-sr-td
      className={`px-3 py-2.5 align-middle ${hiza === 'sag' ? 'text-right' : 'text-left'} ${sayi ? 'tabular-nums whitespace-nowrap' : ''} ${className}`}
      style={portalStyle({ border: `1px solid ${KENAR}`, color: IKINCIL })}
    >
      {children}
    </td>
  );
}

function GrupluTablo<T>({ sutunlar, gruplar, birim, satir, soluk = false }: {
  sutunlar: Sutun[];
  gruplar: Grup<T>[];
  /** grup başlığındaki sayaç birimi: "rapor", "bildirim" */
  birim: string;
  satir: (r: T) => React.ReactNode;
  /** yeni veri gelirken eski satırlar soluk */
  soluk?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table data-sr-tablo className="w-full text-[13px]" style={portalStyle({ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: enAzGenislik(sutunlar) })}>
        <colgroup>
          {sutunlar.map((s) => <col key={s.ad} style={s.genislik ? { width: s.genislik } : undefined} />)}
        </colgroup>
        <thead>
          <tr>
            {sutunlar.map((s) => (
              <th
                key={s.ad}
                data-sr-th
                className={`px-3 py-2.5 align-middle text-[10.5px] font-bold uppercase leading-tight tracking-[.1em] ${s.hiza === 'sag' ? 'text-right' : 'text-left'}`}
                style={portalStyle({ border: `1px solid ${KENAR}`, background: 'rgba(255,255,255,0.03)', color: 'rgba(250,250,249,0.5)' })}
              >
                {s.ad}
              </th>
            ))}
          </tr>
        </thead>
        <tbody style={portalStyle({ opacity: soluk ? 0.55 : 1, transition: 'opacity .15s' })}>
          {gruplar.map((g) => (
            <React.Fragment key={g.taxpayerId}>
              <tr data-sr-grup>
                <td colSpan={sutunlar.length} className="px-3 pb-2 pt-3" style={portalStyle({ border: `1px solid ${KENAR}`, borderTop: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.055)' })}>
                  <div className="flex items-baseline gap-3">
                    <span data-sr-grup-ad className="truncate text-[12.5px] font-extrabold tracking-[.04em]" style={portalStyle({ color: METIN })}>
                      {g.ad.toLocaleUpperCase('tr-TR')}
                    </span>
                    <span data-sr-grup-sayi className="flex-shrink-0 text-[12px] tabular-nums" style={portalStyle({ color: SOLUK })}>
                      {g.satirlar.length} {birim}
                    </span>
                  </div>
                </td>
              </tr>
              {g.satirlar.map((r) => satir(r))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function vakaAdi(r: { vaka: string | null; vakaAdi: string | null }): string {
  return r.vakaAdi || (r.vaka ? SGK_VAKA_ADLARI[r.vaka] : '') || '—';
}

/** Portaldan yapılan son işlem: "Portaldan onaylandı 26.09.2026 14:20" · başarısızsa "SGK reddetti: …". */
function PortalIslemNotu({ r }: { r: SgkRaporSatiri }) {
  const p = r.sonPortalIslemi;
  if (!p) return null;
  const metin = !p.basarili
    ? `SGK reddetti: ${p.sonucAciklama || 'sebep belirtilmedi'}`
    : p.islem === 'PERSONELIM_DEGIL'
      ? `Portaldan "personelim değil" bildirildi ${zamanYaz(p.tarih)}`
      : `Portaldan onaylandı ${zamanYaz(p.tarih)}`;
  return (
    <div data-sr-islem={p.basarili ? 'ok' : 'hata'} className="mt-1 text-[11.5px] leading-snug" style={portalStyle({ color: p.basarili ? SOLUK : '#e2706f' })}
      title={p.kullanici ? `${p.kullanici} · ${zamanYaz(p.tarih)}` : zamanYaz(p.tarih)}>
      {metin}
    </div>
  );
}

// ── Onay bekleyen ────────────────────────────────────────────────────────────────────────────────────────────────
export function BekleyenTablosu({ gruplar, soluk, onOnayla, onPersonelDegil }: {
  gruplar: Grup<SgkRaporSatiri>[];
  soluk?: boolean;
  onOnayla: (r: SgkRaporSatiri) => void;
  onPersonelDegil: (r: SgkRaporSatiri) => void;
}) {
  return (
    <GrupluTablo
      sutunlar={BEKLEYEN_SUTUNLARI}
      gruplar={gruplar}
      birim="rapor"
      soluk={soluk}
      satir={(r) => (
        <tr key={r.id} data-sr-satir>
          <Hucre sayi><span data-sr-tc style={portalStyle({ color: METIN })}>{r.tcKimlikNo}</span></Hucre>
          <Hucre><span data-sr-ad className="font-semibold" style={portalStyle({ color: METIN })}>{r.adSoyad}</span></Hucre>
          <Hucre>{vakaAdi(r)}</Hucre>
          <Hucre sayi><span data-sr-deger style={portalStyle({ color: METIN })}>{gunYaz(r.raporBaslangic)}</span></Hucre>
          <Hucre sayi><span data-sr-deger style={portalStyle({ color: METIN })}>{gunYaz(r.isbasiKontrolTarihi)}</span></Hucre>
          <Hucre sayi hiza="sag"><span data-sr-deger className="font-semibold" style={portalStyle({ color: METIN })}>{r.gunSayisi ?? '—'}</span></Hucre>
          <Hucre>
            <div>{r.raporDurumuAdi || '—'}</div>
            {r.durum === 'PARCALI' && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <Hap ton="sari">Parçalı rapor</Hap>
                <span data-sr-soluk className="text-[12px] tabular-nums" style={portalStyle({ color: SOLUK })}>
                  Kalan: {aralikYaz(r.kalanBaslangic, r.kalanBitis)}
                </span>
              </div>
            )}
            <PortalIslemNotu r={r} />
          </Hucre>
          <Hucre className="whitespace-nowrap">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-sr-btn="onayla"
                onClick={() => onOnayla(r)}
                title="Çalışmazlık bildirimi ile raporu onayla"
                className="inline-flex h-7 items-center gap-1 rounded-[8px] border px-2.5 text-[12px] font-semibold transition hover:brightness-110"
                style={portalStyle({ background: '#2f9e44', borderColor: '#2f9e44', color: '#fff' })}
              >
                <Check size={13} strokeWidth={2.6} /> Onayla
              </button>
              <button
                type="button"
                data-sr-btn="personel"
                onClick={() => onPersonelDegil(r)}
                title="Bu kişi işyerinin personeli değil"
                className="inline-flex h-7 items-center rounded-[8px] border px-2.5 text-[12px] font-semibold transition hover:brightness-125"
                style={portalStyle({ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.14)', color: METIN })}
              >
                Personelim Değil
              </button>
            </div>
          </Hucre>
        </tr>
      )}
    />
  );
}

// ── Onaylanmış ───────────────────────────────────────────────────────────────────────────────────────────────────
function siraliParcalar(r: SgkRaporSatiri): SgkOnayParcasi[] {
  return [...(r.onayParcalari || [])].sort((a, b) => gunSirasi(a.baslangic, b.baslangic));
}

/** Son parçanın işlem tarihi; yoksa parçalardaki en geç işlem tarihi. */
function sonIslemTarihi(parcalar: SgkOnayParcasi[]): string | null {
  const son = parcalar[parcalar.length - 1];
  if (son?.islemTarihi) return son.islemTarihi;
  const hepsi = parcalar.map((p) => p.islemTarihi).filter((x): x is string => !!x).sort();
  return hepsi.length ? hepsi[hepsi.length - 1] : null;
}

export function OnaylananTablosu({ gruplar, soluk }: { gruplar: Grup<SgkRaporSatiri>[]; soluk?: boolean }) {
  return (
    <GrupluTablo
      sutunlar={ONAYLANAN_SUTUNLARI}
      gruplar={gruplar}
      birim="rapor"
      soluk={soluk}
      satir={(r) => {
        const parcalar = siraliParcalar(r);
        const son = parcalar[parcalar.length - 1];
        const odeme = son?.odemeCikti === true ? 'cikti' : son?.odemeCikti === false ? 'cikmadi' : 'yok';
        return (
          <tr key={r.id} data-sr-satir>
            <Hucre sayi><span data-sr-tc style={portalStyle({ color: METIN })}>{r.tcKimlikNo}</span></Hucre>
            <Hucre><span data-sr-ad className="font-semibold" style={portalStyle({ color: METIN })}>{r.adSoyad}</span></Hucre>
            <Hucre>{vakaAdi(r)}</Hucre>
            <Hucre sayi><span data-sr-deger style={portalStyle({ color: METIN })}>{gunYaz(r.poliklinikTarihi)}</span></Hucre>
            <Hucre sayi><span data-sr-deger style={portalStyle({ color: METIN })}>{gunYaz(r.isbasiKontrolTarihi)}</span></Hucre>
            <Hucre>
              {parcalar.length === 0 ? (
                <span data-sr-bos style={portalStyle({ color: SOLUK })}>—</span>
              ) : (
                <div className="space-y-0.5">
                  {parcalar.map((p, k) => (
                    <div key={k} className="whitespace-nowrap tabular-nums">
                      <span data-sr-deger style={portalStyle({ color: METIN })}>{aralikYaz(p.baslangic, p.bitis)}</span>
                      <span data-sr-soluk style={portalStyle({ color: SOLUK })}> · {p.calisti ? 'çalıştı' : 'çalışmadı'}</span>
                    </div>
                  ))}
                </div>
              )}
            </Hucre>
            <Hucre sayi><span data-sr-deger style={portalStyle({ color: METIN })}>{gunYaz(sonIslemTarihi(parcalar))}</span></Hucre>
            <Hucre>
              <span data-sr-odeme={odeme} className={odeme === 'cikti' ? 'font-semibold' : ''}
                style={portalStyle({ color: odeme === 'cikti' ? '#5cbf8a' : odeme === 'cikmadi' ? IKINCIL : SOLUK })}>
                {odeme === 'cikti' ? 'Çıktı' : odeme === 'cikmadi' ? 'Çıkmadı' : '—'}
              </span>
            </Hucre>
          </tr>
        );
      }}
    />
  );
}

// ── İş kazası — hastane bildirimleri ─────────────────────────────────────────────────────────────────────────────
export function IsKazasiTablosu({ gruplar, bugun, soluk }: { gruplar: Grup<SgkIsKazasiSatiri>[]; bugun: string; soluk?: boolean }) {
  return (
    <GrupluTablo
      sutunlar={IS_KAZASI_SUTUNLARI}
      gruplar={gruplar}
      birim="bildirim"
      soluk={soluk}
      satir={(k) => {
        const gecti = !!k.sgkBildirimSonGun && bugun > k.sgkBildirimSonGun;
        return (
          <tr key={k.id} data-sr-satir>
            <Hucre sayi><span data-sr-tc style={portalStyle({ color: METIN })}>{k.tcKimlikNo}</span></Hucre>
            <Hucre>
              {k.adSoyad
                ? <span data-sr-ad className="font-semibold" style={portalStyle({ color: METIN })}>{k.adSoyad}</span>
                : <span data-sr-bos style={portalStyle({ color: SOLUK })}>—</span>}
            </Hucre>
            <Hucre sayi><span data-sr-deger style={portalStyle({ color: METIN })}>{gunYaz(k.isKazasiTarihi)}</span></Hucre>
            <Hucre sayi><span data-sr-deger style={portalStyle({ color: METIN })}>{gunYaz(k.provizyonTarihi)}</span></Hucre>
            <Hucre>{k.tesisAdi || '—'}</Hucre>
            <Hucre>{k.islemTuru || '—'}</Hucre>
            <Hucre sayi>
              <span data-sr-deger style={portalStyle({ color: METIN })}>{gunYaz(k.sgkBildirimSonGun)}</span>
              {gecti && <span data-sr-gecti style={portalStyle({ color: '#e2706f' })}> (süresi geçti)</span>}
            </Hucre>
          </tr>
        );
      }}
    />
  );
}
