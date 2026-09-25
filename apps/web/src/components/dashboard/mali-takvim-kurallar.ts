/**
 * MALİ TAKVİM — hangi kural günü BUGÜNE düşüyor (saf hesap, React yok).
 *
 * 2026-09-25 (portal denetimi bulgu 43): `MaliTakvim.tsx` eskiden `if (day === 26)` gibi SABİT
 * gün kontrolü yapıyordu; hafta sonu / resmî tatil kayması yoktu. 26 Eylül 2026 CUMARTESİ olduğu
 * hâlde ekran o günü MUHSGK son günü gösteriyordu (GİB: 28 Eylül Pazartesi).
 *
 * Tatil tablosu ve kaydırma sunucuyla ORTAK: `@mali-musavir/shared` → `resmi-tatil.ts`.
 * Bu dosya bağımlılıksız tutuluyor ki davranış testi doğrudan çağırabilsin.
 */
import { isGununeKaydir, isoGun, tariheIso } from '@mali-musavir/shared';

/** Ham gün: ayın kaçıncı günü, ya da ayın son günü. */
export type HamGun = number | 'aySonu';

/**
 * `ayOfset` ayındaki ham gün, kaydırma sonrası `date` gününe mi düşüyor?
 * `ayOfset = -1` de bakılır: ay sonuna denk gelen ham gün izleyen aya taşabiliyor
 * (31 Mayıs 2026 Pazar → 1 Haziran).
 */
export function sonGunuMu(date: Date, hamGun: HamGun, ayOfset = 0): boolean {
  const t = new Date(date.getFullYear(), date.getMonth() + ayOfset, 1);
  const ay = t.getMonth() + 1;
  const yil = t.getFullYear();
  const ayinSonu = new Date(yil, ay, 0).getDate();
  const g = hamGun === 'aySonu' ? ayinSonu : hamGun;
  if (g < 1 || g > ayinSonu) return false;
  return isGununeKaydir(isoGun(yil, ay, g)) === tariheIso(date);
}

/** Bu ayın ham günü ya da önceki aydan taşan ham gün. */
export function kuralGunu(date: Date, hamGun: HamGun): boolean {
  return sonGunuMu(date, hamGun, 0) || sonGunuMu(date, hamGun, -1);
}
