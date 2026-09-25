/**
 * RESMÎ TATİL + İŞ GÜNÜ KAYDIRMASI — TEK KAYNAK (2026-09-25).
 *
 * VUK md. 18: süre hafta sonuna ya da resmî tatile rastlarsa izleyen İLK İŞ GÜNÜNÜN mesai
 * bitimine kadar uzar.
 *
 * NEDEN BURADA: bu tablo daha önce ÜÇ ayrı yerde kopyaydı —
 *   `apps/api/src/schedule/is-gunu.ts`, `packages/shared/src/constants/edefter-takvim.ts`
 *   ve `apps/web/.../MaliTakvim.tsx` (orada hiç yoktu, sabit günler kullanılıyordu).
 * Kopyalar birbirinden sapıyordu. Artık sunucu da tarayıcı da buradan okur.
 *
 * ARİFE: yarım gündür, TAM TATİL SAYILMAZ (19 Mart 2026 Ramazan arifesi, 26 Mayıs 2026
 * Kurban arifesi, 28 Ekim öğleden sonra). GİB takvimi de arifeyi son gün olarak kullanır.
 *
 * UYARI — KAYDIRMA YETMEZ: GİB sık sık SİRKÜLERLE uzatma veriyor ve bunu hiçbir formül
 * üretemez. Örnek (25 Eylül 2026'da gib.gov.tr/vergi-takvimi'nden doğrulandı):
 *   Nisan 2026 dönemi MUHSGK/Damga/Konaklama → 03.06.2026, KDV → 05.06.2026
 *   (199 Sıra No.lu VUK Sirküleri). Düz iş günü hesabı ikisine de 01.06.2026 der.
 * Bu yüzden hesaplanan her son gün "TAHMİNİ"dir; bilinen uzatmalar ilgili takvim
 * dosyasındaki uzatma tablosuna kaynağıyla yazılır.
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

/**
 * Dini bayramlar (yıl → AA-GG), arife HARİÇ.
 * 2026 Ramazan 20-22 Mart / Kurban 27-30 Mayıs, 2027 Ramazan 9-11 Mart / Kurban 16-19 Mayıs
 * — GİB vergi takviminin kaydırdığı tarihlerle tutarlı (2026 doğrulandı).
 * Tabloda olmayan yıllarda yalnız sabit tatiller + hafta sonu uygulanır.
 */
export const DINI_BAYRAMLAR: Readonly<Record<number, ReadonlyArray<string>>> = {
  2025: ['03-30', '03-31', '04-01', '06-06', '06-07', '06-08', '06-09'],
  2026: ['03-20', '03-21', '03-22', '05-27', '05-28', '05-29', '05-30'],
  2027: ['03-09', '03-10', '03-11', '05-16', '05-17', '05-18', '05-19'],
  2028: ['02-26', '02-27', '02-28', '05-05', '05-06', '05-07', '05-08'],
};

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-AA-GG" üretir. */
export function isoGun(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parcala(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  return { y, m, d };
}

function gunEkle(iso: string, n: number): string {
  const { y, m, d } = parcala(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoGun(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function haftaGunu(iso: string): number {
  const { y, m, d } = parcala(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Paz … 6 Cmt
}

export function haftaSonuMu(iso: string): boolean {
  const g = haftaGunu(iso);
  return g === 0 || g === 6;
}

export function resmiTatilMi(iso: string): boolean {
  const { y } = parcala(iso);
  const ayGun = iso.slice(5);
  if (SABIT_RESMI_TATILLER.includes(ayGun)) return true;
  return (DINI_BAYRAMLAR[y] || []).includes(ayGun);
}

export function isGunuMu(iso: string): boolean {
  return !haftaSonuMu(iso) && !resmiTatilMi(iso);
}

/** Hafta sonu / resmî tatile rastlayan günü izleyen ilk iş gününe taşır; iş günüyse aynen döner. */
export function isGununeKaydir(iso: string): string {
  let t = iso;
  for (let i = 0; i < 15; i++) {
    if (isGunuMu(t)) return t;
    t = gunEkle(t, 1);
  }
  return t;
}

/** "2026-09-26" → "26.09.2026" */
export function isoGunuBicimle(iso: string | null | undefined): string {
  if (!iso) return '';
  const { y, m, d } = parcala(iso);
  return `${pad(d)}.${pad(m)}.${y}`;
}

/** Date → yerel takvim günü ("YYYY-AA-GG"). Saat/dilim düşürülür. */
export function tariheIso(d: Date): string {
  return isoGun(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
