import { Body, Controller, Headers, HttpException, HttpStatus, Logger, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppBotContextService } from './bot-context.service';

/**
 * Bot Veri API'si — DIŞ bot platformları (örn. Kapso) için salt-okunur veri ucu.
 *
 * Amaç: Kapso'daki WhatsApp AI agent'ı, mesaj atan numaranın mükellef verisine
 * (evrak/beyanname/KDV durumu, açık görevler, borç bakiyesi, son konuşmalar)
 * güvenli şekilde erişip veriye dayalı cevap üretebilsin.
 *
 * Güvenlik:
 *  - Header `X-Bot-Api-Key` ile korunur; değer `process.env.BOT_API_KEY` ile eşleşmeli.
 *  - BOT_API_KEY tanımlı değilse TÜM istekler reddedilir (güvenli varsayılan).
 *  - Yanıt yalnızca SORGULANAN TELEFONUN kendi mükellef verisini içerir; başka
 *    mükellefin verisi asla dönmez.
 */
@Controller('bot')
export class BotDataController {
  private readonly logger = new Logger(BotDataController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly botContext: WhatsAppBotContextService,
  ) {}

  private normalize(raw?: string | null): string {
    if (!raw) return '';
    let digits = String(raw).replace(/[^\d]/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) digits = '90' + digits.slice(1);
    if (digits.length === 10 && digits.startsWith('5')) digits = '90' + digits;
    return digits;
  }

  private assertAuth(key?: string): void {
    const expected = String(process.env.BOT_API_KEY || '').trim();
    if (!expected || !key || key.trim() !== expected) {
      throw new HttpException('Yetkisiz: gecersiz bot API anahtari.', HttpStatus.UNAUTHORIZED);
    }
  }

  private displayName(t: { companyName?: string | null; firstName?: string | null; lastName?: string | null }): string {
    return t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'Mukellef';
  }

  /**
   * POST /api/v1/bot/taxpayer-context
   * Header: X-Bot-Api-Key: <BOT_API_KEY>
   * Body:   { "phone": "+90 5xx ..." }  (WhatsApp gönderen numarası)
   *
   * Dönüş:
   *  { found: true, name, context }  — context: mükellefin güncel durum bloğu (markdown+JSON)
   *  { found: false }                — numara kayıtlı bir mükellefe ait değil
   */
  @Post('taxpayer-context')
  async taxpayerContext(
    @Headers('x-bot-api-key') apiKey: string,
    @Headers('x-wa-phone') waPhone: string,
    @Body() body: { phone?: string },
  ): Promise<{ found: boolean; name?: string; context?: string; reason?: string }> {
    this.assertAuth(apiKey);

    // Telefon önce güvenilir header'dan (Kapso tarafından enjekte edilen gönderen
    // numarası) okunur; yoksa body.phone'a düşülür. Header tercih edilir ki agent
    // başka bir numara sorgulayamasın (gizlilik).
    const normalized = this.normalize(waPhone) || this.normalize(body?.phone);
    if (!normalized) return { found: false, reason: 'phone parametresi gecersiz veya eksik' };

    const taxpayers = await this.prisma.taxpayer.findMany({
      where: { isActive: true },
      select: {
        id: true,
        tenantId: true,
        companyName: true,
        firstName: true,
        lastName: true,
        phone: true,
        phones: true,
      },
      take: 5000,
    });

    const match = taxpayers.find((t: any) => {
      const phones = [t.phone, ...(Array.isArray(t.phones) ? t.phones : [])].filter(Boolean);
      return phones.some((p) => this.normalize(p) === normalized);
    });

    if (!match) {
      this.logger.log(`[BotData] eslesme yok phone=${normalized.slice(0, 4)}***`);
      return { found: false };
    }

    const context = await this.botContext.buildTaxpayerContextBlock(match.tenantId, match.id);
    return { found: true, name: this.displayName(match), context };
  }
}
