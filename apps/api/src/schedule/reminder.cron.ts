import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReminderCron {
  private readonly logger = new Logger(ReminderCron.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Hafta içi 09:00'da çalışır (UTC 06:00 = TR 09:00)
   * Evrak teslim günü gelmiş, evraklar geldi işaretlenmemiş mükellefleri loglar.
   * WhatsApp entegrasyonu aktif edildiğinde bu cron mesaj gönderecek.
   */
  @Cron('0 6 * * 1-5')
  async sendEvrakReminderMessages() {
    const today = new Date();
    const todayDay = today.getDate();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;

    try {
      const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);

      const taxpayers = await this.prisma.taxpayer.findMany({
        where: {
          isActive: true,
          whatsappEvrakTalep: true,
          evrakTeslimGunu: { lte: todayDay },
          OR: [
            { lastReminderSentAt: null },
            { lastReminderSentAt: { lte: twoDaysAgo } },
          ],
        },
      });

      let skipped = 0;
      for (const taxpayer of taxpayers) {
        const status = await this.prisma.taxpayerMonthlyStatus.findUnique({
          where: {
            taxpayerId_year_month: { taxpayerId: taxpayer.id, year, month },
          },
        });
        if (status?.evraklarGeldi) { skipped++; continue; }

        const ad = taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim();
        this.logger.log(`[Hatırlatma] ${ad} — WhatsApp devre dışı, mesaj gönderilemedi`);
        // WhatsApp aktif edildiğinde buraya mesaj gönderme kodu eklenecek
      }

      this.logger.log(`Cron tamamlandı: ${taxpayers.length} mükellef, ${skipped} atlandı`);
    } catch (err: any) {
      this.logger.error(`Cron hatası: ${err.message}`);
    }
  }
}
