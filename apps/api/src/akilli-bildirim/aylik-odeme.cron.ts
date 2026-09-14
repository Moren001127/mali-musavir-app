import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AylikOdemeService, istanbulSimdi } from './aylik-odeme.service';

/**
 * Aylık Ödeme Cetveli — otomatik gönderim tetiği. Her saat başı (Europe/Istanbul) çalışır;
 * işi yalnız ayarda seçilen GÜN + SAAT'te ve o ay daha önce koşulmamışsa yapar
 * (karar `AylikOdemeService.otomatikTetikle`). Ayar kapalıyken (varsayılan) hiçbir şey yapmaz.
 *
 *   onayGerekli = true  → sahibe WhatsApp + portal bildirimi ("cetvel hazır"), gönderim ELLE
 *   onayGerekli = false → gönderilmemişlere gönder (test modu açıksa test alıcısına)
 *
 * AYLIK_ODEME_CRON_ENABLED=false ile tümü kapatılabilir.
 */
@Injectable()
export class AylikOdemeCron {
  private readonly logger = new Logger(AylikOdemeCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly svc: AylikOdemeService,
  ) {}

  private acikMi(): boolean {
    const v = (process.env.AYLIK_ODEME_CRON_ENABLED || 'true').toLowerCase();
    return v !== 'false' && v !== '0';
  }

  @Cron('0 0 * * * *', { timeZone: 'Europe/Istanbul' })
  async saatBasi() {
    if (!this.acikMi()) return;
    const simdi = istanbulSimdi();
    const tenants = await (this.prisma as any).tenant.findMany({ select: { id: true, name: true } }).catch(() => []);
    for (const t of tenants) {
      try {
        const r = await this.svc.otomatikTetikle(t.id, simdi);
        if (r) this.logger.log(`${t.name}: ${r.month} ödeme cetveli otomatik koşusu → ${r.sonuc}${r.gonderilen != null ? ` (${r.gonderilen} gönderim)` : ''}`);
      } catch (e: any) {
        this.logger.warn(`${t.name}: ödeme cetveli otomatik koşu hatası: ${e?.message || e}`);
      }
    }
  }
}
