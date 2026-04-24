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

  // Her ayın 1. günü 00:05 (Istanbul)
  @Cron('0 5 0 1 * *', { timeZone: 'Europe/Istanbul' })
  async handleAylikTahakkuk() {
    const now = new Date();
    const donem = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.logger.log(`[CariKasaCron] Aylık tahakkuk başlıyor · ${donem}`);
    const sonuc = await this.service.otoTahakkukUret(donem);
    this.logger.log(`[CariKasaCron] Bitti · ${JSON.stringify(sonuc)}`);
  }
}
