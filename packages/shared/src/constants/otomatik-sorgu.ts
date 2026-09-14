/**
 * Otomatik Sorgulama Ayarı (mükellef kartı) — 2026-09-14
 *
 * Gece cron'unun bu mükellef için hangi sorguları AÇACAĞI. Taxpayer.otomatikSorgu (Json?) alanında
 * saklanır. NULL/eksik = varsayılan: yalnız e-Tebligat açık, diğerleri kapalı.
 * Elle ("Şimdi sorgula") tetiklenen işler bu ayardan MUAF — ayar sadece geceyi ilgilendirir.
 */
export const OTOMATIK_SORGU_TURLERI = [
  'eTebligat',
  'vergiBorcu',
  'gelenEArsiv',
  'pos',
  'eHaciz',
  'yoklama',
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
};

/** Varsayılan ayar: yalnız e-Tebligat açık. */
export function varsayilanOtomatikSorgu(): OtomatikSorguAyari {
  return {
    eTebligat: true,
    vergiBorcu: false,
    gelenEArsiv: false,
    pos: false,
    eHaciz: false,
    yoklama: false,
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
 * Genel Sorgulamalar sonuç türleri (GenelSorguSonucu.tur).
 * e-Tebligat AYRI modülde (PortalDocument) tutulur; burada değildir.
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
