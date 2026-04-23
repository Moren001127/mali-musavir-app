import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GaleriService } from '../galeri/galeri.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * HGS İhlal Sorgulama — otomatik tetikleyici.
 *
 * Her Pazartesi 08:00 TR (05:00 UTC) — tüm aktif tenant'lar için
 * AgentCommand tablosuna "hgs"/"toplu-sorgu" komutu yazar.
 * Local hgs-agent komutları claim edip KGM sitesinden sorgu yapar ve
 * sonuçları portala geri yazar.
 *
 * Kullanıcı manuel de tetikleyebilir: Galeri > HGS İhlal sayfasında
 * "🔄 Toplu Sorgu Başlat" butonu — aynı endpoint'i (baslatTopluSorgu)
 * çağırır.
 */
@Injectable()
export class HgsCron {
  private readonly logger = new Logger(HgsCron.name);

  constructor(
    private prisma: PrismaService,
    private galeri: GaleriService,
  ) {}

  // Her Pazartesi 08:00 TR (UTC+3 → 05:00 UTC)
  @Cron('0 5 * * 1')
  async pazartesiTopluSorgu() {
    try {
      // Tüm tenant'ları al (aktif kullanıcısı olanlar)
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true, name: true },
      });

      let basariliTenant = 0;
      let atlananTenant = 0;
      let toplamArac = 0;

      for (const t of tenants) {
        try {
          const result = await this.galeri.baslatTopluSorgu(t.id, null, {
            sadeceAktif: true,
          });
          if (result.ok) {
            basariliTenant++;
            toplamArac += result.aracSayisi || 0;
            this.logger.log(
              `[HgsCron] ${t.name}: ${result.aracSayisi} plaka için komut oluşturuldu (${result.komutId})`,
            );
          } else {
            atlananTenant++;
            this.logger.log(`[HgsCron] ${t.name}: atlandı — ${result.sebep}`);
          }
        } catch (err: any) {
          this.logger.warn(`[HgsCron] ${t.name} için hata: ${err?.message}`);
        }
      }

      this.logger.log(
        `[HgsCron] Pazartesi toplu sorgu — ${tenants.length} tenant, ` +
          `${basariliTenant} başarılı, ${atlananTenant} atlandı, ${toplamArac} plaka`,
      );
    } catch (err: any) {
      this.logger.error(`[HgsCron] Genel hata: ${err?.message}`);
    }
  }
}
