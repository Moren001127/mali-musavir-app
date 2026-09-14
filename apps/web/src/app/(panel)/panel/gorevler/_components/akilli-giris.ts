/**
 * Akıllı giriş ayrıştırıcısı — 2026-09-14'te ORTAK PAKETE taşındı:
 *   packages/shared/src/gorev-akilli-giris.ts  (portal + WhatsApp botu aynı kodu kullanır)
 * Bu dosya yalnız yeniden dışa aktarım; bileşenlerin içe aktarım yolları değişmedi.
 * Testi: node apps/web/scripts/akilli-giris-test.mjs
 */
export { ayristir, kategoriTahmin, mukellefEslestir, kucult, sadelestir, mukellefAdi } from '@mali-musavir/shared';
export type { MukellefSecenek, MukellefAday, AyristirmaSonucu, GorevOncelik } from '@mali-musavir/shared';
