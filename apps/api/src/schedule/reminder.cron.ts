import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

/**
 * Evrak teslim hatırlatma cron'u.
 *
 * Her iş günü (Pzt-Cum) saat 10:00 TR (07:00 UTC) çalışır.
 * Resmi tatillerde (Türkiye) atılmaz.
 * Kuralları:
 *   1) Mükellefin evrakTeslimGunu <= bugünün günü olmalı (vade geldi/geçti)
 *   2) whatsappEvrakTalep = true olmalı (mükellef bu tipi onaylamış)
 *   3) Bu ay için TaxpayerMonthlyStatus.evraklarGeldi = false olmalı
 *      (mükellef listesinde "evraklar geldi" işaretlenmediyse devam eder)
 *   4) Son 2 günde hatırlatma gönderilmemiş olmalı (spam koruma)
 *   5) Mükellef aktif olmalı
 *   6) Bugün Türkiye resmi tatili olmamalı
 *
 * Mesaj kaynağı: SmsTemplate.evrakTalepMesaji (tenant başına özel)
 * Değişkenler: {ad}, {dönem}
 */

// Türkiye resmi tatil günleri (2026-2028) — sabit + dini bayramlar
// Kaynak: T.C. resmi takvim. Bayram tarihleri her yıl değişir, manuel güncellenmeli.
const TURKIYE_RESMI_TATILLERI = new Set<string>([
  // 2026
  '2026-01-01', // Yılbaşı
  '2026-03-19', // Ramazan Bayramı arifesi (yarım gün - tam tatil sayıyoruz)
  '2026-03-20', // Ramazan Bayramı 1. gün
  '2026-03-21', // Ramazan Bayramı 2. gün
  '2026-03-22', // Ramazan Bayramı 3. gün
  '2026-04-23', // Ulusal Egemenlik ve Çocuk Bayramı
  '2026-05-01', // Emek ve Dayanışma Günü
  '2026-05-19', // Atatürk'ü Anma, Gençlik ve Spor Bayramı
  '2026-05-26', // Kurban Bayramı arifesi (yarım gün)
  '2026-05-27', // Kurban Bayramı 1. gün
  '2026-05-28', // Kurban Bayramı 2. gün
  '2026-05-29', // Kurban Bayramı 3. gün
  '2026-05-30', // Kurban Bayramı 4. gün
  '2026-07-15', // Demokrasi ve Milli Birlik Günü
  '2026-08-30', // Zafer Bayramı
  '2026-10-28', // Cumhuriyet Bayramı arifesi (yarım gün)
  '2026-10-29', // Cumhuriyet Bayramı
  // 2027
  '2027-01-01', // Yılbaşı
  '2027-03-09', // Ramazan Bayramı 1. gün (tahmini)
  '2027-03-10', // Ramazan Bayramı 2. gün
  '2027-03-11', // Ramazan Bayramı 3. gün
  '2027-04-23', // Çocuk Bayramı
  '2027-05-01', // İşçi Bayramı
  '2027-05-16', // Kurban Bayramı 1. gün (tahmini)
  '2027-05-17', // Kurban Bayramı 2. gün
  '2027-05-18', // Kurban Bayramı 3. gün
  '2027-05-19', // Atatürk'ü Anma + Kurban Bayramı 4. gün
  '2027-07-15', // Demokrasi Günü
  '2027-08-30', // Zafer Bayramı
  '2027-10-29', // Cumhuriyet Bayramı
]);

function bugunResmiTatilMi(date: Date): boolean {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return TURKIYE_RESMI_TATILLERI.has(`${yyyy}-${mm}-${dd}`);
}

@Injectable()
export class ReminderCron {
  private readonly logger = new Logger(ReminderCron.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsAppService,
  ) {}

  @Cron('0 7 * * 1-5')
  async sendEvrakReminderMessages() {
    const today = new Date();

    // Resmi tatil kontrolü - tatildeyse erken çık
    if (bugunResmiTatilMi(today)) {
      this.logger.log(`[ReminderCron] ${today.toISOString().slice(0, 10)} resmi tatil — hatırlatma atılmadı.`);
      return;
    }

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
            ? await this.whatsapp.sendTemplate(phone, [ad, donem], undefined, taxpayer.tenantId)
            : await this.whatsapp.sendMessage(phone, renderedMessage, taxpayer.tenantId);
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
