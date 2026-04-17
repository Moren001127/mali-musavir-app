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
  }) {
    return (this.prisma as any).lucaFetchJob.create({
      data: {
        tenantId: params.tenantId,
        sessionId: params.sessionId,
        mukellefId: params.mukellefId,
        donem: params.donem,
        tip: params.tip,
        status: 'pending',
        createdBy: params.createdBy || null,
      },
    });
  }

  async markJobRunning(jobId: string) {
    return (this.prisma as any).lucaFetchJob.update({
      where: { id: jobId },
      data: { status: 'running', startedAt: new Date() },
    });
  }

  async markJobDone(jobId: string, recordCount: number) {
    return (this.prisma as any).lucaFetchJob.update({
      where: { id: jobId },
      data: {
        status: 'done',
        recordCount,
        finishedAt: new Date(),
      },
    });
  }

  async markJobFailed(jobId: string, errorMsg: string) {
    return (this.prisma as any).lucaFetchJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        errorMsg: errorMsg.slice(0, 500),
        finishedAt: new Date(),
      },
    });
  }

  async listJobs(tenantId: string, limit = 20) {
    // Stale job'ları temizle: 10 dk'dan eski "running" varsa fail yap
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    await (this.prisma as any).lucaFetchJob.updateMany({
      where: {
        tenantId,
        status: 'running',
        startedAt: { lt: tenMinAgo },
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

  async getJob(jobId: string, tenantId: string) {
    const job = await (this.prisma as any).lucaFetchJob.findUnique({
      where: { id: jobId },
    });
    if (!job || job.tenantId !== tenantId) {
      throw new NotFoundException('Luca fetch job bulunamadı');
    }
    return job;
  }

  /**
   * Runner tarafından çağrılır — bekleyen job'ları listeler.
   */
  async pendingJobsForAgent(tenantId: string) {
    return (this.prisma as any).lucaFetchJob.findMany({
      where: { tenantId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });
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
}
