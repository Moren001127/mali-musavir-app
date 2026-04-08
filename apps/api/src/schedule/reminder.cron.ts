import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

@Injectable()
export class ReminderCron {
  private readonly logger = new Logger(ReminderCron.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsAppService,
  ) {}

  /**
   * Hafta içi 09:00'da çalışır (UTC 06:00 = TR 09:00)
   * Evrak teslim günü gelmiş, evraklar geldi işaretlenmemiş
   * ve whatsappEvrakTalep = true olan mükelleflere hatırlatma gönderir.
   */
  @Cron('0 6 * * 1-5') // UTC 06:00 = TR 09:00, Pazartesi-Cuma
  async sendEvrakReminderMessages() {
    this.logger.log('Evrak hatırlatma cron başladı');

    const today = new Date();
    const todayDay = today.getDate();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;

    try {
      // Hatırlatma gönderilecek mükellefleri bul
      const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);

      const taxpayers = await this.prisma.taxpayer.findMany({
        where: {
          isActive: true,
          whatsappEvrakTalep: true,
          evrakTeslimGunu: { lte: todayDay }, // Teslim günü geçmiş veya bugün
          OR: [
            { lastReminderSentAt: null },
            { lastReminderSentAt: { lte: twoDaysAgo } },
          ],
        },
      });

      for (const taxpayer of taxpayers) {
        // Bu ay evraklar geldi mi kontrol et
        const status = await this.prisma.taxpayerMonthlyStatus.findUnique({
          where: {
            taxpayerId_year_month: {
              taxpayerId: taxpayer.id,
              year,
              month,
            },
          },
        });

        if (status?.evraklarGeldi) continue; // Evraklar zaten gelmiş, skip

        // Şablonu çek
        const template = await this.prisma.smsTemplate.findUnique({
          where: { tenantId: taxpayer.tenantId },
        });

        const donem = `${year}/${String(month).padStart(2, '0')}`;
        const ad = taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim();
        const mesaj = (template?.evrakTalepMesaji ||
          'Sayın {ad}, {dönem} dönemi evraklarınızı tarafımıza teslim etmenizi rica ederiz. Moren Mali Müşavirlik')
          .replace('{ad}', ad)
          .replace('{dönem}', donem);

        // Telefon numaralarına gönder
        const phones = taxpayer.phones?.length
          ? taxpayer.phones
          : taxpayer.phone ? [taxpayer.phone] : [];

        let sent = false;
        for (const phone of phones.filter(Boolean)) {
          const ok = await this.whatsapp.sendMessage(phone, mesaj);
          if (ok) sent = true;
        }

        if (sent) {
          await this.prisma.taxpayer.update({
            where: { id: taxpayer.id },
            data: { lastReminderSentAt: new Date() },
          });
          this.logger.log(`Hatırlatma gönderildi: ${ad}`);
        }
      }

      this.logger.log(`Hatırlatma cron tamamlandı. İşlenen: ${taxpayers.length}`);
    } catch (err: any) {
      this.logger.error(`Cron hatası: ${err.message}`);
    }
  }
}
