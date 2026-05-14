import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Luca entegrasyonu — Mihsap deseninin Luca'ya uyarlanmış hali.
 *
 * Akış:
 *   1. Tarayıcı eklentisi (moren-agent.js) Luca sayfasında açıkken session
 *      token/cookie'sini yakalar ve `POST /luca/token` endpoint'ine gönderir.
 *   2. Portal bu oturumla Luca'ya proxy yapar — ya da kullanıcı runner
 *      ile "Luca muavinini çek" dediğinde runner Luca sayfasında Excel
 *      indirip portala `POST /kdv-control/sessions/:id/excel-from-runner`
 *      ile gönderir.
 *
 * Luca'nın tam iç API endpoint'leri müşteri hesabından keşfedilecek;
 * `LUCA_ENDPOINTS` aşağıda yer tutucu olarak duruyor, runner yaklaşımı
 * endpoint bilinmese de çalışır.
 */
const LUCA_ENDPOINTS = {
  baseUrl: 'https://web.luca.com.tr',
  // Keşif yoluyla doldurulacak endpoint'ler. Backend şu anda bunları
  // kullanmıyor — runner DOM üzerinden Excel indiriyor.
  muavin191: '/api/muhasebe/muavin?hesap=191',
  muavin391: '/api/muhasebe/muavin?hesap=391',
  isletmeGelir: '/api/isletme-defteri/gelir',
  isletmeGider: '/api/isletme-defteri/gider',
};

@Injectable()
export class LucaService {
  private readonly logger = new Logger(LucaService.name);

  constructor(private readonly prisma: PrismaService) {}

  private canClaimUnassignedLucaJob(deviceId?: string) {
    const id = deviceId?.trim();
    if (!id) return false;
    // Browser extension device ids are generated as DEV-*. The local Node worker
    // uses the persisted machine id (for example moren-5255e7bb). Unassigned
    // jobs must go to the local worker so visible Chrome tabs do not hijack them.
    return !/^DEV-/i.test(id);
  }

  // ==================== TOKEN / OTURUM ====================

  /** Eklenti Luca session token/cookie'sini gönderir. */
  async saveToken(
    tenantId: string,
    data: { token: string; cookies?: string; origin?: string; email?: string },
    updatedBy?: string,
  ) {
    if (!data.token || data.token.length < 10) {
      throw new BadRequestException('Geçersiz Luca token/cookie');
    }
    return (this.prisma as any).lucaSession.upsert({
      where: { tenantId },
      update: {
        token: data.token,
        cookies: data.cookies || null,
        origin: data.origin || null,
        email: data.email || null,
        updatedBy: updatedBy || null,
      },
      create: {
        tenantId,
        token: data.token,
        cookies: data.cookies || null,
        origin: data.origin || null,
        email: data.email || null,
        updatedBy: updatedBy || null,
      },
    });
  }

  async getSession(tenantId: string) {
    const s = await (this.prisma as any).lucaSession.findUnique({
      where: { tenantId },
    });
    if (!s) return null;
    return {
      connected: true,
      email: s.email,
      origin: s.origin,
      updatedAt: s.updatedAt,
      tokenLength: s.token?.length || 0,
    };
  }

  async clearSession(tenantId: string) {
    await (this.prisma as any).lucaSession.deleteMany({ where: { tenantId } });
    return { deleted: true };
  }

  // ==================== JOB YÖNETİMİ ====================

  /**
   * Kullanıcı "Luca'dan Çek" dediğinde, bir fetch job yaratırız;
   * runner bu job'u alıp Luca sayfasında çalıştırır ve Excel'i backend'e
   * geri gönderir (`kdv-control/sessions/:id/excel` endpoint'i).
   */
  async createFetchJob(params: {
    tenantId: string;
    sessionId: string;
    mukellefId: string;
    donem: string;
    tip: string;
    createdBy?: string;
    mukellefAdi?: string;
    targetDeviceId?: string;
    preferredAgent?: string;
    priority?: number;
  }) {
    // Yeni job oluşturmadan önce stuck running'leri temizle — agent kill
    // edilmiş olabilir, DB'de zombie running kayıtları kalmış olabilir.
    // Bu kayıtlar yeni job'ları "seri kural" üzerinden bloke ediyor.
    await this.cleanupStuckRunning(params.tenantId).catch(() => {});

    // Job tipine göre default affinity (B): e-arşiv/efatura uzun süren işler,
    // headless local agent daha stabil. Aksi belirtilmedikçe local-node tercih.
    const defaultAffinity =
      /^(EARSIV|EFATURA|MIZAN|ACCOUNT_PLAN|IHO_FETCH|KDV_191|KDV_391|ISLETME_GELIR|ISLETME_GIDER)/.test(params.tip || '')
        ? 'local-node'
        : null;
    // Beyanname yaklaşırken priority artırma — şimdilik manuel parametre ile.
    return (this.prisma as any).lucaFetchJob.create({
      data: {
        tenantId: params.tenantId,
        sessionId: params.sessionId,
        mukellefId: params.mukellefId,
        donem: params.donem,
        tip: params.tip,
        status: 'pending',
        createdBy: params.createdBy || null,
        targetDeviceId: params.targetDeviceId || null,
        preferredAgent: params.preferredAgent ?? defaultAffinity,
        priority: params.priority ?? 0,
        // mukellefAdi'yı errorMsg'in başına meta olarak ekleyelim (yeni column eklemeden)
        // Format: "[META] mukellefAdi=ABC FIRMA"
        errorMsg: params.mukellefAdi ? `[META] mukellefAdi=${params.mukellefAdi}` : null,
      },
    });
  }

  /**
   * Agent tipini deviceId'den çıkar.
   * - moren-* (hostname-based) → 'local-node'
   * - DEV-* (Chrome extension generated) → 'browser-ext'
   * - null/empty → null (hiçbiri)
   */
  private agentKindForDeviceId(deviceId?: string | null): 'local-node' | 'browser-ext' | null {
    const id = (deviceId || '').trim();
    if (!id) return null;
    if (/^DEV-/i.test(id)) return 'browser-ext';
    return 'local-node';
  }

  async markJobRunning(
    jobId: string,
    opts: { tenantId?: string; deviceId?: string } = {},
  ) {
    const job = await (this.prisma as any).lucaFetchJob.findUnique({ where: { id: jobId } });
    if (!job) return null;
    if (opts.tenantId && job.tenantId !== opts.tenantId) return null;

    const deviceId = opts.deviceId?.trim();
    const canClaimUnassigned = this.canClaimUnassignedLucaJob(deviceId);
    const where: any = {
      id: jobId,
      status: 'pending',
    };
    if (deviceId) {
      where.OR = [
        ...(canClaimUnassigned ? [{ targetDeviceId: null }] : []),
        { targetDeviceId: deviceId },
      ];
    } else {
      where.targetDeviceId = null;
    }

    const data: any = { status: 'running', startedAt: new Date() };
    if (deviceId && !job.targetDeviceId) data.targetDeviceId = deviceId;

    const result = await (this.prisma as any).lucaFetchJob.updateMany({ where, data });
    if (!result?.count) return null;
    return (this.prisma as any).lucaFetchJob.findUnique({ where: { id: jobId } });
  }

  async markJobDone(jobId: string, recordCount: number) {
    await (this.prisma as any).lucaFetchJob.updateMany({
      where: { id: jobId, status: { notIn: ['cancelled'] } },
      data: {
        status: 'done',
        recordCount,
        finishedAt: new Date(),
      },
    });
    return (this.prisma as any).lucaFetchJob.findUnique({ where: { id: jobId } });
  }

  /**
   * Stuck "running" job'ları temizler — agent kill edildiyse veya
   * crash ettiyse DB'de running kalmış job'lar olabilir. Bu method
   * 5 dk+ running'de duranları otomatik failed yapar.
   *
   * Job creation öncesi çağrılır → temiz başlangıç.
   */
  async cleanupStuckRunning(tenantId: string) {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const result = await (this.prisma as any).lucaFetchJob.updateMany({
      where: {
        tenantId,
        status: 'running',
        OR: [
          { startedAt: { lt: fiveMinAgo } },
          { startedAt: null }, // hiç başlamamış ama running işaretli
        ],
      },
      data: {
        status: 'failed',
        errorMsg: 'Cleanup: 5dk+ stuck running, agent crash veya kill olmuş olabilir',
        finishedAt: new Date(),
      },
    });
    if (result.count > 0) {
      this.logger.log(`Cleanup: ${result.count} stuck running job → failed (tenant=${tenantId})`);
    }
    return result.count;
  }

  async markJobFailed(jobId: string, errorMsg: string) {
    const job = await (this.prisma as any).lucaFetchJob.findUnique({ where: { id: jobId } });
    if (job?.status === 'cancelled') return job;
    await this.appendJobLog(jobId, `X ${errorMsg}`);
    await (this.prisma as any).lucaFetchJob.updateMany({
      where: { id: jobId, status: { notIn: ['cancelled'] } },
      data: { status: 'failed', finishedAt: new Date() },
    });
    return (this.prisma as any).lucaFetchJob.findUnique({ where: { id: jobId } });
  }

  async cancelJob(jobId: string, tenantId: string) {
    const job = await (this.prisma as any).lucaFetchJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.tenantId !== tenantId) {
      throw new NotFoundException('Luca fetch job bulunamadi');
    }
    if (['done', 'failed', 'cancelled'].includes(job.status)) return job;
    await this.appendJobLog(jobId, 'Iptal edildi: kullanici durdurdu');
    await (this.prisma as any).lucaFetchJob.update({
      where: { id: jobId },
      data: { status: 'cancelled', finishedAt: new Date() },
    });
    return (this.prisma as any).lucaFetchJob.findUnique({ where: { id: jobId } });
  }
  /**
   * Job'a ilerleme mesajı ekle — frontend polling ile canlı gösterir.
   * errorMsg field'ını kümülatif log olarak kullan (migration gereksin diye).
   */
  async appendJobLog(jobId: string, message: string) {
    const job = await (this.prisma as any).lucaFetchJob.findUnique({ where: { id: jobId } });
    if (!job) return null;
    const ts = new Date().toLocaleTimeString('tr-TR', { hour12: false, timeZone: 'Europe/Istanbul' });
    const newLine = `[${ts}] ${message}`;
    const prev = job.errorMsg || '';
    const lines = (prev ? prev.split('\n') : []).concat(newLine).slice(-20);
    const merged = lines.join('\n').slice(-2000);
    return (this.prisma as any).lucaFetchJob.update({
      where: { id: jobId },
      data: { errorMsg: merged },
    });
  }

  async listJobs(tenantId: string, limit = 20) {
    // Stale job'ları temizle: 10 dk'dan eski "running" varsa fail yap
    const staleCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await (this.prisma as any).lucaFetchJob.updateMany({
      where: {
        tenantId,
        status: 'running',
        startedAt: { lt: staleCutoff },
      },
      data: {
        status: 'failed',
        errorMsg: 'Zaman aşımı',
        finishedAt: new Date(),
      },
    });

    return (this.prisma as any).lucaFetchJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async listJobsForAgent(tenantId: string, opts: { deviceId?: string; limit?: number; status?: string } = {}) {
    const deviceId = opts.deviceId?.trim();
    const limit = Math.min(Math.max(Number(opts.limit || 20), 1), 50);
    const requestedStatus = String(opts.status || '').trim().toLowerCase();
    const staleCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await (this.prisma as any).lucaFetchJob.updateMany({
      where: {
        tenantId,
        status: 'running',
        startedAt: { lt: staleCutoff },
      },
      data: {
        status: 'failed',
        errorMsg: 'Zaman asimi (eski calisan is temizlendi)',
        finishedAt: new Date(),
      },
    });
    const where: any = {
      tenantId,
      status:
        requestedStatus && requestedStatus !== 'active'
          ? { in: requestedStatus.split(',').map((s) => s.trim()).filter(Boolean) }
          : { in: ['pending', 'running'] },
    };
    if (deviceId) {
      where.OR = [
        { targetDeviceId: null },
        { targetDeviceId: deviceId },
      ];
    }
    return (this.prisma as any).lucaFetchJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getJob(jobId: string, tenantId: string) {
    const job = await (this.prisma as any).lucaFetchJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.tenantId !== tenantId) {
      throw new NotFoundException('Luca fetch job bulunamadı');
    }
    return job;
  }

  async requeueJobForAgent(jobId: string, tenantId: string, reason?: string) {
    const job = await (this.prisma as any).lucaFetchJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.tenantId !== tenantId) {
      throw new NotFoundException('Luca fetch job bulunamadı');
    }
    if (job.status === 'done' || job.status === 'cancelled') return job;
    const line = reason
      ? `Teknik kilit temizlendi; iş tekrar sıraya alındı: ${reason}`
      : 'Teknik kilit temizlendi; iş tekrar sıraya alındı';
    await this.appendJobLog(jobId, line);
    return (this.prisma as any).lucaFetchJob.update({
      where: { id: jobId },
      data: {
        status: 'pending',
        startedAt: null,
        finishedAt: null,
      },
    });
  }

  /**
   * Runner tarafından çağrılır — bekleyen job'ları listeler.
   * Mükellef bilgilerini (lucaSlug, taxNumber, ad) job'a embed eder ki
   * agent Luca'da firma değiştirme kontrolünü yapabilsin.
   */
  async pendingJobsForAgent(tenantId: string, deviceId?: string) {
    const canClaimUnassigned = this.canClaimUnassignedLucaJob(deviceId);
    const agentKind = this.agentKindForDeviceId(deviceId);
    // Boyut B — affinity filter: job preferredAgent dolu ise sadece eşleşen ajan görür.
    // preferredAgent null = herkes (default).
    const affinityFilter = agentKind
      ? { OR: [{ preferredAgent: null }, { preferredAgent: agentKind }] }
      : { preferredAgent: null };
    // SERİ İŞ KURALI: aynı mükellef için aynı anda 1 running job.
    // Bir mükellef için zaten running olan job varsa, o mükellefin
    // diğer pending'lerini bekletecek şekilde filtrele.
    // (Aynı mukellefId'de Luca menü navigasyonu paralel olunca çakışıyor —
    //  Gelen E-Fatura + Giden E-Fatura aynı tab'da menü açmaya çalışırsa
    //  birbirini kırıyor.)
    //
    // KRİTİK: "stuck running" job'ları sayma — agent kill edildiyse DB'de
    // running kalır, sonsuza kadar o mükellefi bloke eder. Sadece son
    // 5 dakikada başlamış olanı gerçekten running say.
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const runningMukellefs = await (this.prisma as any).lucaFetchJob.findMany({
      where: {
        tenantId,
        status: 'running',
        startedAt: { gte: fiveMinAgo }, // son 5dk içinde başlamış olanlar
      },
      select: { mukellefId: true },
    });
    const busyMukellefIds = Array.from(
      new Set(runningMukellefs.map((j: any) => j.mukellefId).filter(Boolean)),
    );

    const jobs = await (this.prisma as any).lucaFetchJob.findMany({
      where: {
        tenantId,
        status: 'pending',
        // Meşgul mükelleflerin diğer job'larını gösterme
        ...(busyMukellefIds.length > 0 ? { mukellefId: { notIn: busyMukellefIds } } : {}),
        AND: [
          {
            OR: [
              ...(canClaimUnassigned ? [{ targetDeviceId: null }] : []),
              ...(deviceId ? [{ targetDeviceId: deviceId }] : []),
            ],
          },
          affinityFilter,
        ],
      },
      // Boyut C — priority önce, sonra eskiden yeni
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 5,
    });

    // Her job için ilgili Taxpayer bilgilerini join'le
    const enriched = await Promise.all(
      jobs.map(async (job: any) => {
        const tp = await (this.prisma as any).taxpayer.findUnique({
          where: { id: job.mukellefId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
            taxNumber: true,
            lucaSlug: true,
          },
        });
        return {
          ...job,
          // Agent'a flat olarak göndermek için kök seviyede expose et
          lucaSlug: tp?.lucaSlug || null,
          taxNumber: tp?.taxNumber || null,
          mukellefAdi:
            tp?.companyName ||
            [tp?.firstName, tp?.lastName].filter(Boolean).join(' ') ||
            null,
        };
      }),
    );

    return enriched;
  }

  // ==================== (İleride) DOĞRUDAN API PROXY ====================

  /**
   * Luca'nın iç API'si keşfedildiğinde buraya Mihsap'taki `listInvoices`
   * deseninde bir fetch yazılır. Şu an runner DOM üzerinden Excel
   * indirdiğinden bu metod placeholder.
   */
  async fetchMuavinDirect(_params: {
    tenantId: string;
    mukellefId: string;
    donem: string;
    tip: string;
  }): Promise<never> {
    throw new BadRequestException(
      'Luca doğrudan API proxy henüz yapılandırılmadı. Runner akışı kullanılıyor.',
    );
  }

  // Endpoint'ler sabitini dışa aktar (debug / keşif için)
  getEndpoints() {
    return LUCA_ENDPOINTS;
  }

  // ==================== PORTAL CAPTCHA BRIDGE ====================

  async getSessionManagerStatus(tenantId: string) {
    await this.expireOldCaptchaChallenges(tenantId);
    const [session, credential, statuses, activeChallenge] = await Promise.all([
      this.getSession(tenantId),
      (this.prisma as any).lucaCredential.findUnique({
        where: { tenantId },
        select: {
          id: true,
          uyeNo: true,
          username: true,
          lastLoginAt: true,
          lastError: true,
          isActive: true,
          updatedAt: true,
        },
      }).catch(() => null),
      (this.prisma as any).agentStatus.findMany({
        where: { tenantId, agent: 'luca' },
        orderBy: { lastPing: 'desc' },
        take: 10,
      }).catch(() => []),
      this.getActiveCaptchaChallenge(tenantId),
    ]);

    return {
      credential: credential
        ? {
            saved: true,
            uyeNo: credential.uyeNo,
            username: credential.username,
            lastLoginAt: credential.lastLoginAt,
            lastError: credential.lastError,
            isActive: credential.isActive,
            updatedAt: credential.updatedAt,
          }
        : { saved: false },
      session: session || { connected: false },
      devices: (statuses || []).map((s: any) => ({
        id: s?.meta?.deviceId || null,
        running: !!s.running,
        lastPing: s.lastPing,
        url: s?.meta?.url || null,
        version: s?.meta?.version || null,
      })),
      activeChallenge,
    };
  }

  async getActiveCaptchaChallenge(tenantId: string) {
    await this.expireOldCaptchaChallenges(tenantId);
    const ch = await (this.prisma as any).lucaCaptchaChallenge.findFirst({
      where: { tenantId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    return ch ? this.publicCaptchaChallenge(ch, true) : null;
  }

  async listCaptchaChallenges(tenantId: string, limit = 20) {
    await this.expireOldCaptchaChallenges(tenantId);
    const rows = await (this.prisma as any).lucaCaptchaChallenge.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r: any) => this.publicCaptchaChallenge(r, r.status === 'pending'));
  }

  async submitCaptchaAnswer(tenantId: string, id: string, answer: string, answeredBy?: string) {
    const text = String(answer || '').trim();
    if (text.length < 3) throw new BadRequestException('Guvenlik kodu en az 3 karakter olmali');
    const ch = await (this.prisma as any).lucaCaptchaChallenge.findFirst({
      where: { id, tenantId },
    });
    if (!ch) throw new NotFoundException('CAPTCHA istegi bulunamadi');
    if (ch.status !== 'pending') {
      throw new BadRequestException('Bu CAPTCHA istegi artik cevap beklemiyor');
    }
    const updated = await (this.prisma as any).lucaCaptchaChallenge.update({
      where: { id },
      data: {
        status: 'answered',
        answer: text,
        answeredBy: answeredBy || null,
        answeredAt: new Date(),
      },
    });
    if (updated.jobId) {
      await this.appendJobLog(updated.jobId, 'Luca guvenlik kodu portaldan girildi').catch(() => {});
    }
    return this.publicCaptchaChallenge(updated, false);
  }

  async cancelCaptchaChallenge(tenantId: string, id: string) {
    const ch = await (this.prisma as any).lucaCaptchaChallenge.findFirst({ where: { id, tenantId } });
    if (!ch) throw new NotFoundException('CAPTCHA istegi bulunamadi');
    const updated = await (this.prisma as any).lucaCaptchaChallenge.update({
      where: { id },
      data: { status: 'cancelled' },
    });
    if (updated.jobId) {
      await this.appendJobLog(updated.jobId, 'Luca guvenlik kodu istegi iptal edildi').catch(() => {});
    }
    return this.publicCaptchaChallenge(updated, false);
  }

  async createCaptchaChallengeFromAgent(
    tenantId: string,
    body: {
      jobId?: string;
      deviceId?: string;
      captchaImage: string;
      context?: any;
      expiresInSec?: number;
    },
  ) {
    if (!body?.captchaImage || !String(body.captchaImage).startsWith('data:image/')) {
      throw new BadRequestException('captchaImage data:image formatinda olmali');
    }
    const expiresInSec = Math.max(30, Math.min(Number(body.expiresInSec || 180), 600));
    const expiresAt = new Date(Date.now() + expiresInSec * 1000);
    const created = await (this.prisma as any).lucaCaptchaChallenge.create({
      data: {
        tenantId,
        jobId: body.jobId || null,
        deviceId: body.deviceId || null,
        captchaImage: body.captchaImage,
        context: body.context || {},
        requestedBy: 'agent',
        expiresAt,
      },
    });
    if (body.jobId) {
      await this.appendJobLog(body.jobId, 'Luca guvenlik kodu bekleniyor; kod portalda gosterildi').catch(() => {});
    }
    return { ok: true, challenge: this.publicCaptchaChallenge(created, true) };
  }

  async getCaptchaAnswerForAgent(tenantId: string, id: string) {
    await this.expireOldCaptchaChallenges(tenantId);
    const ch = await (this.prisma as any).lucaCaptchaChallenge.findFirst({
      where: { id, tenantId },
    });
    if (!ch) throw new NotFoundException('CAPTCHA istegi bulunamadi');
    if (ch.status === 'answered') {
      return { status: 'answered', answer: ch.answer };
    }
    return { status: ch.status, answer: null };
  }

  async consumeCaptchaAnswer(tenantId: string, id: string, ok = true, error?: string) {
    const ch = await (this.prisma as any).lucaCaptchaChallenge.findFirst({ where: { id, tenantId } });
    if (!ch) throw new NotFoundException('CAPTCHA istegi bulunamadi');
    const updated = await (this.prisma as any).lucaCaptchaChallenge.update({
      where: { id },
      data: {
        status: ok ? 'consumed' : 'pending',
        answer: ok ? ch.answer : null,
        consumedAt: ok ? new Date() : null,
        context: {
          ...(ch.context || {}),
          lastAgentError: error || null,
        },
      },
    });
    if (updated.jobId) {
      await this.appendJobLog(
        updated.jobId,
        ok ? 'Luca guvenlik kodu agent tarafindan uygulandi' : `Guvenlik kodu kabul edilmedi${error ? `: ${error}` : ''}`,
      ).catch(() => {});
    }
    return { ok: true, challenge: this.publicCaptchaChallenge(updated, false) };
  }

  private async expireOldCaptchaChallenges(tenantId: string) {
    await (this.prisma as any).lucaCaptchaChallenge.updateMany({
      where: {
        tenantId,
        status: 'pending',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'expired' },
    }).catch(() => {});
  }

  private publicCaptchaChallenge(ch: any, includeImage: boolean) {
    return {
      id: ch.id,
      jobId: ch.jobId,
      deviceId: ch.deviceId,
      status: ch.status,
      captchaImage: includeImage ? ch.captchaImage : undefined,
      context: ch.context || {},
      createdAt: ch.createdAt,
      expiresAt: ch.expiresAt,
      answeredAt: ch.answeredAt,
      consumedAt: ch.consumedAt,
    };
  }
}
