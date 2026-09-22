/**
 * e-Defter berat takibi — SAF yardımcılar (Prisma yok; jest ile sınanır). 2026-09-22
 *
 * Kural: Sıra No 5 Tebliğ (RG 08.11.2024) — takvim `@mali-musavir/shared` edefter-takvim.ts'te.
 *   • Aylık tercih: ilgili ayı izleyen 4. ayın 10'u (şahıs) / 14'ü (firma). Aralık → Nisan (şahıs) / Mayıs (firma).
 *   • 3 aylık tercih: geçici vergi beyan ayını izleyen ayın 10'u / 14'ü (Oca–Mar → Haziran, Nis–Haz → Eylül,
 *     Tem–Eyl → Aralık, Eki–Ara → Nisan şahıs / Mayıs firma). Hafta sonu/tatil → sonraki iş günü; sirküler uzatmaları.
 *   • Eylül 2026 (verilme dönemi) tablosuna düşenler: şahıs aylık → Mayıs 2026 (10.09), firma aylık → Mayıs 2026 (14.09),
 *     şahıs 3 aylık → Nis–Haz 2026 (10.09), firma 3 aylık → Nis–Haz 2026 (14.09).
 *
 * "Verildi" kararı: dönemin HER ayı için Kebir Beratı (KB) ve Yevmiye Beratı (YB) satırı durumKodu 0 ile varsa
 * onaylandı; değilse elle işaretlenmiş BeyanDurumu 'onaylandi' varsa onaylandı; yoksa kalan. Bekleyen/hatalı YOK.
 */
import {
  donemAylari,
  eDefterAyindaBeklenenDonemler,
  eDefterMukellefTipi,
  eDefterSonGun,
  eDefterVergiDonemi,
  type EDefterMukellefTipi,
  type EDefterTercih,
} from '@mali-musavir/shared';

export type EDefterDonemTuru = 'VERILME' | 'VERGI';
export type EDefterDurum = 'onaylandi' | 'kalan';

/** Mükellefin seçilen ayda takibe düşen bir e-Defter dönemi. */
export interface EDefterBeklenenDonem {
  /** "2026-05" (aylık) ya da "2026-Q2" (üç aylık) */
  donem: string;
  /** Dönemin kapsadığı aylar ("YYYY-MM") */
  aylar: string[];
  /** Tebliğdeki özgün gün (10/14) */
  tebligTarihi: string;
  /** Kaydırma + uzatma işlenmiş geçerli son gün ("YYYY-MM-DD") */
  sonGun: string;
  uzatildi: boolean;
  uzatmaKaynagi: string | null;
}

/** Berat satırının karar için gereken alanları (EDefterBerat tablosu). */
export interface EDefterBeratSatiri {
  donem: string; // "YYYY-MM"
  belgeTuru: string; // KB | YB | Y | K
  durumKodu?: number | null; // 0 = başarılı
  alinmaZamani?: Date | string | null;
}

/** config.eDefterPeriod → tercih ('AYLIK' | 'UCAYLIK'); e-Defter mükellefi değilse null. */
export function eDefterTercihCoz(deger: unknown): EDefterTercih | null {
  return deger === 'AYLIK' || deger === 'UCAYLIK' ? deger : null;
}

/** "YYYY-MM" biçimindeyse döner, yoksa null (başlangıç ayı doğrulaması). */
export function eDefterBaslangicCoz(deger: unknown): string | null {
  return typeof deger === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(deger) ? deger : null;
}

/** Mükellef türü + yıllık vergi türü → SAHIS / FIRMA (shared kuralı). */
export function eDefterTipiCoz(taxpayerType: string | null | undefined, incomeTaxType?: string | null): EDefterMukellefTipi {
  return eDefterMukellefTipi(taxpayerType, incomeTaxType);
}

/**
 * Seçilen ay için beklenen dönemler.
 *   VERILME: o ayda geçerli son günü olan dönemler (birden çok olabilir — ör. Haziran 2026 şahıs aylık: Ocak + Şubat).
 *   VERGI  : seçilen ayın kendi dönemi (aylık → aynı ay; üç aylık → yalnız 3/6/9/12'de o çeyrek, diğer aylarda yok).
 * `baslangic` ("YYYY-MM"): e-Defter mükellefiyetinin başladığı ay; ondan önce biten dönemler takibe düşmez.
 */
export function eDefterBeklenenDonemler(
  donem: string,
  donemTuru: EDefterDonemTuru,
  tercih: EDefterTercih,
  tip: EDefterMukellefTipi,
  baslangic?: string | null,
): EDefterBeklenenDonem[] {
  const bas = eDefterBaslangicCoz(baslangic);
  if (donemTuru === 'VERILME') {
    return eDefterAyindaBeklenenDonemler(donem, tercih, tip, bas).map((b) => ({
      donem: b.donem,
      aylar: donemAylari(b.donem),
      tebligTarihi: b.tebligTarihi,
      sonGun: b.sonGun,
      uzatildi: b.uzatildi,
      uzatmaKaynagi: b.uzatmaKaynagi,
    }));
  }
  const vergiDonem = eDefterVergiDonemi(donem, tercih);
  if (!vergiDonem) return [];
  const aylar = donemAylari(vergiDonem);
  if (bas && aylar.length > 0 && aylar[aylar.length - 1] < bas) return [];
  const b = eDefterSonGun(vergiDonem, tercih, tip);
  if (!b) return [];
  return [{ donem: b.donem, aylar, tebligTarihi: b.tebligTarihi, sonGun: b.sonGun, uzatildi: b.uzatildi, uzatmaKaynagi: b.uzatmaKaynagi }];
}

/** Bir ay için KB + YB beratı durumKodu 0 ile var mı? */
export function eDefterAyVerildiMi(ay: string, beratlar: EDefterBeratSatiri[]): boolean {
  let kb = false;
  let yb = false;
  for (const b of beratlar) {
    if (b.donem !== ay || b.durumKodu !== 0) continue;
    if (b.belgeTuru === 'KB') kb = true;
    else if (b.belgeTuru === 'YB') yb = true;
  }
  return kb && yb;
}

/** Dönemin HER ayı için KB + YB başarılıysa verildi. */
export function eDefterBeratVerildiMi(aylar: string[], beratlar: EDefterBeratSatiri[]): boolean {
  if (aylar.length === 0) return false;
  return aylar.every((ay) => eDefterAyVerildiMi(ay, beratlar));
}

/** Berat satırları → onaylandı / kalan (elle 'onaylandi' işareti de onaylandı sayılır). */
export function eDefterDurumCoz(aylar: string[], beratlar: EDefterBeratSatiri[], elleDurum?: string | null): EDefterDurum {
  if (eDefterBeratVerildiMi(aylar, beratlar)) return 'onaylandi';
  if (elleDurum === 'onaylandi') return 'onaylandi';
  return 'kalan';
}

/** Dönem aylarındaki KB/YB beratlarının en son GİB yükleme zamanı (ISO) — yoksa null. */
export function eDefterSonYukleme(aylar: string[], beratlar: EDefterBeratSatiri[]): string | null {
  let enSon: Date | null = null;
  const aySet = new Set(aylar);
  for (const b of beratlar) {
    if (!aySet.has(b.donem) || (b.belgeTuru !== 'KB' && b.belgeTuru !== 'YB') || !b.alinmaZamani) continue;
    const t = new Date(b.alinmaZamani);
    if (Number.isNaN(t.getTime())) continue;
    if (!enSon || t > enSon) enSon = t;
  }
  return enSon ? enSon.toISOString() : null;
}

/**
 * Özet satırındaki `vergiDonem` için tek anahtar: AYLIK tercihin o aya düşen (en yeni) dönemi.
 * Verilme görünümünde Eylül 2026 → "2026-05"; vergi görünümünde seçilen ayın kendisi.
 * Beklenen dönem kümesinde aylık anahtar yoksa şahıs takvimindeki aylık dönem; o da yoksa (uzatma ayı) 4 ay geri.
 */
export function eDefterOzetVergiDonemi(donem: string, donemTuru: EDefterDonemTuru, beklenenDonemler: Iterable<string>): string {
  if (donemTuru === 'VERGI') return donem;
  const aylik = Array.from(beklenenDonemler).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();
  if (aylik.length > 0) return aylik[aylik.length - 1];
  const sahis = eDefterAyindaBeklenenDonemler(donem, 'AYLIK', 'SAHIS');
  if (sahis.length > 0) return sahis[sahis.length - 1].donem;
  const [y, m] = donem.split('-').map((x) => parseInt(x, 10));
  const toplam = y * 12 + (m - 1) - 4;
  return `${Math.floor(toplam / 12)}-${String((toplam % 12) + 1).padStart(2, '0')}`;
}
