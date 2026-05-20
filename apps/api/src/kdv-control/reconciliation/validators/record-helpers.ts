import { KdvRecord, ReceiptImage } from '@prisma/client';
import { parseMoneyLike, parseTrUsAmount } from './amount-check';
import { parseTrDate, sameDay } from './date-helpers';
import { normalizeBelgeNo, sameBelgeNo, stringSimilarity } from './belge-no-check';

export function isAccountingDescription(value: string): boolean {
  const v = value
    .toLocaleUpperCase('tr-TR')
    .replace(/Å/g, 'S').replace(/Ä°/g, 'I')
    .replace(/Ä/g, 'G').replace(/Ã‡/g, 'C')
    .replace(/Ãœ/g, 'U').replace(/Ã–/g, 'O')
    .replace(/[.,;:'"\-/\\()&%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!v) return true;
  return /\b(KDV|TEVKIFAT|TEVKIFATLI|HESAPLANAN|INDIRILECEK|SORUMLU|SATIN|ALMA|IADE|391|191)\b/.test(v);
}

export function stripLucaDescriptionDocumentSuffix(value: string): string {
  return String(value || '')
    .replace(/\s*[-–—]\s*[A-Z0-9]{1,30}\s*[-–—]\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s*$/i, '')
    .trim();
}

export function companyNameSimilarity(a: string, b: string): number {
  const ABBREV: Record<string, string> = {
    MLZ: 'MALZEME', MALZ: 'MALZEME',
    INS: 'INSAAT',
    TIC: 'TICARET',
    SAN: 'SANAYI',
    TUR: 'TURIZM', TURZ: 'TURIZM',
    GID: 'GIDA',
    TEKN: 'TEKNOLOJI', TEKNO: 'TEKNOLOJI',
    NAK: 'NAKLIYAT', NAKL: 'NAKLIYAT', NAKLIY: 'NAKLIYAT',
    LOJ: 'LOJISTIK',
    KOZ: 'KOZMETIK',
    TEKS: 'TEKSTIL', TEKST: 'TEKSTIL',
    PETR: 'PETROL', PET: 'PETROL',
    OTOM: 'OTOMOTIV', OTM: 'OTOMOTIV',
    BIL: 'BILISIM',
    MAK: 'MAKINE',
    MOB: 'MOBILYA',
    KIRT: 'KIRTASIYE',
    PAZ: 'PAZARLAMA',
    DAG: 'DAGITIM',
    ITH: 'ITHALAT',
    IHR: 'IHRACAT',
    PERAK: 'PERAKENDE',
    TOPT: 'TOPTAN',
    HIZ: 'HIZMET',
    MUH: 'MUHASEBE',
    IMA: 'IMALAT',
    EM: 'EMLAK',
    GAY: 'GAYRIMENKUL',
    ECZ: 'ECZACILIK',
    EGT: 'EGITIM',
    KIM: 'KIMYA',
    ELEK: 'ELEKTRIK', ELEKT: 'ELEKTRIK',
    AKAR: 'AKARYAKIT',
    MED: 'MEDIKAL',
    DEK: 'DEKORASYON', DEKO: 'DEKORASYON',
  };

  const normalize = (s: string): string[] => {
    const upper = stripLucaDescriptionDocumentSuffix(s)
      .toLocaleUpperCase('tr-TR')
      .replace(/Å/g, 'S').replace(/Ä°/g, 'I')
      .replace(/Ä/g, 'G').replace(/Ã‡/g, 'C')
      .replace(/Ãœ/g, 'U').replace(/Ã–/g, 'O')
      .replace(/\uFFFD/g, 'G')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[.,;:'"\-/\\()&]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const SUFFIX_REMOVE = new Set([
      'LTD', 'STI', 'AS', 'ANONIM', 'LIMITED',
      'SIRKETI', 'SIRKET',
      'TICARET', 'TIC',
      'SANAYI', 'SAN',
      'INSAAT', 'INS',
      'VE', 'ILE',
    ]);
    return upper
      .split(' ')
      .map((w) => (w.length > 1 && ABBREV[w] ? ABBREV[w] : w))
      .filter((w) => w.length > 1 && !SUFFIX_REMOVE.has(w));
  };

  const tokensA = normalize(a);
  const tokensB = normalize(b);
  if (tokensA.length === 0 || tokensB.length === 0) {
    const flat = (s: string) => s.toLocaleUpperCase('tr-TR')
      .replace(/Å/g, 'S').replace(/Ä°/g, 'I')
      .replace(/Ä/g, 'G').replace(/Ã‡/g, 'C')
      .replace(/Ãœ/g, 'U').replace(/Ã–/g, 'O')
      .replace(/\uFFFD/g, 'G')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '');
    return stringSimilarity(flat(a), flat(b));
  }

  const tokensMatch = (x: string, y: string): boolean => {
    if (x === y) return true;
    if (x.length < 3 || y.length < 3) return false;
    return x.startsWith(y) || y.startsWith(x);
  };

  const matchedA: Set<string> = new Set();
  const matchedB: Set<string> = new Set();
  for (const ta of tokensA) {
    for (const tb of tokensB) {
      if (tokensMatch(ta, tb)) {
        matchedA.add(ta);
        matchedB.add(tb);
      }
    }
  }
  const intersection = matchedA.size;
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  if (Math.min(tokensA.length, tokensB.length) <= 2) {
    const stringSim = stringSimilarity(tokensA.join(''), tokensB.join(''));
    return Math.max(jaccard, stringSim);
  }

  return jaccard;
}

export function recordDocDateKey(record: KdvRecord): string | null {
  const belgeNo = normalizeBelgeNo(record.belgeNo || '');
  if (!belgeNo || !record.belgeDate) return null;
  return `${belgeNo}|${new Date(record.belgeDate).toISOString().slice(0, 10)}`;
}

export function recordDocDateAmountKey(record: KdvRecord): string | null {
  const base = recordDocDateKey(record);
  if (!base) return null;
  const amount = parseFloat(record.kdvTutari?.toString() || '0');
  if (!Number.isFinite(amount) || amount <= 0) return base;
  return `${base}|${amount.toFixed(2)}`;
}

export function inferRecordRate(record: KdvRecord): number | null {
  const rawData = (record.rawData || {}) as Record<string, any>;
  const source = [
    record.karsiTaraf,
    record.aciklama,
    rawData['HESAP ADI'],
    rawData.hesapAdi,
    rawData.accountName,
    rawData['AÃ‡IKLAMA'],
  ]
    .filter(Boolean)
    .join(' ');
  const match = source.match(/%\s*(\d{1,2}(?:[,.]\d{1,2})?)/);
  if (match) {
    const parsed = parseTrUsAmount(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (record.kdvOrani != null) {
    const explicit = parseFloat(record.kdvOrani.toString());
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
  }
  return null;
}

export function buildAmbiguousDocDateAmountKeys(records: KdvRecord[]): Set<string> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = recordDocDateAmountKey(record);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );
}

export function hasSellerMatch(record: KdvRecord, image: ReceiptImage): boolean {
  const rawData = (record.rawData || {}) as Record<string, any>;
  const recordVkn = String(
    (record as any).karsiVergiNo ||
    rawData.karsiVergiNo ||
    rawData.vergiNo ||
    rawData.vkn ||
    rawData.tckn ||
    '',
  ).replace(/\D/g, '');
  const imgVkn = String((image as any).ocrSaticiVkn || '').replace(/\D/g, '');
  if (recordVkn && imgVkn && (imgVkn.length === 10 || imgVkn.length === 11)) {
    return recordVkn === imgVkn;
  }

  const recordSatici = stripLucaDescriptionDocumentSuffix((record.karsiTaraf || '').trim());
  const imgSatici = ((image as any).ocrSatici || '').trim();
  if (!recordSatici || !imgSatici || isAccountingDescription(recordSatici)) return false;
  return companyNameSimilarity(recordSatici, imgSatici) >= 0.5;
}

export function hasStrongTwoOfThree(
  record: KdvRecord,
  image: ReceiptImage,
  mihsapBelgeTarihi: Date | null,
): boolean {
  const belgeOk = sameBelgeNo(record.belgeNo || '', image.confirmedBelgeNo || image.ocrBelgeNo || '');
  const recordKdv = record.kdvTutari ? parseMoneyLike(record.kdvTutari as any) : 0;
  const imageKdv = parseMoneyLike(image.confirmedKdvTutari || image.ocrKdvTutari);
  const kdvOk = recordKdv > 0 && imageKdv > 0 && Math.abs(recordKdv - imageKdv) / recordKdv < 0.01;
  let tarihOk = false;
  if (record.belgeDate) {
    const recordDate = new Date(record.belgeDate);
    const imageDate = parseTrDate(image.confirmedDate || image.ocrDate || '');
    tarihOk = !!imageDate && sameDay(recordDate, imageDate);
    if (!tarihOk && mihsapBelgeTarihi) tarihOk = sameDay(recordDate, mihsapBelgeTarihi);
  }
  return [belgeOk, kdvOk, tarihOk].filter(Boolean).length >= 2;
}

export function recordPartyKey(rec: KdvRecord): string {
  const rawData = (rec.rawData || {}) as Record<string, any>;
  const taxNo = String(
    (rawData.karsiVergiNo ?? rawData.vergiNo ?? rawData.vkn ?? rawData.tckn ?? '')
  ).replace(/\D/g, '');
  if (taxNo.length === 10 || taxNo.length === 11) return `tax:${taxNo}`;

  const nameCandidates = [
    rawData.karsiTaraf,
    rawData.satici,
    rawData.supplierName,
    rawData['AÃ‡IKLAMA'],
    rawData.aciklama,
    rec.karsiTaraf,
    rec.aciklama,
  ];
  const name = nameCandidates
    .map((value) => stripLucaDescriptionDocumentSuffix(String(value || '').trim()))
    .find((value) => value && !isAccountingDescription(value) && !/^191(?:[.\s]|$)/.test(value))
    || '';
  if (!name || isAccountingDescription(name)) return 'noparty';
  return `name:${name
    .toLocaleUpperCase('tr-TR')
    .replace(/Å/g, 'S').replace(/Ä°/g, 'I')
    .replace(/Ä/g, 'G').replace(/Ã‡/g, 'C')
    .replace(/Ãœ/g, 'U').replace(/Ã–/g, 'O')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 32) || 'noparty'}`;
}
