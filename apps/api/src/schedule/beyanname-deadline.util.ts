/**
 * Beyanname son verme tarihi — `Date` arayüzü. Kural tablosu `@mali-musavir/shared`
 * `beyanname-takvim.ts` içinde; tarayıcı (Mali Takvim) da aynı tablodan okuyor.
 *
 * 2026-09-25 (portal denetimi bulgu 43) — İKİ DAVRANIŞ DEĞİŞTİ:
 *
 * 1) KAYDIRMA ARTIK UYGULANIYOR. `calculateBeyannameDeadline` eskiden HAM günü
 *    döndürüyordu; mükellefe giden "Son Ödeme" satırları (akilli-bildirim), hatırlatma
 *    cron'u, Moren AI ve vergi takvimi tohumu bu ham günü GERÇEK son tarih sanıyordu.
 *    Canlı `tax_calendar`'da önümüzdeki 11 satırın 3'ü cumartesiye düşüyordu.
 *    HAM gün isteyen tek yer aylık ödeme cetveli — o artık `beyannameHamTarihi` çağırıyor.
 *
 * 2) İKİ TABAN GÜN DÜZELTİLDİ (GİB vergi takviminden doğrulandı, 25.09.2026):
 *    KDV2 28 → 25 · DAMGA 25 → 26 · TURIZM 26 → izleyen ayın SON GÜNÜ.
 *    EDEFTER buradan KALDIRILDI: gerçek kural 4. ayın 10'u/14'ü ve mükellef tipine bağlı;
 *    `edefter-takvim.ts` → `eDefterSonGun()` kullanılmalı. Buradaki "3 ay sonrasının son
 *    günü" kuralı yanlıştı; artık null dönüyor (yanlış tarih üretmektense sessiz kalır).
 *
 * UYARI: Üretilen tarih TAHMİNİDİR. GİB sirkülerle uzatma veriyor (bilinenler shared'daki
 * `BEYANNAME_UZATMALAR` tablosunda); tabloda olmayan uzatma hesapla bulunamaz.
 */
import { beyannameSonGunu, beyannameHamGunu, type BeyannameSonGun } from '@mali-musavir/shared';

/** "YYYY-AA-GG" → o günün İstanbul saatiyle 23:59:59'u. */
function isoyaTarih(iso: string | null): Date | null {
  return iso ? new Date(`${iso}T23:59:59+03:00`) : null;
}

/** Hafta sonu/tatil kaydırması ve bilinen sirküler uzatması İŞLENMİŞ son tarih. */
export function calculateBeyannameDeadline(beyanTipi: string, donem: string): Date | null {
  const b = beyannameSonGunu(beyanTipi, donem);
  return b ? isoyaTarih(b.sonGun) : null;
}

/** Kural gereği HAM gün — kaydırma ve uzatma YOK. Aylık ödeme cetveli ham/kaydırılmış ikilisini gösteriyor. */
export function beyannameHamTarihi(beyanTipi: string, donem: string): Date | null {
  return isoyaTarih(beyannameHamGunu(beyanTipi, donem));
}

/** Son tarihin ayrıntısı: ham gün, kaydırıldı mı, hangi sirkülerle uzatıldı. */
export function beyannameSonTarihBilgisi(beyanTipi: string, donem: string): BeyannameSonGun | null {
  return beyannameSonGunu(beyanTipi, donem);
}

/**
 * Son tarihe KAC GUN kaldi — iki tarihi de GUN BASINA yuvarlayarak hesaplar.
 *
 * NEDEN: calculateBeyannameDeadline son gunu 23:59:59 olarak kurar. Math.ceil ile ham
 * fark alininca "bugun 25'i, son gun 26'si" durumu 1 gun degil 2 gun cikiyordu
 * (1 gun 23:59:59 -> ceil -> 2). Canli dokumde taranan 16 gun ifadesinin TAMAMI 1 fazlaydi.
 * Math.round + gun basi yuvarlama yaz saati kaymalarina karsi da dayaniklidir.
 *
 * Donus: 0 = son gun bugun, pozitif = kalan gun, negatif = gecikme.
 */
export function kalanGunHesapla(deadline: Date, bugun: Date = new Date()): number {
  const gunBasi = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((gunBasi(deadline) - gunBasi(bugun)) / 86400000);
}

const GUN_ADLARI = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** Tarihin gun adi — modelin gun adi UYDURMASINI onlemek icin arac ciktisinda hazir verilir. */
export function gunAdi(d: Date): string {
  return GUN_ADLARI[d.getDay()] || '';
}
