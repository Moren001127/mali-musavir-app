import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

/**
 * WhatsApp servisi — whatsapp-web.js tabanlı
 * İlk çalıştırmada QR kodu üretir; telefon ile okutulduktan sonra
 * session './whatsapp-session/' klasörüne kaydedilir.
 * 
 * Railway ortamında çalışması için:
 *   - Puppeteer chromium gerekli: PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
 *   - Railway persistent disk: /app/whatsapp-session
 */
@Injectable()
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppService.name);
  private client: any = null;
  private qrCode: string | null = null;
  private isReady = false;
  private initError: string | null = null;

  async onModuleInit() {
    await this.initClient();
  }

  async onModuleDestroy() {
    if (this.client) {
      try { await this.client.destroy(); } catch { /* ignore */ }
    }
  }

  private async initClient() {
    try {
      // whatsapp-web.js dinamik import (opsiyonel bağımlılık)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Client, LocalAuth } = require('whatsapp-web.js');
      
      this.client = new Client({
        authStrategy: new LocalAuth({ dataPath: './whatsapp-session' }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        },
      });

      this.client.on('qr', (qr: string) => {
        this.qrCode = qr;
        this.isReady = false;
        this.logger.log('WhatsApp QR kodu üretildi — /api/whatsapp/qr adresinden görüntüleyin');
      });

      this.client.on('ready', () => {
        this.isReady = true;
        this.qrCode = null;
        this.logger.log('WhatsApp bağlantısı hazır');
      });

      this.client.on('disconnected', (reason: string) => {
        this.isReady = false;
        this.logger.warn(`WhatsApp bağlantısı kesildi: ${reason}`);
      });

      await this.client.initialize();
    } catch (err: any) {
      this.initError = err.message || 'WhatsApp başlatılamadı';
      this.logger.warn(`WhatsApp modülü devre dışı: ${this.initError}`);
    }
  }

  getStatus() {
    return {
      ready: this.isReady,
      hasQr: !!this.qrCode,
      error: this.initError,
    };
  }

  getQr(): string | null {
    return this.qrCode;
  }

  /**
   * Mesaj gönder — sadece hafta içi 09:00-17:00 arasında
   */
  async sendMessage(phone: string, message: string): Promise<boolean> {
    if (!this.isReady || !this.client) {
      this.logger.warn('WhatsApp hazır değil, mesaj gönderilemedi');
      return false;
    }

    // Hafta içi + saat kontrolü (Türkiye saati UTC+3)
    const now = new Date(new Date().getTime() + 3 * 60 * 60 * 1000);
    const day = now.getUTCDay(); // 0=Pazar, 6=Cumartesi
    const hour = now.getUTCHours();
    if (day === 0 || day === 6 || hour < 9 || hour >= 17) {
      this.logger.log(`Mesai saati dışı — mesaj gönderilmedi (${phone})`);
      return false;
    }

    try {
      // Türkiye telefon numarası normalizasyonu
      const normalized = this.normalizePhone(phone);
      if (!normalized) return false;

      await this.client.sendMessage(`${normalized}@c.us`, message);
      this.logger.log(`WhatsApp mesajı gönderildi: ${normalized}`);
      return true;
    } catch (err: any) {
      this.logger.error(`WhatsApp mesaj hatası: ${err.message}`);
      return false;
    }
  }

  private normalizePhone(phone: string): string | null {
    // Türkiye numarası: 05xx → 905xx
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('90') && digits.length === 12) return digits;
    if (digits.startsWith('0') && digits.length === 11) return '9' + digits;
    if (digits.length === 10) return '90' + digits;
    return null;
  }
}
