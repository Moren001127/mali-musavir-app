import type { KdvRecord } from '@prisma/client';

type LucaRecordLike = Pick<KdvRecord, 'belgeNo' | 'belgeDate' | 'karsiTaraf' | 'aciklama' | 'rawData'>;

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/[ıİ]/g, 'i')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[şŞ]/g, 's')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function rawDataText(rawData: unknown): string {
  if (rawData == null) return '';
  if (typeof rawData !== 'object') return String(rawData);

  try {
    return Object.entries(rawData as Record<string, unknown>)
      .map(([key, value]) => {
        const printable =
          value && typeof value === 'object'
            ? JSON.stringify(value)
            : String(value ?? '');
        return `${key} ${printable}`;
      })
      .join(' ');
  } catch {
    return String(rawData);
  }
}

function hasDocumentNo(value: unknown): boolean {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (/^[\s\-_\u2013\u2014]+$/.test(text)) return false;
  return !/^(null|undefined)$/i.test(text);
}

function hasValidDate(value: unknown): boolean {
  if (!value) return false;
  if (value instanceof Date) return Number.isFinite(value.getTime());
  const date = new Date(String(value));
  return Number.isFinite(date.getTime());
}

export function isAggregateLucaRecord(record: LucaRecordLike): boolean {
  const hasBelgeNo = hasDocumentNo(record.belgeNo);
  const hasDate = hasValidDate(record.belgeDate);
  const text = normalizeText(
    [
      record.aciklama,
      record.karsiTaraf,
      rawDataText(record.rawData),
    ].join(' '),
  );

  const hasAggregateLabel =
    /\bnakli\s+yekun\b/.test(text) ||
    /\bnakil\s+yekun\b/.test(text) ||
    /\bdevir\b/.test(text) ||
    /\bgenel\s+toplam\b/.test(text) ||
    /(^|\s)toplam\s*:/.test(text) ||
    /^toplam\b/.test(text);

  // Luca Defteri Kebir raporunda nakli yekun ve final toplam satirlari KDV kolonu dolu olsa
  // bile belge degildir: tarih ve evrak no tasimazlar.
  if (!hasDate && !hasBelgeNo) return true;

  return hasAggregateLabel && (!hasDate || !hasBelgeNo);
}
