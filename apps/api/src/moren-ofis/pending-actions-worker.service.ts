import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { PendingActionsService } from '../pending-actions/pending-actions.service';

/**
 * FAZ 5 — Approved PendingAction → gerçek Task uygulayıcı worker.
 *
 * Her 30 saniyede bir `moren_ofis` kaynaklı approved kayıtları tarar,
 * türüne göre gerçek DB yazımını yapar, sonra `markApplied`. Hata olursa
 * `markApplied(false, errorMessage)` ile loglar.
 *
 * Worker burada (moren-ofis modülünde) — çünkü create_reminder gibi
 * tipler bu ekibin domain'i. Portal Dev'in approved'ları için ayrı worker
 * (gelecek) PortalDev modülünde olacak.
 *
 * Şu anki desteklenen tipler:
 *  - moren_ofis / create_reminder → Task aç
 */
@Injectable()
export class MorenOfisPendingActionsWorker {
  private readonly logger = new Logger(MorenOfisPendingActionsWorker.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pending: PendingActionsService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // Önce süresi dolanları temizle
      await this.pending.expireOldOnes();

      // Approved + moren_ofis olanları al
      const approved = await (this.prisma as any).pendingAction.findMany({
        where: { status: 'approved', source: 'moren_ofis' },
        take: 20,
      });
      for (const action of approved) {
        await this.apply(action);
      }
    } catch (e: any) {
      this.logger.error(`Worker tick hata: ${e?.message}`);
    } finally {
      this.running = false;
    }
  }

  private async apply(action: any) {
    try {
      if (action.type === 'create_reminder') {
        await this.applyCreateReminder(action);
      } else {
        await this.pending.markApplied(action.id, false, `Bilinmeyen tip: ${action.type}`);
        return;
      }
      await this.pending.markApplied(action.id, true);
      this.logger.log(`Applied ${action.type} (${action.id})`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      this.logger.error(`Apply ${action.id} hata: ${msg}`);
      await this.pending.markApplied(action.id, false, msg);
    }
  }

  private async applyCreateReminder(action: any) {
    const payload = action.payload || {};
    const userId = action.reviewedByUserId || action.requestedByUserId;
    if (!userId) throw new Error('Onaylayan kullanıcı yok');

    // Task aç — kategoriler: AI önerisi olduğunu işaretle (tags)
    const due = payload.dueDate ? new Date(payload.dueDate) : null;
    await (this.prisma as any).task.create({
      data: {
        tenantId: action.tenantId,
        title: payload.proposedTitle || action.title,
        description: payload.proposedContent || action.summary,
        category: 'AI_REMINDER',
        priority: 'MEDIUM',
        tags: ['ai-moren-ofis', payload.agent || 'unknown'],
        createdById: userId,
        dueDate: due && !isNaN(due.getTime()) ? due : null,
        allDay: true,
        notifyInApp: true,
      },
    });
  }
}
