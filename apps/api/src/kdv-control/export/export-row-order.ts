export type KdvExportComparableRow = {
  id?: string | null;
  status?: string | null;
  imageId?: string | null;
  kdvRecordId?: string | null;
  kdvRecord?: any;
  image?: any;
};

export function compareKdvExportRows(
  rows: KdvExportComparableRow[],
  inferRecordRate: (record: any) => number | null,
) {
  const normalizeDoc = (value: any): string =>
    String(value || '')
      .toLocaleUpperCase('tr-TR')
      .replace(/[^A-Z0-9]/g, '')
      .replace(/^0+(?=\d)/, '');

  const parseDateKey = (value: any): string => {
    if (!value) return '9999-12-31';
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    const text = String(value).trim();
    const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
    if (tr) {
      const year = tr[3].length === 2 ? `20${tr[3]}` : tr[3];
      return `${year}-${tr[2].padStart(2, '0')}-${tr[1].padStart(2, '0')}`;
    }
    return '9999-12-31';
  };

  const statusRank = (value: any): number => {
    switch (value) {
      case 'MATCHED':
      case 'CONFIRMED':
        return 0;
      case 'NEEDS_REVIEW':
      case 'PARTIAL_MATCH':
        return 1;
      case 'UNMATCHED':
        return 2;
      default:
        return 3;
    }
  };

  const docNo = (row: KdvExportComparableRow) =>
    normalizeDoc(row.kdvRecord?.belgeNo || row.image?.confirmedBelgeNo || row.image?.ocrBelgeNo);

  const dateKey = (row: KdvExportComparableRow) =>
    parseDateKey(row.kdvRecord?.belgeDate || row.image?.confirmedDate || row.image?.ocrDate);

  const groupKey = (row: KdvExportComparableRow) => {
    const doc = docNo(row);
    const date = dateKey(row);
    if (doc) return `${date}|doc:${doc}`;
    if (row.imageId) return `${date}|image:${row.imageId}`;
    return `${date}|row:${row.kdvRecordId || row.id}`;
  };

  const originalOrder = new Map<KdvExportComparableRow, number>();
  const groupFirstOrder = new Map<string, number>();
  rows.forEach((row, index) => {
    originalOrder.set(row, index);
    const key = groupKey(row);
    if (!groupFirstOrder.has(key)) groupFirstOrder.set(key, index);
  });

  return (a: KdvExportComparableRow, b: KdvExportComparableRow): number => {
    const statusCompare = statusRank(a.status) - statusRank(b.status);
    if (statusCompare !== 0) return statusCompare;

    const dateCompare = dateKey(a).localeCompare(dateKey(b));
    if (dateCompare !== 0) return dateCompare;

    const groupCompare = (groupFirstOrder.get(groupKey(a)) ?? 0) - (groupFirstOrder.get(groupKey(b)) ?? 0);
    if (groupCompare !== 0) return groupCompare;

    const rateA = inferRecordRate(a.kdvRecord);
    const rateB = inferRecordRate(b.kdvRecord);
    if (rateA != null && rateB != null && Math.abs(rateA - rateB) > 0.001) {
      return rateA - rateB;
    }

    const rowA = Number(a.kdvRecord?.rowIndex ?? Number.MAX_SAFE_INTEGER);
    const rowB = Number(b.kdvRecord?.rowIndex ?? Number.MAX_SAFE_INTEGER);
    if (rowA !== rowB) return rowA - rowB;

    return (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0);
  };
}
