import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { KdvBeyannameService } from './kdv-beyanname.service';

/**
 * KDV Durum Panosu otomasyonu.
 * Her gün 07:30'da (Istanbul) KAPANAN dönem (önceki ay) için tüm tenant'larda
 * KDV2 (tevkifat) olan mükellefleri tespit edip bildirim üretir.
 * Bildirimler dedupeKey ile tekrarsızdır (gece tekrar koşsa da spam olmaz).
 * KDV_BEYANNAME_CRON_ENABLED=false ile kapatılabilir.
 */
@Injectable()
export class KdvBeyannameCron {
  private readonly logger = new Logger(KdvBeyannameCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly service: KdvBeyannameService,
  ) {}

  private prevIstanbulPeriod(date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date);
    let y = Number(parts.find((p) => p.type === 'year')?.value);
    let m = Number(parts.find((p) => p.type === 'month')?.value);
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    return `${y}-${String(m).padStart(2, '0')}`;
  }

  // Her gün 07:30 (Istanbul)
  @Cron('0 30 7 * * *', { timeZone: 'Europe/Istanbul' })
  async handleKdv2Bildirim() {
    if (process.env.KDV_BEYANNAME_CRON_ENABLED === 'false') return;
    const donem = this.prevIstanbulPeriod();
    let tenants: Array<{ id: string }> = [];
    try {
      tenants = await (this.prisma as any).tenant.findMany({ select: { id: true } });
    } catch (e: any) {
      this.logger.warn(`[KdvBeyannameCron] tenant listesi alınamadı: ${e?.message}`);
      return;
    }
    for (const t of tenants) {
      try {
        const res = await this.service.taraVeBildir(t.id, donem);
        if (res.kdv2Adet > 0) {
          this.logger.log(
            `[KdvBeyannameCron] ${t.id} · ${donem} · KDV2 ${res.kdv2Adet} mükellef, ${res.bildirimAdet} yeni bildirim, ${res.verilmeyenAdet} verilmemiş`,
          );
        }
      } catch (e: any) {
        this.logger.warn(`[KdvBeyannameCron] ${t.id}: ${e?.message}`);
      }
    }
  }
}
