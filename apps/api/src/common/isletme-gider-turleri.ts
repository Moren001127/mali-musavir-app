/**
 * İşletme hesabı esası (VUK 194. madde — 2. sınıf tüccarlar) için
 * Luca Gelir-Gider Defteri gider/gelir türleri.
 *
 * Demirbaş ve taşıt bedeli deftere GİDER YAZILMAZ (VUK 313/315).
 * Yalnızca KDV tutarı gider olarak işlenir; amortisman ayrı takip edilir.
 */

export const ISLETME_GIDER_TURLERI = [
  { kod: 'MAL_ALISI',       label: 'Mal alışı',                  taraf: 'GIDER' as const, aciklama: 'Ticari mal, hammadde, malzeme' },
  { kod: 'HIZMET_ALISI',    label: 'Hizmet alışı',               taraf: 'GIDER' as const, aciklama: 'Danışmanlık, tamir, bakım vb.' },
  { kod: 'AKARYAKIT',       label: 'Akaryakıt',                  taraf: 'GIDER' as const, aciklama: 'Benzin, motorin, LPG' },
  { kod: 'KIRA',            label: 'Kira',                       taraf: 'GIDER' as const, aciklama: 'İş yeri / araç kira bedeli' },
  { kod: 'MAAS_SGK',        label: 'Maaş / SGK',                 taraf: 'GIDER' as const, aciklama: 'Çalışan maaşı ve SGK primi' },
  { kod: 'ELEKTRIK_SU_GAZ', label: 'Elektrik / su / gaz',        taraf: 'GIDER' as const, aciklama: 'Faturalı enerji giderleri' },
  { kod: 'ILETISIM',        label: 'İletişim',                   taraf: 'GIDER' as const, aciklama: 'Telefon, internet, posta' },
  { kod: 'ULASIM',          label: 'Ulaşım',                     taraf: 'GIDER' as const, aciklama: 'Taşıma, kargo, nakliye' },
  { kod: 'REKLAM',          label: 'Reklam / tanıtım',           taraf: 'GIDER' as const, aciklama: 'Pazarlama giderleri' },
  { kod: 'KIRTASIYE',       label: 'Kırtasiye / ofis',           taraf: 'GIDER' as const, aciklama: 'Ofis malzemeleri' },
  { kod: 'DEMIRBAŞ',        label: 'Demirbaş (amort. tabi)',      taraf: 'GIDER' as const, aciklama: 'VUK 313: bedel deftere yazılmaz, yalnız KDV gider. Amortisman ayrı.' },
  { kod: 'TASIT',           label: 'Taşıt (amort. tabi)',         taraf: 'GIDER' as const, aciklama: 'VUK 315: bedel deftere yazılmaz, yalnız KDV gider. Amortisman ayrı.' },
  { kod: 'DIGER_GIDER',     label: 'Diğer gider',                taraf: 'GIDER' as const, aciklama: 'Yukarıdaki kategorilere girmeyen giderler' },
  // Gelir türleri
  { kod: 'MAL_SATISI',      label: 'Mal satışı',                 taraf: 'GELIR' as const, aciklama: 'Ticari mal, ürün satışı' },
  { kod: 'HIZMET_SATISI',   label: 'Hizmet satışı',              taraf: 'GELIR' as const, aciklama: 'Hizmet geliri' },
  { kod: 'DIGER_GELIR',     label: 'Diğer gelir',                taraf: 'GELIR' as const, aciklama: 'Kira geliri, faiz vb.' },
] as const;

export type IsletmeGiderTuruKod = typeof ISLETME_GIDER_TURLERI[number]['kod'];
export type IsletmeTaraf = 'GIDER' | 'GELIR';

/** Belirli taraftaki türleri filtrele */
export function getIsletmeTurleri(taraf: IsletmeTaraf) {
  return ISLETME_GIDER_TURLERI.filter((t) => t.taraf === taraf);
}

/** OCR/AI kalem kategorisinden işletme gider türü tahmini */
export function icerikKategoridenGiderTuru(icerikKategori: string | null | undefined): IsletmeGiderTuruKod {
  // AI/OCR bazen 'demirbaş' (Türkçe ş) bazen 'demirbas' (ascii) üretiyor; eşleşmeyi sağlamlaştırmak
  // için önce Türkçe karakterleri ascii'ye indirip küçük harfe çeviriyoruz (İ/ş/ç/ğ/ü/ö).
  const norm = String(icerikKategori ?? '')
    .trim()
    .replace(/[İIı]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .toLowerCase();
  switch (norm) {
    case 'ticari_mal':  return 'MAL_ALISI';
    case 'tasit':       return 'TASIT';
    case 'demirbas':    return 'DEMIRBAŞ';
    case 'hizmet':      return 'HIZMET_ALISI';
    case 'akaryakit':   return 'AKARYAKIT';
    case 'kira':        return 'KIRA';
    default:            return 'DIGER_GIDER';
  }
}

/** Amortismana tabi mi? (VUK: bedel deftere yazılmaz) */
export function isAmortismanaTabiTur(kod: IsletmeGiderTuruKod): boolean {
  return kod === 'DEMIRBAŞ' || kod === 'TASIT';
}
