/**
 * WhatsApp TOPLU GÖNDERİM şablonları (saf fonksiyonlar — DB/DI yok, test edilebilir).
 *
 * 3 şablon:
 *   1) Beyanname bildirimi (Hattat tarzı): ad + her beyanname (tip/tahakkuk/vade/tutar) + toplam + tek link
 *   2) Cari hesap ekstresi: ad + dönem (PDF ayrıca sendMedia ile gönderilir)
 *   3) Tebligat / genel bilgilendirme: ad + mesaj (+ opsiyonel link)
 *
 * Marka başlığı ("Gönderen: MOREN MALİ MÜŞAVİRLİK") mesajın İÇİNE yazılır:
 * Meta Business doğrulaması olmadan WhatsApp profil adı değiştirilemez, bu yüzden
 * gönderen kimliği metne konur (Hattat da böyle yapıyor).
 *
 * KRİTİK: Bilinmeyen beyan tipinde son ödeme tarihi UYDURULMAZ — boş bırakılır.
 */

const OFFICE_BRAND = process.env.MOREN_OFFICE_NAME || 'MOREN MALİ MÜŞAVİRLİK';
const BRAND_HEADER = `Gönderen: ${OFFICE_BRAND}`;

export type BeyannameItem = {
  beyanTipi: string;          // "KDV1" | "MUHSGK" | "DAMGA" | ...
  donem: string;              // "2026-01" (yıl-ay)
  tahakkukTutari?: number | null;
};

/** Türkçe para biçimi: 1064.7 -> "1.064,70". */
export function formatTutar(value?: number | null): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0,00';
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/** "2026-01" -> { year:2026, month:1 }. Geçersizse null. */
function parseDonem(donem: string): { year: number; month: number } | null {
  const m = String(donem || '').match(/^(\d{4})-(\d{1,2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** Tarihi D.M.YYYY olarak yaz (örn. 26.2.2026 — başında sıfır yok). */
function formatTarih(d: Date): string {
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/**
 * Vergi takvimi — beyan tipine göre SON ÖDEME tarihi.
 * NOMİNAL tarihler (Hattat referansıyla birebir: 26.2 / 28.2). Hafta sonu/resmî
 * tatil kayması DAHİL DEĞİL — GİB fiilen sonraki iş gününe uzatır, nominal tarih
 * göstermek güvenli ve referansla aynı. Gerekirse tatil tablosuyla eklenir.
 * Bilinmeyen tip -> null (uydurma yok).
 *
 * Aylık (dönem+1 ay):
 *   KDV1/KDV2 -> 28'i · MUHSGK/DAMGA/POSET -> 26'sı
 * Üç aylık geçici vergi: çeyrek bitiminden sonraki 2. ayın 17'si.
 * Yıllık: GELIR -> 31 Mart (yıl+1) · KURUMLAR -> 30 Nisan (yıl+1).
 */
export function taxDueDate(beyanTipi: string, donem: string): string | null {
  const p = parseDonem(donem);
  if (!p) return null;
  const tip = String(beyanTipi || '').toUpperCase().replace(/\s+/g, '');

  // dönem+1 ayın `day`'i (new Date month 0-index olduğu için p.month = sonraki ay)
  const monthly = (day: number): string => formatTarih(new Date(p.year, p.month, day));

  if (tip === 'KDV1' || tip === 'KDV2' || tip === 'KDV') return monthly(28);
  if (tip === 'MUHSGK' || tip === 'DAMGA' || tip === 'POSET' || tip === 'BILDIRGE') return monthly(26);

  if (tip === 'GGECICI' || tip === 'KGECICI' || tip === 'GECICI_VERGI' || tip === 'GECICI') {
    // p.month genelde çeyreğin son ayı (3,6,9,12). Çeyrek bitiminden sonraki 2. ayın 17'si.
    return formatTarih(new Date(p.year, p.month + 1, 17));
  }

  if (tip === 'GELIR') return formatTarih(new Date(p.year + 1, 2, 31));   // 31 Mart
  if (tip === 'KURUMLAR') return formatTarih(new Date(p.year + 1, 3, 30)); // 30 Nisan

  return null; // bilinmeyen tip -> tarih uydurma
}

/** Beyan tipini kullanıcıya gösterilecek kısa ada çevirir. */
export function beyanTipiLabel(beyanTipi: string): string {
  const map: Record<string, string> = {
    KDV1: 'KDV1', KDV2: 'KDV2',
    MUHSGK: 'MUHSGK', DAMGA: 'Damga',
    POSET: 'Poşet', BILDIRGE: 'Bildirge',
    KURUMLAR: 'Kurumlar', GELIR: 'Gelir',
    GGECICI: 'Gelir Geçici', KGECICI: 'Kurum Geçici', GECICI_VERGI: 'Geçici Vergi',
    EDEFTER: 'E-Defter', DIGER: 'Diğer',
  };
  return map[String(beyanTipi || '').toUpperCase()] || beyanTipi;
}

/**
 * 1) BEYANNAME BİLDİRİMİ (Hattat tarzı).
 * Her satır: "{Tip} - Tahakkuk - Son Ödeme: {vade} - {tutar} TL"
 * Vade bilinmiyorsa "Son Ödeme: -" yazılır (uydurma yok).
 */
export function buildBeyannameBulkMessage(input: {
  ad: string;
  items: BeyannameItem[];
  link?: string | null;
}): string {
  const ad = String(input.ad || '').trim();
  const lines: string[] = [];
  let toplam = 0;

  for (const it of input.items || []) {
    const tutar = Number(it.tahakkukTutari || 0);
    toplam += Number.isFinite(tutar) ? tutar : 0;
    const vade = taxDueDate(it.beyanTipi, it.donem);
    lines.push(`${beyanTipiLabel(it.beyanTipi)} - Tahakkuk - Son Ödeme: ${vade || '-'} - ${formatTutar(tutar)} TL`);
  }

  const parts = [
    BRAND_HEADER,
    '',
    `Merhaba ${ad},`,
    '',
    'Aşağıdaki beyanname dökümanları bilginize sunulmuştur:',
    '',
    ...lines,
    '',
    `Toplam: ${formatTutar(toplam)} TL`,
  ];
  if (input.link) {
    parts.push('', String(input.link).trim());
  }
  return parts.join('\n');
}

/**
 * 2) CARİ HESAP EKSTRESİ mesajı (PDF ayrıca sendMedia ile gönderilir).
 */
export function buildCariEkstreMessage(input: {
  ad: string;
  baslangic: string; // "01-08-2025"
  bitis: string;     // "31-03-2026"
}): string {
  const ad = String(input.ad || '').trim();
  return [
    BRAND_HEADER,
    '',
    `Sayın ${ad},`,
    '',
    `${input.baslangic} / ${input.bitis} Hesap Dökümü`,
  ].join('\n');
}

/**
 * 3) TEBLİGAT / GENEL BİLGİLENDİRME mesajı.
 */
export function buildTebligatMessage(input: {
  ad: string;
  mesaj: string;
  link?: string | null;
}): string {
  const ad = String(input.ad || '').trim();
  const parts = [
    BRAND_HEADER,
    '',
    `Sayın ${ad},`,
    '',
    String(input.mesaj || '').trim(),
  ];
  if (input.link) parts.push('', String(input.link).trim());
  return parts.join('\n');
}
