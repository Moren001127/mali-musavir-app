/**
 * Mükellef portalı — KDV özetinde GÖSTERİLEN TUTARIN KAYNAĞI.
 *
 * 2026-09-25 denetim bulgusu 18. Eski ekran `beyanVar` (KDV1 satırı AÇILDI MI) alanına
 * bakıyordu; oysa tutar `tahakkukTutari` DOLU İSE resmî beyandan, değilse taslak hesaptan
 * geliyor. Ofis dönem başında devreden KDV'yi işlerken KDV1 satırını durum='beklemede',
 * tahakkukTutari=null olarak açtığı için ekran taslak rakamı "resmî beyannamenizden
 * alınmıştır" diye sunuyordu. Mükellef bu rakama göre eksik ödeme yapabilir.
 *
 * Bu dosya saf (bağımlılıksız) tutuluyor ki davranış testi doğrudan çağırabilsin.
 */
export type KdvKaynak = 'beyan' | 'taslak';

/**
 * Sunucu açıkça 'beyan' demedikçe TASLAK sayar. Sunucu eski sürümde kalıp alanı hiç
 * göndermezse de taslak görünür: az söylemek güvenli, fazla söylemek mükellefi yanlış
 * tutara inandırır.
 */
export function kdvKaynagi(kdv: { kaynak?: string | null } | null | undefined): KdvKaynak {
  return kdv?.kaynak === 'beyan' ? 'beyan' : 'taslak';
}

/** Rozet: tutarın kaynağını söyler (eskiden ön-hazırlığın iç puanını gösteriyordu). */
export const KDV_KAYNAK_ROZET: Record<KdvKaynak, { label: string; color: string }> = {
  beyan: { label: 'Resmî beyanname', color: '#4ade80' },
  taslak: { label: 'Taslak', color: '#fbbf24' },
};

/** Kartın altındaki açıklama metni. */
export function kdvKaynakMetni(kaynak: KdvKaynak, veriGuveniEtiketi?: string | null): string {
  if (kaynak === 'beyan') {
    return 'Ödenecek KDV resmî KDV beyannamenizden alınmıştır. Alış/satış KDV kırılımı dönem verinizden hesaplanır.';
  }
  const ek = veriGuveniEtiketi ? ` (${veriGuveniEtiketi})` : '';
  return `Taslak — resmî beyan tutarı değildir. Bu dönemin beyannamesi henüz tahakkuk etmediği için tutarlar dönem verinizden hesaplanan ön bilgidir.${ek}`;
}
