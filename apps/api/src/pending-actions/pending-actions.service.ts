import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type PendingActionSource =
  | 'moren_ofis'
  | 'portal_dev'
  | 'mukellef_msg'
  | 'github_merge'
  | 'migration'
  | 'mobile';

export type PendingActionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'applied'
  | 'failed';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CreatePendingActionInput {
  tenantId: string;
  source: PendingActionSource;
  sourceRef?: string;
  type: string;
  title: string;
  summary: string;
  payload: any;
  riskLevel?: RiskLevel;
  requestedByAgent?: string;
  requestedByUserId?: string;
  expiresInMinutes?: number;
}

/**
 * FAZ 2 — Merkezi onay kuyruğu servisi.
 *
 * Tüm AI ekipleri ve mükellef tarafı yazma/dışa-iletim eylemleri için
 * tek nokta. Worker (Faz 3'te eklenecek) approved kayıtları sırayla uygular.
 *
 * Uygulama (apply) mantığı BURADA TANIMLI DEĞİL — tüketici modüller (moren-ofis,
 * portal-dev) kendi worker'larında 'applyPendingAction(id)' çağırır. Bu servis
 * sadece kuyruğu yönetir.
 */
@Injectable()
export class PendingActionsService {
  private readonly logger = new Logger(PendingActionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreatePendingActionInput) {
    const expiresAt = input.expiresInMinutes
      ? new Date(Date.now() + input.expiresInMinutes * 60_000)
      : null;
    const row = await (this.prisma as any).pendingAction.create({
      data: {
        tenantId: input.tenantId,
        source: input.source,
        sourceRef: input.sourceRef,
        type: input.type,
        title: input.title,
        summary: input.summary,
        payload: input.payload,
        riskLevel: input.riskLevel || 'low',
        requestedByAgent: input.requestedByAgent,
        requestedByUserId: input.requestedByUserId,
        expiresAt,
      },
    });
    this.logger.log(
      `PendingAction created: ${row.id} source=${input.source} risk=${input.riskLevel || 'low'}`,
    );
    return row;
  }

  async list(
    tenantId: string,
    opts: { status?: PendingActionStatus; source?: PendingActionSource; limit?: number } = {},
  ) {
    return (this.prisma as any).pendingAction.findMany({
      where: {
        tenantId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.source ? { source: opts.source } : {}),
      },
      orderBy: { requestedAt: 'desc' },
      take: opts.limit || 100,
    });
  }

  async count(tenantId: string, status: PendingActionStatus = 'pending') {
    return (this.prisma as any).pendingAction.count({
      where: { tenantId, status },
    });
  }

  async getById(tenantId: string, id: string) {
    const row = await (this.prisma as any).pendingAction.findUnique({ where: { id } });
    if (!row || row.tenantId !== tenantId) {
      throw new NotFoundException('Onay kaydı bulunamadı');
    }
    return row;
  }

  async approve(tenantId: string, id: string, userId: string, note?: string) {
    const existing = await this.getById(tenantId, id);
    if (existing.status !== 'pending') {
      throw new BadRequestException(`Bu kayıt zaten ${existing.status} durumunda`);
    }
    return (this.prisma as any).pendingAction.update({
      where: { id },
      data: {
        status: 'approved',
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        reviewNote: note,
      },
    });
  }

  async reject(tenantId: string, id: string, userId: string, note?: string) {
    const existing = await this.getById(tenantId, id);
    if (existing.status !== 'pending') {
      throw new BadRequestException(`Bu kayıt zaten ${existing.status} durumunda`);
    }
    return (this.prisma as any).pendingAction.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        reviewNote: note,
      },
    });
  }

  /**
   * Approved → applied / failed geçişi. Worker bunu çağırır.
   * applyFn: gerçek uygulamayı yapan fonksiyon (örn. hatırlatma yazma, mesaj gönderme).
   */
  async markApplied(id: string, ok: boolean, errorMessage?: string) {
    return (this.prisma as any).pendingAction.update({
      where: { id },
      data: {
        status: ok ? 'applied' : 'failed',
        appliedAt: new Date(),
        errorMessage: ok ? null : errorMessage,
      },
    });
  }

  /**
   * Süresi geçen pending'leri otomatik expire et. Cron tarafından çağırılır.
   */
  async expireOldOnes(): Promise<number> {
    const now = new Date();
    const result = await (this.prisma as any).pendingAction.updateMany({
      where: {
        status: 'pending',
        expiresAt: { not: null, lte: now },
      },
      data: { status: 'expired' },
    });
    if (result.count > 0) this.logger.log(`Expired ${result.count} pending actions`);
    return result.count;
  }
}
