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
 * GÜVENLİK:
 *  - Her çağrı `onizleme/zorlaTest` ile çalışır; bu, canlı şalterinin
 *    ÜSTÜNDEDİR. MOREN_EVRAK_CANLI=1 açılsa bile BU UÇLAR mükellefe mesaj
 *    gönderemez; metin yalnız MOREN_OWNER_WHATSAPP_PHONES numaralarına gider.
 *  - Çözülen ofis kimliği sorgulara GEÇİRİLİR. Önce çözülüp atılıyordu; ikinci
 *    bir ofis eklendiğinde A'nın anahtarıyla yapılan çağrı B'nin mükellef
 *    verisini döndürebilirdi.
 *  - Şablon YAZAN uç kaldırıldı (2026-08-18). İşini yaptı; X-Agent-Token ofis
 *    kısa adına düşebildiği için yazma yetkisi burada durmamalı. Metin
 *    değişikliği Ayarlar > Mesaj Şablonları ekranından yapılır.
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

  /**
   * Sıkı mod: yalnız AGENT_INGEST_TOKENS'ta tanımlı gerçek anahtar kabul
   * edilir. Ofis kısa adı yedeği burada kapalı — slug ofis adından türetiliyor,
   * tahmin edilebilir; bu uçlar ofis sahibinin telefonuna mesaj tetikliyor.
   */
  private tenant(token?: string) {
    return resolveTenantFromAgentToken(token, this.prisma as any, { strict: true });
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
      proaktifSalter: this.evrakMesaj.proaktifAcikMi(),
      mesaiIcinde: this.evrakMesaj.mesaiIcindeMi(),
      resmiTatil: this.evrakMesaj.resmiTatilMi(),
      onayBeklemeDk: this.evrakMesaj.onayBeklemeDk(),
      testNumarasiTanimli: !!(
        process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE
      ),
      aciklama:
        this.evrakMesaj.canliMi() && this.evrakMesaj.proaktifAcikMi()
          ? 'Zamanlı gönderim CANLI: cron mükelleflere mesaj atar.'
          : 'Zamanlı gönderim KAPALI. Açmak için MOREN_EVRAK_CANLI=1 ve MOREN_CLIENT_PROACTIVE_REMINDERS=1.',
      kapsam: await this.kapsam(tenantId),
    };
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
   * Şalter, iki-gün aralığı, mesai ve tatil penceresi yok sayılır ki sonuç
   * beklemeden görülsün. Damga ATILMAZ; atılsaydı gerçek hatırlatma iki gün
   * kilitlenirdi.
   */
  @Post('test/tarama')
  async tarama(@Headers('x-agent-token') token: string) {
    const tenantId = await this.tenant(token);
    const sonuc = await this.reminder.evrakTalepTara({
      salteriYokSay: true,
      aralikYokSay: true,
      onizleme: true,
      tenantId,
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

  /**
   * GÖNDERİM DÖKÜMÜ — son N günde evrak akışından kime ne gitti.
   *
   * 20 Ağustos 2026 olayından sonra eklendi: "kaç mesaj gitti, hangisi
   * yanlıştı" sorusu uygulama logundan değil veritabanından yanıtlanmalı.
   * Metin gövdesi DÖNMEZ; yalnız başlık (tür/dönem/durum/hedef) ve zaman.
   */
  @Post('gonderim-dokumu')
  async gonderimDokumu(@Headers('x-agent-token') token: string) {
    const tenantId = await this.tenant(token);
    const bes = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const kayitlar = await this.prisma.communicationLog.findMany({
      where: {
        channel: 'WHATSAPP',
        occurredAt: { gte: bes },
        OR: [
          { subject: { startsWith: 'Evrak' } },
          { subject: { startsWith: '[TEST] Evrak' } },
        ],
        taxpayer: { tenantId },
      },
      select: { subject: true, occurredAt: true, taxpayer: { select: { companyName: true, firstName: true, lastName: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 500,
    });
    return {
      aralik: '5 gün',
      adet: kayitlar.length,
      kayitlar: kayitlar.map((k) => ({
        zaman: k.occurredAt,
        mukellef: this.evrakMesaj.ad(k.taxpayer),
        baslik: k.subject,
      })),
    };
  }

  /**
   * KAPSAM LİSTESİ — otomasyonun dokunacağı mükelleflerin ADLARI.
   *
   * Sayı tek başına yetmiyor: şalteri açmadan önce "kimlere gidecek" sorusunun
   * isim isim cevaplanması gerekiyor. Telefon numarası DÖNMEZ, yalnız kaç
   * numara tanımlı olduğu — liste teyit içindir, rehber değil.
   */
  @Post('kapsam/liste')
  async kapsamListe(@Headers('x-agent-token') token: string) {
    const tenantId = await this.tenant(token);
    const simdi = new Date();
    const yil = simdi.getFullYear();
    const ay = simdi.getMonth() + 1;
    const ilkGun = new Date(yil, ay - 1, 1);
    const sonGun = new Date(yil, ay, 0, 23, 59, 59);

    const mukellefler = await this.prisma.taxpayer.findMany({
      where: {
        tenantId,
        isActive: true,
        // Herhangi bir evrak ayarı olan herkes — anahtarı açık olmayan da
        // görünsün ki "açtım sandım ama açılmamış" durumu fark edilsin.
        OR: [
          { evrakTeslimGunu: { not: null } },
          { whatsappEvrakTalep: true },
          { whatsappEvrakGeldi: true },
        ],
        AND: [
          { OR: [{ startDate: null }, { startDate: { lte: sonGun } }] },
          { OR: [{ endDate: null }, { endDate: { gte: ilkGun } }] },
          { NOT: { taxNumber: { startsWith: 'WHATSAPP-' } } },
        ],
      },
      orderBy: [{ evrakTeslimGunu: 'asc' }, { companyName: 'asc' }, { firstName: 'asc' }],
    });

    const durumlar = await this.prisma.taxpayerMonthlyStatus.findMany({
      where: { tenantId, year: yil, month: ay, taxpayerId: { in: mukellefler.map((m) => m.id) } },
      select: {
        taxpayerId: true, evraklarGeldi: true, evrakTalepSonGonderimAt: true,
        // Onay mesaji kuyrukta mi / gonderildi mi — mesai disi isaretlemenin
        // gercekten beklemeye alindigini gormeden 09:00'i beklemek gerekiyordu.
        evrakGeldiMesajBekliyor: true, evrakGeldiMesajKuyrukAt: true, evrakGeldiMesajGonderimAt: true,
      },
    });
    const durumHarita = new Map(durumlar.map((d) => [d.taxpayerId, d]));

    const donem = this.evrakMesaj.beyannameDonemi(yil, ay);
    return {
      islemAyi: `${yil}-${String(ay).padStart(2, '0')}`,
      mukellefeYazilanDonem: donem.etiket,
      bugun: simdi.getDate(),
      satirlar: mukellefler.map((m) => {
        const d = durumHarita.get(m.id);
        const talep = this.evrakMesaj.uygunMu(m, 'TALEP');
        const geldi = this.evrakMesaj.uygunMu(m, 'GELDI');
        return {
          ad: this.evrakMesaj.ad(m),
          vkn: m.taxNumber,
          teslimGunu: m.evrakTeslimGunu,
          talepAnahtari: m.whatsappEvrakTalep,
          geldiAnahtari: m.whatsappEvrakGeldi,
          telefonSayisi: this.evrakMesaj.telefonlar(m).length,
          evrakGeldiIsaretli: !!d?.evraklarGeldi,
          sonHatirlatma: d?.evrakTalepSonGonderimAt ?? null,
          onayKuyrukta: !!d?.evrakGeldiMesajBekliyor,
          onayKuyrukAt: d?.evrakGeldiMesajKuyrukAt ?? null,
          onayGonderimi: d?.evrakGeldiMesajGonderimAt ?? null,
          hatirlatmaGider: talep.uygun,
          hatirlatmaEngeli: talep.sebep ?? null,
          onayGider: geldi.uygun,
          onayEngeli: geldi.sebep ?? null,
        };
      }),
    };
  }

  /**
   * KAPSAM — otomasyon kaç mükellefi kapsıyor.
   *
   * Tarama yalnız o an şartı tutanı sayar; "hiç kimseye gitmedi" ile "kimsede
   * ayar açık değil" aynı görünüyordu. Bu sayılar ikisini ayırır ve Aylık
   * Takip Listesi kümesi üzerinden hesaplanır.
   */
  private async kapsam(tenantId: string) {
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
    const [aktif, gunVar, talep, geldi, hatirlatma, onay] = await Promise.all([
      t({}),
      t({ evrakTeslimGunu: { not: null } }),
      t({ whatsappEvrakTalep: true }),
      t({ whatsappEvrakGeldi: true }),
      t({ evrakTeslimGunu: { not: null }, whatsappEvrakTalep: true }),
      t({ evrakTeslimGunu: { not: null }, whatsappEvrakGeldi: true }),
    ]);
    return {
      takiptekiMukellef: aktif,
      teslimGunuTanimli: gunVar,
      talepAnahtariAcik: talep,
      geldiAnahtariAcik: geldi,
      hatirlatmaCalisir: hatirlatma,
      onayCalisir: onay,
      not: 'İki mesaj türü de teslim günü TANIMLI olmayan mükellefe gitmez.',
    };
  }
}
