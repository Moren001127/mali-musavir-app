import { Controller, Headers, Param, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTenantFromAgentToken } from '../common/agent-token';
import { ReminderCron } from './reminder.cron';
import { EvrakMesajService } from './evrak-mesaj.service';

/**
 * EVRAK OTOMASYONU — ÖNİZLEME uçları.
 *
 * Kullanıcı talebi: "mükellefe gitmeden önce şablonlar ile test mesajlarını
 * bana gönder." Bu uçlar o iş için var; başka bir işlevi yok.
 *
 * İKİ TASARIM KARARI:
 *
 * 1) X-Agent-Token ile korunuyor, JWT ile değil. Uçları yerel ajan
 *    üzerinden tetikleyebilmek gerekiyor; tarayıcıdan oturum açıp token
 *    taşımak bu iş için gereksiz bir yol.
 *
 * 2) Her çağrı `onizleme: true` gönderir; bu, EvrakMesajService içinde
 *    `zorlaTest` olarak canlı şalterinin ÜSTÜNDE çalışır. Yani ileride
 *    MOREN_EVRAK_CANLI=1 açılsa bile BU UÇLAR mükellefe mesaj gönderemez —
 *    metin yalnız MOREN_OWNER_WHATSAPP_PHONES numaralarına gider.
 *    Önizleme ucunun zamanla gönderim yetkisi kazanmaması için şart.
 *
 * Controller AppModule'e kayıtlı: ReminderCron oradaki provider listesinde.
 * Ayrı modül açıp orada da provide etmek İKİNCİ bir örnek yaratır, cron iki
 * kez çalışır ve aynı mesaj mükellefe iki kez giderdi.
 */
@Controller('evrak-otomasyon')
export class EvrakOtomasyonController {
  constructor(
    private prisma: PrismaService,
    private reminder: ReminderCron,
    private evrakMesaj: EvrakMesajService,
  ) {}

  private tenant(token?: string) {
    return resolveTenantFromAgentToken(token, this.prisma as any);
  }

  private not() {
    return 'Metin yalnız ofis sahibine gitti. Bu uçtan mükellefe mesaj GİDEMEZ.';
  }

  /** Otomasyon o an ne yapardı — gönderim yapmaz */
  @Post('durum')
  async durum(@Headers('x-agent-token') token: string) {
    const tenantId = await this.tenant(token);
    return {
      canliGonderim: this.evrakMesaj.canliMi(),
      mesaiIcinde: this.evrakMesaj.mesaiIcindeMi(),
      proaktifSalter: process.env.MOREN_CLIENT_PROACTIVE_REMINDERS === '1',
      testNumarasiTanimli: !!(
        process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE
      ),
      aciklama: this.evrakMesaj.canliMi()
        ? 'Zamanlı gönderim CANLI: cron mükelleflere mesaj atar.'
        : 'Zamanlı gönderim TEST: mesajlar yalnız ofis sahibine gider. Açmak için MOREN_EVRAK_CANLI=1.',
      kapsam: await this.kapsam(tenantId),
    };
  }

  /**
   * KAPSAM — otomasyon kaç mükellefi kapsıyor.
   *
   * Tarama yalnız o an şartı tutanı sayar; "hiç kimseye gitmedi" ile
   * "kimsede ayar açık değil" aynı görünüyordu. Bu sayılar ikisini ayırır.
   */
  private async kapsam(tenantId: string) {
    // Sayılar da Aylık Takip Listesi kümesi üzerinden; aksi hâlde "75 aktif"
    // deyip listede 65 kişi görünüyordu ve sayılar tutmuyordu.
    const simdi = new Date();
    const ilkGun = new Date(simdi.getFullYear(), simdi.getMonth(), 1);
    const sonGun = new Date(simdi.getFullYear(), simdi.getMonth() + 1, 0, 23, 59, 59);
    const takipte = [
      { OR: [{ startDate: null }, { startDate: { lte: sonGun } }] },
      { OR: [{ endDate: null }, { endDate: { gte: ilkGun } }] },
      { NOT: { taxNumber: { startsWith: 'WHATSAPP-' } } },
    ];
    const t = (where: any) =>
      this.prisma.taxpayer.count({ where: { tenantId, isActive: true, AND: takipte, ...where } });
    const [aktif, gunTanimli, talepAcik, geldiAcik, calisir] = await Promise.all([
      t({}),
      t({ evrakTeslimGunu: { not: null } }),
      t({ whatsappEvrakTalep: true }),
      t({ whatsappEvrakGeldi: true }),
      t({ evrakTeslimGunu: { not: null }, whatsappEvrakTalep: true }),
    ]);
    return {
      takiptekiMukellef: aktif,
      teslimGunuTanimli: gunTanimli,
      talepAnahtariAcik: talepAcik,
      geldiAnahtariAcik: geldiAcik,
      hatirlatmaCalisir: calisir,
      not: 'Hatırlatma için HEM teslim günü HEM "Evrak talep mesajı" anahtarı gerekli.',
    };
  }

  /**
   * KAYITLI ŞABLONLARI VARSAYILANA DÖNDÜR.
   *
   * Ayarlar > Mesaj Şablonları'ndaki metin, koddaki varsayılanı ezer. Kayıtlı
   * metin eski/kısa kalınca mesaj yanlış görünüyordu; bu uç iki alanı koddaki
   * metne geri yazar. Gövde kabul etmez — serbest metin alsaydı X-Agent-Token
   * taşıyan her yerel ajan mükelleflere gidecek metni değiştirebilirdi.
   */
  @Post('sablon/varsayilana-al')
  async sablonuVarsayilanaAl(@Headers('x-agent-token') token: string) {
    const tenantId = await this.tenant(token);
    return { ok: true, yazilan: await this.evrakMesaj.sablonuVarsayilanaAl(tenantId) };
  }

  /**
   * ŞABLON ÖNİZLEMESİ — iki metni de gönderir.
   *
   * Tarama ucundan farkı: o an şartı tutan mükellef olmasa da metinleri
   * gösterir. "Şablonları bana gönder" isteğinin doğrudan karşılığı.
   */
  @Post('test/sablon')
  async sablonOnizle(@Headers('x-agent-token') token: string) {
    const tenantId = await this.tenant(token);
    return { ok: true, not: this.not(), ...(await this.reminder.evrakSablonOnizle(tenantId)) };
  }

  /**
   * GERÇEK TARAMA — bugün kimlere gideceğini gösterir.
   *
   * Proaktif şalter, iki-gün aralığı, mesai ve tatil penceresi yok sayılır ki
   * sonuç beklemeden görülsün. Damga (lastReminderSentAt) ATILMAZ; atılsaydı
   * gerçek hatırlatma iki gün kilitlenirdi.
   */
  @Post('test/tarama')
  async tarama(@Headers('x-agent-token') token: string) {
    await this.tenant(token);
    const sonuc = await this.reminder.evrakTalepTara({
      salteriYokSay: true,
      aralikYokSay: true,
      onizleme: true,
    });
    return { ok: true, not: this.not(), sonuc };
  }

  /** Tek mükellef için "evrak geldi" metnini gösterir */
  @Post('test/geldi/:taxpayerId')
  async geldi(@Headers('x-agent-token') token: string, @Param('taxpayerId') taxpayerId: string) {
    const tenantId = await this.tenant(token);
    const simdi = new Date();
    const sonuc = await this.reminder.evrakGeldiBildir(
      tenantId,
      taxpayerId,
      simdi.getFullYear(),
      simdi.getMonth() + 1,
      { onizleme: true },
    );
    return { ok: true, not: this.not(), sonuc };
  }
}
