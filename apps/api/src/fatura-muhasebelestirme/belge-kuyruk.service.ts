import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { hostname } from 'os';
import { PrismaService } from '../prisma/prisma.service';
import { BelgeKuyrukGirdisi, BelgeKuyrukKancasi, FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';
import { fmAiBaglamIle, fmAiBekciDurumu } from '../common/fm-ai';

/**
 * KALICI BELGE KUYRUĞU — Fatura Merkezi (2026-09-13)
 *
 * NEDEN: Bellek-içi uploadOcrQueue (classify / ai-read) her deploy'da siliniyordu; sahip classify-pending ve
 *   ai-read-batch uçlarıyla elle yeniden dolduruyordu. Canlı ölçüm (2026-09-13 02:00): tek Max sınıflandırma
 *   çağrısı 95-153 sn; toplu koalesans (MAX_CLASSIFY_BATCH=10, 8 sn pencere) var ama partiler çoğunlukla grup=1
 *   kalıyordu (işçiler kapıda beklerken pencere kaçıyor). Burada partiler DB'den AYNI MÜKELLEFTEN seçilip
 *   AYNI ANDA başlatılır → koalesans onları tek Max çağrısında birleştirir.
 *
 * Tablo: invoice_processing_jobs (InvoiceProcessingJob). kind CLASSIFY | AI_READ; status PENDING | RUNNING |
 *   DONE | FAILED; priority 0 arka plan · 3 ithal/okuma sonrası · 5 gece · 10 sahip isteği.
 *
 * İşçi (@Interval 5 sn):
 *   (a) bayat RUNNING (lockedAt < şimdi-15 dk) → PENDING attempts+1; attempts ≥ 3 → FAILED.
 *   (b) kapasite: aktif AI_READ ≤ FM_KUYRUK_OKUMA_ESZAMANLI (4); aktif CLASSIFY partisi ≤ FM_KUYRUK_SINIF_PARTI_ESZAMANLI (2).
 *   (c) seçim: en yüksek priority, en eski; CLASSIFY için aynı mükelleften en çok MAX_CLASSIFY_BATCH (10) belge tek parti.
 *   (d) işleme: FaturaMuhasebelestirmeService.kuyrukIsle(kind, tenantId, ids) — CLASSIFY partisi Promise.all ile aynı anda.
 *   (e) bitince DONE/FAILED + finishedAt; hata 300 karakter.
 *   AI_READ bitince belge okunmuş-ama-sınıflanmamışsa (UBL/XML yolu Max'i atlar → kategori boş) CLASSIFY (priority 3) kuyruklanır.
 *
 * Gece (03:45 Europe/Istanbul, env FM_GECE_KUYRUK=off kapatır): bekleyen belgelerde okunmamış → AI_READ, okunmuş-ama-
 *   sınıflanmamış → CLASSIFY (priority 5, tavan 400/gece/tenant); AuditLog GECE_KUYRUK {okuma, sinif}.
 *
 * Tek instance varsayımı (Railway tek replika) ama lockedBy=instanceId ile güvenli: iki instance aynı işi claim edemez
 *   (updateMany where status=PENDING → yalnız kazanan görür).
 */
/** CLASSIFY_GUCLU (2026-09-13): zayıf Haiku sonucu için Sonnet ikinci turu — öncelik 1 (en son), CLASSIFY ile aynı partileme. */
export type KuyrukTuru = 'CLASSIFY' | 'AI_READ' | 'CLASSIFY_GUCLU';
export type KuyrukDurumu = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export const KUYRUK_ONCELIK = { ARKA_PLAN: 0, ITHAL: 3, GECE: 5, SAHIP: 10 } as const;
export const GECE_KUYRUK_CRON = '0 45 3 * * *';
export const BAYAT_KILIT_MS = 15 * 60 * 1000;
/** Açılış kurtarması gecikmesi: rolling deploy örtüşmesi bitsin diye (eski süreç bu arada işini bitirirse DONE yazar, dokunulmaz). */
export const ACILIS_KURTARMA_GECIKME_MS = 2 * 60 * 1000;
/** Açılış kurtarmasında bu süreden TAZE kilitler (eski süreç hâlâ işliyor olabilir) geri alınmaz. Env: KUYRUK_ACILIS_TAZE_KILIT_SN (180). */
export const ACILIS_TAZE_KILIT_MS = Math.max(0, Number(process.env.KUYRUK_ACILIS_TAZE_KILIT_SN ?? 180) || 180) * 1000;
export const MAX_DENEME = 3;
export const GECE_TAVAN = 400;
export const ISCI_TIK_MS = 5000;

/** FM_GECE_KUYRUK: tanımsız/on/1/true → açık; off|0|false|kapali → kapalı. */
export function geceKuyrukEnvKapaliMi(v: string | undefined = process.env.FM_GECE_KUYRUK): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'off' || s === '0' || s === 'false' || s === 'kapali' || s === 'kapalı';
}

export function kuyrukAyarlari(env: NodeJS.ProcessEnv = process.env) {
  const sayi = (v: string | undefined, vars: number) => { const n = Number(String(v ?? '').trim() || vars); return Math.max(1, Number.isFinite(n) ? n : vars); };
  return {
    okumaEszamanli: sayi(env.FM_KUYRUK_OKUMA_ESZAMANLI, 4),
    sinifPartiEszamanli: sayi(env.FM_KUYRUK_SINIF_PARTI_ESZAMANLI, 2),
    partiBoyu: sayi(env.MAX_CLASSIFY_BATCH, 10),
  };
}

/** Belgenin ocrData'sına göre sınıflanacak içerik var mı / zaten sınıflı mı (classifyPending ile aynı ölçüt). */
export function belgeIcerikVarMi(o: any, vendorName?: string | null): boolean {
  o = o || {};
  // 2026-09-13: kalem/metin yoksa satıcı ünvanı (≥6 kr) da "sınıflanabilir içerik" sayılır (satıcı adından düşük güvenli tahmin).
  return !!(String(o.icerikMetni || '').trim() || (Array.isArray(o.kalemler) && o.kalemler.length) || String(vendorName || '').trim().length >= 6);
}
export function belgeSinifliMi(o: any): boolean {
  o = o || {};
  return !!(String(o.matrahKategori || o.kategori || '').trim() || String(o.giderTuru || '').trim());
}

type Is = { id: string; tenantId: string; taxpayerId: string | null; documentId: string; kind: string; priority: number; status: string; attempts: number };

@Injectable()
export class BelgeKuyrukService implements OnModuleInit, BelgeKuyrukKancasi {
  private readonly logger = new Logger(BelgeKuyrukService.name);
  readonly instanceId = `${hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
  private readonly surecBaslangici = new Date();
  private tikCalisiyor = false;
  private geceCalisiyor = false;
  /** Şu an bu süreçte koşan AI_READ işi sayısı / CLASSIFY partisi sayısı (kapasite). */
  aktifOkuma = 0;
  aktifParti = 0;
  /** Testte kapatılır (Interval tetiklemez); canlıda açılışta açılır. */
  private isciAcik = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fm: FaturaMuhasebelestirmeService,
  ) {}

  onModuleInit() {
    // Fatura servisine bağlan → classify-pending / ai-read-batch / restart-kurtarma DB kuyruğuna yazar.
    this.fm.kuyrukBagla(this);
    this.isciAcik = true;
    this.logger.log(`[KUYRUK] kalıcı belge kuyruğu bağlandı (instance=${this.instanceId}, ayar=${JSON.stringify(kuyrukAyarlari())})`);
    // AÇILIŞ KURTARMASI (2026-09-13): deploy'da önceki süreçte RUNNING kalan işler 15 dk bayat-kilit beklemesin —
    //   açılıştan 2 dk sonra (eski süreç kesin kapanmış) başka instance'ın kilitlediği RUNNING işler PENDING'e döner
    //   (deneme sayısı ARTMAZ: iş başarısız değil, süreç kesildi). Testte (isciAcik kapalıyken) çalışmaz.
    const t = setTimeout(() => { void this.acilisKurtar().catch((e: any) => this.logger.warn(`[KUYRUK] açılış kurtarma hatası: ${e?.message || e}`)); }, ACILIS_KURTARMA_GECIKME_MS);
    (t as any).unref?.();
  }

  /** Başka süreçte kilitli kalmış RUNNING işleri PENDING'e al (deploy/çökme). @returns kurtarılan sayısı */
  async acilisKurtar(surecBaslangici: Date = this.surecBaslangici): Promise<number> {
    // YAYIN ÖRTÜŞMESİ (2026-09-15 Gemini maliyet incelemesi): Railway yeni süreci açarken eski süreç işini bitiriyor olabilir;
    //   açılışta TAZE kilitli (son ACILIS_TAZE_KILIT_MS) işleri geri almak aynı belgeyi iki kez Gemini'ye okutuyordu
    //   (sabah 30+ yayında aynı 5 belge 3 kez okundu). Taze kilit eski sürece bırakılır; gerçekten yarım kalanı 15 dk
    //   bayat-kilit kurtarması alır.
    const esik = new Date(Math.min(surecBaslangici.getTime(), Date.now() - ACILIS_TAZE_KILIT_MS));
    const r = await this.db.invoiceProcessingJob.updateMany({
      where: { status: 'RUNNING', lockedBy: { not: this.instanceId }, lockedAt: { lt: esik } },
      data: { status: 'PENDING', lockedBy: null, lockedAt: null, startedAt: null, lastError: 'deploy: önceki süreç yarım bıraktı — açılışta yeniden kuyruğa alındı' },
    }).catch(() => ({ count: 0 }));
    const n = Number(r?.count || 0);
    if (n) this.logger.warn(`[KUYRUK] açılış kurtarma: ${n} RUNNING iş (önceki süreç) PENDING'e alındı`);
    return n;
  }

  private get db(): any { return this.prisma as any; }

  // ── KUYRUĞA ALMA ────────────────────────────────────────────────────────────────────────────────

  /** İdempotent: aynı belge+kind PENDING/RUNNING varsa eklemez; PENDING ise ve yeni öncelik yüksekse yükseltir. */
  async kuyrugaAl(g: BelgeKuyrukGirdisi): Promise<{ eklendi: boolean; yukseltildi: boolean }> {
    const r = await this.topluKuyrugaAl([g]);
    return { eklendi: r.eklenen > 0, yukseltildi: r.yukseltilen > 0 };
  }

  async topluKuyrugaAl(girdiler: BelgeKuyrukGirdisi[]): Promise<{ eklenen: number; yukseltilen: number; zatenKuyrukta: number; bekleyen: number }> {
    const temiz = (girdiler || []).filter((g) => g && g.tenantId && g.documentId && (g.kind === 'CLASSIFY' || g.kind === 'AI_READ' || g.kind === 'CLASSIFY_GUCLU'));
    let eklenen = 0; let yukseltilen = 0; let zatenKuyrukta = 0; let failedAtlanan = 0;
    if (temiz.length) {
      // Aynı istekte tekrar eden (belge, kind) çiftlerini tekilleştir (en yüksek öncelik kalsın).
      const tekil = new Map<string, BelgeKuyrukGirdisi>();
      for (const g of temiz) {
        const k = `${g.documentId}|${g.kind}`;
        const onceki = tekil.get(k);
        if (!onceki || Number(g.priority) > Number(onceki.priority)) tekil.set(k, g);
      }
      const liste = [...tekil.values()];
      const mevcut: Is[] = await this.db.invoiceProcessingJob.findMany({
        where: { documentId: { in: liste.map((g) => g.documentId) }, status: { in: ['PENDING', 'RUNNING'] } },
        select: { id: true, documentId: true, kind: true, priority: true, status: true },
      }).catch(() => []);
      const mevcutMap = new Map<string, Is>();
      for (const m of mevcut) mevcutMap.set(`${m.documentId}|${m.kind}`, m);
      // 72 SAAT FAILED SÜZGECİ (2026-09-13 doğrulayıcı bulgusu): başlangıç kurtarma / okuma-sonrası / gece yolları son 72 saatte
      //   aynı belge+kind için FAILED olmuş işi yeniden kuyruklayıp her deploy'da Max israfı yapıyordu. Sahip isteği (priority ≥ 10)
      //   bu süzgeçten MUAF (bilinçli tekrar deneme; kuyruk/tekrar-dene de FAILED→PENDING yapar).
      const failedSon: Array<{ documentId: string; kind: string }> = await this.db.invoiceProcessingJob.findMany({
        where: { documentId: { in: liste.map((g) => g.documentId) }, status: 'FAILED', finishedAt: { gte: new Date(Date.now() - 72 * 3600 * 1000) } },
        select: { documentId: true, kind: true },
      }).catch(() => []);
      const failedSet = new Set(failedSon.map((f) => `${f.documentId}|${f.kind}`));
      const yeniler: any[] = [];
      const yukselt: Array<{ id: string; priority: number }> = [];
      for (const g of liste) {
        const m = mevcutMap.get(`${g.documentId}|${g.kind}`);
        const oncelik = Math.max(0, Math.round(Number(g.priority) || 0));
        if (!m) {
          if (oncelik < 10 && failedSet.has(`${g.documentId}|${g.kind}`)) { failedAtlanan++; continue; }
          yeniler.push({ tenantId: g.tenantId, taxpayerId: g.taxpayerId || null, documentId: g.documentId, kind: g.kind, priority: oncelik, status: 'PENDING' });
          continue;
        }
        if (m.status === 'PENDING' && oncelik > Number(m.priority)) { yukselt.push({ id: m.id, priority: oncelik }); continue; }
        zatenKuyrukta++;
      }
      if (yeniler.length) {
        await this.db.invoiceProcessingJob.createMany({ data: yeniler });
        eklenen = yeniler.length;
      }
      for (const y of yukselt) {
        // Yalnız hâlâ PENDING ise yükselt (bu arada işçi almış olabilir).
        const r = await this.db.invoiceProcessingJob.updateMany({ where: { id: y.id, status: 'PENDING' }, data: { priority: y.priority } }).catch(() => ({ count: 0 }));
        if (r?.count) yukseltilen++; else zatenKuyrukta++;
      }
    }
    const bekleyen = await this.db.invoiceProcessingJob.count({ where: { status: 'PENDING' } }).catch(() => 0);
    if (failedAtlanan > 0) this.logger.log(`[KUYRUK] ${failedAtlanan} belge son 72 saatte FAILED olduğu için yeniden kuyruklanmadı (sahip isteği muaf)`);
    return { eklenen, yukseltilen, zatenKuyrukta, bekleyen };
  }

  // ── DURUM / TEKRAR DENE ─────────────────────────────────────────────────────────────────────────

  async durum(tenantId: string) {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const j = this.db.invoiceProcessingJob;
    const [pCls, pRead, running, done24h, failed24h, sonHata, pGuclu] = await Promise.all([
      j.count({ where: { tenantId, status: 'PENDING', kind: 'CLASSIFY' } }),
      j.count({ where: { tenantId, status: 'PENDING', kind: 'AI_READ' } }),
      j.count({ where: { tenantId, status: 'RUNNING' } }),
      j.count({ where: { tenantId, status: 'DONE', finishedAt: { gte: since } } }),
      j.count({ where: { tenantId, status: 'FAILED', finishedAt: { gte: since } } }),
      j.findMany({
        where: { tenantId, status: 'FAILED' },
        orderBy: [{ finishedAt: 'desc' }],
        take: 10,
        select: { id: true, documentId: true, kind: true, attempts: true, lastError: true, finishedAt: true },
      }),
      j.count({ where: { tenantId, status: 'PENDING', kind: 'CLASSIFY_GUCLU' } })
    ]);
    return {
      pending: { CLASSIFY: pCls, AI_READ: pRead, CLASSIFY_GUCLU: pGuclu },
      running,
      done24h,
      failed24h,
      sonHata: (sonHata || []).map((h: any) => ({ id: h.id, documentId: h.documentId, kind: h.kind, attempts: h.attempts, hata: h.lastError || '', zaman: h.finishedAt })),
      instance: this.instanceId,
      aktifOkuma: this.aktifOkuma,
      aktifParti: this.aktifParti,
      ayar: kuyrukAyarlari(),
    };
  }

  /** FAILED → PENDING (attempts sıfırlanır). ids verilirse yalnız onlar; hepsi:true ise tenant'ın tüm FAILED işleri. */
  async tekrarDene(tenantId: string, opts: { ids?: string[]; hepsi?: boolean }) {
    const ids = Array.isArray(opts?.ids) ? opts.ids.map((s) => String(s || '').trim()).filter(Boolean) : [];
    if (!ids.length && opts?.hepsi !== true) return { ok: false, tekrarDenenen: 0, neden: 'ids ya da hepsi:true gerekli' };
    const r = await this.db.invoiceProcessingJob.updateMany({
      where: { tenantId, status: 'FAILED', ...(ids.length ? { id: { in: ids } } : {}) },
      data: { status: 'PENDING', attempts: 0, lastError: null, lockedBy: null, lockedAt: null, startedAt: null, finishedAt: null },
    });
    this.logger.log(`[KUYRUK] tekrar-dene: ${r?.count || 0} FAILED iş PENDING'e alındı (tenant=${tenantId})`);
    return { ok: true, tekrarDenenen: r?.count || 0 };
  }

  /** Sabah özeti satırı için: son 24 saatte kuyruktan geçen işler (ekip dosyalarına dokunulmaz; yalnız metot sunulur). */
  async geceKuyrukOzeti(tenantId: string) {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const j = this.db.invoiceProcessingJob;
    const say = (kind: KuyrukTuru, status: KuyrukDurumu) => j.count({ where: { tenantId, kind, status, finishedAt: { gte: since } } }).catch(() => 0);
    const [oD, oF, sD, sF, bekleyen] = await Promise.all([
      say('AI_READ', 'DONE'), say('AI_READ', 'FAILED'), say('CLASSIFY', 'DONE'), say('CLASSIFY', 'FAILED'),
      j.count({ where: { tenantId, status: 'PENDING' } }).catch(() => 0),
    ]);
    const metin = (oD + oF + sD + sF) === 0
      ? 'Belge kuyruğu: son 24 saatte iş geçmedi'
      : `Belge kuyruğu: ${oD} belge okundu (${oF} hata), ${sD} belge sınıflandı (${sF} hata)${bekleyen ? `, ${bekleyen} bekliyor` : ''}`;
    return { okuma: { done: oD, failed: oF }, sinif: { done: sD, failed: sF }, bekleyen, metin };
  }

  // ── İŞÇİ ────────────────────────────────────────────────────────────────────────────────────────

  /** Bekçi duraklatma logu en çok 5 dk'da bir. */
  private bekciSonLog = 0;

  @Interval(ISCI_TIK_MS)
  async isciTik() {
    if (!this.isciAcik) return;
    await this.tik();
  }

  /** Bir işçi tiki (testten doğrudan çağrılır). */
  async tik(): Promise<{ baslatilanOkuma: number; baslatilanParti: number; kurtarilan: number }> {
    if (this.tikCalisiyor) return { baslatilanOkuma: 0, baslatilanParti: 0, kurtarilan: 0 };
    this.tikCalisiyor = true;
    try {
      const kurtarilan = await this.bayatKilitleriKurtar().catch((e: any) => { this.logger.warn(`[KUYRUK] bayat kilit kurtarma hatası: ${e?.message || e}`); return 0; });
      // BİRİM MALİYET BEKÇİSİ (2026-09-15): anormal harcama tespit edildiyse yeni iş ALINMAZ — belgeler PENDING kalır
      //   (FAILED/72 saat kilidine düşmez), süre dolunca ya da sahip "devam" deyince kaldığı yerden sürer.
      const bekci = fmAiBekciDurumu();
      if (bekci.durduruldu) {
        if (Date.now() - this.bekciSonLog > 300000) { this.bekciSonLog = Date.now(); this.logger.warn(`[KUYRUK] AI bekçisi duraklattı — iş alınmıyor (${bekci.neden}; bitiş ${bekci.bitis ? new Date(bekci.bitis).toISOString() : '-'})`); }
        return { baslatilanOkuma: 0, baslatilanParti: 0, kurtarilan };
      }
      const ayar = kuyrukAyarlari();
      let baslatilanOkuma = 0; let baslatilanParti = 0;
      while (this.aktifOkuma < ayar.okumaEszamanli) {
        const is = await this.okumaIsiSec();
        if (!is) break;
        baslatilanOkuma++;
        this.aktifOkuma++;
        void this.isle('AI_READ', is.tenantId, is.taxpayerId, [is]).finally(() => { this.aktifOkuma = Math.max(0, this.aktifOkuma - 1); });
      }
      while (this.aktifParti < ayar.sinifPartiEszamanli) {
        const parti = await this.sinifPartisiSec(ayar.partiBoyu);
        if (!parti.length) break;
        baslatilanParti++;
        this.aktifParti++;
        void this.isle(parti[0].kind as KuyrukTuru, parti[0].tenantId, parti[0].taxpayerId, parti).finally(() => { this.aktifParti = Math.max(0, this.aktifParti - 1); });
      }
      return { baslatilanOkuma, baslatilanParti, kurtarilan };
    } finally {
      this.tikCalisiyor = false;
    }
  }

  /** (a) Bayat RUNNING kilitleri: lockedAt < şimdi-15 dk → PENDING attempts+1; attempts+1 ≥ 3 → FAILED. */
  async bayatKilitleriKurtar(now: Date = new Date()): Promise<number> {
    const esik = new Date(now.getTime() - BAYAT_KILIT_MS);
    const bayat: Is[] = await this.db.invoiceProcessingJob.findMany({
      where: { status: 'RUNNING', lockedAt: { lt: esik } },
      select: { id: true, attempts: true, kind: true, documentId: true },
      take: 500,
    });
    let n = 0;
    for (const b of bayat) {
      const deneme = Number(b.attempts || 0) + 1;
      const tukendi = deneme >= MAX_DENEME;
      await this.db.invoiceProcessingJob.updateMany({
        where: { id: b.id, status: 'RUNNING' },
        data: tukendi
          ? { status: 'FAILED', attempts: deneme, lastError: `bayat kilit: ${MAX_DENEME} denemede bitmedi (deploy/çökme)`, lockedBy: null, lockedAt: null, finishedAt: now }
          : { status: 'PENDING', attempts: deneme, lastError: 'bayat kilit (15 dk) — yeniden kuyruğa alındı', lockedBy: null, lockedAt: null },
      });
      n++;
    }
    if (n) this.logger.warn(`[KUYRUK] ${n} bayat RUNNING iş kurtarıldı (15 dk kilit; ≥${MAX_DENEME} deneme → FAILED)`);
    return n;
  }

  /** (c) AI_READ: en yüksek öncelik, en eski; tek tek. Claim: PENDING → RUNNING (yalnız kazanan). */
  private async okumaIsiSec(): Promise<Is | null> {
    for (let deneme = 0; deneme < 3; deneme++) {
      const aday: Is | null = await this.db.invoiceProcessingJob.findFirst({
        where: { status: 'PENDING', kind: 'AI_READ' },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      });
      if (!aday) return null;
      const alinan = await this.claim([aday.id]);
      if (alinan.length) return alinan[0];
    }
    return null;
  }

  /** (c) CLASSIFY: en yüksek öncelikli en eski işin mükellefinden en çok partiBoyu belge → tek parti. */
  private async sinifPartisiSec(partiBoyu: number): Promise<Is[]> {
    for (let deneme = 0; deneme < 3; deneme++) {
      const bas: Is | null = await this.db.invoiceProcessingJob.findFirst({
        where: { status: 'PENDING', kind: { in: ['CLASSIFY', 'CLASSIFY_GUCLU'] } },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      });
      if (!bas) return [];
      // Parti tek türden: baş işin türü (CLASSIFY_GUCLU öncelik 1 → normal sınıflandırmalar bitmeden sıra gelmez).
      const ayni: Is[] = await this.db.invoiceProcessingJob.findMany({
        where: { status: 'PENDING', kind: bas.kind, tenantId: bas.tenantId, taxpayerId: bas.taxpayerId ?? null },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        take: partiBoyu,
      });
      const ids = [...new Set([bas.id, ...ayni.map((a) => a.id)])].slice(0, partiBoyu);
      const alinan = await this.claim(ids);
      if (alinan.length) return alinan;
    }
    return [];
  }

  /** PENDING → RUNNING (lockedBy=instanceId). Yalnız bu instance'ın kazandığı satırlar döner. */
  private async claim(ids: string[]): Promise<Is[]> {
    if (!ids.length) return [];
    const now = new Date();
    const r = await this.db.invoiceProcessingJob.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'RUNNING', lockedBy: this.instanceId, lockedAt: now, startedAt: now },
    });
    if (!r?.count) return [];
    return this.db.invoiceProcessingJob.findMany({
      where: { id: { in: ids }, status: 'RUNNING', lockedBy: this.instanceId },
      select: { id: true, tenantId: true, taxpayerId: true, documentId: true, kind: true, priority: true, status: true, attempts: true },
    });
  }

  /** (d)+(e) Partiyi işle, her işi DONE/FAILED yaz. */
  private async isle(kind: KuyrukTuru, tenantId: string, taxpayerId: string | null, isler: Is[]) {
    return fmAiBaglamIle({ tenantId, taxpayerId: taxpayerId || undefined, kaynak: `kuyruk:${kind}` }, () => this.isleGovde(kind, tenantId, taxpayerId, isler));
  }

  private async isleGovde(kind: KuyrukTuru, tenantId: string, taxpayerId: string | null, isler: Is[]) {
    const t0 = Date.now();
    const byDoc = new Map<string, Is>();
    for (const i of isler) byDoc.set(i.documentId, i);
    let sonuc: Array<{ documentId: string; ok: boolean; hata?: string }> = [];
    try {
      let hedef = isler;
      if (kind === 'AI_READ') {
        // ai-read-cancel ile CANCELLED yapılmış belge okunmaz → iş DONE (not: iptal). APPROVED belgeye dokunulmaz.
        const iptal = await this.iptalEdilenler(tenantId, isler.map((i) => i.documentId));
        for (const docId of iptal) {
          const i = byDoc.get(docId);
          if (i) await this.bitir(i.id, true, 'iptal edildi (ai-read-cancel) — okunmadı', t0);
        }
        hedef = isler.filter((i) => !iptal.has(i.documentId));
      }
      if (hedef.length) sonuc = await this.fm.kuyrukIsle(kind, tenantId, hedef.map((i) => i.documentId));
      const map = new Map(sonuc.map((s) => [s.documentId, s]));
      for (const i of hedef) {
        const s = map.get(i.documentId);
        await this.bitir(i.id, !!s?.ok, s?.ok ? null : (s?.hata || 'sonuç dönmedi'), t0);
      }
      if (kind === 'AI_READ') await this.okumaSonrasiSinif(tenantId, taxpayerId, hedef.filter((i) => map.get(i.documentId)?.ok).map((i) => i.documentId));
      const ok = sonuc.filter((s) => s.ok).length;
      this.logger.log(`[KUYRUK] parti=${isler.length} tp=${taxpayerId || '-'} kind=${kind} ok=${ok} hata=${hedef.length - ok} sure=${Date.now() - t0}ms`);
    } catch (e: any) {
      const msg = String(e?.message || e || 'hata').slice(0, 300);
      this.logger.error(`[KUYRUK] parti hata kind=${kind} tp=${taxpayerId || '-'}: ${msg}`);
      for (const i of isler) await this.bitir(i.id, false, msg, t0).catch(() => {});
    }
  }

  private async iptalEdilenler(tenantId: string, docIds: string[]): Promise<Set<string>> {
    const rows: any[] = await this.db.invoiceAccountingDocument.findMany({
      where: { tenantId, id: { in: docIds }, OR: [{ ocrStatus: 'CANCELLED' }, { status: 'APPROVED' }] },
      select: { id: true },
    }).catch(() => []);
    return new Set(rows.map((r) => String(r.id)));
  }

  private async bitir(id: string, ok: boolean, hata: string | null, t0: number) {
    await this.db.invoiceProcessingJob.updateMany({
      where: { id, status: 'RUNNING' },
      data: {
        status: ok ? 'DONE' : 'FAILED',
        lastError: hata ? String(hata).slice(0, 300) : null, // DONE'da da not olabilir (ör. iptal edildi)
        lockedBy: null,
        lockedAt: null,
        finishedAt: new Date(),
        attempts: { increment: 1 },
      },
    }).catch((e: any) => this.logger.warn(`[KUYRUK] iş ${id} kapanamadı (${Date.now() - t0}ms): ${e?.message || e}`));
  }

  /** AI_READ sonrası: UBL/XML yolu Max'i atlar → kategori/giderTuru boş kalır; sınıflanacak içerik varsa CLASSIFY (priority 3). */
  private async okumaSonrasiSinif(tenantId: string, taxpayerId: string | null, docIds: string[]) {
    if (!docIds.length) return;
    const docs: any[] = await this.db.invoiceAccountingDocument.findMany({
      where: { tenantId, id: { in: docIds }, invoiceKind: 'ALIS', status: { in: ['READY', 'NEEDS_REVIEW', 'DRAFT'] } },
      select: { id: true, taxpayerId: true, ocrData: true, vendorName: true },
    }).catch(() => []);
    const girdiler: BelgeKuyrukGirdisi[] = docs
      .filter((d) => belgeIcerikVarMi(d.ocrData, d.vendorName) && !belgeSinifliMi(d.ocrData))
      .map((d) => ({ tenantId, taxpayerId: d.taxpayerId ?? taxpayerId, documentId: d.id, kind: 'CLASSIFY' as const, priority: KUYRUK_ONCELIK.ITHAL }));
    if (!girdiler.length) return;
    const r = await this.topluKuyrugaAl(girdiler).catch(() => null);
    if (r?.eklenen) this.logger.log(`[KUYRUK] okuma sonrası ${r.eklenen} belge sınıflandırmaya alındı (priority ${KUYRUK_ONCELIK.ITHAL})`);
  }

  // ── GECE ────────────────────────────────────────────────────────────────────────────────────────

  @Cron(GECE_KUYRUK_CRON, { timeZone: 'Europe/Istanbul' })
  async geceTik() {
    if (geceKuyrukEnvKapaliMi()) { this.logger.log('[KUYRUK] gece kuyruklama env ile KAPALI (FM_GECE_KUYRUK=off)'); return; }
    if (this.geceCalisiyor) return;
    this.geceCalisiyor = true;
    try {
      await this.geceKuyrukla();
    } catch (e: any) {
      this.logger.error(`[KUYRUK] gece kuyruklama hatası: ${e?.message || e}`);
    } finally {
      this.geceCalisiyor = false;
    }
  }

  /** Tüm tenant'lar için gece seçimi (testten doğrudan çağrılır). Tavan 400/gece/tenant. */
  async geceKuyrukla(now: Date = new Date()): Promise<Array<{ tenantId: string; okuma: number; sinif: number }>> {
    const grup: any[] = await this.db.invoiceAccountingDocument.groupBy({
      by: ['tenantId'],
      where: { status: { in: ['READY', 'NEEDS_REVIEW', 'DRAFT'] } },
    }).catch(() => []);
    const out: Array<{ tenantId: string; okuma: number; sinif: number }> = [];
    for (const g of grup) {
      const tenantId = String(g.tenantId);
      const r = await this.geceKuyruklaTenant(tenantId, now).catch((e: any) => { this.logger.warn(`[KUYRUK] gece tenant=${tenantId} hata: ${e?.message || e}`); return null; });
      if (r) out.push({ tenantId, ...r });
    }
    return out;
  }

  async geceKuyruklaTenant(tenantId: string, now: Date = new Date()): Promise<{ okuma: number; sinif: number; atlanan: number }> {
    // Planı READY olan mükellefler (okunmamış belge yalnız planlı mükellefte okunur — kod üretmek için plan şart).
    const planlar: any[] = await this.db.lucaAccountPlanSnapshot.findMany({
      where: { tenantId, status: 'READY' }, select: { taxpayerId: true }, distinct: ['taxpayerId'],
    }).catch(() => []);
    const planli = new Set(planlar.map((p) => String(p.taxpayerId)));
    // Son 72 saatte FAILED olan belge+kind çiftleri gece tekrar alınmaz (her gece aynı hatayı yeniden denemesin).
    const sonFailed: any[] = await this.db.invoiceProcessingJob.findMany({
      where: { tenantId, status: 'FAILED', finishedAt: { gte: new Date(now.getTime() - 72 * 3600 * 1000) } },
      select: { documentId: true, kind: true },
    }).catch(() => []);
    const failedSet = new Set(sonFailed.map((f) => `${f.documentId}|${f.kind}`));
    const docs: any[] = await this.db.invoiceAccountingDocument.findMany({
      where: {
        tenantId,
        status: { in: ['READY', 'NEEDS_REVIEW', 'DRAFT'] },
        lucaStatus: { in: ['NOT_STARTED', 'FAILED'] }, // Luca'ya gitmemiş
        ocrStatus: { notIn: ['PENDING', 'IN_PROGRESS', 'FAILED', 'CANCELLED'] },
      },
      select: { id: true, taxpayerId: true, invoiceKind: true, ocrData: true, vendorName: true },
      orderBy: [{ taxpayerId: 'asc' }, { createdAt: 'desc' }],
      take: 4000,
    }).catch(() => []);
    const girdiler: BelgeKuyrukGirdisi[] = [];
    let okuma = 0; let sinif = 0; let atlanan = 0;
    for (const d of docs) {
      if (girdiler.length >= GECE_TAVAN) { atlanan++; continue; }
      const o: any = d.ocrData || {};
      const okunmus = !!String(o.readMode || '').trim();
      const icerik = belgeIcerikVarMi(o); // gerçek içerik (metin/kalem)
      const icerikVeyaSatici = belgeIcerikVarMi(o, d.vendorName); // satıcı adından tahmin de sayılır (2026-09-13)
      if (!okunmus && !icerik) {
        if (!d.taxpayerId || !planli.has(String(d.taxpayerId))) { atlanan++; continue; }
        if (!failedSet.has(`${d.id}|AI_READ`)) {
          girdiler.push({ tenantId, taxpayerId: d.taxpayerId, documentId: d.id, kind: 'AI_READ', priority: KUYRUK_ONCELIK.GECE });
          okuma++;
          continue;
        }
        // Okuma son 72 saatte başarısız (içerik yok) → satıcı adından düşük güvenli sınıflandırma (yalnız alış, satıcı adı ≥6 kr).
        if (icerikVeyaSatici && !belgeSinifliMi(o) && d.invoiceKind === 'ALIS' && !failedSet.has(`${d.id}|CLASSIFY`)) {
          girdiler.push({ tenantId, taxpayerId: d.taxpayerId, documentId: d.id, kind: 'CLASSIFY', priority: KUYRUK_ONCELIK.GECE });
          sinif++;
        } else atlanan++;
        continue;
      }
      if (icerikVeyaSatici && !belgeSinifliMi(o) && d.invoiceKind === 'ALIS') {
        if (failedSet.has(`${d.id}|CLASSIFY`)) { atlanan++; continue; }
        girdiler.push({ tenantId, taxpayerId: d.taxpayerId, documentId: d.id, kind: 'CLASSIFY', priority: KUYRUK_ONCELIK.GECE });
        sinif++;
      }
    }
    let r = { eklenen: 0, yukseltilen: 0, zatenKuyrukta: 0, bekleyen: 0 };
    if (girdiler.length) r = await this.topluKuyrugaAl(girdiler);
    const ozet = { tarih: now.toISOString(), okuma, sinif, atlanan, eklenen: r.eklenen, yukseltilen: r.yukseltilen, zatenKuyrukta: r.zatenKuyrukta };
    try {
      await this.db.auditLog.create({ data: { tenantId, userId: null, action: 'GECE_KUYRUK', resource: 'belge-kuyruk', resourceId: tenantId, newData: ozet } });
    } catch (e: any) {
      this.logger.warn(`[KUYRUK] GECE_KUYRUK kaydı yazılamadı (tenant=${tenantId}): ${e?.message || e}`);
    }
    this.logger.log(`[KUYRUK] gece tenant=${tenantId} okuma=${okuma} sinif=${sinif} eklenen=${r.eklenen} zatenKuyrukta=${r.zatenKuyrukta} atlanan=${atlanan}`);
    return { okuma, sinif, atlanan };
  }
}
