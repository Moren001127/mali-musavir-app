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

  // Her Pazartesi 08:00 TR (05:00 UTC) — SUNUCU (Railway) HGS sorgusu.
  // Galeri aracı + aktif GİB_IVD kimliği olan her mükellef için GALERI_HGS işi oluşturur;
  // Railway runner GİB'den araçları çekip KGM'den sorgular ve borç özetini WhatsApp'tan gönderir.
  // (Local hgs-agent ARTIK GEREKMİYOR.)
  @Cron('0 5 * * 1', { timeZone: 'Europe/Istanbul' })
  async pazartesiTopluSorgu() {
    try {
      const sonuc = await this.galeri.baslatHaftalikSunucuSorgu();
      this.logger.log(
        `[HgsCron] Pazartesi sunucu HGS — ${sonuc.olusturulan} iş oluşturuldu, ` +
          `${sonuc.atlanan} atlandı (${sonuc.aday} aday mükellef)`,
      );
    } catch (err: any) {
      this.logger.error(`[HgsCron] Genel hata: ${err?.message}`);
    }
  }
}
