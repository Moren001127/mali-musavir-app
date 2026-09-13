/**
 * EKİP BAYAT KOŞU BEKÇİSİ — saf karar mantığı (2026-09-13).
 *
 * Sorun: ekip koşuları (AgentCommand agent='ekip:*') süreç belleğinde koşar. Deploy / yeniden başlatma /
 * çökme anında koşu ölür ama iş dosyası 'running' kalır → `ekip_ajan_baslat` "çalışan iş var" diye yenisini
 * AÇMAZ, Konsol "Sürüyor" gösterir → sistem sessizce kilitlenir. (Belge kuyruğundaki 15 dk bayat-RUNNING
 * kurtarmasının ekip karşılığı.)
 *
 * Kural (KODDA):
 *   - Süreç belleğinde hâlâ koşan iş (runner.calisanKosular) ASLA bayat sayılmaz.
 *   - Başlangıç taraması: süreç açılışından ÖNCE başlamış 'running' işler bayat (eski süreç öldü). Rolling
 *     deploy örtüşmesi için açılıştan BEKCI_ACILIS_GECIKME_MS sonra bakılır; eski süreç o arada bitirirse
 *     kendi 'done' yazar ve bekçi dokunmaz.
 *   - Düzenli tarama: startedAt üzerinden EKIP_KOSU_TAVAN_DK (varsayılan 120 dk) geçmiş 'running' iş bayat.
 *   - Bayat iş → 'failed', result.hata = insan dilinde neden, result.bayat = true (rapor korunur).
 */

export const BEKCI_ACILIS_GECIKME_MS = 3 * 60 * 1000;
export const BEKCI_TARAMA_ARALIGI_MS = 5 * 60 * 1000;
export const EKIP_KOSU_TAVAN_DK_VARSAYILAN = 120;

export interface BekciAdayIs {
  id: string;
  agent: string;
  status: string;
  startedAt: Date | null;
  createdAt: Date;
  result?: any;
}

export interface BekciKarar {
  id: string;
  neden: 'sunucu_yeniden_basladi' | 'sure_asimi';
  metin: string;
}

export function kosuTavanDk(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.EKIP_KOSU_TAVAN_DK);
  return Number.isFinite(n) && n >= 10 ? n : EKIP_KOSU_TAVAN_DK_VARSAYILAN;
}

/**
 * Hangi işler bayat? `aktifMi(id)` süreç belleğindeki koşuyu söyler (true → dokunma).
 * `surecBaslangici` verilirse ondan önce başlamış her 'running' iş bayattır (açılış taraması);
 * verilmezse yalnız süre aşımı (düzenli tarama).
 */
export function bayatKosulariSec(
  isler: BekciAdayIs[],
  opts: { simdi: Date; aktifMi: (id: string) => boolean; surecBaslangici?: Date | null; tavanDk?: number },
): BekciKarar[] {
  const tavanDk = opts.tavanDk ?? EKIP_KOSU_TAVAN_DK_VARSAYILAN;
  const simdiMs = opts.simdi.getTime();
  const out: BekciKarar[] = [];
  for (const is of isler) {
    if (!is || is.status !== 'running') continue;
    if (!String(is.agent || '').startsWith('ekip:')) continue;
    if (opts.aktifMi(is.id)) continue;
    const basla = (is.startedAt || is.createdAt || opts.simdi).getTime();
    const dk = Math.max(0, Math.round((simdiMs - basla) / 60000));
    if (opts.surecBaslangici && basla < opts.surecBaslangici.getTime()) {
      out.push({
        id: is.id,
        neden: 'sunucu_yeniden_basladi',
        metin: `Sunucu yeniden başlatıldığı için bu koşu yarım kaldı (${dk} dk önce başlamıştı). Gerekirse aynı işi Konsoldan yeniden verin.`,
      });
      continue;
    }
    if (simdiMs - basla > tavanDk * 60000) {
      out.push({
        id: is.id,
        neden: 'sure_asimi',
        metin: `Koşu ${tavanDk} dakikalık tavanı aştı (${dk} dk), yarım sayıldı. Gerekirse aynı işi Konsoldan yeniden verin.`,
      });
    }
  }
  return out;
}

/** Bayat işin result alanı: eski rapor/alanlar korunur, hata + bayat işareti eklenir. */
export function bayatSonucBirlestir(eski: any, karar: BekciKarar): any {
  const e = eski && typeof eski === 'object' && !Array.isArray(eski) ? eski : {};
  return { ...e, hata: karar.metin, bayat: true, bayatNeden: karar.neden };
}
