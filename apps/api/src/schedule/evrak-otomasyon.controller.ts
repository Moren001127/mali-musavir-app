import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OwnerOnlyGuard } from '../auth/guards/owner-only.guard';
import { ReminderCron } from './reminder.cron';
import { EvrakMesajService } from './evrak-mesaj.service';

/**
 * EVRAK OTOMASYONU — test uçları.
 *
 * Bu controller AppModule'e kayıtlı; ReminderCron oradaki provider listesinde
 * olduğu için aynı örnek kullanılır. Ayrı bir modül açıp ReminderCron'u orada
 * da provide etmek İKİNCİ bir örnek yaratırdı ve cron iki kez çalışıp aynı
 * mesajı iki kez gönderirdi.
 *
 * Owner-only: mesaj metinleri ve mükellef telefonları burada dönüyor.
 */
@Controller('evrak-otomasyon')
@UseGuards(AuthGuard('jwt'), OwnerOnlyGuard)
export class EvrakOtomasyonController {
  constructor(
    private reminder: ReminderCron,
    private evrakMesaj: EvrakMesajService,
  ) {}

  /** Otomasyonun o an ne yapacağını söyler — gönderim yapmaz */
  @Post('durum')
  durum() {
    return {
      canli: this.evrakMesaj.canliMi(),
      mesaiIcinde: this.evrakMesaj.mesaiIcindeMi(),
      aciklama: this.evrakMesaj.canliMi()
        ? 'CANLI: mesajlar mükellefe gider.'
        : 'TEST: mesajlar yalnız ofis sahibine gider, mükellefe gitmez. Açmak için MOREN_EVRAK_CANLI=1.',
    };
  }

  /**
   * Evrak talep taramasını şimdi çalıştırır.
   *
   * Proaktif şalter ve iki-gün aralığı yok sayılır ki metinler beklemeden
   * görülebilsin. Gönderim kararı yine tek kapıda: MOREN_EVRAK_CANLI=1
   * olmadıkça mükellefe değil, ofis sahibine gider.
   */
  @Post('test/talep')
  async talepTest() {
    const sonuc = await this.reminder.evrakTalepTara({
      salteriYokSay: true,
      aralikYokSay: true,
    });
    return {
      ok: true,
      canli: this.evrakMesaj.canliMi(),
      not: this.evrakMesaj.canliMi()
        ? 'DİKKAT: canlı mod açık, mesajlar mükelleflere gitti.'
        : 'Mesajlar TEST başlığıyla ofis sahibine gönderildi; mükellefe hiçbir mesaj gitmedi.',
      sonuc,
    };
  }

  /** Tek mükellef için "evrak geldi" bilgilendirme metnini test eder */
  @Post('test/geldi/:taxpayerId')
  async geldiTest(@Req() req: any, @Param('taxpayerId') taxpayerId: string) {
    const simdi = new Date();
    await this.reminder.evrakGeldiBildir(
      req.user.tenantId,
      taxpayerId,
      simdi.getFullYear(),
      simdi.getMonth() + 1,
    );
    return {
      ok: true,
      canli: this.evrakMesaj.canliMi(),
      not: this.evrakMesaj.canliMi()
        ? 'DİKKAT: canlı mod açık, mesaj mükellefe gitti.'
        : 'Varsa metin TEST başlığıyla ofis sahibine gönderildi. Mükellefin "Evrak geldi onayı" anahtarı kapalıysa hiç üretilmez.',
    };
  }
}
