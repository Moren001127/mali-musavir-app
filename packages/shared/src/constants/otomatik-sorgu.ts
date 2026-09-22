/**
 * Otomatik Sorgulama Ayarı (mükellef kartı) — 2026-09-14, e-Defter şalteri 2026-09-22
 *
 * Gece cron'unun bu mükellef için hangi sorguları AÇACAĞI. Taxpayer.otomatikSorgu (Json?) alanında
 * saklanır. NULL/eksik = varsayılan: e-Tebligat ve e-Defter açık, diğerleri kapalı.
 * Elle ("Sorgula") tetiklenen işler bu ayardan MUAF — ayar sadece geceyi ilgilendirir.
 *
 * Gece akışı (2026-09-22): mükellef başına TEK Dijital Vergi Dairesi girişi. e-Tebligat açıksa
 * E_TEBLIGAT_CHECK işi açılır ve açık olan diğer sorgular `payload.ekSorgular` ile aynı oturumda koşar;
 * e-Tebligat kapalı ama başka şalter açıksa DVD_SORGU işi açılır.
 */
export const OTOMATIK_SORGU_TURLERI = [
  'eTebligat',
  'vergiBorcu',
  'gelenEArsiv',
  'pos',
  'eHaciz',
  'yoklama',
  'eDefter',
] as const;

export type OtomatikSorguTuru = (typeof OTOMATIK_SORGU_TURLERI)[number];

export type OtomatikSorguAyari = Record<OtomatikSorguTuru, boolean>;

/** Ekran etiketleri (kod → Türkçe). */
export const OTOMATIK_SORGU_ETIKETLERI: Record<OtomatikSorguTuru, string> = {
  eTebligat: 'e-Tebligat',
  vergiBorcu: 'Vergi Borcu',
  gelenEArsiv: 'Gelen e-Arşiv',
  pos: 'POS Bilgisi',
  eHaciz: 'e-Haciz',
  yoklama: 'Yoklama / Denetim',
  eDefter: 'e-Defter',
};

/** Varsayılan ayar: e-Tebligat ve e-Defter açık (e-Defter yalnız e-Defter mükellefinde çalışır). */
export function varsayilanOtomatikSorgu(): OtomatikSorguAyari {
  return {
    eTebligat: true,
    vergiBorcu: false,
    gelenEArsiv: false,
    pos: false,
    eHaciz: false,
    yoklama: false,
    eDefter: true,
  };
}

/**
 * Kayıttaki ham değeri (null / eksik alanlı / bozuk) tam şekle getirir.
 * Eksik anahtar → varsayılan; boolean olmayan değer → varsayılan.
 */
export function otomatikSorguCoz(ham: unknown): OtomatikSorguAyari {
  const sonuc = varsayilanOtomatikSorgu();
  if (!ham || typeof ham !== 'object') return sonuc;
  const kayit = ham as Record<string, unknown>;
  for (const tur of OTOMATIK_SORGU_TURLERI) {
    if (typeof kayit[tur] === 'boolean') sonuc[tur] = kayit[tur] as boolean;
  }
  return sonuc;
}

/**
 * Dijital Vergi Dairesi (DVD) oturumunda koşan sorgular — e-Tebligat HARİÇ (o kendi işi).
 * Hem DVD_SORGU işinin `payload.sorgular`ı hem E_TEBLIGAT_CHECK'in `payload.ekSorgular`ı bu kümeden.
 */
export const DVD_SORGU_TURLERI = ['vergiBorcu', 'eHaciz', 'yoklama', 'pos', 'gelenEArsiv', 'eDefter'] as const;
export type DvdSorguTuru = (typeof DVD_SORGU_TURLERI)[number];

export function dvdSorguTuruMu(v: unknown): v is DvdSorguTuru {
  return typeof v === 'string' && (DVD_SORGU_TURLERI as readonly string[]).includes(v);
}

/** Şalter ayarından o gece koşacak DVD sorgularını çıkarır (e-Tebligat ayrı değerlendirilir). */
export function acikDvdSorgulari(ayar: OtomatikSorguAyari): DvdSorguTuru[] {
  return DVD_SORGU_TURLERI.filter((t) => ayar[t] === true);
}

/**
 * Genel Sorgulamalar sonuç türleri (GenelSorguSonucu.tur).
 * e-Tebligat AYRI modülde (PortalDocument) tutulur; e-Defter beratları EDefterBerat tablosunda — burada değildir.
 */
export const GENEL_SORGU_TURLERI = [
  'VERGI_BORCU',
  'E_HACIZ',
  'YOKLAMA_DENETIM',
  'POS',
  'GELEN_EARSIV',
] as const;

export type GenelSorguTuru = (typeof GENEL_SORGU_TURLERI)[number];

export const GENEL_SORGU_ETIKETLERI: Record<GenelSorguTuru, string> = {
  VERGI_BORCU: 'Vergi Borcu',
  E_HACIZ: 'e-Haciz',
  YOKLAMA_DENETIM: 'Yoklama / Denetim',
  POS: 'POS Bilgisi',
  GELEN_EARSIV: 'Gelen e-Arşiv',
};

/** DVD sorgu anahtarı ↔ sonuç türü (e-Defter'in sonuç türü yok; ayrı tabloda). */
export const DVD_SORGU_SONUC_TURU: Record<Exclude<DvdSorguTuru, 'eDefter'>, GenelSorguTuru> = {
  vergiBorcu: 'VERGI_BORCU',
  eHaciz: 'E_HACIZ',
  yoklama: 'YOKLAMA_DENETIM',
  pos: 'POS',
  gelenEArsiv: 'GELEN_EARSIV',
};

export const GENEL_SORGU_DVD_ANAHTARI: Record<GenelSorguTuru, Exclude<DvdSorguTuru, 'eDefter'>> = {
  VERGI_BORCU: 'vergiBorcu',
  E_HACIZ: 'eHaciz',
  YOKLAMA_DENETIM: 'yoklama',
  POS: 'pos',
  GELEN_EARSIV: 'gelenEArsiv',
};
