/**
 * Mükellef KURUM TÜRÜ (KDV kısmi tevkifatta "belirlenmiş alıcı" ayrımı) — kod listesi + Türkçe etiketler.
 * API tarafındaki kaynak: apps/api/src/fatura-muhasebelestirme/tevkifat-kurallari.ts (KURUM_TURLERI).
 * Buradaki liste onunla BİREBİR aynı olmalı; web + zod şemaları buradan beslenir (PLAN/16 §F).
 */
export const KURUM_TURU_KODLARI = [
  'kamu',
  'banka',
  'belediye',
  'universite',
  'kit',
  'belirlenmis_diger',
  'diger',
  'kdv_mukellefi_degil',
] as const;

export type KurumTuruKodu = (typeof KURUM_TURU_KODLARI)[number];

/** Kod → ekranda gösterilecek Türkçe etiket. */
export const KURUM_TURU_ETIKETLERI: Record<KurumTuruKodu, string> = {
  kamu: 'Kamu kurumu',
  banka: 'Banka',
  belediye: 'Belediye',
  universite: 'Üniversite',
  kit: 'KİT',
  belirlenmis_diger: 'Belirlenmiş diğer (BİST/OSB/…)',
  diger: 'Diğer (normal KDV mükellefi)',
  kdv_mukellefi_degil: 'KDV mükellefi değil',
};

/** Seçim kutuları için sıralı liste. */
export const KURUM_TURU_SECENEKLERI: Array<{ value: KurumTuruKodu; label: string }> = KURUM_TURU_KODLARI.map(
  (value) => ({ value, label: KURUM_TURU_ETIKETLERI[value] }),
);

export const DEFTER_TURU_KODLARI = ['BILANCO', 'ISLETME'] as const;
export type DefterTuruKodu = (typeof DEFTER_TURU_KODLARI)[number];

export const DEFTER_TURU_ETIKETLERI: Record<DefterTuruKodu, string> = {
  BILANCO: 'Bilanço',
  ISLETME: 'İşletme',
};

/** Kod → etiket; bilinmeyen/boş kod için null. */
export function kurumTuruEtiketi(kod: string | null | undefined): string | null {
  const k = String(kod || '').trim().toLowerCase() as KurumTuruKodu;
  return k && (KURUM_TURU_KODLARI as readonly string[]).includes(k) ? KURUM_TURU_ETIKETLERI[k] : null;
}
