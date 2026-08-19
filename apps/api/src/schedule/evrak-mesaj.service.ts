import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

/**
 * EVRAK MESAJLARI — tek kapı.
 *
 * Evrak talep hatırlatması ve "evrak geldi" bilgilendirmesi buradan çıkar.
 * Tek kapı olması şart: gönderim kararı (test mi canlı mı, mesai içinde mi,
 * resmî tatil mi, telefon var mı) iki ayrı yerde tekrarlansaydı biri
 * gevşediğinde mükellefe istenmeyen mesaj giderdi. Geçmişte bir belge
 * akışında bu koruma yoktu ve üç gerçek mesaj mükellefe ulaştı.
 *
 * VARSAYILAN: TEST. Mesaj mükellefe DEĞİL, ofis sahibine gider. Gerçek
 * gönderim yalnız MOREN_EVRAK_CANLI=1 ile açılır — bilinçli bir adım.
 */
@Injectable()
export class EvrakMesajService {
  private readonly logger = new Logger(EvrakMesajService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsAppService,
  ) {}

  // ---------------------------------------------------------------- TAKVİM

  /**
   * Türkiye resmî tatilleri. Bayram tarihleri her yıl kayar, elle güncellenir.
   *
   * Burada duruyor çünkü hem hatırlatma hem "evrak geldi" onayı aynı takvimi
   * kullanmalı. Önce yalnız hatırlatma tarafında vardı; 23 Nisan'da hatırlatma
   * susarken onay mesajı gidiyordu.
   */
  static readonly RESMI_TATILLER = new Set<string>([
    // 2026
    '2026-01-01', '2026-03-19', '2026-03-20', '2026-03-21', '2026-03-22',
    '2026-04-23', '2026-05-01', '2026-05-19', '2026-05-26', '2026-05-27',
    '2026-05-28', '2026-05-29', '2026-05-30', '2026-07-15', '2026-08-30',
    '2026-10-28', '2026-10-29',
    // 2027
    '2027-01-01', '2027-03-09', '2027-03-10', '2027-03-11', '2027-04-23',
    '2027-05-01', '2027-05-16', '2027-05-17', '2027-05-18', '2027-05-19',
    '2027-07-15', '2027-08-30', '2027-10-29',
  ]);

  /**
   * Verilen anın TÜRKİYE saatindeki takvim parçaları.
   *
   * Sunucu UTC çalışıyor; yerel saate güvenmek yaz/kış saatinde kaydırır,
   * bu yüzden saat dilimi açıkça veriliyor.
   */
  private trParcala(an: Date) {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', weekday: 'short', hour12: false,
    }).formatToParts(an);
    const al = (t: string) => p.find((x) => x.type === t)?.value || '';
    const gunAdi = al('weekday');
    return {
      tarih: `${al('year')}-${al('month')}-${al('day')}`,
      // 24:00 tuzagı: hour12:false bazı ortamlarda gece yarısını "24" verir
      saat: Number(al('hour')) % 24,
      haftaSonu: gunAdi === 'Sat' || gunAdi === 'Sun',
    };
  }

  /** O gün Türkiye resmî tatili mi */
  resmiTatilMi(an: Date = new Date()): boolean {
    return EvrakMesajService.RESMI_TATILLER.has(this.trParcala(an).tarih);
  }

  /**
   * MESAİ PENCERESİ — Pazartesi–Cuma, 09:00–17:00 (Türkiye saati),
   * resmî tatil hariç.
   */
  mesaiIcindeMi(an: Date = new Date()): boolean {
    const { saat, haftaSonu, tarih } = this.trParcala(an);
    if (haftaSonu) return false;
    if (EvrakMesajService.RESMI_TATILLER.has(tarih)) return false;
    return saat >= 9 && saat < 17;
  }

  // ---------------------------------------------------------------- DÖNEM

  private static readonly AYLAR = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
  ];

  /** (2026, 7) → "Temmuz 2026" */
  donemAdi(yil: number, ay: number): string {
    return `${EvrakMesajService.AYLAR[ay - 1]} ${yil}`;
  }

  /**
   * MÜKELLEFE YAZILAN DÖNEM = işlem ayının BİR ÖNCESİ.
   *
   * Aylık durum kayıtları İŞLEM ayına göre tutulur; Ağustos'ta işlenen evrak
   * TEMMUZ dönemine aittir. Mesajda işlem ayı yazılırsa mükellef bir ay ileri
   * bir dönem için sıkıştırılmış olur. Olay yükündeki beyannamePeriodLabel de
   * aynı hesabı yapıyor (taxpayers.service.ts).
   */
  beyannameDonemi(islemYili: number, islemAyi: number): { yil: number; ay: number; etiket: string } {
    const yil = islemAyi === 1 ? islemYili - 1 : islemYili;
    const ay = islemAyi === 1 ? 12 : islemAyi - 1;
    return { yil, ay, etiket: this.donemAdi(yil, ay) };
  }

  // ---------------------------------------------------------------- ŞALTER

  /** Gerçek gönderim açık mı — varsayılan KAPALI (test). */
  canliMi(): boolean {
    return process.env.MOREN_EVRAK_CANLI === '1';
  }

  /**
   * Proaktif (mükellefin yazmasını beklemeden) mesaj izni.
   *
   * Hem hatırlatma hem "evrak geldi" onayı proaktiftir; ikisi de bu şaltere
   * bağlı. Onay yolu bir süre şaltersizdi ve otomasyon motoru üzerinden de
   * tetiklenebiliyordu — evrak modülünü hiç bilmeyen bir otomasyon toplu
   * mesaj gönderebilirdi.
   */
  proaktifAcikMi(): boolean {
    return process.env.MOREN_CLIENT_PROACTIVE_REMINDERS === '1';
  }

  /**
   * GÖNDERİMLER ARASI BEKLEME (ms).
   *
   * WhatsApp QR hattında arka arkaya aralıksız toplu mesaj, numaranın
   * işaretlenmesine yol açabiliyor. Şalter açıldığı gün 10:00'da şartı tutan
   * herkese peş peşe gönderim yapılacağı için aralık şart.
   * MOREN_EVRAK_GONDERIM_ARALIK_MS ile ayarlanır; 0 vermek beklemeyi kapatır.
   */
  gonderimAralikMs(): number {
    const ham = process.env.MOREN_EVRAK_GONDERIM_ARALIK_MS;
    if (ham === undefined || ham === '') return 5000;
    const n = Number(ham);
    return Number.isFinite(n) && n >= 0 ? n : 5000;
  }

  /** Verilen süre kadar bekler (0 ise hiç beklemez) */
  async bekle(ms: number): Promise<void> {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  /**
   * ONAY MESAJI BEKLEME SÜRESİ (dakika).
   *
   * "Evrak geldi" işaretlenince mesaj ANINDA gidiyordu; yanlış işaretleme fark
   * edilse bile iş işten geçmiş oluyordu. Artık işaretleme kuyruğa alınır ve bu
   * süre dolunca gönderilir — süre içinde işaret kaldırılırsa mesaj HİÇ gitmez.
   * MOREN_EVRAK_ONAY_BEKLEME_DK ile ayarlanır; 0 anında gönderim demektir.
   */
  onayBeklemeDk(): number {
    const ham = process.env.MOREN_EVRAK_ONAY_BEKLEME_DK;
    if (ham === undefined || ham === '') return 5;
    const n = Number(ham);
    return Number.isFinite(n) && n >= 0 ? n : 5;
  }

  /** Test mesajlarının gideceği numaralar (ofis sahibi). */
  private testNumaralari(): string[] {
    return String(
      process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || '',
    )
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }

  // ---------------------------------------------------------------- METİN

  /** Mükellefin ekranda görünen adı */
  ad(t: any): string {
    return (
      t?.companyName ||
      `${t?.firstName || ''} ${t?.lastName || ''}`.trim() ||
      'Sayın Mükellef'
    );
  }

  /**
   * GÖVDE METİNLERİ — kullanıcının verdiği metinler (2026-08-18), başlıksız.
   *
   * Hitap ("Sayın {ad},") ve ofis adı buraya YAZILMAZ; ikisini de sarmala()
   * ekliyor. Gövdeye de konsaydı mesajda iki kez "Sayın ..." görünürdü.
   */
  static readonly VARSAYILAN = {
    TALEP:
      '{dönem} dönemine ait muhasebe evraklarınız tarafımıza henüz ulaşmamıştır. ' +
      'Beyanname sürecinin aksamaması için evraklarınızı en kısa sürede iletmenizi rica ederiz.',
    GELDI:
      '{dönem} dönemine ait evraklarınız tarafımıza ulaşmış olup işlemleriniz başlatılmıştır. ' +
      'Bilginize sunarız.',
  };

  /** Tenant şablonu; yoksa varsayılan metin */
  async sablon(tenantId: string, tur: 'TALEP' | 'GELDI'): Promise<string> {
    const tpl = await this.prisma.smsTemplate.findUnique({ where: { tenantId } }).catch(() => null);
    const kayitli = tur === 'TALEP' ? tpl?.evrakTalepMesaji : tpl?.evrakGeldiMesaji;
    return (kayitli || '').trim() || EvrakMesajService.VARSAYILAN[tur];
  }

  /** Ofis adı — Akıllı Bildirim ayarındaki gönderen adı (ekstre ile aynı kaynak) */
  async ofisAdi(tenantId: string): Promise<string> {
    const ayar = await (this.prisma as any).smartDispatchSetting
      .findUnique({ where: { tenantId_kategori: { tenantId, kategori: 'VERGI' } } })
      .catch(() => null);
    return String(ayar?.senderName || 'MOREN MALİ MÜŞAVİRLİK');
  }

  /** {ad} / {dönem} yer tutucularını doldurur */
  doldur(sablon: string, ad: string, donem: string): string {
    return sablon
      .replace(/\{ad\}/g, ad)
      .replace(/\{dönem\}/g, donem)
      .replace(/\{donem\}/g, donem);
  }

  /**
   * BAŞLIK SARMALI — cari ekstre mesajıyla birebir aynı düzen (kullanıcı
   * kararı 2026-08-18): kalın "Gönderen" / ofis adı / kalın "Sayın" /
   * mükellef adı / gövde. Tek yerde durması şart: iki mesaj türü ayrı ayrı
   * biçimlenseydi biri değiştiğinde diğeri geride kalırdı.
   */
  sarmala(ofis: string, ad: string, govde: string): string {
    return ['*Gönderen*', ofis, '', '*Sayın*', `${ad},`, '', govde].join('\n');
  }

  /** Tam mesaj: şablonu oku, doldur, başlığı sar */
  async mesajKur(tenantId: string, tur: 'TALEP' | 'GELDI', ad: string, donem: string): Promise<string> {
    return this.sarmala(
      await this.ofisAdi(tenantId),
      ad,
      this.doldur(await this.sablon(tenantId, tur), ad, donem),
    );
  }

  // ------------------------------------------------------------- UYGUNLUK

  /**
   * MESAJ GİDER Mİ — TEK KURAL (kullanıcı kararı 2026-08-18).
   *
   * "Teslim günü tanımlanmayan mükellefe mesaj gitmeyecek; sadece teslim
   * tarihi tanımlı OLUP ilgili anahtar AÇIK ise gidecek."
   *
   * Kural üç ayrı yerde tekrarlanıyordu (cron sorgusu, olay tetikli onay,
   * Panel > Hatırlatmalar). Biri gevşediğinde ekran hata vermez, yalnız
   * istenmeyen mükellefe mesaj gider — o yüzden tek kaynak.
   *
   * NOT: Prisma sorgusu bu fonksiyonu çağıramaz (veritabanı tarafında süzmek
   * gerekiyor); sorgular aynı koşulları kurar, bu fonksiyon da son kapıda
   * tekrar doğrular. İkisi birden kaymadıkça mesaj sızmaz.
   */
  uygunMu(t: any, tur: 'TALEP' | 'GELDI'): { uygun: boolean; sebep?: string } {
    if (!t) return { uygun: false, sebep: 'mükellef bulunamadı' };
    if (t.isActive === false) return { uygun: false, sebep: 'mükellef pasif' };
    // TESLİM GÜNÜ ŞARTI — her iki mesaj türü için de geçerli
    if (t.evrakTeslimGunu == null) return { uygun: false, sebep: 'teslim günü tanımsız' };
    const anahtar = tur === 'TALEP' ? t.whatsappEvrakTalep : t.whatsappEvrakGeldi;
    if (anahtar !== true) {
      return {
        uygun: false,
        sebep: tur === 'TALEP' ? '"Evrak talep mesajı" anahtarı kapalı' : '"Evrak geldi onayı" anahtarı kapalı',
      };
    }
    if (!this.telefonlar(t).length) return { uygun: false, sebep: 'telefon yok' };
    return { uygun: true };
  }

  /** Mükellefin telefonları — phones[] öncelikli, yoksa phone */
  telefonlar(t: any): string[] {
    return t?.phones?.length ? t.phones.filter(Boolean) : t?.phone ? [t.phone] : [];
  }

  // ---------------------------------------------------------------- GÖNDER

  /**
   * TEK GÖNDERİM KAPISI.
   *
   * Test modunda mükellefe HİÇBİR mesaj gitmez; metin ofis sahibine iletilir.
   */
  async gonder(opts: {
    tenantId: string;
    taxpayer: any;
    metin: string;
    tur: 'TALEP' | 'GELDI';
    donem: string;
    sebep: string;
    /** Önizleme: mesai/tatil penceresini uygulama (yalnız sahibe giden testte) */
    mesaiYokSay?: boolean;
    /** Önizleme: MOREN_EVRAK_CANLI açık olsa bile mükellefe GÖNDERME */
    zorlaTest?: boolean;
    /** Test başlığını EKLEME — metin mükellefe gideceği haliyle görünsün */
    baslikSiz?: boolean;
  }): Promise<{ gonderildi: boolean; test: boolean; atlandi?: string }> {
    const { tenantId, taxpayer, metin, tur, donem, sebep } = opts;
    // zorlaTest, canlı şalterinin ÜSTÜNDE. Önizleme ucu bunu hep true verir;
    // böylece MOREN_EVRAK_CANLI=1 açıldığında bile o uç mükellefe mesaj atamaz.
    const test = opts.zorlaTest === true || !this.canliMi();

    // Mesai + resmî tatil. Gerçek akışta gece/hafta sonu/tatilde mesaj atmamak
    // bu kontrolün tek işi; yalnız önizlemede atlanabilir.
    if (!opts.mesaiYokSay && !this.mesaiIcindeMi()) {
      return { gonderildi: false, test, atlandi: this.resmiTatilMi() ? 'resmî tatil' : 'mesai dışı' };
    }

    const acik = await this.whatsapp.isAutomationActive(tenantId).catch(() => false);
    if (!acik) return { gonderildi: false, test, atlandi: 'WhatsApp ana şalter kapalı' };

    // ---- TEST: mükellefe gitmez, sahibe gider ----
    if (test) {
      const numaralar = this.testNumaralari();
      if (!numaralar.length) {
        this.logger.warn('[EvrakMesaj] TEST modu ama MOREN_OWNER_WHATSAPP_PHONES tanımlı değil — hiçbir yere gönderilmedi.');
        return { gonderildi: false, test: true, atlandi: 'test numarası tanımsız' };
      }

      // Başlıksız: metin birebir mükellefe gidecek hali. Yine de mükellefe
      // DEĞİL, yalnız sahibin numarasına gider — kapı burası, başlık değil.
      const govde = opts.baslikSiz
        ? metin
        : `🧪 EVRAK OTOMASYONU — TEST\n` +
          `Tür: ${tur === 'TALEP' ? 'Evrak talep hatırlatması' : 'Evrak geldi bilgilendirmesi'}\n` +
          `Mükellef: ${this.ad(taxpayer)}\n` +
          `Dönem: ${donem}\n` +
          `Gidecekti: ${this.telefonlar(taxpayer).join(', ') || '(telefon yok — canlıda atlanırdı)'}\n` +
          `Sebep: ${sebep}\n` +
          `──────────\n${metin}`;

      // Numara BASINA sonuc: iz kaydi her numara icin ayri yazilir.
      const sonuclar: Array<{ no: string; basarili: boolean }> = [];
      for (const n of numaralar) {
        sonuclar.push({ no: n, basarili: await this.whatsapp.sendMessage(n, govde, tenantId) });
      }
      const ok = sonuclar.some((x) => x.basarili);
      await this.izYaz({ tenantId, taxpayer, tur, donem, metin, test: true, hedefler: sonuclar, sebep });
      // Başarısızlıkta sebep DOLU dönmeli: çağıran "geçici engel mi" kararını
      // buna bakarak veriyor; boş kalırsa kayıt beklemeye alınmıyordu.
      return ok ? { gonderildi: true, test: true } : { gonderildi: false, test: true, atlandi: 'WhatsApp gönderimi başarısız' };
    }

    // ---- CANLI ----
    const hedefler = this.telefonlar(taxpayer);
    if (!hedefler.length) return { gonderildi: false, test: false, atlandi: 'telefon yok' };

    const sonuclar: Array<{ no: string; basarili: boolean }> = [];
    for (const n of hedefler) {
      sonuclar.push({ no: n, basarili: await this.whatsapp.sendMessage(n, metin, tenantId) });
    }
    const ok = sonuclar.some((x) => x.basarili);
    await this.izYaz({ tenantId, taxpayer, tur, donem, metin, test: false, hedefler: sonuclar, sebep });
    return ok ? { gonderildi: true, test: false } : { gonderildi: false, test: false, atlandi: 'WhatsApp gönderimi başarısız' };
  }

  /**
   * GÖNDERİM İZİ — her denemeyi kaydeder.
   *
   * Önce yalnız canlı + başarılı gönderim yazılıyordu; "gitti mi gitmedi mi"
   * sorusu veritabanından yanıtlanamıyor, yalnız uygulama logunda kalıyordu.
   * Test gönderimleri de yazılır ama başlığında TEST der, gerçekle karışmaz.
   */
  private async izYaz(o: {
    tenantId: string; taxpayer: any; tur: 'TALEP' | 'GELDI'; donem: string;
    metin: string; test: boolean; hedefler: Array<{ no: string; basarili: boolean }>; sebep: string;
  }) {
    try {
      const tur = o.tur === 'TALEP' ? 'Evrak hatırlatma' : 'Evrak geldi bilgisi';

      // HER NUMARAYA AYRI KAYIT.
      //
      // Önce gönderim başına TEK kayıt yazılıyordu ve o kayıt yalnız İLK
      // numarayla damgalanıyordu. Konuşmalar bu damgaya göre gruplandığı için
      // (conversationId = taxpayerId__wa__numara), iki numarası olan mükellefte
      // mesaj İKİSİNE DE gittiği hâlde ekranda tek konuşma görünüyordu —
      // ikinci numaraya giden mesajın izi hiçbir yerde yoktu.
      if (!o.hedefler.length) {
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: o.taxpayer.id,
            channel: 'WHATSAPP',
            subject: `${o.test ? '[TEST] ' : ''}${tur} — ${o.donem} — Başarısız · Hedef: (yok) · ${o.sebep}`,
            content: o.metin,
            occurredAt: new Date(),
          },
        });
        return;
      }

      for (const h of o.hedefler) {
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: o.taxpayer.id,
            channel: 'WHATSAPP',
            subject:
              `${o.test ? '[TEST] ' : ''}${tur} — ${o.donem} — ` +
              `${h.basarili ? 'Gönderildi' : 'Başarısız'} · Hedef: ${h.no} · ${o.sebep}`,
            // İÇERİK = GÖNDERİLEN METNİN AYNISI. Teşhis bilgisi bir süre metnin
            // ALTINA ekleniyordu; Mesaj Merkezi ekranı bu kaydı gösterdiği için
            // "gönderilen" ile "görünen" ayrışıyordu. Teşhis artık başlıkta.
            content: this.telefonBasligi(o.metin, h.no),
            occurredAt: new Date(),
          },
        });
      }
    } catch (err: any) {
      this.logger.warn(`[EvrakMesaj] CommunicationLog yazılamadı: ${err?.message}`);
    }
  }

  private normalizeTelefon(value?: string | null): string {
    let d = String(value || '').replace(/[^\d]/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0') && d.length === 11) d = `90${d.slice(1)}`;
    if (d.length === 10 && d.startsWith('5')) d = `90${d}`;
    return d;
  }

  private telefonBasligi(content: string, phone?: string | null): string {
    const n = this.normalizeTelefon(phone);
    return n ? `[[wa_phone:${n}]]\n${content}` : content;
  }
}
