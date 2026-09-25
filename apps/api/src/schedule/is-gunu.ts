/**
 * İŞ GÜNÜ YARDIMCISI — `Date` arayüzü. Saf hesap, veritabanı yok.
 *
 * Son ödeme / beyan günü Cumartesi-Pazar'a ya da resmî tatile denk gelirse süre, izleyen
 * İLK İŞ GÜNÜNÜN mesai bitimine kadar uzar (VUK md. 18).
 *
 * 2026-09-25 (denetim bulgusu 43): TATİL TABLOSU BURADAN KALDIRILDI. Aynı tablo
 * `packages/shared/src/constants/edefter-takvim.ts` içinde de duruyordu; iki kopya
 * birbirinden sapabiliyordu. Tek kaynak artık `@mali-musavir/shared` → `resmi-tatil.ts`.
 * Bu dosya yalnız `Date` ↔ "YYYY-AA-GG" köprüsü; tarayıcı tarafı da aynı tablodan okuyor.
 */
import {
  isGununeKaydir as isGununeKaydirIso,
  isGunuMu as isGunuMuIso,
  resmiTatilMi as resmiTatilMiIso,
  haftaSonuMu as haftaSonuMuIso,
  tariheIso,
  SABIT_RESMI_TATILLER,
  DINI_BAYRAMLAR,
} from '@mali-musavir/shared';

export { SABIT_RESMI_TATILLER, DINI_BAYRAMLAR };

/** Yerel takvim günü — "YYYY-AA-GG". */
export function isoGun(d: Date): string {
  return tariheIso(d);
}

export function haftaSonuMu(d: Date): boolean {
  return haftaSonuMuIso(tariheIso(d));
}

export function resmiTatilMi(d: Date): boolean {
  return resmiTatilMiIso(tariheIso(d));
}

export function isGunuMu(d: Date): boolean {
  return isGunuMuIso(tariheIso(d));
}

/**
 * Tarih iş günüyse AYNI anı (yeni nesne) döner; değilse izleyen ilk iş gününü — günün saati korunur.
 * Ardışık tatil + hafta sonu zincirini (ör. 30 Ağustos 2026 Pazar → 31 Ağustos Pazartesi;
 * Kurban 2026 27-30 Mayıs + 31 Mayıs Pazar → 1 Haziran) tek tek yürür.
 */
export function ilkIsGunu(d: Date): Date {
  const hedef = isGununeKaydirIso(tariheIso(d));
  const [y, m, g] = hedef.split('-').map((x) => parseInt(x, 10));
  const out = new Date(d.getTime());
  out.setFullYear(y, m - 1, g);
  return out;
}
