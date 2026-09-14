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
 *   - SÜREÇ KİMLİĞİ (PLAN/19 H9-b, 2026-09-14): runner iş dosyasını 'running' yaparken payload.surec = SUREC_KIMLIGI yazar;
 *     bekçi payload.surec bu sürecin kimliğine EŞİT olan kayda dokunmaz (kendi canlı koşusu), yalnız başka/ölmüş sürecin
 *     kayıtlarını (ya da surec alanı olmayan eski kayıtları) değerlendirir.
 *   - Başlangıç taraması: süreç açılışından ÖNCE başlamış 'running' işler bayat (eski süreç öldü). Rolling
 *     deploy örtüşmesi için açılıştan BEKCI_ACILIS_GECIKME_MS sonra bakılır; eski süreç o arada bitirirse
 *     kendi 'done' yazar ve bekçi dokunmaz.
 *   - Başlangıç taramasında 'pending' (PLAN/19 H9-a): BEKCI_PENDING_TAVAN_DK (10 dk) önce açılmış ama hiç 'running'
 *     olmamış iş takılıdır (runner pending→running geçişini milisaniyede yapar) → failed, "iş takılı kalmıştı".
 *     `ekip_ajan_baslat` pending'i de "çalışan iş var" saydığından temizlenmezse yeni iş açılmıyordu.
 *   - Düzenli tarama: startedAt üzerinden EKIP_KOSU_TAVAN_DK (varsayılan 120 dk) geçmiş 'running' iş bayat.
 *   - Bayat iş → 'failed', result.hata = insan dilinde neden, result.bayat = true (rapor korunur).
 */

export const BEKCI_ACILIS_GECIKME_MS = 3 * 60 * 1000;
export const BEKCI_TARAMA_ARALIGI_MS = 5 * 60 * 1000;
export const EKIP_KOSU_TAVAN_DK_VARSAYILAN = 120;
/** Açılış taramasında bu kadar dakikadan eski 'pending' iş takılı sayılır (PLAN/19 H9-a). */
export const BEKCI_PENDING_TAVAN_DK = 10;

/**
 * Bu API sürecinin kimliği: pid + süreç başlangıç zaman damgası (modül yüklenince bir kez). Runner iş dosyasını
 * 'running' yaparken payload.surec'e yazar; bekçi bu kimliğe eşit kayıtlara dokunmaz (PLAN/19 H9-b).
 */
export const SUREC_KIMLIGI = `${process.pid}@${Date.now()}`;

export interface BekciAdayIs {
  id: string;
  agent: string;
  status: string;
  startedAt: Date | null;
  createdAt: Date;
  result?: any;
  /** payload.surec: işi 'running' yapan sürecin kimliği (eski kayıtlarda yok). */
  payload?: any;
}

export interface BekciKarar {
  id: string;
  neden: 'sunucu_yeniden_basladi' | 'sure_asimi' | 'takili_pending';
  /** Kaydın bekçi bakarkenki durumu — güncelleme yarış korumasında (where.status) kullanılır. */
  eskiDurum: 'running' | 'pending';
  metin: string;
}

export function kosuTavanDk(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.EKIP_KOSU_TAVAN_DK);
  return Number.isFinite(n) && n >= 10 ? n : EKIP_KOSU_TAVAN_DK_VARSAYILAN;
}

/** İşi 'running' yapan sürecin kimliği (payload.surec); yoksa null. */
function isinSureci(is: BekciAdayIs): string | null {
  const p = is?.payload;
  const s = p && typeof p === 'object' && !Array.isArray(p) ? p.surec : null;
  return typeof s === 'string' && s ? s : null;
}

/**
 * Hangi işler bayat? `aktifMi(id)` süreç belleğindeki koşuyu söyler (true → dokunma).
 * `surecKimligi` verilirse payload.surec ona EŞİT olan kayıt bu sürecin canlı koşusudur → dokunulmaz.
 * `surecBaslangici` verilirse (açılış taraması) ondan önce başlamış her 'running' iş bayattır ve 10 dk'dan eski
 * 'pending' işler takılı sayılır; verilmezse yalnız süre aşımı (düzenli tarama; pending'e bakılmaz).
 */
export function bayatKosulariSec(
  isler: BekciAdayIs[],
  opts: { simdi: Date; aktifMi: (id: string) => boolean; surecBaslangici?: Date | null; tavanDk?: number; surecKimligi?: string | null },
): BekciKarar[] {
  const tavanDk = opts.tavanDk ?? EKIP_KOSU_TAVAN_DK_VARSAYILAN;
  const simdiMs = opts.simdi.getTime();
  const out: BekciKarar[] = [];
  for (const is of isler) {
    if (!is) continue;
    if (!String(is.agent || '').startsWith('ekip:')) continue;
    if (opts.aktifMi(is.id)) continue;
    // Bu sürecin kendi koşusu (payload.surec = süreç kimliği) → dokunma (bitiş yazımı ile tarama yarışmasın)
    if (opts.surecKimligi && isinSureci(is) === opts.surecKimligi) continue;

    if (is.status === 'pending') {
      if (!opts.surecBaslangici) continue; // yalnız açılış taraması
      const olusma = (is.createdAt || opts.simdi).getTime();
      const dk = Math.max(0, Math.round((simdiMs - olusma) / 60000));
      if (simdiMs - olusma > BEKCI_PENDING_TAVAN_DK * 60000) {
        out.push({
          id: is.id,
          neden: 'takili_pending',
          eskiDurum: 'pending',
          metin: `Bekçi: süreç yeniden başladı, iş takılı kalmıştı (${dk} dk önce açılmış, hiç başlamamış). Gerekirse aynı işi Konsoldan yeniden verin.`,
        });
      }
      continue;
    }
    if (is.status !== 'running') continue;
    const basla = (is.startedAt || is.createdAt || opts.simdi).getTime();
    const dk = Math.max(0, Math.round((simdiMs - basla) / 60000));
    if (opts.surecBaslangici && basla < opts.surecBaslangici.getTime()) {
      out.push({
        id: is.id,
        neden: 'sunucu_yeniden_basladi',
        eskiDurum: 'running',
        metin: `Sunucu yeniden başlatıldığı için bu koşu yarım kaldı (${dk} dk önce başlamıştı). Gerekirse aynı işi Konsoldan yeniden verin.`,
      });
      continue;
    }
    if (simdiMs - basla > tavanDk * 60000) {
      out.push({
        id: is.id,
        neden: 'sure_asimi',
        eskiDurum: 'running',
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
