import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KdvControlService } from './kdv-control.service';

/**
 * Her gece 02:00 (Istanbul) — sistemdeki tüm NEEDS_REVIEW / FAILED / LOW_CONFIDENCE
 * OCR görsellerini yeniden işler. Son parser fix'leri otomatik uygulanır,
 * manuel müdahale gerekmez.
 */
@Injectable()
export class KdvOcrCron {
  private readonly logger = new Logger(KdvOcrCron.name);

  constructor(private readonly kdvService: KdvControlService) {}

  @Cron('0 0 2 * * *', { timeZone: 'Europe/Istanbul' })
  async handleOcrRetry() {
    if (process.env.KDV_OCR_CRON_ENABLED === 'false') return;
    this.logger.log('Otomatik OCR yeniden tarama başlıyor...');
    try {
      const result = await this.kdvService.reocrAllPending();
      this.logger.log(`OCR yeniden tarama tamamlandı: ${result.queued} görsel işlendi, ${result.skipped} atlandı`);
    } catch (err: any) {
      this.logger.error(`OCR yeniden tarama hatası: ${err?.message}`);
    }
  }
}
