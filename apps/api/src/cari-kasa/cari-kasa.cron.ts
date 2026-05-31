import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CariKasaService } from './cari-kasa.service';

/**
 * Her ayın 1. günü 00:05'te çalışır — aktif CariHizmet tanımları için
 * o ay TAHAKKUK hareketi oluşturur. Duplicate önleme: sonTahakkukAy.
 */
@Injectable()
export class CariKasaCron {
  private readonly logger = new Logger(CariKasaCron.name);
  constructor(private readonly service: CariKasaService) {}

  private currentIstanbulPeriod(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    return `${year}-${month}`;
  }

  // Her ayın 1. günü 00:05 (Istanbul)
  @Cron('0 5 0 1 * *', { timeZone: 'Europe/Istanbul' })
  async handleAylikTahakkuk() {
    const donem = this.currentIstanbulPeriod();
    this.logger.log(`[CariKasaCron] Aylık tahakkuk başlıyor · ${donem}`);
    const sonuc = await this.service.otoTahakkukUret(donem);
    this.logger.log(`[CariKasaCron] Bitti · ${JSON.stringify(sonuc)}`);
  }
}
