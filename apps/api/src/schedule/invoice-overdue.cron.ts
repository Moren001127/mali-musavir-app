import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-types';

/**
 * Vadesi gecmis fatura cron'u — INVOICE_OVERDUE bildirimi.
 *
 * EarsivFatura modelinde "vadeTarihi" alani yok; bu yuzden "vadesi gecmis"i
 * 60 gunden eski + henuz muhasebelesmemiş (mihsapUploadStatus != 'uploaded')
 * SATIS faturalari olarak yorumluyoruz.
 *
 * Her sabah 07:30 Europe/Istanbul calisir, tenant geneline 1 ozet bildirim atar.
 * Dedupe: tenant + day -> ayni gun ikinci kez atilmaz.
 *
 * Kapatmak icin: INVOICE_OVERDUE_CRON_ENABLED=false
 */
@Injectable()
export class InvoiceOverdueCron {
  private readonly logger = new Logger(InvoiceOverdueCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 30 7 * * *', { timeZone: 'Europe/Istanbul' })
  async run() {
    if (!this.isEnabled()) return;
    try {
      const tenants = await (this.prisma as any).tenant.findMany({ select: { id: true } });
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      let total = 0;
      for (const tenant of tenants) {
        try {
          const sent = await this.runForTenant(tenant.id, sixtyDaysAgo);
          total += sent;
        } catch (e: any) {
          this.logger.warn(`tenant=${tenant.id} hata: ${e?.message}`);
        }
      }
      this.logger.log(`[InvoiceOverdueCron] Tamam: ${total} bildirim`);
    } catch (e: any) {
      this.logger.error(`Genel hata: ${e?.message}`);
    }
  }

  private async runForTenant(tenantId: string, threshold: Date): Promise<number> {
    const count = await (this.prisma as any).earsivFatura.count({
      where: {
        tenantId,
        tip: 'ALIS', // Sadece alis faturalari — odenmesi gereken
        faturaTarihi: { lt: threshold },
        OR: [
          { mihsapUploadStatus: null },
          { mihsapUploadStatus: { not: 'uploaded' } },
        ],
      },
    }).catch(() => 0);
    if (!count) return 0;

    const todayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    await this.notifications.createForTenant({
      tenantId,
      type: NOTIFICATION_TYPES.INVOICE_OVERDUE,
      title: `📋 ${count} alış faturası 60+ gündür muhasebeleşmedi`,
      body: `Vadesi geçmiş veya işlenmemiş ${count} alış faturası var. Faturalar sayfasından inceleyin.`,
      metadata: {
        count,
        threshold: threshold.toISOString(),
        link: '/panel/faturalar?filter=overdue',
      },
      dedupeKey: `invoice-overdue:${tenantId}:${todayKey}`,
      dedupeWindowMin: 60 * 20,
    }).catch((e) => {
      this.logger.warn(`INVOICE_OVERDUE notif failed: ${(e as Error).message}`);
    });
    return 1;
  }

  private isEnabled(): boolean {
    const raw = process.env.INVOICE_OVERDUE_CRON_ENABLED;
    if (raw == null) return true;
    return ['1', 'true', 'yes', 'on', 'evet'].includes(String(raw).trim().toLowerCase());
  }
}
