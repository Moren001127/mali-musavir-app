import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AkilliBildirimService, DISPATCH_KATEGORILER } from './akilli-bildirim.service';

/**
 * Akıllı Bildirim sabah dağıtımı — her gün 09:00 (Europe/Istanbul).
 * Gece otomasyonunun indirdiği belgeleri (son 26 saat) kategori bazında
 * TEK mesaj + ekler olarak mükellefe iletir. Kategori ayarı kapalıysa atlanır;
 * testMode açıkken yalnız test alıcısına gider.
 */
@Injectable()
export class AkilliBildirimCron {
  private readonly logger = new Logger(AkilliBildirimCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: AkilliBildirimService,
  ) {}

  private isEnabled(): boolean {
    const v = (process.env.AKILLI_BILDIRIM_CRON_ENABLED || 'true').toLowerCase();
    return v !== 'false' && v !== '0';
  }

  @Cron(process.env.AKILLI_BILDIRIM_CRON || '0 0 9 * * *', { timeZone: 'Europe/Istanbul' })
  async run() {
    if (!this.isEnabled()) {
      this.logger.log('Akıllı Bildirim cron kapalı (AKILLI_BILDIRIM_CRON_ENABLED=false)');
      return;
    }
    const tenants = await (this.prisma as any).tenant.findMany({ select: { id: true, name: true } });
    for (const tenant of tenants) {
      for (const kategori of DISPATCH_KATEGORILER) {
        try {
          const res = await this.svc.runKategori(tenant.id, kategori, { sinceHours: 26 });
          if ((res as any)?.count) this.logger.log(`${tenant.name} ${kategori}: ${(res as any).count} gönderim işlendi`);
        } catch (e: any) {
          this.logger.warn(`${tenant.name} ${kategori} dağıtım hatası: ${e?.message}`);
        }
      }
    }
  }
}
