import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';

/**
 * Luca entegrasyonu — Mihsap deseninin Luca'ya uyarlanmış hali.
 *
 * Akış:
 *   1. Tarayıcı eklentisi (moren-agent.js) Luca sayfasında açıkken session
 *      token/cookie'sini yakalar ve `POST /luca/token` endpoint'ine gönderir.
 *   2. Portal bu oturumla Luca'ya proxy yapar — ya da kullanıcı runner
 *      ile "Luca Defteri Kebir/KDV verisini çek" dediğinde runner Luca sayfasında Excel
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
  defteriKebir191: '/api/muhasebe/defteri-kebir?hesap=191',
  defteriKebir391: '/api/muhasebe/defteri-kebir?hesap=391',
  isletmeGelir: '/api/isletme-defteri/gelir',
  isletmeGider: '/api/isletme-defteri/gider',
};

@Injectable()
export class LucaService {
  private readonly logger = new Logger(LucaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * İş tipine göre "takıldı say" üst süresi (ms). Tüm stuck / seri-kural /
   * meşgul-mükellef kararları buradan okur — TEK KAYNAK. Canlı uzun işi
   * (örn. e-arşiv GİB sorgusu tek başına 5dk olabiliyor) yanlışlıkla
   * öldürmemek için iş tipine göre cömert pencere.
   */
  private lucaJobMaxRunMs(tip?: string | null): number {
    const t = String(tip || '').toUpperCase();
    if (/^(EARSIV|EFATURA)/.test(t)) return 15 * 60 * 1000;
    if (
      /^(MIZAN|KDV_MIZAN|KDV_191|KDV_391|ISLETME_GELIR|ISLETME_GIDER|ACCOUNT_PLAN|EDEFTER_FIS_LISTESI|IHO_FETCH|MUAVIN|ISLETME|GELIR_TABLOSU|BILANCO)/.test(t)
    ) {
      return 10 * 60 * 1000;
    }
    if (t === 'INVOICE_POST') return 5 * 60 * 1000;
    return 8 * 60 * 1000;
  }

  // createFetchJob içindeki inline temizliği kiracı başına en fazla 30sn'de
  // bir çalıştırmak için (toplu zamanlama bir dakikada DB'yi boğmasın;
  // sürekli temizliği bağımsız reaper yapar).
  private lastCleanupAtByTenant = new Map<string, number>();

  private canClaimUnassignedLucaJob(deviceId?: string) {
    const id = deviceId?.trim();
    if (!id) return false;
    // Browser extension device ids are generated as DEV-*. The local Node worker
    // uses the persisted machine id (for example moren-5255e7bb). Unassigned
    // jobs must go to the local worker so visible Chrome tabs do not hijack them.
    return !/^DEV-/i.test(id);
  }

  private inferDonemTipi(donem?: string | null, explicit?: string | null) {
    const given = String(explicit || '').trim().toUpperCase();
    if (/^GECICI_Q[1-4]$/.test(given)) return given;
    if (given === 'AY' || given === 'AYLIK' || given === 'MONTH') return 'AYLIK';
    if (given === 'YILLIK' || given === 'YEAR' || given === 'ANNUAL') return 'YILLIK';

    const s = String(donem || '').trim().toUpperCase();
    const q = s.match(/(?:^|[-_/])Q([1-4])$/);
    if (q) return `GECICI_Q${q[1]}`;
    if (/-YILLIK$/.test(s) || /^\d{4}$/.test(s)) return 'YILLIK';
    if (/^\d{4}[-_/]\d{1,2}$/.test(s)) return 'AYLIK';
    return 'AYLIK';
  }

  private withDerivedDonemTipi<T extends Record<string, any> | null>(job: T): T {
    if (!job) return job;
    return {
      ...job,
      donemTipi: this.inferDonemTipi(job.donem, job.donemTipi),
    } as T;
  }

  private normalizeDefterTuru(defterTuru?: string | null, mihsapDefterTuru?: string | null) {
    const raw = `${defterTuru || ''} ${mihsapDefterTuru || ''}`.toLocaleUpperCase('tr-TR');
    if (/ISLETME|İŞLETME|DEFTER[_\s-]*BEYAN/.test(raw)) return 'ISLETME';
    if (/BILANCO|BİLANÇO|BILANÇO/.test(raw)) return 'BILANCO';
    return defterTuru || null;
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
    donemTipi?: string;
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
    // Toplu zamanlama (1000 mükellef/dakika) DB'yi boğmasın diye kiracı
    // başına en fazla 30sn'de bir; sürekli temizliği bağımsız reaper yapar.
    const lastClean = this.lastCleanupAtByTenant.get(params.tenantId) || 0;
    if (Date.now() - lastClean > 30_000) {
      this.lastCleanupAtByTenant.set(params.tenantId, Date.now());
      await this.cleanupStuckRunning(params.tenantId).catch(() => {});
    }

    const activeDuplicate = await (this.prisma as any).lucaFetchJob.findFirst({
      where: {
        tenantId: params.tenantId,
        sessionId: params.sessionId,
        mukellefId: params.mukellefId,
        donem: params.donem,
        tip: params.tip,
        status: { in: ['pending', 'running'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (activeDuplicate) {
      await this.appendJobLog(
        activeDuplicate.id,
        'Ayni Luca cekimi zaten kuyrukta; yeni kopya olusturulmadi',
      ).catch(() => {});
      return this.withDerivedDonemTipi(activeDuplicate);
    }

    // Job tipine göre default affinity (B): e-arşiv/efatura uzun süren işler,
    // headless local agent daha stabil. Aksi belirtilmedikçe local-node tercih.
    const defaultAffinity =
      /^(EARSIV|EFATURA|MIZAN|KDV_MIZAN|ACCOUNT_PLAN|IHO_FETCH|EDEFTER_FIS_LISTESI|KDV_191|KDV_391|ISLETME_GELIR|ISLETME_GIDER)/.test(params.tip || '')
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

    if (job.mukellefId) {
      const now = Date.now();
      const others = await (this.prisma as any).lucaFetchJob.findMany({
        where: {
          tenantId: job.tenantId,
          mukellefId: job.mukellefId,
          status: 'running',
          id: { not: jobId },
        },
        select: { id: true, tip: true, startedAt: true },
      });
      // Aynı mükellefte kendi iş-tipi penceresi içinde GERÇEKTEN çalışan başka
      // bir iş varsa beklet; pencereyi aşan (muhtemelen ölü) işi sayma.
      const runningSameMukellef = others.find(
        (o: any) =>
          o.startedAt &&
          now - new Date(o.startedAt).getTime() < this.lucaJobMaxRunMs(o.tip),
      );
      if (runningSameMukellef) {
        await this.appendJobLog(
          job.id,
          `Ayni mukellefte ${runningSameMukellef.tip || 'baska'} Luca isi calisiyor; bu is sirada bekliyor`,
        ).catch(() => undefined);
        return null;
      }
    }

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

  async markJobDone(jobId: string, recordCount: number, extra?: { fisNo?: string }) {
    const current = await (this.prisma as any).lucaFetchJob.findUnique({
      where: { id: jobId },
      select: { recordCount: true, tip: true, invoiceDocumentId: true },
    });
    const nextRecordCount = Number.isFinite(recordCount) && recordCount > 0
      ? recordCount
      : (current?.recordCount || 0);
    await (this.prisma as any).lucaFetchJob.updateMany({
      where: { id: jobId, status: { notIn: ['cancelled'] } },
      data: {
        status: 'done',
        recordCount: nextRecordCount,
        finishedAt: new Date(),
      },
    });

    // v1.38: INVOICE_POST -> InvoiceAccountingDocument.lucaStatus = POSTED
    if (current?.tip === 'INVOICE_POST' && current?.invoiceDocumentId) {
      try {
        await (this.prisma as any).invoiceAccountingDocument.updateMany({
          where: { id: current.invoiceDocumentId },
          data: {
            lucaStatus: 'POSTED',
            lucaPostedAt: new Date(),
            lucaErrorMessage: null,
            ...(extra?.fisNo ? { lucaFisNo: extra.fisNo } : {}),
          },
        });
      } catch (err) {
        this.logger.warn(`InvoiceAccountingDocument lucaStatus POSTED guncellenemedi: ${(err as any)?.message}`);
      }
    }

    return (this.prisma as any).lucaFetchJob.findUnique({ where: { id: jobId } });
  }

  /**
   * Stuck "running" job'ları temizler — agent kill edildiyse veya
   * crash ettiyse DB'de running kalmış job'lar olabilir. Bu method
   * 5 dk+ running'de duranları otomatik failed yapar.
   *
   * Job creation öncesi çağrılır → temiz başlangıç.
   */
  async cleanupStuckRunning(tenantId?: string) {
    const now = Date.now();
    // Aday: en kısa pencereyi (5dk) geçmiş running'ler + startedAt null.
    // Gerçek "takıldı" kararı iş-tipine göre verilir (lucaJobMaxRunMs) →
    // adayları çekip JS'te tipe göre ele. Böylece canlı uzun e-arşiv işi
    // 5dk'da yanlışlıkla öldürülmez; yalnızca kendi penceresini aşan kapanır.
    const shortestMs = 5 * 60 * 1000;
    const candidates = await (this.prisma as any).lucaFetchJob.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        status: 'running',
        OR: [
          { startedAt: { lt: new Date(now - shortestMs) } },
          { startedAt: null }, // hiç başlamamış ama running işaretli
        ],
      },
      select: { id: true, tip: true, startedAt: true },
    });
    const staleIds = candidates
      .filter(
        (j: any) =>
          !j.startedAt ||
          now - new Date(j.startedAt).getTime() >= this.lucaJobMaxRunMs(j.tip),
      )
      .map((j: any) => j.id);
    if (staleIds.length === 0) return 0;
    const result = await (this.prisma as any).lucaFetchJob.updateMany({
      where: { id: { in: staleIds }, status: 'running' },
      data: {
        status: 'failed',
        errorMsg: 'Cleanup: is-tipine gore ust sure asildi (agent crash/kill olmus olabilir)',
        finishedAt: new Date(),
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `Cleanup: ${result.count} stuck running job → failed${tenantId ? ` (tenant=${tenantId})` : ' (tum kiracilar)'}`,
      );
    }
    return result.count;
  }

  /**
   * Bağımsız temizleyici (reaper) — luca-schedule tarafından dakikada bir
   * çağrılır. Yeni iş yaratılmasa bile sistemi temiz tutar:
   *  (1) Tüm kiracılarda iş-tipi penceresini aşan takılı running'leri kapat.
   *  (2) 30+ dk hiç alınmamış pending iş için TEK görünür uyarı bildirimi —
   *      kullanıcı körlemesine beklemesin (ajan + klasik Luca ekranı açık mı?).
   *      Pending iş otomatik SİLİNMEZ (ajan o an kapalıysa kaybolmasın).
   */
  async reapStaleJobs() {
    await this.cleanupStuckRunning().catch(() => {});

    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const stalePending = await (this.prisma as any).lucaFetchJob.findMany({
      where: { status: 'pending', createdAt: { lt: cutoff } },
      select: { id: true, tenantId: true },
      take: 500,
    });
    if (!stalePending.length) return;
    const countByTenant = new Map<string, number>();
    for (const j of stalePending) {
      if (!j.tenantId) continue;
      countByTenant.set(j.tenantId, (countByTenant.get(j.tenantId) || 0) + 1);
    }
    for (const [tenantId, count] of Array.from(countByTenant.entries())) {
      await this.notifications
        .createForTenant({
          tenantId,
          type: NOTIFICATION_TYPES.LUCA_SYNC_ERROR,
          title: `Luca işi bekliyor (${count} adet, 30+ dk)`,
          body: 'Luca veri çekme işleri 30 dakikadır sırada bekliyor. Ajanın çalıştığından ve klasik Luca ekranının açık olduğundan emin olun.',
          metadata: { kind: 'stale-pending', count, link: '/panel/luca' },
          dedupeKey: `luca-stale-pending:${tenantId}`,
          dedupeWindowMin: 60,
        })
        .catch((e) => {
          this.logger.warn(`Luca stale-pending notif failed: ${(e as Error).message}`);
        });
    }
  }

  async markJobFailed(jobId: string, errorMsg: string) {
    const job = await (this.prisma as any).lucaFetchJob.findUnique({ where: { id: jobId } });
    if (job?.status === 'cancelled') return job;
    const retryableLucaRuntimeError =
      /Firma\s+DE[ĞG][Iİ]S[ŞS]MED[Iİ]|firma degisimi|frm4\/SirketCombo|firma frame|classic frame|giris\.do bos|giris\.do bo[sş]|TRANSIENT_LUCA/i.test(errorMsg || '');
    if (job && retryableLucaRuntimeError && Number(job.retryCount || 0) < 3) {
      const nextRetryCount = Number(job.retryCount || 0) + 1;
      const retryDelayMs = Math.min(5 * 60 * 1000, 30 * 1000 * nextRetryCount);
      const reason = `TRANSIENT_LUCA_FIRMA_OR_FRAME_STUCK_RESET: ${String(errorMsg || '').slice(0, 500)}`;
      await this.appendJobLog(jobId, `Teknik Luca kilidi algilandi; browser oturumu sifirlanip is otomatik tekrar denenecek (${nextRetryCount}/3): ${reason}`);
      await (this.prisma as any).lucaFetchJob.updateMany({
        where: { id: jobId, status: { notIn: ['done', 'cancelled'] } },
        data: {
          status: 'pending',
          startedAt: null,
          finishedAt: null,
          retryCount: nextRetryCount,
          nextRetryAt: new Date(Date.now() + retryDelayMs),
          targetDeviceId: null,
          preferredAgent: 'local-node',
        },
      });
      return (this.prisma as any).lucaFetchJob.findUnique({ where: { id: jobId } });
    }
    await this.appendJobLog(jobId, `X ${errorMsg}`);
    await (this.prisma as any).lucaFetchJob.updateMany({
      where: { id: jobId, status: { notIn: ['cancelled'] } },
      data: { status: 'failed', finishedAt: new Date() },
    });

    if (job?.sessionId && ['KDV_191', 'KDV_391', 'ISLETME_GELIR', 'ISLETME_GIDER'].includes(job.tip)) {
      await this.prisma.kdvControlSession.updateMany({
        where: { id: job.sessionId, tenantId: job.tenantId, status: 'PROCESSING' },
        data: { status: 'REVIEWING' },
      }).catch(() => undefined);
    }

    // === IN-APP BILDIRIM: Luca aktarim hatasi ===
    if (job?.tenantId) {
      // Mukellef adi
      let mukellefLabel = '';
      if (job.mukellefId) {
        const tp = await (this.prisma as any).taxpayer.findFirst({
          where: { id: job.mukellefId, tenantId: job.tenantId },
          select: { companyName: true, firstName: true, lastName: true },
        }).catch(() => null);
        if (tp) {
          mukellefLabel = tp.companyName || [tp.firstName, tp.lastName].filter(Boolean).join(' ') || '';
        }
      }
      const titleSuffix = mukellefLabel ? ` (${mukellefLabel})` : '';
      await this.notifications.createForTenant({
        tenantId: job.tenantId,
        type: NOTIFICATION_TYPES.LUCA_SYNC_ERROR,
        title: `⚠️ Luca aktarım hatası: ${job.tip || 'job'}${titleSuffix}`,
        body: `${errorMsg.slice(0, 400)}`,
        metadata: {
          jobId,
          jobTip: job.tip,
          mukellefId: job.mukellefId || null,
          mukellefLabel: mukellefLabel || null,
          sessionId: job.sessionId || null,
          donem: job.donem || null,
          link: '/panel/luca',
        },
        dedupeKey: `luca-fail:${job.tip}:${job.mukellefId || 'all'}:${job.donem || 'na'}`,
        dedupeWindowMin: 60 * 4, // 4 saat
      }).catch((e) => {
        this.logger.warn(`LUCA_SYNC_ERROR notif failed: ${(e as Error).message}`);
      });
    }

    // v1.38: INVOICE_POST -> InvoiceAccountingDocument.lucaStatus = FAILED
    if (job?.tip === 'INVOICE_POST' && job?.invoiceDocumentId) {
      try {
        await (this.prisma as any).invoiceAccountingDocument.updateMany({
          where: { id: job.invoiceDocumentId },
          data: {
            lucaStatus: 'FAILED',
            lucaErrorMessage: String(errorMsg || '').slice(0, 1000),
          },
        });
      } catch (err) {
        this.logger.warn(`InvoiceAccountingDocument lucaStatus FAILED guncellenemedi: ${(err as any)?.message}`);
      }
    }

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

  async listJobs(tenantId: string, opts: number | { limit?: number; status?: string; tip?: string } = 20) {
    const normalizedOpts = typeof opts === 'number' ? { limit: opts } : (opts || {});
    const limit = Math.min(Math.max(Number(normalizedOpts.limit || 20), 1), 100);
    const requestedStatus = String(normalizedOpts.status || '').trim().toLowerCase();
    const requestedTips = String(normalizedOpts.tip || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    // Stale job temizliği: iş-tipine göre üst süreyi aşan running'leri kapat
    // (eşikler tek kaynak — lucaJobMaxRunMs; eski sabit 20dk kaldırıldı).
    await this.cleanupStuckRunning(tenantId).catch(() => {});

    const where: any = { tenantId };
    if (requestedStatus) {
      where.status =
        requestedStatus === 'active'
          ? { in: ['pending', 'running'] }
          : { in: requestedStatus.split(',').map((s) => s.trim()).filter(Boolean) };
    }
    if (requestedTips.length > 0) {
      where.tip = { in: requestedTips };
    }

    const jobs = await (this.prisma as any).lucaFetchJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return jobs.map((job: any) => this.withDerivedDonemTipi(job));
  }

  async listJobsForAgent(tenantId: string, opts: { deviceId?: string; limit?: number; status?: string } = {}) {
    const deviceId = opts.deviceId?.trim();
    const limit = Math.min(Math.max(Number(opts.limit || 20), 1), 50);
    const requestedStatus = String(opts.status || '').trim().toLowerCase();
    await this.cleanupStuckRunning(tenantId).catch(() => {});
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
    const jobs = await (this.prisma as any).lucaFetchJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return jobs.map((job: any) => this.withDerivedDonemTipi(job));
  }

  async getJob(jobId: string, tenantId: string) {
    const job = await (this.prisma as any).lucaFetchJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.tenantId !== tenantId) {
      throw new NotFoundException('Luca fetch job bulunamadı');
    }
    return this.withDerivedDonemTipi(job);
  }

  async requeueJobForAgent(jobId: string, tenantId: string, reason?: string) {
    const job = await (this.prisma as any).lucaFetchJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.tenantId !== tenantId) {
      throw new NotFoundException('Luca fetch job bulunamadı');
    }
    const recoveryReason = String(reason || '');
    const isTechnicalRecovery =
      /TRANSIENT_LUCA|runtime toparlanamadi|classic frame|firma frame|browser oturumu/i.test(recoveryReason);
    if (job.status === 'done' || (job.status === 'cancelled' && !isTechnicalRecovery)) {
      return this.withDerivedDonemTipi(job);
    }
    const line = reason
      ? `Teknik kilit temizlendi; iş tekrar sıraya alındı: ${reason}`
      : 'Teknik kilit temizlendi; iş tekrar sıraya alındı';
    await this.appendJobLog(jobId, line);
    const refreshed = await (this.prisma as any).lucaFetchJob.findUnique({
      where: { id: jobId },
    });
    const sanitizedLog = String(refreshed?.errorMsg || '')
      .split('\n')
      .filter((logLine) => !/TRANSIENT_LUCA/i.test(logLine))
      .filter((logLine) => !/Iptal edildi: kullanici durdurdu/i.test(logLine))
      .slice(-20)
      .join('\n')
      .slice(-2000);
    const nextRetryCount = isTechnicalRecovery ? Number(job.retryCount || 0) + 1 : 0;
    const shouldFailTransient = isTechnicalRecovery && nextRetryCount >= 3;
    const retryDelayMs = isTechnicalRecovery
      ? Math.min(5 * 60 * 1000, 30 * 1000 * nextRetryCount)
      : 0;
    const updated = await (this.prisma as any).lucaFetchJob.update({
      where: { id: jobId },
      data: shouldFailTransient
        ? {
            status: 'failed',
            startedAt: null,
            finishedAt: new Date(),
            retryCount: nextRetryCount,
            nextRetryAt: null,
            errorMsg: `${sanitizedLog ? `${sanitizedLog}\n` : ''}[AUTO] Luca klasik ekran 3 kez toparlanamadı; diğer işler bloklanmasın diye kapatıldı`.slice(-2000),
          }
        : {
            status: 'pending',
            startedAt: null,
            finishedAt: null,
            retryCount: nextRetryCount,
            nextRetryAt: retryDelayMs ? new Date(Date.now() + retryDelayMs) : null,
            errorMsg: sanitizedLog || null,
          },
    });
    return this.withDerivedDonemTipi(updated);
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
    // running kalır, sonsuza kadar o mükellefi bloke eder. Bir running iş
    // SADECE kendi iş-tipi penceresi (lucaJobMaxRunMs) içinde "meşgul" sayılır;
    // pencereyi aşan iş zaten reaper ile kapatılacak, mükellefi bloke etmesin.
    const nowMs = Date.now();
    const runningJobs = await (this.prisma as any).lucaFetchJob.findMany({
      where: {
        tenantId,
        status: 'running',
      },
      select: { mukellefId: true, tip: true, startedAt: true },
    });
    const busyMukellefIds = Array.from(
      new Set(
        runningJobs
          .filter(
            (j: any) =>
              j.startedAt &&
              nowMs - new Date(j.startedAt).getTime() < this.lucaJobMaxRunMs(j.tip),
          )
          .map((j: any) => j.mukellefId)
          .filter(Boolean),
      ),
    );

    const jobs = await (this.prisma as any).lucaFetchJob.findMany({
      where: {
        tenantId,
        status: 'pending',
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: new Date() } },
        ],
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
            defterTuru: true,
            mihsapDefterTuru: true,
          },
        });
        const defterTuru = this.normalizeDefterTuru(tp?.defterTuru, tp?.mihsapDefterTuru);
        return {
          ...job,
          donemTipi: this.inferDonemTipi(job.donem, job.donemTipi),
          // Agent'a flat olarak göndermek için kök seviyede expose et
          lucaSlug: tp?.lucaSlug || null,
          taxNumber: tp?.taxNumber || null,
          defterTuru,
          mihsapDefterTuru: tp?.mihsapDefterTuru || null,
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
      devices: (statuses || []).map((s: any) => {
        const lastPingMs = s?.lastPing ? new Date(s.lastPing).getTime() : 0;
        const ageSec = lastPingMs ? Math.round((Date.now() - lastPingMs) / 1000) : null;
        const fresh = typeof ageSec === 'number' && ageSec <= 120;
        return {
          id: s?.meta?.deviceId || s?.deviceId || null,
          running: !!s.running && fresh,
          stale: !fresh,
          ageSec,
          lastPing: s.lastPing,
          url: s?.meta?.url || null,
          version: s?.meta?.version || null,
        };
      }),
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
    const challenge = await this.tryAutoSolveCaptchaChallenge(tenantId, created).catch(async (e) => {
      this.logger.warn(`Luca CAPTCHA OCR denenemedi: ${e?.message || e}`);
      await (this.prisma as any).lucaCaptchaChallenge.update({
        where: { id: created.id },
        data: {
          context: {
            ...(created.context || {}),
            autoOcr: {
              attempted: true,
              autoSubmitted: false,
              error: e?.message || String(e),
              at: new Date().toISOString(),
            },
          },
        },
      }).catch(() => null);
      return created;
    });
    if (body.jobId && challenge.status === 'pending') {
      await this.appendJobLog(body.jobId, 'Luca guvenlik kodu bekleniyor; kod portalda gosterildi').catch(() => {});
    }
    return { ok: true, challenge: this.publicCaptchaChallenge(challenge, challenge.status === 'pending') };
  }

  private async tryAutoSolveCaptchaChallenge(tenantId: string, challenge: any) {
    if (String(process.env.LUCA_CAPTCHA_AUTO_OCR || 'true').toLowerCase() === 'false') {
      return challenge;
    }

    if (!challenge.jobId) return challenge;

    const priorAutoAttempts = await (this.prisma as any).lucaCaptchaChallenge.count({
      where: {
        tenantId,
        jobId: challenge.jobId,
        id: { not: challenge.id },
        answeredBy: { in: ['auto-ocr', 'auto-2captcha'] },
        createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) },
      },
    }).catch(() => 0);
    if (priorAutoAttempts >= Number(process.env.LUCA_CAPTCHA_OCR_MAX_ATTEMPTS || 3)) {
      return (this.prisma as any).lucaCaptchaChallenge.update({
        where: { id: challenge.id },
        data: {
          context: {
            ...(challenge.context || {}),
            autoOcr: {
              attempted: false,
              autoSubmitted: false,
              skippedReason: 'Bu is icin otomatik deneme limiti doldu',
              at: new Date().toISOString(),
            },
          },
        },
      });
    }

    const ocr = await this.readCaptchaWithOcr(challenge.captchaImage);
    const minConfidence = Math.max(0, Math.min(100, Number(process.env.LUCA_CAPTCHA_OCR_MIN_CONFIDENCE || 70)));
    const minLength = Math.max(3, Number(process.env.LUCA_CAPTCHA_OCR_MIN_LENGTH || 4));
    const maxLength = Math.max(minLength, Number(process.env.LUCA_CAPTCHA_OCR_MAX_LENGTH || 8));
    const accepted =
      !!ocr.text
      && ocr.confidence >= minConfidence
      && ocr.text.length >= minLength
      && ocr.text.length <= maxLength;

    const context: any = {
      ...(challenge.context || {}),
      autoOcr: {
        attempted: true,
        autoSubmitted: accepted,
        text: ocr.text || null,
        confidence: ocr.confidence,
        rawText: ocr.rawText || null,
        minConfidence,
        at: new Date().toISOString(),
      },
    };

    if (accepted) {
      const updated = await (this.prisma as any).lucaCaptchaChallenge.update({
        where: { id: challenge.id },
        data: {
          status: 'answered',
          answer: ocr.text,
          answeredBy: 'auto-ocr',
          answeredAt: new Date(),
          context,
        },
      });
      if (challenge.jobId) {
        await this.appendJobLog(
          challenge.jobId,
          `Luca guvenlik kodu OCR ile otomatik okundu (guven=${Math.round(ocr.confidence)}); agent'a gonderildi`,
        ).catch(() => {});
      }
      return updated;
    }

    // Tesseract düşük güvenle okudu — 2captcha fallback'a düş
    const twoCaptchaKey = process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY;
    if (twoCaptchaKey) {
      if (challenge.jobId) {
        await this.appendJobLog(
          challenge.jobId,
          `Luca guvenlik kodu OCR yetersiz (guven=${Math.round(ocr.confidence)}, okunan="${ocr.text || '-'}"); 2captcha'ya gonderiliyor`,
        ).catch(() => {});
      }
      try {
        const twoResult = await this.solveCaptchaWith2Captcha(challenge.captchaImage, twoCaptchaKey);
        const cleanText = String(twoResult.text || '').replace(/[^0-9A-Za-z]/g, '');
        const twoOk = cleanText.length >= minLength && cleanText.length <= maxLength;

        context.twoCaptcha = {
          attempted: true,
          autoSubmitted: twoOk,
          text: cleanText || null,
          rawText: twoResult.text || null,
          id: twoResult.id || null,
          at: new Date().toISOString(),
        };

        if (twoOk) {
          const updated = await (this.prisma as any).lucaCaptchaChallenge.update({
            where: { id: challenge.id },
            data: {
              status: 'answered',
              answer: cleanText,
              answeredBy: 'auto-2captcha',
              answeredAt: new Date(),
              context,
            },
          });
          if (challenge.jobId) {
            await this.appendJobLog(
              challenge.jobId,
              `Luca guvenlik kodu 2captcha ile cozuldu ("${cleanText}"); agent'a gonderildi`,
            ).catch(() => {});
          }
          return updated;
        }

        // 2captcha cevap verdi ama format uymadı
        if (challenge.jobId) {
          await this.appendJobLog(
            challenge.jobId,
            `Luca guvenlik kodu 2captcha cevabi format disinda ("${twoResult.text || '-'}"); portalda manuel bekliyor`,
          ).catch(() => {});
        }
      } catch (err: any) {
        context.twoCaptcha = {
          attempted: true,
          autoSubmitted: false,
          error: err?.message || String(err),
          at: new Date().toISOString(),
        };
        if (challenge.jobId) {
          await this.appendJobLog(
            challenge.jobId,
            `Luca guvenlik kodu 2captcha hatasi: ${err?.message || err}; portalda manuel bekliyor`,
          ).catch(() => {});
        }
        this.logger.warn(`Luca 2captcha hatasi: ${err?.message || err}`);
      }
    } else if (challenge.jobId) {
      await this.appendJobLog(
        challenge.jobId,
        `Luca guvenlik kodu OCR ile guvenli okunamadi (guven=${Math.round(ocr.confidence)}, okunan="${ocr.text || '-'}"); portalda manuel bekliyor`,
      ).catch(() => {});
    }

    const updated = await (this.prisma as any).lucaCaptchaChallenge.update({
      where: { id: challenge.id },
      data: { context },
    });

    return updated;
  }

  /**
   * 2captcha API ile base64 image captcha çözer.
   * https://2captcha.com/2captcha-api
   *
   * 1) POST in.php → captcha id döner
   * 2) GET res.php → 5sn aralıkla poll edilir, çözüm gelene kadar
   */
  private async solveCaptchaWith2Captcha(
    dataUrl: string,
    apiKey: string,
  ): Promise<{ text: string; id: string | null }> {
    const match = String(dataUrl || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!match) throw new Error('captchaImage data:image formatinda degil');
    const base64 = match[1];

    // 1. captcha gönder
    const inForm = new URLSearchParams();
    inForm.append('key', apiKey);
    inForm.append('method', 'base64');
    inForm.append('body', base64);
    inForm.append('json', '0');

    const inRes = await fetch('https://2captcha.com/in.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: inForm.toString(),
    });
    const inText = (await inRes.text()).trim();
    if (!inText.startsWith('OK|')) {
      throw new Error(`2captcha in.php: ${inText}`);
    }
    const captchaId = inText.slice(3);

    // 2. poll res.php
    const maxAttempts = Number(process.env.LUCA_2CAPTCHA_MAX_POLL || 30); // ~ 2.5 dk
    const pollInterval = Number(process.env.LUCA_2CAPTCHA_POLL_INTERVAL_MS || 5000);
    // ilk istek için 5sn bekle (2captcha öneriyor)
    await new Promise((r) => setTimeout(r, pollInterval));

    for (let i = 0; i < maxAttempts; i++) {
      const resUrl = `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&id=${encodeURIComponent(captchaId)}&json=0`;
      const r = await fetch(resUrl);
      const t = (await r.text()).trim();
      if (t === 'CAPCHA_NOT_READY') {
        await new Promise((r) => setTimeout(r, pollInterval));
        continue;
      }
      if (t.startsWith('OK|')) {
        return { text: t.slice(3), id: captchaId };
      }
      throw new Error(`2captcha res.php: ${t}`);
    }
    throw new Error(`2captcha zaman asimi (${maxAttempts} deneme)`);
  }

  private async readCaptchaWithOcr(dataUrl: string): Promise<{ text: string; rawText: string; confidence: number }> {
    const match = String(dataUrl || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!match) return { text: '', rawText: '', confidence: 0 };

    const rawBuffer = Buffer.from(match[1], 'base64');
    let imageBuffer = rawBuffer;
    try {
      const sharpMod = await import('sharp');
      const sharp = (sharpMod as any).default || sharpMod;
      imageBuffer = await sharp(rawBuffer)
        .resize({ width: 360, withoutEnlargement: false })
        .grayscale()
        .normalize()
        .threshold(155)
        .png()
        .toBuffer();
    } catch {
      imageBuffer = rawBuffer;
    }

    const tesseract = await import('tesseract.js') as any;
    const workerOptions: any = { logger: () => undefined };
    const langPath = process.env.TESSDATA_PREFIX || '/app/tessdata';
    if (existsSync(join(langPath, 'eng.traineddata'))) {
      workerOptions.langPath = langPath;
    }
    const worker = await tesseract.createWorker('eng', tesseract.OEM?.LSTM_ONLY, workerOptions);
    try {
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
        tessedit_pageseg_mode: String(tesseract.PSM?.SINGLE_WORD || 8),
      });
      const result = await worker.recognize(imageBuffer);
      const rawText = String(result?.data?.text || '').trim();
      const text = rawText.replace(/[^0-9A-Za-z]/g, '').trim();
      const confidence = Number(result?.data?.confidence || 0);
      return { text, rawText, confidence: Number.isFinite(confidence) ? confidence : 0 };
    } finally {
      await worker.terminate().catch(() => undefined);
    }
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
