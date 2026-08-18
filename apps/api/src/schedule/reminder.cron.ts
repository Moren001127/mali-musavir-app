import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EvrakMesajService } from './evrak-mesaj.service';
import { AutomationEventBus } from '../automations/automation-event-bus.service';

/**
 * EVRAK OTOMASYONU — hatırlatma + "evrak geldi" onayı.
 *
 * ÇALIŞMA ŞARTLARI (kullanıcı kararı 2026-08-18):
 *   TALEP  — Mükellef kartında evrak teslim günü TANIMLI olacak; boşsa hiçbir
 *            mesaj gitmez. O gün geldiğinde Aylık Takip Listesi'nde "evrak
 *            geldi" işaretli değilse, o günden başlayarak 2 günde bir
 *            hatırlatma gider. Pazartesi–Cuma, saat 10:00 (TR).
 *   GELDI  — "Evrak geldi" işaretlenince onay mesajı gider. Pazartesi–Cuma
 *            09:00–17:00 (TR). Mesai dışında işaretlenirse mesaj DÜŞMEZ,
 *            beklemeye alınır ve ilk iş günü 09:00'da gönderilir.
 *   İkisi de yalnız Aylık Takip Listesi kümesindeki mükelleflere gider,
 *   resmî tatilde gitmez ve MOREN_CLIENT_PROACTIVE_REMINDERS=1 şartına bağlı.
 *
 * Gönderim kararının tamamı EvrakMesajService'te (tek kapı). Burada yalnız
 * KİME ve NE ZAMAN sorusu çözülür.
 *
 * Damgalar TaxpayerMonthlyStatus üzerinde, DÖNEM bazında tutulur. Önceden
 * Taxpayer.lastReminderSentAt tek alandaydı: ay değişince eski dönemin takibi
 * düşüyor, aynı damga farklı dönemleri kilitliyordu.
 */
@Injectable()
export class ReminderCron {
  private readonly logger = new Logger(ReminderCron.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsAppService,
    private evrakMesaj: EvrakMesajService,
    private eventBus: AutomationEventBus,
  ) {}

  // ================================================================
  //  AYLIK TAKİP LİSTESİ KÜMESİ
  // ================================================================

  /**
   * Mesaj yalnız bu mükelleflere gider.
   *
   * Liste sayfası mükellefi işe başlama/bitiş tarihine göre süzüyor; yalnız
   * isActive'e bakmak işi BIRAKMIŞ veya henüz BAŞLAMAMIŞ mükellefe mesaj
   * gönderirdi. Koşullar monthly-status.shared.ts ile birebir aynı.
   */
  private takipPenceresi(yil: number, ay: number) {
    const ilkGun = new Date(yil, ay - 1, 1);
    const sonGun = new Date(yil, ay, 0, 23, 59, 59);
    return [
      { OR: [{ startDate: null }, { startDate: { lte: sonGun } }] },
      { OR: [{ endDate: null }, { endDate: { gte: ilkGun } }] },
      // Sanal WhatsApp kayıtları gerçek mükellef değil
      { NOT: { taxNumber: { startsWith: 'WHATSAPP-' } } },
    ];
  }

  /**
   * İKİ GÜN EŞİĞİ — takvim günü bazında, tek kaynak.
   *
   * Panel ekranı ve cron ayrı formül kullanınca ekran "kilitli" derken cron
   * yarım saat sonra gönderiyordu. İkisi de burayı çağırır.
   */
  static ikiGunEsigi(an: Date = new Date()): Date {
    return new Date(an.getFullYear(), an.getMonth(), an.getDate() - 1, 0, 0, 0);
  }

  /**
   * Bu ay, bugünden SONRA hatırlatma taraması çalışacak bir gün var mı.
   *
   * Yoksa bugün o dönemin son şansıdır; teslim günü büyük olanlar da vadesi
   * gelmiş sayılır. Cron Pzt–Cum ve tatil dışı çalıştığı için "ayın son günü"
   * ölçüsü yetmiyordu.
   */
  private buAyBaskaTaramaVarMi(yil: number, ay: number, bugun: number): boolean {
    const sonGun = new Date(yil, ay, 0).getDate();
    for (let g = bugun + 1; g <= sonGun; g++) {
      const d = new Date(yil, ay - 1, g, 12, 0, 0);
      const hafta = d.getDay();
      if (hafta === 0 || hafta === 6) continue;
      if (this.evrakMesaj.resmiTatilMi(d)) continue;
      return true;
    }
    return false;
  }

  /**
   * Gönderim kalıcı olarak mı reddedildi.
   *
   * Kalıcı retlerde beklemeye almanın anlamı yok; geçici engellerde (mesai,
   * tatil, şalter, köprü kopukluğu, `atlandi` hiç set edilmeden başarısızlık)
   * kayıt beklemeye alınır ve ilk mesai saatinde tekrar denenir.
   */
  private kaliciRet(atlandi?: string): boolean {
    return atlandi === 'telefon yok' || atlandi === 'test numarası tanımsız';
  }

  /** İşlem ayı = içinde bulunulan takvim ayı (durum kayıtları buna göre) */
  private islemAyi(an: Date = new Date()) {
    return { yil: an.getFullYear(), ay: an.getMonth() + 1 };
  }

  /** Durum kaydını oluşturmadan bulur; yoksa null */
  private durumBul(taxpayerId: string, yil: number, ay: number) {
    return this.prisma.taxpayerMonthlyStatus.findUnique({
      where: { taxpayerId_year_month: { taxpayerId, year: yil, month: ay } },
    });
  }

  /** Durum kaydına damga yazar; kayıt yoksa oluşturur */
  private async durumDamgala(
    tenantId: string,
    taxpayerId: string,
    yil: number,
    ay: number,
    veri: Record<string, any>,
  ) {
    await this.prisma.taxpayerMonthlyStatus.upsert({
      where: { taxpayerId_year_month: { taxpayerId, year: yil, month: ay } },
      update: veri,
      create: { tenantId, taxpayerId, year: yil, month: ay, ...veri },
    });
  }

  // ================================================================
  //  "EVRAK GELDİ" ONAYI — olay tetikli + bekleyen taraması
  // ================================================================

  /**
   * Aylık Takip Listesi'nde "evrak geldi" işaretlendiği anda çalışır.
   *
   * Cron değil, çünkü kullanıcı işaretler işaretlemez haber gitmeli. Mesai
   * dışındaysa mesaj DÜŞMEZ; kayda "bekliyor" damgası yazılır ve ilk iş günü
   * 09:00 taraması gönderir.
   */
  onModuleInit() {
    this.eventBus.on('Taxpayer.EvrakDurumuChanged', async (p: any) => {
      // Yalnız "geldi" tarafı; işaret geri alınınca mesaj atılmaz
      if (p?.newValue !== true) return;
      try {
        await this.evrakGeldiBildir(p.tenantId, p.taxpayerId, p.year, p.month);
      } catch (err: any) {
        this.logger.error(`[EvrakGeldi] Hata: ${err?.message}`);
      }
    });
  }

  /**
   * BEKLEYEN ONAYLAR — her iş günü 09:00 TR.
   *
   * Cumartesi/gece işaretlenen evrakların onayı burada gönderilir. Kullanıcının
   * tarifi: "Cumartesi işaretledim → Pazartesi sabah 09:00'da gitsin."
   */
  @Cron('0 9 * * 1-5', { timeZone: 'Europe/Istanbul' })
  async bekleyenEvrakGeldiOnaylari() {
    return this.evrakGeldiBekleyenleriGonder();
  }

  async evrakGeldiBekleyenleriGonder(opts: { tenantId?: string } = {}) {
    if (!this.evrakMesaj.proaktifAcikMi()) {
      this.logger.log('[EvrakGeldi] Proaktif mesaj KAPALI — bekleyenler gönderilmedi.');
      return { atlandi: 'proaktif şalter kapalı' };
    }
    if (!this.evrakMesaj.mesaiIcindeMi()) {
      // Tatil gününe denk gelirse bir sonraki iş günü tekrar denenecek;
      // damga duruyor, kayıp yok.
      this.logger.log('[EvrakGeldi] Mesai dışı/tatil — bekleyenler ertelendi.');
      return { atlandi: 'mesai dışı' };
    }

    // DURUMA DAYALI TARAMA — bayrağa değil.
    //
    // Önce yalnız `evrakGeldiMesajBekliyor` bakılıyordu; o bayrak da yalnız
    // "mesai dışı/tatil" dönüşünde yazılıyordu. Oysa gönderim WhatsApp şalteri
    // kapalıyken, telefon yokken veya köprü anlık koptuğunda da başarısız
    // dönüyor; o kayıtlar bayraksız kalıp bir daha HİÇ taranmıyordu ve onay
    // mesajı kalıcı olarak düşüyordu.
    //
    // ESKİ KAYIT TAŞMASI: geçmişteki tüm işaretli dönemler taranırsa şalter
    // açıldığı gün toplu mesaj gider. Bu yüzden yalnız BU ay ve BİR ÖNCEKİ ay.
    const simdi = new Date();
    const buAy = this.islemAyi(simdi);
    const oncekiAyTarih = new Date(simdi.getFullYear(), simdi.getMonth() - 1, 1);
    const oncekiAy = this.islemAyi(oncekiAyTarih);

    const bekleyenler = await this.prisma.taxpayerMonthlyStatus.findMany({
      where: {
        evraklarGeldi: true,
        evrakGeldiMesajGonderimAt: null,
        OR: [
          { year: buAy.yil, month: buAy.ay },
          { year: oncekiAy.yil, month: oncekiAy.ay },
        ],
        ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      },
      take: 500,
    });

    let gonderilen = 0;
    let atlanan = 0;
    for (const b of bekleyenler) {
      const r = await this.evrakGeldiBildir(b.tenantId, b.taxpayerId, b.year, b.month);
      if ((r as any)?.gonderildi) gonderilen++;
      else atlanan++;
    }
    const ozet = { bekleyen: bekleyenler.length, gonderilen, atlanan };
    this.logger.log(`[EvrakGeldi] Bekleyen taraması: ${JSON.stringify(ozet)}`);
    return ozet;
  }

  /** Tek mükellef için "evraklarınız ulaştı" bilgilendirmesi */
  async evrakGeldiBildir(
    tenantId: string,
    taxpayerId: string,
    yil: number,
    ay: number,
    opts: { onizleme?: boolean } = {},
  ) {
    // Proaktif şalter onay yolunu da kapsar. Bir süre yalnız hatırlatmadaydı;
    // onay mesajı şaltersizdi ve otomasyon motoru üzerinden de tetiklenebiliyordu.
    if (!opts.onizleme && !this.evrakMesaj.proaktifAcikMi()) {
      return { atlandi: 'proaktif şalter kapalı' };
    }

    const t = await this.prisma.taxpayer.findFirst({
      where: {
        id: taxpayerId,
        tenantId,
        // Bilgilendirme de yalnız Aylık Takip Listesi kümesine gider; işi
        // bırakmış mükellefe "işlemleriniz başlatıldı" mesajı gitmemeli.
        ...(opts.onizleme ? {} : { AND: this.takipPenceresi(yil, ay) }),
      },
    });
    if (!t) return { atlandi: 'mükellef Aylık Takip Listesi kümesinde değil' };
    // TEK KURAL: teslim günü tanımlı + "Evrak geldi onayı" açık + aktif + telefon.
    // Önizlemede atlanır; metin zaten mükellefe değil ofis sahibine gidiyor.
    if (!opts.onizleme) {
      const uygun = this.evrakMesaj.uygunMu(t, 'GELDI');
      if (!uygun.uygun) return { atlandi: uygun.sebep };
    }

    if (!opts.onizleme) {
      const durum = await this.durumBul(taxpayerId, yil, ay);
      // TEKRAR GÖNDERİM ENGELİ: personel işareti açıp kapatıp tekrar açarsa
      // mükellef aynı dönem için ikinci kez mesaj almasın.
      if (durum?.evrakGeldiMesajGonderimAt) {
        return { atlandi: 'bu dönem için onay zaten gönderildi' };
      }
    }

    // Mükellefe yazılan dönem = işlem ayı − 1 (Ağustos'ta işlenen = Temmuz
    // evrakı). Önizleme de AYNI hesabı kullanır; ayrışsaydı kullanıcı
    // onayladığı metinden bir ay farklı mesaj gönderilirdi.
    const donem = this.evrakMesaj.beyannameDonemi(yil, ay).etiket;
    const ad = this.evrakMesaj.ad(t);
    const metin = await this.evrakMesaj.mesajKur(tenantId, 'GELDI', ad, donem);

    const sonuc = await this.evrakMesaj.gonder({
      tenantId,
      taxpayer: t,
      metin,
      tur: 'GELDI',
      donem,
      sebep: 'Aylık Takip Listesi\'nde "evrak geldi" işaretlendi',
      mesaiYokSay: opts.onizleme,
      zorlaTest: opts.onizleme,
    });

    if (!opts.onizleme) {
      // DAMGA YALNIZ GERÇEK GÖNDERİMDE. Test gönderimi de damgalasaydı, şalter
      // kapalıyken işaretlenen her dönem "onay gönderildi" sayılır ve canlıya
      // geçildiğinde mükellefe o dönemin onayı BİR DAHA hiç gitmezdi.
      // (Aynı tuzak TALEP tarafında görülmüş, burada unutulmuştu.)
      if (sonuc.gonderildi && !sonuc.test) {
        await this.durumDamgala(tenantId, taxpayerId, yil, ay, {
          evrakGeldiMesajBekliyor: false,
          evrakGeldiMesajGonderimAt: new Date(),
        });
      } else if (!sonuc.gonderildi && !this.kaliciRet(sonuc.atlandi)) {
        // GEÇİCİ engel (mesai dışı, tatil, şalter kapalı, köprü kopuk): kayıt
        // beklemeye alınır, mesai başındaki tarama gönderir. Kalıcı retlerde
        // (anahtar kapalı, pasif mükellef) beklemeye almanın anlamı yok.
        await this.durumDamgala(tenantId, taxpayerId, yil, ay, { evrakGeldiMesajBekliyor: true });
      }
    }

    this.logger.log(
      `[EvrakGeldi] ${ad} · ${donem} · ` +
      `${sonuc.gonderildi ? (sonuc.test ? 'TEST gönderildi' : 'gönderildi') : `atlandı (${sonuc.atlandi || 'bilinmiyor'})`}`,
    );
    return { mukellef: ad, donem, ...sonuc };
  }

  // ================================================================
  //  EVRAK TALEP HATIRLATMASI
  // ================================================================

  /**
   * SAAT 10:00 (TR), Pazartesi–Cuma — kullanıcı kararı 2026-08-18.
   *
   * Saat dilimi AÇIKÇA veriliyor: ifade tek başına sunucunun UTC kalmasına
   * bağlı kalırsa, ortama TZ tanımlandığı gün mesaj başka saatte gider.
   */
  @Cron('0 10 * * 1-5', { timeZone: 'Europe/Istanbul' })
  async sendEvrakReminderMessages() {
    return this.evrakTalepTara({});
  }

  /**
   * Evrak talep taraması.
   *
   * Cron bunu şalterle çağırır; önizleme ucu şalteri, aralığı ve mesai
   * penceresini yok sayarak çağırır. Gönderim kararı yine tek kapıda.
   */
  async evrakTalepTara(opts: {
    salteriYokSay?: boolean;
    aralikYokSay?: boolean;
    /** Önizleme: mesai/tatil penceresini ve canlı şalterini yok say */
    onizleme?: boolean;
    /** Yalnız bu ofis — önizleme ucu kendi ofisiyle sınırlı kalsın */
    tenantId?: string;
  }) {
    if (!opts.salteriYokSay && !this.evrakMesaj.proaktifAcikMi()) {
      this.logger.log('[ReminderCron] Proaktif evrak hatırlatması KAPALI (MOREN_CLIENT_PROACTIVE_REMINDERS!=1).');
      return { hata: 'proaktif şalter kapalı' };
    }

    const today = new Date();
    if (!opts.onizleme && this.evrakMesaj.resmiTatilMi(today)) {
      this.logger.log(`[ReminderCron] Bugün resmî tatil — hatırlatma atılmadı.`);
      return { hata: 'bugün resmi tatil' };
    }

    const { yil: year, ay: month } = this.islemAyi(today);
    const todayDay = today.getDate();
    // Mükellefe yazılan dönem = işlem ayı − 1
    const donem = this.evrakMesaj.beyannameDonemi(year, month).etiket;

    try {
      // AY SONU KIRPMA: teslim günü 29/30 girilmiş mükellef, Şubat gibi kısa
      // aylarda "teslim günü <= bugün" şartını HİÇ sağlamıyordu.
      //
      // Ölçü "ayın son takvim günü" DEĞİL, "bu ay taramanın çalışacağı son
      // gün". Cron yalnız hafta içi ve tatil dışı çalışıyor; ayın son günü
      // cumartesiye düşerse son tarama son cuma olur ve kırpma hiç devreye
      // girmezdi (2026/02, 2026/05, 2027/01 … hep böyle).
      const etkinGun = this.buAyBaskaTaramaVarMi(year, month, todayDay) ? todayDay : 31;

      // İKİ GÜNDE BİR — takvim günü bazında. Saat farkıyla kıyaslanınca damga
      // her zaman birkaç saniye ileride kalıyor ve ritim 3 güne kayıyordu.
      const esik = ReminderCron.ikiGunEsigi(today);

      const taxpayers = await this.prisma.taxpayer.findMany({
        where: {
          isActive: true,
          whatsappEvrakTalep: true,
          ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
          // YALNIZ AYLIK TAKİP LİSTESİNDEKİLER
          AND: this.takipPenceresi(year, month),
          // TESLİM GÜNÜ TANIMLI OLACAK (null bu koşulla zaten elenir) ve
          // vadesi gelmiş olacak. Hatırlatma teslim gününün KENDİSİNDE başlar.
          evrakTeslimGunu: { not: null, lte: etkinGun },
        },
      });

      const tenantActiveCache = new Map<string, boolean>();
      for (const tenantId of Array.from(new Set(taxpayers.map((t) => t.tenantId).filter(Boolean)))) {
        const active = await this.whatsapp.isAutomationActive(tenantId);
        tenantActiveCache.set(tenantId, active);
        if (!active) {
          this.logger.log(`[ReminderCron] tenant=${tenantId} WhatsApp şalteri pasif — atlanacak.`);
        }
      }

      let sent = 0, skippedAlreadyArrived = 0, skippedNoPhone = 0,
        skippedMasterSwitch = 0, skippedAralik = 0, skippedUygunDegil = 0, failed = 0;

      for (const taxpayer of taxpayers) {
        if (tenantActiveCache.get(taxpayer.tenantId) === false) { skippedMasterSwitch++; continue; }

        const durum = await this.durumBul(taxpayer.id, year, month);
        if (durum?.evraklarGeldi) { skippedAlreadyArrived++; continue; }

        // İki gün kuralı — damga DÖNEM bazında
        if (!opts.aralikYokSay && durum?.evrakTalepSonGonderimAt && durum.evrakTalepSonGonderimAt >= esik) {
          skippedAralik++;
          continue;
        }

        // Sorgu zaten süzüyor; burada TEK KURAL son kapı olarak tekrar bakar.
        // Sorgu ile bu kontrol birlikte kaymadıkça istenmeyen mesaj sızmaz.
        const uygun = this.evrakMesaj.uygunMu(taxpayer, 'TALEP');
        if (!uygun.uygun) {
          if (uygun.sebep === 'telefon yok') skippedNoPhone++;
          else skippedUygunDegil++;
          continue;
        }

        const ad = this.evrakMesaj.ad(taxpayer);
        const metin = await this.evrakMesaj.mesajKur(taxpayer.tenantId, 'TALEP', ad, donem);

        const sonuc = await this.evrakMesaj.gonder({
          tenantId: taxpayer.tenantId,
          taxpayer,
          metin,
          tur: 'TALEP',
          donem,
          sebep: `Teslim günü ${taxpayer.evrakTeslimGunu}, bugün ${todayDay} — evrak hâlâ işaretlenmedi`,
          mesaiYokSay: opts.onizleme,
          zorlaTest: opts.onizleme,
        });

        if (sonuc.gonderildi) {
          sent++;
          // DAMGA YALNIZ GERÇEK GÖNDERİMDE. Test gönderiminde de atılsaydı,
          // canlıya geçilen gün ilk tarama bu mükellefleri "2 gün kuralı" ile
          // atlar ve kimseye mesaj gitmezdi.
          if (!sonuc.test && !opts.onizleme) {
            await this.durumDamgala(taxpayer.tenantId, taxpayer.id, year, month, {
              evrakTalepSonGonderimAt: new Date(),
              evrakTalepGonderimSayisi: (durum?.evrakTalepGonderimSayisi ?? 0) + 1,
            });
          }
        } else {
          failed++;
        }
      }

      const ozet = {
        donem,
        aday: taxpayers.length,
        gonderilen: sent,
        evrakZatenGeldi: skippedAlreadyArrived,
        aralikBeklemede: skippedAralik,
        telefonYok: skippedNoPhone,
        kuralaUymayan: skippedUygunDegil,
        salterKapali: skippedMasterSwitch,
        basarisiz: failed,
        canli: this.evrakMesaj.canliMi(),
      };
      this.logger.log(`[ReminderCron] ${JSON.stringify(ozet)}`);
      return ozet;
    } catch (err: any) {
      this.logger.error(`[ReminderCron] Hata: ${err.message}`);
      return { hata: err.message };
    }
  }

  // ================================================================
  //  ÖNİZLEME
  // ================================================================

  /**
   * ŞABLON ÖNİZLEMESİ — iki metni de ofis sahibine gönderir.
   *
   * Tarama ucu yalnız o an şartı tutan mükellef varsa mesaj üretir; hiç aday
   * yoksa kullanıcı metinleri göremezdi. Bu uç şarta bakmaz.
   */
  async evrakSablonOnizle(tenantId: string) {
    const t =
      (await this.prisma.taxpayer.findFirst({
        where: { tenantId, isActive: true, evrakTeslimGunu: { not: null } },
        orderBy: { createdAt: 'asc' },
      })) ||
      (await this.prisma.taxpayer.findFirst({ where: { tenantId, isActive: true } }));
    if (!t) return { hata: 'Aktif mükellef bulunamadı' };

    const { yil, ay } = this.islemAyi();
    const donem = this.evrakMesaj.beyannameDonemi(yil, ay).etiket;
    const ad = this.evrakMesaj.ad(t);

    const cikti: any[] = [];
    for (const tur of ['TALEP', 'GELDI'] as const) {
      const metin = await this.evrakMesaj.mesajKur(tenantId, tur, ad, donem);
      const sonuc = await this.evrakMesaj.gonder({
        tenantId,
        taxpayer: t,
        metin,
        tur,
        donem,
        sebep: 'Şablon önizlemesi',
        mesaiYokSay: true,
        zorlaTest: true,
        // Metin mükellefe gideceği haliyle görünsün; bilgi bloğu yok.
        baslikSiz: true,
      });
      cikti.push({ tur, metin, ...sonuc });
    }
    return { ornekMukellef: ad, donem, mesajlar: cikti };
  }
}
