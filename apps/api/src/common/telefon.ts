/**
 * TELEFON NUMARASI — tek normalizasyon kaynağı.
 *
 * Aynı normalizasyon repoda sekiz ayrı yerde kopyalanmıştı ve davranışları
 * birebir aynı değildi. Telefon başına ad özelliği bu kopyalara dayanamaz:
 * ad, numara ANAHTARIYLA saklanıyor. Yazarken bir biçim, okurken başka bir
 * biçim üretilirse ad hiç görünmez — üstelik ekran hata da vermez, sessizce
 * boş kalır. O yüzden bu iki iş (yaz/oku) aynı fonksiyondan geçer.
 */

/** Yalnız rakamlar */
export function telefonRakamlari(value?: string | null): string {
  return String(value ?? '').replace(/[^\d]/g, '');
}

/**
 * Türkiye cep numarasını "90XXXXXXXXXX" biçimine getirir.
 *
 * Kabul edilen girdiler:  0533 923 36 74 · 5339233674 · +90 533 923 36 74 ·
 *                         0090533... · 905339233674
 * Çözülemeyen girdi olduğu gibi (yalnız rakamlar) döner — veri kaybetmemek
 * için; eşleşme olmazsa ad görünmez ama numara da bozulmaz.
 */
export function telefonAnahtari(value?: string | null): string {
  let d = telefonRakamlari(value);
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  // 0XXXXXXXXXX (11 hane, başında 0)
  if (d.length === 11 && d.startsWith('0')) d = `90${d.slice(1)}`;
  // 5XXXXXXXXX (10 hane, operatör kodu ile başlar)
  else if (d.length === 10 && d.startsWith('5')) d = `90${d}`;
  return d;
}

/**
 * Kaydedilmiş telefon adları haritası — anahtarlar normalize edilir.
 *
 * Kullanıcı karta "0533 923 36 74" yazar, WhatsApp "905339233674" getirir.
 * Harita ham anahtarla tutulsaydı ikisi eşleşmezdi.
 */
export function telefonAdlariHaritasi(ham: any): Map<string, string> {
  const harita = new Map<string, string>();
  if (!ham || typeof ham !== 'object' || Array.isArray(ham)) return harita;
  for (const [numara, ad] of Object.entries(ham as Record<string, unknown>)) {
    const anahtar = telefonAnahtari(numara);
    const isim = String(ad ?? '').trim();
    if (anahtar && isim) harita.set(anahtar, isim);
  }
  return harita;
}

/** Bu numaraya verilmiş ad (yoksa null) */
export function telefonAdi(ham: any, numara?: string | null): string | null {
  const anahtar = telefonAnahtari(numara);
  if (!anahtar) return null;
  return telefonAdlariHaritasi(ham).get(anahtar) ?? null;
}
