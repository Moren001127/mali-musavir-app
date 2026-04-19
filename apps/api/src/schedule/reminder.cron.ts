import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

/**
 * Evrak teslim hatırlatma cron'u.
 *
 * Her iş günü (Pzt-Cum) saat 09:00 TR (06:00 UTC) çalışır.
 * Kuralları:
 *   1) Mükellefin evrakTeslimGunu <= bugünün günü olmalı (vade geldi/geçti)
 *   2) whatsappEvrakTalep = true olmalı (mükellef bu tipi onaylamış)
 *   3) Bu ay için TaxpayerMonthlyStatus.evraklarGeldi = false olmalı
 *   4) Son 2 günde hatırlatma gönderilmemiş olmalı (spam koruma)
 *   5) Mükellef aktif olmalı
 *
 * Mesaj kaynağı: SmsTemplate.evrakTalepMesaji (tenant başına özel)
 * Değişkenler: {ad}, {dönem}
 */
@Injectable()
export class ReminderCron {
  private readonly logger = new Logger(ReminderCron.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsAppService,
  ) {}

  @Cron('0 6 * * 1-5')
  async sendEvrakReminderMessages() {
    const today = new Date();
    const todayDay = today.getDate();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const donem = `${this.aylarTr[month - 1]} ${year}`;

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

      // Tenant başına şablonu önbelleğe al — tek tenant için tek SQL sorgusu
      const templateCache = new Map<string, string>();
      const getTemplate = async (tenantId: string): Promise<string> => {
        if (templateCache.has(tenantId)) return templateCache.get(tenantId)!;
        const tpl = await this.prisma.smsTemplate.findUnique({ where: { tenantId } });
        const text = tpl?.evrakTalepMesaji
          || 'Sayın {ad}, {dönem} dönemi evraklarınızı tarafımıza teslim etmenizi rica ederiz.';
        templateCache.set(tenantId, text);
        return text;
      };

      let sent = 0, skippedAlreadyArrived = 0, skippedNoPhone = 0, failed = 0;

      for (const taxpayer of taxpayers) {
        // 3) Evraklar zaten geldiyse atla
        const status = await this.prisma.taxpayerMonthlyStatus.findUnique({
          where: {
            taxpayerId_year_month: { taxpayerId: taxpayer.id, year, month },
          },
        });
        if (status?.evraklarGeldi) { skippedAlreadyArrived++; continue; }

        // Telefonları topla — hem phones[] hem fallback olarak phone alanı
        const phones = (taxpayer.phones && taxpayer.phones.length > 0)
          ? taxpayer.phones.filter(Boolean)
          : (taxpayer.phone ? [taxpayer.phone] : []);
        if (phones.length === 0) { skippedNoPhone++; continue; }

        const ad = taxpayer.companyName
          || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim()
          || 'Sayın Mükellef';

        const template = await getTemplate(taxpayer.tenantId);
        const renderedMessage = template
          .replace(/\{ad\}/g, ad)
          .replace(/\{dönem\}/g, donem)
          .replace(/\{donem\}/g, donem);

        // Her telefon numarasına gönder — şablon önceliklidir (24s pencere dışı için)
        let anyDelivered = false;
        for (const phone of phones) {
          const ok = process.env.WHATSAPP_TEMPLATE_NAME
            ? await this.whatsapp.sendTemplate(phone, [ad, donem])
            : await this.whatsapp.sendMessage(phone, renderedMessage);
          if (ok) anyDelivered = true;
        }

        if (anyDelivered) {
          sent++;
          await this.prisma.taxpayer.update({
            where: { id: taxpayer.id },
            data: { lastReminderSentAt: new Date() },
          });
          // İletişim logu
          try {
            await this.prisma.communicationLog.create({
              data: {
                taxpayerId: taxpayer.id,
                channel: 'WHATSAPP',
                subject: `Evrak hatırlatma — ${donem}`,
                content: renderedMessage,
                occurredAt: new Date(),
              },
            });
          } catch (err: any) {
            this.logger.warn(`[ReminderCron] CommunicationLog yazılamadı: ${err?.message}`);
          }
        } else {
          failed++;
        }
      }

      this.logger.log(
        `[ReminderCron] ${donem} · ${taxpayers.length} aday → gönderilen: ${sent}, ` +
        `evrak zaten geldi: ${skippedAlreadyArrived}, telefon yok: ${skippedNoPhone}, başarısız: ${failed}`,
      );
    } catch (err: any) {
      this.logger.error(`[ReminderCron] Hata: ${err.message}`);
    }
  }

  private aylarTr = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
  ];
}
