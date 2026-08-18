import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EvrakMesajService } from './evrak-mesaj.service';
import { AutomationEventBus } from '../automations/automation-event-bus.service';

/**
 * Evrak teslim hatırlatma cron'u.
 *
 * Her iş günü (Pzt-Cum) saat 10:00 TR (07:00 UTC) çalışır.
 * Resmi tatillerde (Türkiye) atılmaz.
 * Kuralları:
 *   1) Mükellefin evrakTeslimGunu <= bugünün günü olmalı (vade geldi/geçti)
 *   2) whatsappEvrakTalep = true olmalı (mükellef bu tipi onaylamış)
 *   3) Bu ay için TaxpayerMonthlyStatus.evraklarGeldi = false olmalı
 *      (mükellef listesinde "evraklar geldi" işaretlenmediyse devam eder)
 *   4) Son 2 günde hatırlatma gönderilmemiş olmalı (spam koruma)
 *   5) Mükellef aktif olmalı
 *   6) Bugün Türkiye resmi tatili olmamalı
 *
 * Mesaj kaynağı: SmsTemplate.evrakTalepMesaji (tenant başına özel)
 * Değişkenler: {ad}, {dönem}
 */

// Türkiye resmi tatil günleri (2026-2028) — sabit + dini bayramlar
// Kaynak: T.C. resmi takvim. Bayram tarihleri her yıl değişir, manuel güncellenmeli.
const TURKIYE_RESMI_TATILLERI = new Set<string>([
  // 2026
  '2026-01-01', // Yılbaşı
  '2026-03-19', // Ramazan Bayramı arifesi (yarım gün - tam tatil sayıyoruz)
  '2026-03-20', // Ramazan Bayramı 1. gün
  '2026-03-21', // Ramazan Bayramı 2. gün
  '2026-03-22', // Ramazan Bayramı 3. gün
  '2026-04-23', // Ulusal Egemenlik ve Çocuk Bayramı
  '2026-05-01', // Emek ve Dayanışma Günü
  '2026-05-19', // Atatürk'ü Anma, Gençlik ve Spor Bayramı
  '2026-05-26', // Kurban Bayramı arifesi (yarım gün)
  '2026-05-27', // Kurban Bayramı 1. gün
  '2026-05-28', // Kurban Bayramı 2. gün
  '2026-05-29', // Kurban Bayramı 3. gün
  '2026-05-30', // Kurban Bayramı 4. gün
  '2026-07-15', // Demokrasi ve Milli Birlik Günü
  '2026-08-30', // Zafer Bayramı
  '2026-10-28', // Cumhuriyet Bayramı arifesi (yarım gün)
  '2026-10-29', // Cumhuriyet Bayramı
  // 2027
  '2027-01-01', // Yılbaşı
  '2027-03-09', // Ramazan Bayramı 1. gün (tahmini)
  '2027-03-10', // Ramazan Bayramı 2. gün
  '2027-03-11', // Ramazan Bayramı 3. gün
  '2027-04-23', // Çocuk Bayramı
  '2027-05-01', // İşçi Bayramı
  '2027-05-16', // Kurban Bayramı 1. gün (tahmini)
  '2027-05-17', // Kurban Bayramı 2. gün
  '2027-05-18', // Kurban Bayramı 3. gün
  '2027-05-19', // Atatürk'ü Anma + Kurban Bayramı 4. gün
  '2027-07-15', // Demokrasi Günü
  '2027-08-30', // Zafer Bayramı
  '2027-10-29', // Cumhuriyet Bayramı
]);

function bugunResmiTatilMi(date: Date): boolean {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return TURKIYE_RESMI_TATILLERI.has(`${yyyy}-${mm}-${dd}`);
}

@Injectable()
export class ReminderCron {
  private readonly logger = new Logger(ReminderCron.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsAppService,
    private evrakMesaj: EvrakMesajService,
    private eventBus: AutomationEventBus,
  ) {}

  /**
   * EVRAK GELDİ BİLGİLENDİRMESİ — olay tetikli.
   *
   * Aylık Takip Listesi'nde "evrak geldi" işaretlendiği anda çalışır.
   * Cron değil, çünkü kullanıcı işaretler işaretlemez haber gitmeli; günde
   * bir tarama, sabah işaretlenen evrakın bilgisini ertesi güne bırakırdı.
   *
   * Mesai dışında işaretlenirse mesaj GİTMEZ (gece bildirim atmamak için) —
   * EvrakMesajService.mesaiIcindeMi bunu kapatır.
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

  /** Tek mükellef için "evraklarınız ulaştı" bilgilendirmesi */
  async evrakGeldiBildir(tenantId: string, taxpayerId: string, yil: number, ay: number) {
    const t = await this.prisma.taxpayer.findFirst({ where: { id: taxpayerId, tenantId } });
    if (!t) return;
    // Anahtar kapalıysa hiç üretme — kullanıcı bu mükellef için istemiyor
    if (!t.whatsappEvrakGeldi) return;
    if (!t.isActive) return;

    const donem = this.evrakMesaj.donemAdi(yil, ay);
    const metin = this.evrakMesaj.doldur(
      await this.evrakMesaj.sablon(tenantId, 'GELDI'),
      this.evrakMesaj.ad(t),
      donem,
    );
    const sonuc = await this.evrakMesaj.gonder({
      tenantId,
      taxpayer: t,
      metin,
      tur: 'GELDI',
      donem,
      sebep: 'Aylık Takip Listesi\'nde "evrak geldi" işaretlendi',
    });
    this.logger.log(
      `[EvrakGeldi] ${this.evrakMesaj.ad(t)} · ${donem} · ` +
      `${sonuc.gonderildi ? (sonuc.test ? 'TEST gönderildi' : 'gönderildi') : `atlandı (${sonuc.atlandi || 'bilinmiyor'})`}`,
    );
  }

  // ÖĞLEN: 09:00 UTC = 12:00 TR. Kullanıcı "öğlen saatlerinde" dedi;
  // eskiden 07:00 UTC (10:00 TR) idi.
  @Cron('0 9 * * 1-5')
  async sendEvrakReminderMessages() {
    return this.evrakTalepTara({});
  }

  /**
   * Evrak talep taraması.
   *
   * Cron bunu env şalteriyle çağırır; test ucu ise şalteri ve iki-gün
   * aralığını yok sayarak çağırır — böylece kullanıcı metinleri beklemeden
   * görebilir. Gerçek gönderim kararı yine tek kapıda (EvrakMesajService).
   */
  async evrakTalepTara(opts: { salteriYokSay?: boolean; aralikYokSay?: boolean }) {
    // Kullanıcı talimatı (2026-06-15): ŞİMDİLİK mükelleflere kendiliğinden
    // (proaktif) mesaj ATILMAYACAK — bot yalnız mükellef YAZINCA cevap verir.
    // Bu evrak hatırlatması proaktif gönderim olduğu için varsayılan KAPALI.
    // Tekrar açmak için: MOREN_CLIENT_PROACTIVE_REMINDERS=1
    if (!opts.salteriYokSay && process.env.MOREN_CLIENT_PROACTIVE_REMINDERS !== '1') {
      this.logger.log('[ReminderCron] Proaktif evrak hatırlatması KAPALI (MOREN_CLIENT_PROACTIVE_REMINDERS!=1) — mükellefe mesaj atılmadı.');
      return;
    }
    const today = new Date();

    // Resmi tatil kontrolü - tatildeyse erken çık
    if (bugunResmiTatilMi(today)) {
      this.logger.log(`[ReminderCron] ${today.toISOString().slice(0, 10)} resmi tatil — hatırlatma atılmadı.`);
      return;
    }

    const todayDay = today.getDate();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const donem = `${this.aylarTr[month - 1]} ${year}`;

    try {
      const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);

      const taxpayers = await this.prisma.taxpayer.findMany({
        where: {
          isActive: true,
          whatsappEvrakTalep: true,
          // TESLİM GÜNÜNÜN KENDİSİNDEN İTİBAREN (kullanıcı kararı 2026-08-18).
          // Kısa süre "ertesi gün" yapılmıştı; geri alındı — teslim günü öğlen
          // hâlâ evrak yoksa hatırlatma o gün başlar.
          evrakTeslimGunu: { lte: todayDay },
          // İKİ GÜNDE BİR. Test taramasında bu aralık yok sayılır, yoksa
          // kullanıcı metni görmek için iki gün beklemek zorunda kalırdı.
          ...(opts.aralikYokSay
            ? {}
            : {
                OR: [
                  { lastReminderSentAt: null },
                  { lastReminderSentAt: { lte: twoDaysAgo } },
                ],
              }),
        },
      });

      const tenantActiveCache = new Map<string, boolean>();
      for (const tenantId of Array.from(new Set(taxpayers.map((t) => t.tenantId).filter(Boolean)))) {
        const active = await this.whatsapp.isAutomationActive(tenantId);
        tenantActiveCache.set(tenantId, active);
        if (!active) {
          this.logger.log(`[ReminderCron] tenant=${tenantId} WhatsApp master switch pasif - evrak hatirlatmalari atlanacak.`);
        }
      }

      // Tenant başına şablonu önbelleğe al — tek tenant için tek SQL sorgusu
      const templateCache = new Map<string, string>();
      const getTemplate = async (tenantId: string): Promise<string> => {
        if (templateCache.has(tenantId)) return templateCache.get(tenantId)!;
        const tpl = await this.prisma.smsTemplate.findUnique({ where: { tenantId } });
        const text = tpl?.evrakTalepMesaji
          || 'Sayın {ad}, {dönem} dönemi evraklarınızı tarafımıza teslim etmenizi rica ederiz.';
        templateCache.set(tenantId, text);
        return text;
      };

      let sent = 0, skippedAlreadyArrived = 0, skippedNoPhone = 0, skippedMasterSwitch = 0, failed = 0;

      for (const taxpayer of taxpayers) {
        if (tenantActiveCache.get(taxpayer.tenantId) === false) { skippedMasterSwitch++; continue; }

        // 3) Evraklar zaten geldiyse atla
        const status = await this.prisma.taxpayerMonthlyStatus.findUnique({
          where: {
            taxpayerId_year_month: { taxpayerId: taxpayer.id, year, month },
          },
        });
        if (status?.evraklarGeldi) { skippedAlreadyArrived++; continue; }

        // Telefonları topla — hem phones[] hem fallback olarak phone alanı
        const phones = (taxpayer.phones && taxpayer.phones.length > 0)
          ? taxpayer.phones.filter(Boolean)
          : (taxpayer.phone ? [taxpayer.phone] : []);
        if (phones.length === 0) { skippedNoPhone++; continue; }

        const ad = taxpayer.companyName
          || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim()
          || 'Sayın Mükellef';

        const template = await getTemplate(taxpayer.tenantId);
        const renderedMessage = template
          .replace(/\{ad\}/g, ad)
          .replace(/\{dönem\}/g, donem)
          .replace(/\{donem\}/g, donem);

        // TEK KAPI: test/canlı kararı, mesai penceresi ve loglama orada.
        const sonuc = await this.evrakMesaj.gonder({
          tenantId: taxpayer.tenantId,
          taxpayer,
          metin: renderedMessage,
          tur: 'TALEP',
          donem,
          sebep: `Teslim günü ${taxpayer.evrakTeslimGunu}, bugün ${todayDay} — evrak hâlâ işaretlenmedi`,
        });

        if (sonuc.gonderildi) {
          sent++;
          // Damga YALNIZ normal akışta atılır. Test taraması damga atsaydı
          // gerçek hatırlatma iki gün boyunca kilitlenirdi.
          if (!opts.aralikYokSay) {
            await this.prisma.taxpayer.update({
              where: { id: taxpayer.id },
              data: { lastReminderSentAt: new Date() },
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
        telefonYok: skippedNoPhone,
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

  private aylarTr = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
  ];

  private normalizePhone(value?: string | null): string {
    let digits = String(value || '').replace(/[^\d]/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) digits = `90${digits.slice(1)}`;
    if (digits.length === 10 && digits.startsWith('5')) digits = `90${digits}`;
    return digits;
  }

  private withWhatsAppPhone(content: string, phone?: string | null): string {
    const normalized = this.normalizePhone(phone);
    return normalized ? `[[wa_phone:${normalized}]]\n${content}` : content;
  }
}
