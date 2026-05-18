import type { KdvRecord } from '@prisma/client';

export interface MultiRateAggregateResult {
  records: KdvRecord[];
  virtualGroups: Map<string, string[]>;
  virtualExpectedBreakdown: Map<string, Array<{ oran: number; tutar: number }>>;
  virtualOriginalKdvAmounts: Map<string, number[]>;
}

interface MultiRateAggregateDeps {
  normalizeBelgeNo: (value: string) => string;
  recordPartyKey: (record: KdvRecord) => string;
  inferRecordRate: (record: KdvRecord) => number | null;
  log?: (message: string) => void;
}

export function aggregateMultiRateRecords(
  rawRecords: KdvRecord[],
  isAlis: boolean,
  deps: MultiRateAggregateDeps,
): MultiRateAggregateResult {
  const groups = new Map<string, KdvRecord[]>();
  const unaggregated: KdvRecord[] = [];

  for (const rec of rawRecords) {
    const bn = deps.normalizeBelgeNo(rec.belgeNo || '');
    if (!bn || !rec.belgeDate) {
      unaggregated.push(rec);
      continue;
    }

    const dateKey = new Date(rec.belgeDate).toISOString().slice(0, 10);
    const partyKey = deps.recordPartyKey(rec);
    const kdvAmount = parseFloat(rec.kdvTutari?.toString() || '0');

    if (partyKey === 'noparty') {
      const isShortReceiptNo = bn.length < 10;
      const canGroupShortOkcNo = isShortReceiptNo && /^\d{1,8}$/.test(bn);
      if (!(kdvAmount > 0) || (isShortReceiptNo && !canGroupShortOkcNo)) {
        unaggregated.push(rec);
        continue;
      }
    }

    const key = partyKey === 'noparty'
      ? (bn.length < 10
        ? `${bn}|${dateKey}|okc-short`
        : isAlis
          ? `${bn}|${dateKey}|amount:${kdvAmount.toFixed(2)}`
          : `${bn}|${dateKey}|sales-long`)
      : `${bn}|${dateKey}|${partyKey}`;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(rec);
  }

  const result: KdvRecord[] = [...unaggregated];
  const virtualGroups = new Map<string, string[]>();
  const virtualExpectedBreakdown = new Map<string, Array<{ oran: number; tutar: number }>>();
  const virtualOriginalKdvAmounts = new Map<string, number[]>();

  for (const [key, group] of groups) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    let kdvToplam = 0;
    let matrahToplam = 0;
    const expectedByRate = new Map<number, number>();

    for (const record of group) {
      const tutar = parseFloat(record.kdvTutari?.toString() || '0');
      kdvToplam += tutar;
      matrahToplam += parseFloat(record.kdvMatrahi?.toString() || '0');
      const oran = deps.inferRecordRate(record) || 0;
      if (oran > 0 && tutar > 0) {
        expectedByRate.set(oran, (expectedByRate.get(oran) || 0) + tutar);
      }
    }

    const base = group[0];
    const virtualId = `__virtual__:${key}`;
    const virtual: KdvRecord = {
      ...base,
      id: virtualId,
      kdvTutari: kdvToplam as any,
      kdvOrani: null,
      ...(matrahToplam > 0 ? { kdvMatrahi: matrahToplam as any } : {}),
    };

    result.push(virtual);
    virtualGroups.set(virtualId, group.map((record) => record.id));

    if (expectedByRate.size > 0) {
      virtualExpectedBreakdown.set(
        virtualId,
        Array.from(expectedByRate.entries())
          .map(([oran, tutar]) => ({ oran, tutar }))
          .sort((a, b) => b.oran - a.oran),
      );
    }

    virtualOriginalKdvAmounts.set(
      virtualId,
      group
        .map((record) => parseFloat(record.kdvTutari?.toString() || '0'))
        .filter((amount) => amount > 0),
    );

    deps.log?.(
      `Cok oranli KDV aggregate: belge=${base.belgeNo} · ${group.length} satir -> toplam KDV=${kdvToplam.toFixed(2)} · oranlar=[${Array.from(expectedByRate.entries()).map(([oran, tutar]) => `%${oran}:${tutar.toFixed(2)}`).join(', ')}]`,
    );
  }

  return {
    records: result,
    virtualGroups,
    virtualExpectedBreakdown,
    virtualOriginalKdvAmounts,
  };
}
