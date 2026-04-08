import { Injectable, Logger } from '@nestjs/common';

/**
 * WhatsApp Stub Servisi
 * Railway ortamında whatsapp-web.js/puppeteer olmadığından bu stub kullanılır.
 * Gerçek WhatsApp entegrasyonu için ayrı bir sunucu gereklidir.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  getStatus() {
    return {
      ready: false,
      hasQr: false,
      error: 'WhatsApp bu ortamda devre dışı. Yerel kurulum için ayrı ayar gereklidir.',
    };
  }

  getQr(): string | null {
    return null;
  }

  async sendMessage(phone: string, message: string): Promise<boolean> {
    this.logger.warn(`WhatsApp devre dışı — mesaj gönderilemedi: ${phone}`);
    return false;
  }
}
