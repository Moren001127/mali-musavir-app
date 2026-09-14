/**
 * Beyanname İndirme — sayfalı liste için SAF yardımcılar (DB/Nest yok; test edilebilir).
 * Sözleşme: docs/sayfalama-sozlesme-2026-09-14.md §4
 *
 *  - sayfaBoyutuNormalize : pageSize 25/50/100 dışı → 50; dışa aktarım için 101..1000 serbest.
 *  - donemAraligiWhere    : donemBas/donemBit ("YYYY-MM") → Prisma where parçası.
 *                           Yıllık kayıtlar ("YYYY-YIL") yıl olarak karşılaştırılır.
 *  - iletimHaritasiKur    : DocumentDispatch satırlarından (docRefs) kayıt-id → iletim listesi.
 *                           Kanal başına EN YENİ gönderim tutulur, liste en yeni önce sıralıdır.
 *  - iletimSuzgecIdleri   : `iletim=iletildi|iletilmedi|hata` süzgeci için id kümeleri.
 */

export type IletimKanal = 'WHATSAPP' | 'EMAIL';
export type IletimDurum = 'SENT' | 'FAILED' | 'PENDING' | 'SKIPPED';

/** Sözleşme §1/§4 — satırdaki `iletim[]` öğesi. Alan adları web ile BİREBİR. */
export type IletimBilgisi = {
  channel: IletimKanal;
  status: IletimDurum;
  sentAt: string | null;
  error: string | null;
  testMode: boolean;
};

/** documentDispatch.findMany(select) ile gelen satır (yalnız gereken alanlar). */
export type GonderimSatiri = {
  docRefs?: unknown;
  status?: string | null;
  channel?: string | null;
  sentAt?: Date | string | null;
  error?: string | null;
  testMode?: boolean | null;
  createdAt?: Date | string | null;
};

export type IletimSecimi = 'iletildi' | 'iletilmedi' | 'hata';

export const SAYFA_BOYUTLARI = [25, 50, 100] as const;
export const SAYFA_BOYUTU_VARSAYILAN = 50;
export const SAYFA_BOYUTU_TAVAN = 1000;

/** 25/50/100 → aynen; 101..1000 → dışa aktarım (tavan 1000); başka her şey → 50. */
export function sayfaBoyutuNormalize(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return SAYFA_BOYUTU_VARSAYILAN;
  if ((SAYFA_BOYUTLARI as readonly number[]).includes(n)) return n;
  if (n > 100) return Math.min(n, SAYFA_BOYUTU_TAVAN);
  return SAYFA_BOYUTU_VARSAYILAN;
}

/** page: 1'den küçük / sayı değil → 1. */
export function sayfaNoNormalize(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/** "YYYY-MM" / "YYYY/MM" / "YYYY-M" / "YYYY" → { yil, ay|null, donem:"YYYY-MM" }; tanınmazsa null. */
export function donemCoz(raw: string | null | undefined): { yil: number; ay: number | null; donem: string } | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = /^(\d{4})(?:[-\/](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const yil = Number(m[1]);
  if (yil < 1990 || yil > 2100) return null;
  if (m[2] == null) return { yil, ay: null, donem: `${yil}` };
  const ay = Number(m[2]);
  if (ay < 1 || ay > 12) return null;
  return { yil, ay, donem: `${yil}-${String(ay).padStart(2, '0')}` };
}

/**
 * Dönem aralığı → Prisma where parçası (BeyanKaydi.donem üzerinde).
 *
 * Aylık kayıtlar ("YYYY-MM") alfabetik sıra = tarih sırası olduğundan string karşılaştırmasıyla,
 * yıllık kayıtlar ("YYYY-YIL") ise yıl ∈ [basYılı, bitYılı] kuralıyla süzülür:
 *   OR: [ { donem: { gte: bas, lte: bit } }, { donem: { in: ['2025-YIL', '2026-YIL'] } } ]
 * Tek uçlu aralıkta ("YYYY-YIL" > "YYYY-12" olduğu için) alt sınır string ile doğru çalışır;
 * üst sınır için yıllık kayıtlar ayrıca `endsWith:'-YIL'` dalıyla alınır.
 * İki uç da yoksa null (süzgeç yok). Uçlar ters verilmişse yer değiştirilir.
 */
export function donemAraligiWhere(donemBas?: string | null, donemBit?: string | null): Record<string, unknown> | null {
  let bas = donemCoz(donemBas);
  let bit = donemCoz(donemBit);
  if (!bas && !bit) return null;
  // Yalnız yıl verildiyse: baş → Ocak, bit → Aralık
  if (bas && bas.ay == null) bas = { ...bas, ay: 1, donem: `${bas.yil}-01` };
  if (bit && bit.ay == null) bit = { ...bit, ay: 12, donem: `${bit.yil}-12` };
  if (bas && bit && bas.donem > bit.donem) [bas, bit] = [bit, bas];

  if (bas && bit) {
    const yillar: string[] = [];
    for (let y = bas.yil; y <= bit.yil && yillar.length < 40; y++) yillar.push(`${y}-YIL`);
    return {
      OR: [
        { donem: { gte: bas.donem, lte: bit.donem } },
        { donem: { in: yillar } },
      ],
    };
  }
  if (bas) {
    // "2025-YIL" >= "2025-03" (Y > rakam) → yıllık kayıtlar da doğru süzülür
    return { donem: { gte: bas.donem } };
  }
  // yalnız bit
  return {
    OR: [
      { donem: { lte: bit!.donem } },
      { donem: { endsWith: '-YIL', lte: `${bit!.yil}-YIL` } },
    ],
  };
}

function zamanMs(v: Date | string | null | undefined): number {
  if (!v) return 0;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isoVeyaNull(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function kanalNormalize(v: unknown): IletimKanal | null {
  return v === 'WHATSAPP' || v === 'EMAIL' ? v : null;
}

function durumNormalize(v: unknown): IletimDurum {
  return v === 'SENT' || v === 'FAILED' || v === 'PENDING' || v === 'SKIPPED' ? v : 'PENDING';
}

/**
 * Gönderim satırlarından kayıt-id → IletimBilgisi[] haritası.
 * Her kayıt için KANAL BAŞINA en yeni gönderim (createdAt, yoksa sentAt) tutulur;
 * liste en yeni önce sıralıdır → web `iletim[0]`'ı rozet olarak gösterir.
 * docRefs dizi değilse / boşsa satır atlanır; kanalı tanınmayan satır atlanır.
 */
export function iletimHaritasiKur(dispatches: GonderimSatiri[]): Map<string, IletimBilgisi[]> {
  type Ic = { bilgi: IletimBilgisi; zaman: number };
  const ara = new Map<string, Map<IletimKanal, Ic>>();
  for (const d of dispatches || []) {
    const refs = Array.isArray(d?.docRefs) ? d.docRefs : [];
    if (refs.length === 0) continue;
    const channel = kanalNormalize(d.channel);
    if (!channel) continue;
    const zaman = zamanMs(d.createdAt) || zamanMs(d.sentAt);
    const bilgi: IletimBilgisi = {
      channel,
      status: durumNormalize(d.status),
      sentAt: isoVeyaNull(d.sentAt),
      error: d.error ?? null,
      testMode: !!d.testMode,
    };
    for (const ref of refs) {
      if (typeof ref !== 'string' || !ref) continue;
      let kanallar = ara.get(ref);
      if (!kanallar) {
        kanallar = new Map();
        ara.set(ref, kanallar);
      }
      const eski = kanallar.get(channel);
      if (!eski || zaman > eski.zaman) kanallar.set(channel, { bilgi, zaman });
    }
  }
  const out = new Map<string, IletimBilgisi[]>();
  for (const [ref, kanallar] of ara) {
    out.set(
      ref,
      [...kanallar.values()].sort((a, b) => b.zaman - a.zaman).map((x) => x.bilgi),
    );
  }
  return out;
}

/**
 * `iletim` süzgeci için id kümeleri (haritadaki kanal-başına-en-yeni listeler üzerinden):
 *  - iletildi   → en az bir kanalda son gönderimi SENT olanlar            → { in }
 *  - hata       → en yeni gönderimi (iletim[0]) FAILED olanlar            → { in }
 *  - iletilmedi → SENT ya da FAILED gönderimi olmayanlar (hiç denenmemiş / bekleyen) → { notIn }
 */
export function iletimSuzgecIdleri(
  harita: Map<string, IletimBilgisi[]>,
  secim: IletimSecimi,
): { in: string[] } | { notIn: string[] } {
  const sentIds: string[] = [];
  const hataIds: string[] = [];
  const sentVeyaFailed: string[] = [];
  for (const [id, liste] of harita) {
    const sentVar = liste.some((x) => x.status === 'SENT');
    const failedVar = liste.some((x) => x.status === 'FAILED');
    if (sentVar) sentIds.push(id);
    if (liste[0]?.status === 'FAILED') hataIds.push(id);
    if (sentVar || failedVar) sentVeyaFailed.push(id);
  }
  if (secim === 'iletildi') return { in: sentIds };
  if (secim === 'hata') return { in: hataIds };
  return { notIn: sentVeyaFailed };
}
