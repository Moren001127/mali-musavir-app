/**
 * İŞ GÜNÜ YARDIMCISI — saf hesap, veritabanı yok.
 *
 * Son ödeme / beyan günü Cumartesi-Pazar'a ya da resmî tatile denk gelirse süre, izleyen
 * İLK İŞ GÜNÜNÜN mesai bitimine kadar uzar (VUK md. 18). `calculateBeyannameDeadline`
 * HAM günü verir ve TEK KAYNAK olarak kalır — ona dokunulmaz; kaydırmayı isteyen çağıran
 * `ilkIsGunu` uygular (Aylık Ödeme Listesi bunu yapar, hatırlatma cron'ları yapmaz).
 *
 * Dini bayram günleri her yıl kayar; aşağıdaki tablo 2026-2027 için elle girilmiştir —
 * RESMÎ TAKVİMLE DOĞRULANMALI. Arife günleri yarım gündür, tam tatil SAYILMAZ
 * (19 Mart 2026 Ramazan arifesi, 26 Mayıs 2026 Kurban arifesi, 28 Ekim öğleden sonra).
 * Tabloda olmayan yıllarda yalnız sabit tatiller + hafta sonu uygulanır.
 */

/** Her yıl aynı güne düşen resmî tatiller (AA-GG). */
export const SABIT_RESMI_TATILLER: ReadonlyArray<string> = [
  '01-01', // Yılbaşı
  '04-23', // Ulusal Egemenlik ve Çocuk Bayramı
  '05-01', // Emek ve Dayanışma Günü
  '05-19', // Atatürk'ü Anma, Gençlik ve Spor Bayramı
  '07-15', // Demokrasi ve Millî Birlik Günü
  '08-30', // Zafer Bayramı
  '10-29', // Cumhuriyet Bayramı
];

/** Dini bayramlar (YYYY-AA-GG) — resmî takvimle doğrulanmalı; arife dahil DEĞİL. */
export const DINI_BAYRAMLAR: Readonly<Record<number, ReadonlyArray<string>>> = {
  2026: [
    '2026-03-20', '2026-03-21', '2026-03-22', // Ramazan Bayramı (arife 19 Mart yarım gün)
    '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30', // Kurban Bayramı (arife 26 Mayıs yarım gün)
  ],
  2027: [
    '2027-03-09', '2027-03-10', '2027-03-11', // Ramazan Bayramı
    '2027-05-16', '2027-05-17', '2027-05-18', '2027-05-19', // Kurban Bayramı
  ],
};

const iki = (n: number) => String(n).padStart(2, '0');

/** Yerel takvim günü — "YYYY-AA-GG". */
export function isoGun(d: Date): string {
  return `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`;
}

export function haftaSonuMu(d: Date): boolean {
  const g = d.getDay();
  return g === 0 || g === 6;
}

export function resmiTatilMi(d: Date): boolean {
  const gun = isoGun(d);
  if (SABIT_RESMI_TATILLER.includes(gun.slice(5))) return true;
  const bayramlar = DINI_BAYRAMLAR[d.getFullYear()];
  return !!bayramlar && bayramlar.includes(gun);
}

export function isGunuMu(d: Date): boolean {
  return !haftaSonuMu(d) && !resmiTatilMi(d);
}

/**
 * Tarih iş günüyse AYNI anı (yeni nesne) döner; değilse izleyen ilk iş gününü — günün saati korunur.
 * Ardışık tatil + hafta sonu zincirini (ör. 30 Ağustos 2026 Pazar → 31 Ağustos Pazartesi;
 * Kurban 2026 27-30 Mayıs + 31 Mayıs Pazar → 1 Haziran) tek tek yürür.
 */
export function ilkIsGunu(d: Date): Date {
  const out = new Date(d.getTime());
  let emniyet = 0;
  while (!isGunuMu(out) && emniyet++ < 30) out.setDate(out.getDate() + 1);
  return out;
}
