/**
 * BEYANNAME SON GÜN TAKVİMİ — TEK KAYNAK (2026-09-25, portal denetimi bulgu 43).
 *
 * Neyi düzeltiyor:
 *   1) TABAN GÜN HATASI. `beyanname-deadline.util.ts` KDV2'yi ayın 28'i, DAMGA'yı 25'i
 *      sayıyordu; `MaliTakvim.tsx` ise KDV2'yi 25, DAMGA'yı 26 sayıyordu. İki kural seti
 *      birbiriyle çelişiyordu. 25 Eylül 2026'da gib.gov.tr/vergi-takvimi'nden TEMİZ BİR
 *      İŞ GÜNÜ AYINDA (Kasım 2026: 25'i Çarşamba, 26'sı Perşembe) ölçüldü:
 *        • KDV Tevkifatı (2 No'lu KDV), Ekim 2026 dönemi → 25.11.2026  ⇒ taban 25
 *        • Damga (her iki tür),        Ekim 2026 dönemi → 26.11.2026  ⇒ taban 26
 *        • MUHSGK, Konaklama,          Ekim 2026 dönemi → 26.11.2026  ⇒ taban 26
 *        • KDV (1 No'lu),              Kasım 2026 dönemi → 28.12.2026 ⇒ taban 28
 *        • Gelir/Kurum Geçici Q1 2026  → 18.05.2026 (17'si Pazar)     ⇒ taban 17
 *      Ofis KDV2'yi (30 kayıt) ve DAMGA'yı (1 kayıt) gerçekten veriyor.
 *
 *   2) İŞ GÜNÜ KAYDIRMASI HİÇ UYGULANMIYORDU. Canlı `tax_calendar`'da önümüzdeki 11
 *      satırın 3'ü cumartesiye düşüyordu (MUHSGK 26.09.2026, KDV1 28.11.2026,
 *      MUHSGK 26.12.2026). GİB'in kendi takvimi bunları 28.09 / 30.11 / 28.12 gösteriyor.
 *
 *   3) SİRKÜLER UZATMALARI hesapla üretilemez. `UZATMALAR` tablosu bunun içindir.
 *      Bu yüzden bu dosyanın ürettiği her tarih TAHMİNİDİR; ekranlar öyle söylemeli.
 */
import { isGununeKaydir, isoGun } from './resmi-tatil';

/**
 * Beyan tipi → izleyen ayın kaçıncı günü (HAM taban gün, kaydırma öncesi).
 * Kaynağı GİB vergi takvimi olanlar ✓ ile işaretli; diğerleri teyitsiz, dokunulmadı.
 */
export const BEYANNAME_TABAN_GUN: Readonly<Record<string, number>> = {
  KDV1: 28,      // ✓ GİB
  KDV4: 28,      //   teyitsiz (KDV1 ile aynı varsayıldı)
  KDV9015: 28,   //   teyitsiz
  KDV2: 25,      // ✓ GİB — eskiden 28'di, YANLIŞTI
  MUHSGK: 26,    // ✓ GİB
  MUHSGK2: 26,   //   teyitsiz
  KONAKLAMA: 26, // ✓ GİB — Ekim 2026 dönemi 26.11.2026; Ağustos dönemi 28.09 çünkü 26'sı Cumartesi
  OIV: 26,       //   teyitsiz
  GMSI: 26,      //   teyitsiz
  DAMGA: 26,     // ✓ GİB — eskiden 25'ti, YANLIŞTI
  POSET: 24,     //   teyitsiz — GİB takviminde 24'ünde yükümlülük görünmedi
  BILDIRGE: 23,  //   SGK yükümlülüğü, GİB takviminde yok
  GGECICI: 17,   // ✓ GİB
  KGECICI: 17,   // ✓ GİB
  OTV1: 15,      //   teyitsiz
  OTV3A: 15,     //   teyitsiz
  OTV3B: 15,     //   teyitsiz
  OTV4: 15,      //   teyitsiz
};

/**
 * Bilinen GİB sirküler uzatmaları: iş gününe KAYDIRILMIŞ son gün → yeni son gün.
 * Kaydırma sonrası anahtarla eşleşir; zincirlenebilir.
 * Yeni sirküler çıktıkça buraya kaynağıyla eklenir — uydurma tarih YAZILMAZ.
 */
export const BEYANNAME_UZATMALAR: Readonly<Record<string, { yeni: string; kaynak: string; tipler?: ReadonlyArray<string> }>> = {
  // Nisan 2026 dönemi — Kurban Bayramı. gib.gov.tr/vergi-takvimi, 25.09.2026'da okundu:
  //   MUHSGK / Damga / Konaklama: ham 26 Mayıs (arife, iş günü) → sirkülerle 03.06.2026
  //   KDV (1 No'lu):              ham 28 Mayıs (bayram) → kayma 01.06 → sirkülerle 05.06.2026
  //   KDV Tevkifatı (KDV2) 25.05 ve Turizm payı 01.06 UZATILMADI — bu yüzden tabloda yok.
  '2026-05-26': { yeni: '2026-06-03', kaynak: '199 Sıra No.lu VUK Sirküleri', tipler: ['MUHSGK', 'MUHSGK2', 'DAMGA', 'KONAKLAMA'] },
  '2026-06-01': { yeni: '2026-06-05', kaynak: '199 Sıra No.lu VUK Sirküleri', tipler: ['KDV1', 'KDV4', 'KDV9015'] },
};

export interface BeyannameSonGun {
  tip: string;
  donem: string;
  /** Kural gereği ham gün (kaydırma ve uzatma ÖNCESİ), "YYYY-AA-GG". */
  ham: string;
  /** Hafta sonu / resmî tatil kaydırması + bilinen sirküler uzatması işlenmiş son gün. */
  sonGun: string;
  /** Ham gün hafta sonu/tatile düştüğü için taşındı mı? */
  kaydirildi: boolean;
  /** Bilinen bir sirküler uzatması uygulandı mı? */
  uzatildi: boolean;
  uzatmaKaynagi: string | null;
  /**
   * HER ZAMAN true. GİB sirkülerle uzatma verebilir; tablomuzda olmayan bir uzatma
   * hesapla bulunamaz. Ekranlar bu tarihi "tahmini" diye sunmalı.
   */
  tahmini: true;
}

/**
 * Beyanname son günü. `donem` = "YYYY-AA" (ait olduğu dönem).
 * Yıllık beyannamelerde dönem YILI kullanılır: GELIR → izleyen 31 Mart, KURUMLAR → izleyen 30 Nisan.
 * Kural bilinmiyorsa null.
 */
export function beyannameSonGunu(tip: string, donem: string): BeyannameSonGun | null {
  const ham = beyannameHamGunu(tip, donem);
  if (!ham) return null;

  const kaydirilmis = isGununeKaydir(ham);
  let sonGun = kaydirilmis;
  let uzatildi = false;
  let uzatmaKaynagi: string | null = null;
  for (let i = 0; i < 5; i++) {
    const u = BEYANNAME_UZATMALAR[sonGun];
    if (!u || u.yeni <= sonGun) break;
    if (u.tipler && !u.tipler.includes(tip)) break;
    sonGun = isGununeKaydir(u.yeni);
    uzatildi = true;
    uzatmaKaynagi = u.kaynak;
  }

  return {
    tip, donem, ham, sonGun,
    kaydirildi: kaydirilmis !== ham,
    uzatildi, uzatmaKaynagi,
    tahmini: true,
  };
}

/** Kural gereği ham gün — kaydırma ve uzatma YOK. Aylık ödeme cetveli "ham"ı ayrıca gösteriyor. */
export function beyannameHamGunu(tip: string, donem: string): string | null {
  const [yStr, mStr] = String(donem || '').split('-');
  const yil = Number(yStr);
  const ay = Number(mStr); // 1-12
  if (!yil || !ay || ay < 1 || ay > 12) return null;

  if (tip === 'GELIR') return isoGun(yil, 3, 31);   // dönem yılı = beyan yılı (util ile aynı)
  if (tip === 'KURUMLAR') return isoGun(yil, 4, 30);
  if (tip === 'EDEFTER') return null;               // e-Defter kendi takviminde: edefter-takvim.ts

  const izleyenAy = ay === 12 ? 1 : ay + 1;
  const izleyenYil = ay === 12 ? yil + 1 : yil;

  // ✓ GİB — Turizm Payı izleyen ayın SON GÜNÜ (Ağustos 2026 dönemi → 30.09.2026;
  //   Nisan 2026 dönemi → 01.06.2026 çünkü 31 Mayıs Pazar). Eski kural 26'sı diyordu, YANLIŞTI.
  if (tip === 'TURIZM') return isoGun(izleyenYil, izleyenAy, new Date(izleyenYil, izleyenAy, 0).getDate());

  const gun = BEYANNAME_TABAN_GUN[tip];
  if (!gun) return null;
  return isoGun(izleyenYil, izleyenAy, gun);
}
