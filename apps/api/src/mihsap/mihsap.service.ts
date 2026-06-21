import { Injectable, Logger, BadRequestException, UnauthorizedException, Optional, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';
import { AutomationEventBus } from '../automations/automation-event-bus.service';

const MIHSAP_BASE = 'https://app.mihsap.com';
// MIHSAP all-faturas body'sinde kullanılan alan id'leri (keşif yoluyla bulundu)
const FIELD = {
  FATURA_TURU: 8,    // "ALIS" | "SATIS"
  MUKELLEF_ID: 9,    // userFirmaBilgisiId
  FATURA_TARIHI: 37, // Between [YYYY-MM-DD, YYYY-MM-DD]
  ONAY_DURUMU: 44,   // 1 = ONAYLANMIS (sanırız)
};

export interface MihsapInvoiceSummary {
  id: number;
  fileId?: number;
  faturaId?: number;
  userFirmaBilgisiId: number;
  belgeTuru: string;
  faturaNo: string;
  firmaKimlikNo?: string;
  firmaUnvan?: string;
  faturaTuru: string;
  onayDurumu?: string;
  faturaTarihi?: string;
  faturaTarihiStr?: string;
  faturaFirmaAdi?: string;
  faturaFirmaKimlikNo?: string;
  toplamTutar?: number;
  fileLink?: string;
  fileDownloadLink?: string;
  orjDosyaTuru?: string;
}

/** Takılı 'running' job'lar bu süreden (ms) eski ise başarısız sayılır. */
const STALE_JOB_MS = 3 * 60 * 1000; // 3 dakika

@Injectable()
export class MihsapService implements OnModuleInit {
  private readonly logger = new Logger(MihsapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly eventBus?: AutomationEventBus,
  ) {}

  /** Sunucu başlarken takılı kalmış 'running' job'ları temizle. */
  async onModuleInit() {
    await this.closeStaleRunningJobs();
  }

  /**
   * Takılı 'running' MihsapFetchJob'ları kapatır.
   * Sunucu restart/crash sonrası DB'de 'running' kalan job'lar
   * portal UI'ında sonsuza dek "çekiliyor" gösterir — bu, temizler.
   */
  private async closeStaleRunningJobs(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - STALE_JOB_MS);
      const result = await (this.prisma as any).mihsapFetchJob.updateMany({
        where: { status: 'running', startedAt: { lt: cutoff } },
        data: {
          status: 'failed',
          errorMsg: 'Zaman aşımı — sunucu yeniden başlatıldı veya işlem takıldı.',
          finishedAt: new Date(),
        },
      });
      if (result.count > 0) {
        this.logger.warn(`Boot temizliği: ${result.count} takılı Mihsap fetch job kapatıldı.`);
      }
    } catch (err: any) {
      this.logger.error(`Stale job temizliği hatası: ${err?.message}`);
    }
  }

  /** Her 2 dakikada bir takılı job'ları temizle (frontend polling'e bağımlılığı ortadan kaldırır). */
  @Cron('0 */2 * * * *')
  async periodicStaleJobCleanup(): Promise<void> {
    await this.closeStaleRunningJobs();
  }

  // ==================== TOKEN YÖNETİMİ ====================

  /** Eklenti veya kullanıcı MIHSAP JWT'sini gönderir. Şifresiz saklar (MVP). */
  async saveToken(tenantId: string, token: string, email?: string, updatedBy?: string) {
    if (!token || token.length < 20) {
      throw new BadRequestException('Geçersiz token');
    }
    const existing = await (this.prisma as any).mihsapSession.findUnique({
      where: { tenantId },
      select: { token: true },
    });
    // ÇÖP-TOKEN KORUMASI (kök neden): Eklenti bazen Mihsap JWT'si yerine BAŞKA bir
    // site/portal token'ını (kısa, JWT OLMAYAN) okuyup gönderiyordu. Backend bunu
    // Mihsap'a yollayınca Mihsap 200 + BOŞ gövde dönüyor → "MIHSAP bos cevap" hatası,
    // ve getSession süreyi okuyamadığı için "bağlı/yeşil" görünüyordu (sessiz bozulma).
    // Gerçek Mihsap token'ı JWT'dir (exp ayrıştırılabilir). JWT OLMAYAN bir token
    // MEVCUT geçerli JWT'yi ASLA ezmesin; geçerli JWT yoksa da çöpü saklama.
    const incomingExp = this.getJwtExpiresAt(token);
    if (!incomingExp) {
      this.logger.warn(
        `Mihsap saveToken: JWT olmayan token reddedildi (len=${token.length}, tenant=${tenantId}). ` +
          `${existing ? 'Mevcut token korunuyor.' : 'Geçerli JWT bekleniyor.'}`,
      );
      return existing || null;
    }
    // Token gerçekten değişti mi? Eklenti aynı token'ı periyodik (60 sn) gönderebilir;
    // sadece yeni/yenilenmiş token'da aşağıdaki retry tetiklensin (gereksiz tarama olmasın).
    const tokenChanged = !existing || existing.token !== token;

    const result = await (this.prisma as any).mihsapSession.upsert({
      where: { tenantId },
      update: { token, email: email || null, updatedBy: updatedBy || null },
      create: { tenantId, token, email: email || null, updatedBy: updatedBy || null },
    });

    // Faz 2: Token tazelendiyse, token/oturum hatasıyla bekleyen Mihsap fatura-çekme
    // otomasyonlarını otomatik yeniden denemeyi tetikle (AutomationRunner dinler).
    // Kullanıcı Mihsap sayfasını açınca eklenti taze token gönderir → bu noktaya gelinir.
    if (tokenChanged && this.eventBus) {
      try {
        this.eventBus.emit('Mihsap.TokenYenilendi', { tenantId });
      } catch (err: any) {
        this.logger.warn(`Mihsap.TokenYenilendi yayını başarısız: ${err?.message ?? err}`);
      }
      // Faz 2+: otomasyon retry (AutomationRunner) + manuel fatura-çekme retry
      this.retryFailedFetchJobs(tenantId).catch((err: any) =>
        this.logger.warn(`Mihsap job retry taraması başarısız: ${err?.message ?? err}`),
      );
    }

    return result;
  }

  async getSession(tenantId: string) {
    const s = await (this.prisma as any).mihsapSession.findUnique({ where: { tenantId } });
    if (!s) return null;
    const expiresAt = this.getJwtExpiresAt(s.token);
    // JWT ayrıştırılamıyorsa (çöp token) BAĞLI DEĞİL say — eskiden "bağlı/yeşil" görünüp
    // çekme sessizce patlıyordu. Artık dürüst: token JWT değilse oturum geçersizdir.
    const expired = !expiresAt || expiresAt.getTime() <= Date.now() + 30_000;
    return {
      connected: !expired,
      email: s.email,
      updatedAt: s.updatedAt,
      tokenLength: s.token?.length || 0,
      expiresAt,
      expired,
    };
  }

  private getJwtExpiresAt(token?: string | null): Date | null {
    try {
      const part = String(token || '').split('.')[1];
      if (!part) return null;
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
      const exp = Number(payload?.exp);
      return Number.isFinite(exp) ? new Date(exp * 1000) : null;
    } catch {
      return null;
    }
  }

  private async getToken(tenantId: string): Promise<string> {
    const s = await (this.prisma as any).mihsapSession.findUnique({ where: { tenantId } });
    if (!s?.token) {
      throw new UnauthorizedException(
        'MIHSAP token yok. Lütfen MIHSAP sayfasını açın; eklenti tokenı otomatik senkronize edecek.',
      );
    }
    // JWT süresi dolmuşsa/JWT değilse net hata fırlat — Mihsap 200 + boş body dönerek gizliyor.
    const expiresAt = this.getJwtExpiresAt(s.token);
    // JWT olarak ayrıştırılamayan token (çöp) Mihsap'a YOLLANMASIN — "bos cevap" üretiyordu.
    if (!expiresAt) {
      throw new UnauthorizedException(
        'MIHSAP token geçerli görünmüyor (JWT değil). Mihsap sekmesini açın — eklenti doğru tokenı otomatik gönderecek.',
      );
    }
    if (expiresAt.getTime() < Date.now() - 30_000) {
      const minsAgo = Math.round((Date.now() - expiresAt.getTime()) / 60_000);
      throw new UnauthorizedException(
        `MIHSAP token süresi ${minsAgo} dakika önce doldu. Mihsap sekmesini açın — eklenti otomatik yenileyecek.`,
      );
    }
    return s.token;
  }

  /** 12 ay öncesini YYYY-MM formatında döndürür — eski dönem filtresi için. */
  private donemCutoff(): string {
    const d = new Date();
    d.setMonth(d.getMonth() - 11);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Token yenilenince (veya proaktif cron tetiklenince) son 24 saatte token
   * hatasıyla başarısız olmuş manuel MihsapFetchJob'ları otomatik yeniden dener.
   *
   * Sonsuz döngü koruması:
   *  - createdBy='token-retry' olanlar atlanır (kendi açtığı retry job'ını tekrar deneme)
   *  - 12 aydan eski dönemler atlanır (geçmiş yıl faturası sonsuz döngüsünü önler)
   */
  private async retryFailedFetchJobs(tenantId: string): Promise<void> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const cutoff = this.donemCutoff();
    const failedJobs = await (this.prisma as any).mihsapFetchJob.findMany({
      where: {
        tenantId,
        status: 'failed',
        createdAt: { gte: since },
        NOT: { createdBy: 'token-retry' }, // kendi açtığı retry job'larını tekrar deneme
        OR: [
          { errorMsg: { contains: 'MIHSAP' } },
          { errorMsg: { contains: 'token' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    if (failedJobs.length === 0) return;

    const seen = new Set<string>();
    for (const job of failedJobs) {
      // 12 aydan eski dönemler denenmez (string karşılaştırması: "2024-03" < "2025-07")
      if (job.donem && job.donem < cutoff) {
        this.logger.log(`Mihsap retry atlandı (eski dönem ${job.donem} < ${cutoff}): mukellef=${job.mukellefId}`);
        continue;
      }

      const key = `${job.mukellefId}|${job.donem}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Son 2 saatte bu (mukellef, dönem) için zaten token-retry yapıldıysa tekrar deneme.
      // Sabri Yaş gibi Mihsap'ta faturası olmayanlar sonsuz döngüye girmesin.
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const recentRetry = await (this.prisma as any).mihsapFetchJob.findFirst({
        where: {
          tenantId,
          mukellefId: job.mukellefId,
          donem: job.donem,
          createdBy: 'token-retry',
          createdAt: { gte: twoHoursAgo },
        },
        select: { id: true },
      });
      if (recentRetry) {
        this.logger.log(`Mihsap retry atlandı (son 2 saatte zaten denendi): mukellef=${job.mukellefId} donem=${job.donem}`);
        continue;
      }

      const alreadyFetched = await (this.prisma as any).mihsapInvoice.count({
        where: { tenantId, mukellefId: job.mukellefId, donem: job.donem },
      });
      if (alreadyFetched > 0) continue;

      const taxpayer = await (this.prisma as any).taxpayer.findUnique({
        where: { id: job.mukellefId },
        select: { mihsapId: true },
      });
      if (!taxpayer?.mihsapId) continue;

      this.logger.log(
        `Mihsap token yenilendi → manuel iş yeniden deneniyor: mukellef=${job.mukellefId} donem=${job.donem}`,
      );
      this.fetchAndStoreInvoices({
        tenantId,
        mukellefId: job.mukellefId,
        mukellefMihsapId: String(taxpayer.mihsapId),
        donem: job.donem,
        faturaTuru: job.faturaTuru as 'ALIS' | 'SATIS' | undefined,
        createdBy: 'token-retry',
      }).catch((err: any) =>
        this.logger.error(`Mihsap job retry hatası (mukellef=${job.mukellefId} donem=${job.donem}): ${err?.message ?? err}`),
      );
    }
  }

  /**
   * Proaktif retry cron — 15 dakikada bir çalışır.
   * Geçerli Mihsap token'ı olan tüm tenant'lar için bekleyen/başarısız
   * fatura çekme işlerini otomatik yeniden dener.
   * Kullanıcı elle müdahale etmek zorunda kalmaz.
   */
  @Cron('0 */15 * * * *')
  async proactiveRetryPendingFetches(): Promise<void> {
    try {
      const sessions = await (this.prisma as any).mihsapSession.findMany({
        select: { tenantId: true, token: true },
      });
      for (const session of sessions) {
        const expiresAt = this.getJwtExpiresAt(session.token);
        // Token süresi dolmuşsa veya 30 sn'den az kalmışsa bu tenant'ı atla
        if (!expiresAt || expiresAt.getTime() < Date.now() + 30_000) continue;
        await this.retryFailedFetchJobs(session.tenantId).catch((err: any) =>
          this.logger.warn(`Proaktif retry hatası tenant=${session.tenantId}: ${err?.message}`),
        );
      }
    } catch (err: any) {
      this.logger.error(`Proaktif Mihsap retry cron hatası: ${err?.message}`);
    }
  }

  /**
   * Gider faturası (gelen e-arşiv) PDF dosyasını Mihsap'a yükler.
   * Endpoint: POST /api/fileUploadFromMusavir/{mihsapId}/ALIS
   * @param tenantId Bizim tenant
   * @param mihsapId Mukellefin Mihsap'taki internal ID (taxpayer.mihsapId)
   * @param pdfBuffer PDF içeriği
   * @param fileName Dosya adı (örn "fatura-no.pdf")
   * @returns Mihsap response detayı
   */
  async uploadGiderFatura(
    tenantId: string,
    mihsapId: string | number,
    pdfBuffer: Buffer,
    fileName: string,
  ): Promise<{ ok: boolean; status: number; body?: any; error?: string }> {
    if (!mihsapId) return { ok: false, status: 0, error: 'mihsapId yok (mukellefte tanımlı değil)' };
    if (!pdfBuffer || pdfBuffer.length < 5 * 1024) {
      return { ok: false, status: 0, error: `PDF çok küçük (${pdfBuffer?.length || 0} byte) — Mihsap min 5KB istiyor` };
    }
    const token = await this.getToken(tenantId);
    const url = `${MIHSAP_BASE}/api/fileUploadFromMusavir/${mihsapId}/ALIS`;
    // FormData inşa et
    const fd = new FormData();
    const blob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' });
    fd.append('file', blob, fileName || 'fatura.pdf');
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json, text/plain, */*',
          Origin: MIHSAP_BASE,
          Referer: `${MIHSAP_BASE}/`,
        },
        body: fd as any,
      });
    } catch (e: any) {
      return { ok: false, status: 0, error: `network: ${e?.message || e}` };
    }
    let body: any = null;
    try {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json')) body = await res.json();
      else body = await res.text();
    } catch {}
    if (!res.ok) {
      const errMsg = typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body || {}).slice(0, 200);
      return { ok: false, status: res.status, error: errMsg, body };
    }
    return { ok: true, status: res.status, body };
  }

  // ==================== MIHSAP API PROXY ====================

  /** Belirli mükellef + ay için fatura listesini MIHSAP'tan çeker.
   *  kaynak: 'arsiv' (varsayilan, ONAYLANMIS) | 'bekleyen' (Gelen Belgeler) */
  async listInvoices(params: {
    tenantId: string;
    mukellefMihsapId: string | number;
    donem: string; // "2026-03"
    faturaTuru: 'ALIS' | 'SATIS';
    pageSize?: number;
    pageIndex?: number;
    kaynak?: 'arsiv' | 'bekleyen';
  }): Promise<{ total: number; items: MihsapInvoiceSummary[] }> {
    const token = await this.getToken(params.tenantId);
    const [year, month] = params.donem.split('-');
    const startDate = `${year}-${month}-01`;
    // Ayın son günü
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    return this.listInvoicesRobust(params, token, startDate, endDate);

    const body = {
      sortAlanlari: [
        { siralamaYonu: 'ASCENDING', sortAlanId: 2 },
        { siralamaYonu: 'DESCENDING', sortAlanId: FIELD.FATURA_TARIHI },
      ],
      valueList: [
        { alanId: FIELD.FATURA_TURU, operator: 'Equals', values: [params.faturaTuru] },
        { alanId: FIELD.MUKELLEF_ID, operator: 'Equals', values: [String(params.mukellefMihsapId)] },
        { alanId: FIELD.FATURA_TARIHI, operator: 'Between', values: [startDate, endDate] },
        { alanId: FIELD.ONAY_DURUMU, operator: 'Equals', values: [1] },
      ],
      // MIHSAP pagination query string ile yapılıyor — ileride gerekirse eklenir
    };

    const qs = new URLSearchParams();
    // ÖNEMLI: MIHSAP Arşivim sayfası ?onayliMi=true gönderiyor (Network'ten teyit).
    // Bunsuz "Gelen Belgeler" (bekleyen) sonucu donuyor → bu kullanicinin
    // "Faturalar gelmiyor" sikayetinin sebebi.
    if ((params.kaynak || 'arsiv') === 'arsiv') qs.set('onayliMi', 'true');
    if (params.pageSize) qs.set('size', String(params.pageSize));
    if (params.pageIndex !== undefined) qs.set('page', String(params.pageIndex));

    const url = `${MIHSAP_BASE}/api/mali-musavir/all-faturas${qs.toString() ? '?' + qs.toString() : ''}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Authorization: `Bearer ${token}`,
        Origin: MIHSAP_BASE,
        Referer: `${MIHSAP_BASE}/`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      throw new UnauthorizedException(
        'MIHSAP token süresi dolmuş. MIHSAP sayfasını yenileyin; eklenti yeni token gönderecek.',
      );
    }
    // Cevap gövdesini önce text olarak al → bos/HTML cevap durumunda
    // anlamsiz 'Unexpected end of JSON input' yerine net hata mesaji ver.
    const ct = res.headers.get('content-type') || '';
    const rawText = await res.text();
    const preview = rawText.slice(0, 400);
    if (!res.ok) {
      this.logger.error(`MIHSAP all-faturas error ${res.status} (ct=${ct}, len=${rawText.length}): ${preview}`);
      throw new BadRequestException(`MIHSAP hata ${res.status}: ${preview.slice(0, 120)}`);
    }
    if (!rawText || rawText.length === 0) {
      this.logger.error(`MIHSAP bos govde (status=${res.status}, ct=${ct}, url=${url})`);
      throw new BadRequestException('MIHSAP bos cevap. Token süresi dolmus olabilir — MIHSAP sayfasini yenileyin.');
    }
    if (!ct.includes('json') && !rawText.trim().startsWith('{')) {
      this.logger.error(`MIHSAP non-JSON cevap (ct=${ct}): ${preview}`);
      throw new BadRequestException(`MIHSAP beklenmedik cevap: ${preview.slice(0, 120)}`);
    }
    let json: any;
    try { json = JSON.parse(rawText); } catch (e: any) {
      this.logger.error(`MIHSAP JSON parse hatasi: ${preview}`);
      throw new BadRequestException(`MIHSAP JSON parse hatasi: ${e?.message}. Preview: ${preview.slice(0, 120)}`);
    }
    const content = json?.sonucValue?.content || [];
    const total = json?.sonucValue?.totalElements ?? content.length;
    return { total, items: content };
  }

  /** Tüm sayfaları çek (pagination loop). Büyük mükellef dosyaları (1500+) için güvenli:
   *  100'lük sayfalarla ilerler, Mihsap'ın döndürdüğü 'total' değerine ulaşınca durur.
   *  Safety cap: 100 sayfa × 100 = 10,000 fatura üst sınırı. */
  private async listInvoicesRobust(
    params: {
      tenantId: string;
      mukellefMihsapId: string | number;
      donem: string;
      faturaTuru: 'ALIS' | 'SATIS';
      pageSize?: number;
      pageIndex?: number;
      kaynak?: 'arsiv' | 'bekleyen';
    },
    token: string,
    startDate: string,
    endDate: string,
  ): Promise<{ total: number; items: MihsapInvoiceSummary[] }> {
    const baseValueList = [
      { alanId: FIELD.FATURA_TURU, operator: 'Equals', values: [params.faturaTuru] },
      { alanId: FIELD.MUKELLEF_ID, operator: 'Equals', values: [String(params.mukellefMihsapId)] },
      { alanId: FIELD.FATURA_TARIHI, operator: 'Between', values: [startDate, endDate] },
    ];
    const buildBody = (includeOnayDurumu: boolean) => ({
      sortAlanlari: [
        { siralamaYonu: 'ASCENDING', sortAlanId: 2 },
        { siralamaYonu: 'DESCENDING', sortAlanId: FIELD.FATURA_TARIHI },
      ],
      valueList: includeOnayDurumu
        ? [...baseValueList, { alanId: FIELD.ONAY_DURUMU, operator: 'Equals', values: [1] }]
        : baseValueList,
    });
    const buildUrl = (onayliMi: boolean) => {
      const qs = new URLSearchParams();
      if (onayliMi) qs.set('onayliMi', 'true');
      if (params.pageSize) qs.set('size', String(params.pageSize));
      if (params.pageIndex !== undefined) qs.set('page', String(params.pageIndex));
      return `${MIHSAP_BASE}/api/mali-musavir/all-faturas${qs.toString() ? '?' + qs.toString() : ''}`;
    };
    const attempts = (params.kaynak || 'arsiv') === 'arsiv'
      ? [
          { name: 'arsiv-query', url: buildUrl(true), body: buildBody(false) },
          { name: 'arsiv-query-legacy-status', url: buildUrl(true), body: buildBody(true) },
          { name: 'legacy-status-no-query', url: buildUrl(false), body: buildBody(true) },
        ]
      : [
          { name: 'bekleyen', url: buildUrl(false), body: buildBody(false) },
        ];

    let lastError: Error | null = null;
    for (const attempt of attempts) {
      const res = await fetch(attempt.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
          Authorization: `Bearer ${token}`,
          Origin: MIHSAP_BASE,
          Referer: `${MIHSAP_BASE}/`,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(attempt.body),
      });

      if (res.status === 401 || res.status === 403) {
        throw new UnauthorizedException(
          'MIHSAP token süresi dolmuş. MIHSAP sayfasını yenileyin; eklenti yeni token gönderecek.',
        );
      }
      const ct = res.headers.get('content-type') || '';
      const rawText = await res.text();
      const preview = rawText.slice(0, 400);
      if (!res.ok) {
        this.logger.warn(`MIHSAP all-faturas ${attempt.name} error ${res.status} (ct=${ct}, len=${rawText.length}): ${preview}`);
        lastError = new BadRequestException(`MIHSAP hata ${res.status}: ${preview.slice(0, 120)}`);
        continue;
      }
      if (!rawText || rawText.trim().length === 0) {
        this.logger.warn(`MIHSAP all-faturas ${attempt.name} bos govde (status=${res.status}, ct=${ct}, url=${attempt.url})`);
        lastError = new BadRequestException('MIHSAP bos cevap. Token suresi dolmus olabilir veya MIHSAP liste filtresi degismis olabilir.');
        continue;
      }
      if (!ct.includes('json') && !rawText.trim().startsWith('{') && !rawText.trim().startsWith('[')) {
        this.logger.warn(`MIHSAP all-faturas ${attempt.name} non-JSON cevap (ct=${ct}): ${preview}`);
        lastError = new BadRequestException(`MIHSAP beklenmedik cevap: ${preview.slice(0, 120)}`);
        continue;
      }
      try {
        const json = JSON.parse(rawText);
        const normalized = this.normalizeAllFaturasResponse(json, {
          mukellefMihsapId: params.mukellefMihsapId,
          faturaTuru: params.faturaTuru,
        });
        this.logger.log(`MIHSAP all-faturas ${attempt.name}: total=${normalized.total}, items=${normalized.items.length}`);
        return normalized;
      } catch (e: any) {
        this.logger.warn(`MIHSAP all-faturas ${attempt.name} JSON parse/normalize hatasi: ${preview}`);
        lastError = new BadRequestException(`MIHSAP JSON parse hatasi: ${e?.message}. Preview: ${preview.slice(0, 120)}`);
      }
    }
    throw lastError || new BadRequestException('MIHSAP fatura listesi alinamadi');
  }

  private normalizeAllFaturasResponse(
    json: any,
    fallback: { mukellefMihsapId: string | number; faturaTuru: 'ALIS' | 'SATIS' },
  ): { total: number; items: MihsapInvoiceSummary[] } {
    const root = json?.sonucValue ?? json?.data ?? json?.result ?? json;
    const rawItems =
      (Array.isArray(root) && root) ||
      (Array.isArray(root?.content) && root.content) ||
      (Array.isArray(root?.items) && root.items) ||
      (Array.isArray(root?.list) && root.list) ||
      (Array.isArray(root?.rows) && root.rows) ||
      (Array.isArray(root?.records) && root.records) ||
      [];
    const totalRaw =
      root?.totalElements ??
      root?.totalCount ??
      root?.total ??
      root?.numberOfElements ??
      rawItems.length;
    const total = Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : rawItems.length;
    return {
      total,
      items: rawItems.map((item: any) => this.normalizeMihsapInvoiceItem(item, fallback)),
    };
  }

  private normalizeMihsapInvoiceItem(
    item: any,
    fallback: { mukellefMihsapId: string | number; faturaTuru: 'ALIS' | 'SATIS' },
  ): MihsapInvoiceSummary {
    return {
      ...item,
      id: item?.id ?? item?.faturaId ?? item?.fileId ?? item?.defterDataId,
      fileId: item?.fileId ?? item?.dosyaId ?? item?.file?.id,
      faturaId: item?.faturaId ?? item?.fatura?.id,
      userFirmaBilgisiId: item?.userFirmaBilgisiId ?? item?.mukellefMihsapId ?? item?.firmaId ?? Number(fallback.mukellefMihsapId),
      belgeTuru: item?.belgeTuru ?? item?.belgeTipi ?? item?.documentType ?? '',
      faturaNo: item?.faturaNo ?? item?.belgeNo ?? item?.fisNo ?? item?.invoiceNo ?? '',
      firmaKimlikNo: item?.firmaKimlikNo ?? item?.faturaFirmaKimlikNo ?? item?.vknTckn ?? item?.vergiKimlikNo,
      firmaUnvan: item?.firmaUnvan ?? item?.faturaFirmaAdi ?? item?.firmaAdi ?? item?.cariUnvan,
      faturaTuru: item?.faturaTuru ?? item?.alisSatisTuru ?? fallback.faturaTuru,
      faturaTarihi: item?.faturaTarihi ?? item?.tarih ?? item?.belgeTarihi,
      faturaTarihiStr: item?.faturaTarihiStr ?? item?.tarihStr ?? item?.belgeTarihiStr,
      toplamTutar: item?.toplamTutar ?? item?.tutar ?? item?.genelToplam ?? item?.odenecekTutar,
      fileLink: item?.fileLink ?? item?.fileDownloadLink ?? item?.dosyaLink ?? item?.gorselLink ?? item?.url,
      fileDownloadLink: item?.fileDownloadLink,
      orjDosyaTuru: item?.orjDosyaTuru ?? item?.dosyaTuru ?? item?.fileType,
    };
  }

  async listAllInvoices(params: {
    tenantId: string;
    mukellefMihsapId: string | number;
    donem: string;
    faturaTuru: 'ALIS' | 'SATIS';
    kaynak?: 'arsiv' | 'bekleyen';
  }): Promise<MihsapInvoiceSummary[]> {
    const PAGE_SIZE = 100;
    let pageIndex = 0;
    const all: MihsapInvoiceSummary[] = [];
    while (true) {
      const { items, total } = await this.listInvoices({
        ...params,
        pageSize: PAGE_SIZE,
        pageIndex,
      });
      all.push(...items);
      if (all.length >= total || items.length < PAGE_SIZE) break;
      pageIndex++;
      if (pageIndex > 100) break; // safety: en fazla 10,000 fatura
    }
    return all;
  }

  // ==================== STORAGE + DB ====================

  private buildStorageKey(
    tenantId: string,
    mukellefId: string,
    donem: string,
    belgeNo: string,
    ext: string,
    faturaTuru: string,
    mihsapId: string | number,
  ): string {
    // belgeNo boş/hatalı olabilir — MIHSAP internal id ile birleştirip unique garantile
    const safeBelgeNo = (belgeNo || 'fatura').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const side = /ALIS|ALIŞ/i.test(faturaTuru) ? 'ALIS' : 'SATIS';
    return `${tenantId}/mihsap-invoices/${mukellefId}/${donem}/${side}/${safeBelgeNo}_${mihsapId}.${ext}`;
  }

  /** Fatura metadata'sını DB'ye yaz. Görüntü MIHSAP CDN'inden (mihsapFileLink)
   *  direkt sunulur — S3'e kopyalamaya gerek yok. S3 yapılandırılırsa
   *  ileride burada arşiv kopyası eklenebilir. */
  private async downloadAndStore(
    tenantId: string,
    mukellefId: string,
    item: MihsapInvoiceSummary,
    donem: string,
    kaynak?: 'arsiv' | 'bekleyen',
  ): Promise<{ stored: boolean; skipped?: boolean; reason?: string }> {
    // Daha önce kaydedilmiş mi? mihsapId unique
    const mihsapInternalId =
      item.id ??
      item.faturaId ??
      item.fileId ??
      `${item.userFirmaBilgisiId || 'mukellef'}-${item.faturaTuru || 'TUR'}-${item.faturaNo || 'NO'}-${item.faturaTarihi || item.faturaTarihiStr || 'TARIH'}`;
    const existing = await (this.prisma as any).mihsapInvoice.findUnique({
      where: { mihsapId: String(mihsapInternalId) },
    });
    if (existing?.mihsapFileLink) {
      return { stored: false, skipped: true, reason: 'already-stored' };
    }

    // S3 upload atlanıyor — MIHSAP CDN (invoice.mihsap.com) auth gerektirmez,
    // frontend mihsapFileLink'i doğrudan <img> src olarak kullanır.
    const storageKey: string | undefined = undefined;
    const storageUrl: string | undefined = undefined;

    const faturaTarihi = item.faturaTarihi
      ? new Date(item.faturaTarihi)
      : item.faturaTarihiStr
        ? this.parseTrDate(item.faturaTarihiStr)
        : new Date();

    await (this.prisma as any).mihsapInvoice.upsert({
      where: { mihsapId: String(item.id) },
      update: {
        tenantId,
        mukellefId,
        mukellefMihsapId: String(item.userFirmaBilgisiId),
        donem,
        faturaTuru: item.faturaTuru,
        belgeTuru: item.belgeTuru,
        faturaNo: item.faturaNo,
        firmaKimlikNo: item.firmaKimlikNo || item.faturaFirmaKimlikNo || null,
        firmaUnvan: item.firmaUnvan || item.faturaFirmaAdi || null,
        faturaTarihi,
        toplamTutar: item.toplamTutar ?? 0,
        onayDurumu: item.onayDurumu || null,
        mihsapFileId: item.fileId ? String(item.fileId) : null,
        mihsapFaturaId: item.faturaId ? String(item.faturaId) : null,
        orjDosyaTuru: item.orjDosyaTuru || null,
        mihsapFileLink: item.fileLink || item.fileDownloadLink || null,
        ...(kaynak ? { kaynak } : {}),
        raw: item as any,
        ...(storageKey ? { storageKey, storageUrl, downloadedAt: new Date() } : {}),
      },
      create: {
        tenantId,
        mukellefId,
        mukellefMihsapId: String(item.userFirmaBilgisiId),
        donem,
        faturaTuru: item.faturaTuru,
        belgeTuru: item.belgeTuru,
        faturaNo: item.faturaNo,
        firmaKimlikNo: item.firmaKimlikNo || item.faturaFirmaKimlikNo || null,
        firmaUnvan: item.firmaUnvan || item.faturaFirmaAdi || null,
        faturaTarihi,
        toplamTutar: item.toplamTutar ?? 0,
        onayDurumu: item.onayDurumu || null,
        mihsapId: String(mihsapInternalId),
        mihsapFileId: item.fileId ? String(item.fileId) : null,
        mihsapFaturaId: item.faturaId ? String(item.faturaId) : null,
        orjDosyaTuru: item.orjDosyaTuru || null,
        storageKey: storageKey || null,
        storageUrl: storageUrl || null,
        mihsapFileLink: item.fileLink || item.fileDownloadLink || null,
        kaynak: kaynak || null,
        downloadedAt: storageKey ? new Date() : null,
        raw: item as any,
      },
    });

    // mihsapFileLink varsa fatura görüntülenebilir — "stored" olarak say
    return { stored: !!(storageKey || item.fileLink || item.fileDownloadLink) };
  }

  private parseTrDate(s: string): Date {
    const m = s.match(/^(\d{2})[-.\/](\d{2})[-.\/](\d{4})/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return new Date();
  }

  /** Belirli bir dönemin tüm MIHSAP fatura kayıtlarını siler (yeniden çekme öncesi) */
  async clearPeriod(tenantId: string, mukellefId: string, donem: string) {
    // DB'den sil (S3 kullanılmıyor — dosyalar MIHSAP CDN'inde)
    const { count } = await (this.prisma as any).mihsapInvoice.deleteMany({
      where: { tenantId, mukellefId, donem },
    });
    return { deleted: count };
  }

  /** Kullanıcı "MIHSAP'tan Çek" dediğinde çalışır.
   *  kaynak (varsayilan 'arsiv'): ONAYLANMIS/ISLENMIS faturalari ceker. */
  async fetchAndStoreInvoices(params: {
    tenantId: string;
    mukellefId: string;
    mukellefMihsapId: string;
    donem: string;
    faturaTuru?: 'ALIS' | 'SATIS';
    createdBy?: string;
    forceRefresh?: boolean; // true: önce mevcut kayıtları sil, sonra çek
    kaynak?: 'arsiv' | 'bekleyen';
  }) {
    if (params.forceRefresh) {
      await this.clearPeriod(params.tenantId, params.mukellefId, params.donem);
    }
    const job = await (this.prisma as any).mihsapFetchJob.create({
      data: {
        tenantId: params.tenantId,
        mukellefId: params.mukellefId,
        donem: params.donem,
        faturaTuru: params.faturaTuru || null,
        status: 'running',
        startedAt: new Date(),
        createdBy: params.createdBy || null,
      },
    });

    const sides: Array<'ALIS' | 'SATIS'> = params.faturaTuru
      ? [params.faturaTuru]
      : ['ALIS', 'SATIS'];
    let total = 0;
    let fetched = 0;
    let errorMsg: string | null = null;

    try {
      for (const side of sides) {
        const items = await this.listAllInvoices({
          tenantId: params.tenantId,
          mukellefMihsapId: params.mukellefMihsapId,
          donem: params.donem,
          faturaTuru: side,
          kaynak: params.kaynak || 'arsiv',
        });
        total += items.length;
        // Paralel 3'erli indirme (rate limit dostu)
        const CONCURRENCY = 3;
        for (let i = 0; i < items.length; i += CONCURRENCY) {
          const batch = items.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            batch.map((it) =>
              this.downloadAndStore(params.tenantId, params.mukellefId, it, params.donem, params.kaynak || 'arsiv'),
            ),
          );
          fetched += results.filter((r) => r.stored || r.skipped).length;
          await (this.prisma as any).mihsapFetchJob.update({
            where: { id: job.id },
            data: { totalCount: total, fetchedCount: fetched },
          });
        }
      }
    } catch (e: any) {
      errorMsg = e?.message || 'bilinmeyen hata';
      this.logger.error('fetchAndStoreInvoices failed', e);
    }

    await (this.prisma as any).mihsapFetchJob.update({
      where: { id: job.id },
      data: {
        status: errorMsg ? 'failed' : 'done',
        totalCount: total,
        fetchedCount: fetched,
        errorMsg,
        finishedAt: new Date(),
      },
    });

    // === IN-APP BILDIRIM: Mihsap toplu islem tamamlandi ===
    if (this.notifications) {
      try {
        let mukellefLabel = '';
        if (params.mukellefId) {
          const tp = await (this.prisma as any).taxpayer.findFirst({
            where: { id: params.mukellefId, tenantId: params.tenantId },
            select: { companyName: true, firstName: true, lastName: true },
          }).catch(() => null);
          if (tp) {
            mukellefLabel = tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ') || '';
          }
        }
        // Kaynaga gore hedef modul: "bekleyen" (gelen evrak) -> Fatura Isleme Merkezi'nde
        // gorunur, Islenen Faturalar'da DEGIL. "arsiv" -> Islenen Faturalar. Bildirim
        // dogru modulu soylesin + linki oraya gitsin (yaniltici "indirildi" yerine).
        const isBekleyen = (params.kaynak || 'arsiv') === 'bekleyen';
        const hedefModul = isBekleyen ? 'Fatura İşleme Merkezi' : 'İşlenen Faturalar';
        const hedefLink = isBekleyen ? '/fatura-merkezi' : '/panel/faturalar';
        // Token/oturum kaynaklı hatalar GEÇİCİ + OTOMATİK retry'li → kullanıcıya KIRMIZI
        // "hata" yerine YUMUŞAK "oturum bekleniyor, otomatik tamamlanacak" göster. (Kullanıcı
        // bu hatayı bir daha görmek istemiyor; token tazelenince zaten kendiliğinden tamamlanır.)
        const retriable = !!errorMsg && /bos cevap|bo[şs] cevap|token|oturum|yetki|401|403|JWT|geçerli görünmüyor/i.test(errorMsg);
        const emoji = errorMsg ? (retriable ? '⏳' : '❌') : '✅';
        const title = errorMsg
          ? (retriable
              ? `${emoji} Mihsap oturumu bekleniyor${mukellefLabel ? ` - ${mukellefLabel}` : ''}`
              : `${emoji} Mihsap aktarım hatası${mukellefLabel ? ` - ${mukellefLabel}` : ''}`)
          : `${emoji} Mihsap aktarım tamam${mukellefLabel ? ` - ${mukellefLabel}` : ''} (${fetched}/${total})`;
        const body = errorMsg
          ? (retriable
              ? `${params.donem} dönemi: Mihsap oturumu (token) tazelenince otomatik tamamlanacak — Mihsap sekmesini bir kez açmanız yeterli.`
              : `${params.donem} dönemi: ${String(errorMsg).slice(0, 300)}`)
          : `${params.donem} dönemi: ${fetched} fatura çekildi → ${hedefModul}.`;
        await this.notifications.createForTenant({
          tenantId: params.tenantId,
          type: NOTIFICATION_TYPES.MIHSAP_RESULT,
          title,
          body,
          metadata: {
            jobId: job.id,
            mukellefId: params.mukellefId || null,
            donem: params.donem,
            total,
            fetched,
            errorMsg: errorMsg || null,
            link: hedefLink,
          },
          dedupeKey: `mihsap-result:${job.id}`,
          dedupeWindowMin: 60,
        });
      } catch (e) {
        this.logger.warn(`MIHSAP_RESULT notif failed: ${(e as Error).message}`);
      }
    }

    // === Drive otomatik yedek tetikle (Drive bağlıysa DriveService dinler) ===
    // Hata olsa bile şimdiye dek kaydedilenler yedeklenebilsin diye throw'dan önce yayınla.
    if (this.eventBus) {
      try {
        this.eventBus.emit('Mihsap.InvoicesFetched', {
          tenantId: params.tenantId,
          mukellefId: params.mukellefId,
          donem: params.donem,
        });
      } catch {
        /* yedek tetikleme zorunlu değil — yut */
      }
    }

    if (errorMsg) {
      throw new BadRequestException(errorMsg);
    }

    return { jobId: job.id, total, fetched, errorMsg };
  }

  // ==================== LİSTELEME ====================

  /** Panel için DB'deki indirilmiş faturaları listele */
  async listStoredInvoices(params: {
    tenantId: string;
    mukellefId?: string;
    donem?: string;
    faturaTuru?: string;
    belgeTuru?: string;
    limit?: number;
    // true: "bekleyen" (gelen evrak) kaynakli kayitlari haric tut. Islenen Faturalar
    // modulu bunu kullanir; Fatura Isleme Merkezi'nden cekilenler orada gorunmesin.
    excludeBekleyen?: boolean;
  }) {
    const where: any = { tenantId: params.tenantId };
    if (params.mukellefId) where.mukellefId = params.mukellefId;
    if (params.donem) where.donem = params.donem;
    if (params.faturaTuru) where.faturaTuru = params.faturaTuru;
    if (params.belgeTuru) where.belgeTuru = params.belgeTuru;
    // Gelen-evrak (bekleyen) kayitlarini disla; eski/null kayitlar arsiv sayilir (gorunur).
    if (params.excludeBekleyen) {
      where.OR = [{ kaynak: null }, { kaynak: { not: 'bekleyen' } }];
    }

    // Limit: kullanıcı belirtmişse en fazla 10000, hiç belirtmemişse 5000.
    // Büyük mükellef dosyalarında (1500+ fatura/ay) 500 limiti yetersizdi.
    const safeLimit = Math.min(params.limit || 5000, 10000);

    return (this.prisma as any).mihsapInvoice.findMany({
      where,
      orderBy: [{ donem: 'desc' }, { faturaTarihi: 'desc' }],
      take: safeLimit,
    });
  }

  /** Canlı akış log butonundan — belgeNo ile invoice bul */
  async findInvoiceByBelgeNo(
    tenantId: string,
    belgeNo: string,
    mukellefId?: string,
  ): Promise<{ id: string; storageUrl: string | null } | null> {
    const where: any = {
      tenantId,
      OR: [
        { faturaNo: belgeNo },
        { faturaNo: { contains: belgeNo } },
      ],
    };
    if (mukellefId) where.mukellefId = mukellefId;

    const inv = await (this.prisma as any).mihsapInvoice.findFirst({
      where,
      select: { id: true, storageUrl: true, mihsapFileLink: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!inv) return null;
    return { id: inv.id, storageUrl: inv.storageUrl || inv.mihsapFileLink || null };
  }

  /** Bir faturanın binary içeriğini getir (proxy — CORS bypass).
   *  Frontend `fetch()` MIHSAP CDN'e direkt gidemez; backend aracı olur.
   *  Başarısızsa reason ile birlikte exception atar — 404 yerine 502 dönülür.
   */
  async getInvoiceFile(
    tenantId: string,
    invoiceId: string,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
    const inv = await (this.prisma as any).mihsapInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv || inv.tenantId !== tenantId) {
      throw new BadRequestException(`Fatura kaydı bulunamadı (${invoiceId})`);
    }

    // URL'yi hazırla — S3 artık kullanılmıyor, doğrudan MIHSAP CDN link'ini kullan.
    // (Eski kayıtlarda `storageKey` dolu olabilir ama S3 bucket erişilemez; o yüzden atla.)
    let url: string | null = null;
    if (inv.mihsapFileLink) {
      url = inv.mihsapFileLink.startsWith('http')
        ? inv.mihsapFileLink
        : `${MIHSAP_BASE}${inv.mihsapFileLink.startsWith('/') ? '' : '/'}${inv.mihsapFileLink}`;
    }
    if (!url) {
      throw new BadRequestException(
        `Fatura ${invoiceId} için MIHSAP indirme bağlantısı yok (mihsapFileLink boş). Faturaları yeniden çekmeniz gerekebilir.`,
      );
    }

    this.logger.log(`Fatura ${invoiceId} indiriliyor: ${url.slice(0, 150)}`);

    // MIHSAP token'ı varsa auth header olarak dene
    let mihsapToken: string | null = null;
    try {
      mihsapToken = await this.getToken(tenantId);
    } catch {
      /* token yoksa auth'suz dene */
    }

    const tryFetch = async (headers: Record<string, string>): Promise<Response> => {
      // Zaman aşımı: takılan bir indirme toplu yedeklemeyi sonsuza dek dondurmasın
      return fetch(url!, { headers, signal: AbortSignal.timeout(45000) });
    };

    const baseHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: `${MIHSAP_BASE}/`,
      Origin: MIHSAP_BASE,
    };

    let res: Response;
    try {
      // 1. Deneme: auth'suz
      res = await tryFetch(baseHeaders);
      if (!res.ok && mihsapToken) {
        // 2. Deneme: Bearer token ile
        this.logger.log(`Fatura ${invoiceId}: auth'suz ${res.status}, Bearer token ile deneniyor`);
        res = await tryFetch({
          ...baseHeaders,
          Authorization: `Bearer ${mihsapToken}`,
          Cookie: `jwt=${mihsapToken}; Auth=${mihsapToken}`,
        });
      }
    } catch (e: any) {
      throw new BadRequestException(
        `MIHSAP'a bağlanılamadı: ${e?.message || 'network hatası'}`,
      );
    }

    if (!res.ok) {
      // Yanıt gövdesinden ipucu al
      let body = '';
      try {
        body = (await res.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      this.logger.warn(
        `Fatura ${invoiceId} HTTP ${res.status}: ${body.slice(0, 100)}`,
      );
      throw new BadRequestException(
        `MIHSAP CDN ${res.status} döndü (${res.statusText}). URL: ${url.slice(0, 80)}. Body: ${body.slice(0, 80)}`,
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType =
      res.headers.get('content-type') ||
      this.guessContentType(inv.orjDosyaTuru || url) ||
      'application/octet-stream';

    const ext = this.extFromUrlOrType(url, inv.orjDosyaTuru);
    const filename = `${inv.faturaNo || invoiceId}.${ext}`;
    return { buffer, contentType, filename };
  }

  private extFromUrlOrType(url: string, orjType?: string | null): string {
    const fromType = (orjType || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['jpg', 'jpeg', 'png', 'pdf', 'xml'].includes(fromType)) return fromType;
    const linkExt = (url.split('?')[0].split('.').pop() || '').toLowerCase();
    if (['jpg', 'jpeg', 'png', 'pdf', 'xml'].includes(linkExt)) return linkExt;
    return 'bin';
  }

  private guessContentType(hint: string): string | null {
    const s = hint.toLowerCase();
    if (s.endsWith('.jpg') || s.endsWith('.jpeg') || s === 'jpeg' || s === 'jpg') return 'image/jpeg';
    if (s.endsWith('.png') || s === 'png') return 'image/png';
    if (s.endsWith('.pdf') || s === 'pdf') return 'application/pdf';
    if (s.endsWith('.xml') || s === 'xml') return 'application/xml';
    return null;
  }

  /** Bir faturanın görüntüleme URL'ini döndür.
   *  S3 artık kullanılmıyor; doğrudan MIHSAP CDN link'i döndürülür.
   */
  async getInvoiceDownloadUrl(tenantId: string, invoiceId: string): Promise<string | null> {
    const inv = await (this.prisma as any).mihsapInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv || inv.tenantId !== tenantId) return null;

    // MIHSAP CDN URL'i (auth gerektirmez, path hash ile korumalı)
    if (inv.mihsapFileLink) {
      return inv.mihsapFileLink;
    }

    return null;
  }

  // ==================== TOPLU YAZDIRMA ====================

  /**
   * Toplu fatura yazdırma — belirli bir dönem + ALIS/SATIS için SADECE fatura
   * niteliğindeki belgeleri (e-Fatura, e-Arşiv) bir araya getirir, her JPEG'i
   * MIHSAP CDN'den çeker, base64 inline edilmiş tek bir print-ready HTML üretir.
   *
   * **ÇOK ÖNEMLİ:** Fiş (FIS/OKC) ve Z Raporu gibi belge türleri HARİÇ tutulur.
   * Whitelist yaklaşımı: sadece E_FATURA + E_ARSIV.
   */
  async buildBulkPrintHtml(params: {
    tenantId: string;
    mukellefId?: string;
    donem: string;             // "2026-03"
    faturaTuru: 'ALIS' | 'SATIS';
  }): Promise<{ html: string; count: number; skipped: number }> {
    const { tenantId, mukellefId, donem, faturaTuru } = params;

    // Mihsap belgeTuru değerleri gerçek DB'de: "e_FATURA", "e_ARSIV", "FIS",
    // "IRSALIYE", "Z_RAPORU" vb. Case karışık (küçük e, büyük FATURA).
    // Prisma `in` clause case-sensitive olduğu için DB tarafında filtre yapmıyor,
    // tüm dönem+faturaTuru kayıtlarını çekip JS'de normalize edilmiş whitelist
    // + blacklist uyguluyoruz.
    //
    // ÖNEMLİ: faturaTuru DB'de "ALIS", "TEVKIFATLI_ALIS", "SATIS",
    // "TEVKIFATLI_SATIS" olabiliyor. Toplu yazdırırken tevkifatlılar da
    // dahil olmalı → kesin eşitlik yerine "contains" ile filtrele.
    const where: any = {
      tenantId,
      donem,
      faturaTuru: { contains: faturaTuru }, // 'ALIS' → 'ALIS' + 'TEVKIFATLI_ALIS'
    };
    if (mukellefId) where.mukellefId = mukellefId;

    const invoices = await (this.prisma as any).mihsapInvoice.findMany({
      where,
      orderBy: [{ faturaTarihi: 'asc' }, { faturaNo: 'asc' }],
      take: 10000,
    });

    // BASİT KURAL:
    //   ALIŞ yazdır → fiş dışında HER ŞEYİ al (e-Fatura, e-Arşiv, irsaliye, vb.)
    //   SATIŞ yazdır → Z raporu dışında HER ŞEYİ al
    // Whitelist yok — sadece spesifik bir tek tipi dışla.
    const filtered = invoices.filter((inv: any) => {
      const bt = String(inv.belgeTuru || '')
        .toUpperCase()
        .replace(/[-\s]/g, '_');

      if (faturaTuru === 'ALIS') {
        // Alışta SADECE fişleri (FIS / OKC / PERAKENDE_FIS) dışla
        if (/^FI[SŞ]$|FI[SŞ]_|_FI[SŞ]|OKC|PERAKENDE/.test(bt)) return false;
        return true;
      } else {
        // Satışta SADECE Z raporlarını dışla
        if (/Z_?RAPOR/.test(bt)) return false;
        return true;
      }
    });

    const skipped = invoices.length - filtered.length;

    if (filtered.length === 0) {
      // Debug: DB'deki gerçek belgeTuru değerlerini göster
      const belgeTuruSayim = new Map<string, number>();
      for (const inv of invoices) {
        const bt = String(inv.belgeTuru || '(boş)');
        belgeTuruSayim.set(bt, (belgeTuruSayim.get(bt) || 0) + 1);
      }
      const debugSatir = Array.from(belgeTuruSayim.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      this.logger.warn(
        `[toplu-yazdir] ${donem} ${faturaTuru}: toplam=${invoices.length} filtrelenen=${filtered.length} belgeTuru değerleri: ${debugSatir}`,
      );
      return {
        html: this.renderBulkPrintEmpty(donem, faturaTuru, {
          toplam: invoices.length,
          filtrelenen: filtered.length,
          belgeTuruOrnek: debugSatir || '(hiç fatura yok)',
        }),
        count: 0,
        skipped,
      };
    }

    // MIHSAP token'ı (bazı CDN path'leri auth ister)
    let mihsapToken: string | null = null;
    try {
      mihsapToken = await this.getToken(tenantId);
    } catch {
      /* ignore */
    }

    // Paralel çek — 8'li batch (CDN rate limit'i yorma)
    type ImgRec = {
      inv: any;
      base64: string | null;
      mime: string;
      error?: string;
    };
    const results: ImgRec[] = [];
    const BATCH = 8;
    for (let i = 0; i < filtered.length; i += BATCH) {
      const chunk = filtered.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        chunk.map((inv: any) => this.fetchMihsapFileAsBase64(inv, mihsapToken)),
      );
      settled.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          results.push({ inv: chunk[idx], ...r.value });
        } else {
          results.push({
            inv: chunk[idx],
            base64: null,
            mime: '',
            error: String(r.reason?.message || r.reason || 'indirme hatası'),
          });
        }
      });
    }

    const html = this.renderBulkPrintHtml(donem, faturaTuru, results);
    return { html, count: results.filter((r) => r.base64).length, skipped };
  }

  private async fetchMihsapFileAsBase64(
    inv: any,
    mihsapToken: string | null,
  ): Promise<{ base64: string; mime: string }> {
    if (!inv.mihsapFileLink) throw new Error('mihsapFileLink boş');
    const url = inv.mihsapFileLink.startsWith('http')
      ? inv.mihsapFileLink
      : `${MIHSAP_BASE}${inv.mihsapFileLink.startsWith('/') ? '' : '/'}${inv.mihsapFileLink}`;

    const baseHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: `${MIHSAP_BASE}/`,
      Origin: MIHSAP_BASE,
    };
    let res = await fetch(url, { headers: baseHeaders });
    if (!res.ok && mihsapToken) {
      res = await fetch(url, {
        headers: {
          ...baseHeaders,
          Authorization: `Bearer ${mihsapToken}`,
          Cookie: `jwt=${mihsapToken}; Auth=${mihsapToken}`,
        },
      });
    }
    if (!res.ok) throw new Error(`CDN ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime =
      res.headers.get('content-type') ||
      this.guessContentType(inv.orjDosyaTuru || url) ||
      'image/jpeg';
    return { base64: buf.toString('base64'), mime };
  }

  private renderBulkPrintEmpty(
    donem: string,
    faturaTuru: 'ALIS' | 'SATIS',
    debug?: { toplam: number; filtrelenen: number; belgeTuruOrnek: string },
  ): string {
    const tr = faturaTuru === 'ALIS' ? 'Alış' : 'Satış';
    const debugBlock = debug
      ? `<div style="margin-top:24px;padding:16px;background:#222;color:#ccc;text-align:left;border-radius:6px;font-family:ui-monospace,monospace;font-size:12px;max-width:640px;margin-left:auto;margin-right:auto">
  <div style="color:#c9a77c;font-weight:bold;margin-bottom:6px">DEBUG</div>
  <div>Dönemdeki toplam ${tr} kaydı: <b>${debug.toplam}</b></div>
  <div>Filtreden geçen: <b>${debug.filtrelenen}</b></div>
  <div>Atlanan (fiş/Z raporu/bilinmeyen): <b>${debug.toplam - debug.filtrelenen}</b></div>
  <div style="margin-top:8px">DB'deki belgeTuru değerleri: <b>${debug.belgeTuruOrnek}</b></div>
  <div style="margin-top:12px;color:#f4a5b2">Bu değer whitelist'te (E_FATURA / E_ARSIV) yoksa bize bildir — filtreye ekleyelim.</div>
</div>`
      : '';
    const haricKural =
      faturaTuru === 'ALIS'
        ? 'Alışta sadece <b>fişler (FIS / OKC / PERAKENDE)</b> dışlandı; diğer her şey dahil edildi.'
        : 'Satışta sadece <b>Z raporları</b> dışlandı; diğer her şey dahil edildi.';
    return `<!doctype html><meta charset="utf-8"><title>Toplu ${tr} · ${donem}</title>
<body style="font-family:system-ui,sans-serif;padding:40px;text-align:center;color:#444;background:#0f0d0b">
  <h1 style="color:#9c4656">Yazdırılacak ${tr} belgesi bulunamadı</h1>
  <p style="color:#aaa">Dönem <b>${donem}</b> için bu mükellefte yazdırılabilir belge yok.<br>
  ${haricKural}</p>
  ${debugBlock}
</body>`;
  }

  private renderBulkPrintHtml(
    donem: string,
    faturaTuru: 'ALIS' | 'SATIS',
    items: Array<{ inv: any; base64: string | null; mime: string; error?: string }>,
  ): string {
    const tr = faturaTuru === 'ALIS' ? 'Alış' : 'Satış';
    const esc = (s: any) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) =>
      ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' } as any)[c],
    );
    const tarihFmt = (d: any) => {
      try {
        const dt = new Date(d);
        return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
      } catch {
        return String(d || '');
      }
    };
    const pages = items.map((it, idx) => {
      const inv = it.inv;
      const meta = `<div class="hdr">
  <span class="idx">#${idx + 1} / ${items.length}</span>
  <span class="no">${esc(inv.faturaNo || '—')}</span>
  <span class="firma">${esc(inv.firmaUnvan || '')}</span>
  <span class="tarih">${tarihFmt(inv.faturaTarihi)}</span>
  <span class="tutar">${Number(inv.toplamTutar || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺</span>
</div>`;
      if (!it.base64) {
        return `<section class="page err">${meta}
  <div class="missing">⚠ Bu fatura görseli indirilemedi: ${esc(it.error || '')}</div>
</section>`;
      }
      const isPdf = it.mime.includes('pdf');
      if (isPdf) {
        return `<section class="page">${meta}
  <iframe class="pdf" src="data:${it.mime};base64,${it.base64}"></iframe>
</section>`;
      }
      return `<section class="page">${meta}
  <img class="doc" src="data:${it.mime};base64,${it.base64}" alt="">
</section>`;
    }).join('\n');

    return `<!doctype html>
<html lang="tr"><head>
<meta charset="utf-8">
<title>Toplu ${tr} Faturaları · ${donem}</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#f5f4ef;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#2a2a2a}
  .page{width:210mm;min-height:297mm;margin:8px auto;padding:8mm 8mm 10mm;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.08);page-break-after:always;break-after:page;display:flex;flex-direction:column}
  .page.err{justify-content:center;align-items:center;text-align:center}
  .hdr{display:flex;align-items:center;gap:10px;border-bottom:2px solid #9c4656;padding:2mm 0 3mm;margin-bottom:4mm;font-size:10pt;color:#555}
  .hdr .idx{font-weight:600;color:#9c4656;min-width:60px}
  .hdr .no{font-weight:700;color:#111;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .hdr .firma{flex:1;font-weight:600;color:#2a2a2a;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  .hdr .tarih{font-family:ui-monospace,monospace}
  .hdr .tutar{font-weight:700;color:#9c4656;font-variant-numeric:tabular-nums}
  .doc{width:100%;max-height:270mm;object-fit:contain;display:block;margin:0 auto}
  .pdf{width:100%;height:270mm;border:0}
  .missing{color:#c43;font-size:14pt;padding:20mm;border:1px dashed #c43;border-radius:6px}
  .toolbar{position:sticky;top:0;z-index:10;background:#1a1a1a;color:#fafaf9;padding:10px 16px;display:flex;align-items:center;gap:16px;border-bottom:1px solid #333}
  .toolbar h1{margin:0;font-family:'Fraunces',serif;font-size:18px;font-weight:600;color:#c9a77c;letter-spacing:-.02em}
  .toolbar .meta{color:#aaa;font-size:13px}
  .toolbar button{margin-left:auto;padding:8px 16px;background:#9c4656;color:#fff;border:0;border-radius:4px;font-size:13px;font-weight:600;cursor:pointer}
  .toolbar button:hover{background:#b35565}
  @media print{.toolbar{display:none!important}body{background:#fff}.page{margin:0;box-shadow:none;page-break-after:always}}
  @page{size:A4;margin:8mm}
</style>
</head>
<body>
  <div class="toolbar">
    <h1>Toplu ${tr} Faturaları</h1>
    <span class="meta">Dönem <b>${donem}</b> · ${items.filter(i=>i.base64).length}/${items.length} belge</span>
    <button onclick="window.print()">🖨 Yazdır</button>
  </div>
  ${pages}
  <script>
    window.addEventListener('load', function(){
      var imgs = document.querySelectorAll('img.doc');
      var left = imgs.length;
      var fire = function(){ setTimeout(function(){ window.print(); }, 400); };
      if (left === 0) { fire(); return; }
      imgs.forEach(function(im){
        if (im.complete) { if (--left === 0) fire(); }
        else {
          im.addEventListener('load',  function(){ if (--left === 0) fire(); });
          im.addEventListener('error', function(){ if (--left === 0) fire(); });
        }
      });
    });
  </script>
</body></html>`;
  }

  /** DEBUG — DB kayıt + ham MIHSAP payload'u. Hangi tarih alanı kabul tarihi
   *  onu anlamak için. */
  async getInvoiceRaw(tenantId: string, invoiceId: string) {
    const inv = await (this.prisma as any).mihsapInvoice.findUnique({ where: { id: invoiceId } });
    if (!inv || inv.tenantId !== tenantId) return { error: 'bulunamadı' };
    // Ham payload içindeki tüm tarih benzeri alanları öne çıkar
    const raw = inv.raw || {};
    const dateFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw as Record<string, any>)) {
      if (/tarih|date|time/i.test(k)) dateFields[k] = v;
    }
    return {
      db: {
        id: inv.id,
        faturaNo: inv.faturaNo,
        faturaTarihi: inv.faturaTarihi,
        donem: inv.donem,
        createdAt: inv.createdAt,
        downloadedAt: inv.downloadedAt,
      },
      rawDateFields: dateFields,
      rawFull: raw,
    };
  }

  /** Son çekme işlerini listele (progress gösterimi için) */
  async listFetchJobs(tenantId: string, limit = 20) {
    // Stale job'ları temizle: STALE_JOB_MS'den uzun süredir "running" olan job'ları fail yap
    const staleAgo = new Date(Date.now() - STALE_JOB_MS);
    await (this.prisma as any).mihsapFetchJob.updateMany({
      where: {
        tenantId,
        status: 'running',
        startedAt: { lt: staleAgo },
      },
      data: {
        status: 'failed',
        errorMsg: 'Zaman aşımı – sunucu yeniden başlatıldı',
        finishedAt: new Date(),
      },
    });

    return (this.prisma as any).mihsapFetchJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
