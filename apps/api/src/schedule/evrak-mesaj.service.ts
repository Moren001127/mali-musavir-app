import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

/**
 * EVRAK MESAJLARI — tek kapı.
 *
 * Evrak talep hatırlatması ve "evrak geldi" bilgilendirmesi buradan çıkar.
 * Tek kapı olması şart: gönderim kararı (test mi canlı mı, mesai içinde mi,
 * telefon var mı) iki ayrı yerde tekrarlansaydı biri gevşediğinde mükellefe
 * istenmeyen mesaj giderdi. Geçmişte bir belge akışında bu koruma yoktu ve
 * üç gerçek mesaj mükellefe ulaştı.
 *
 * VARSAYILAN: TEST. Mesaj mükellefe DEĞİL, ofis sahibine gider ve başına
 * "kime gidecekti / neden" bilgisi eklenir. Gerçek gönderim yalnız
 * MOREN_EVRAK_CANLI=1 ile açılır — env değişikliği bilinçli bir adımdır.
 */
@Injectable()
export class EvrakMesajService {
  private readonly logger = new Logger(EvrakMesajService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsAppService,
  ) {}

  /** Gerçek gönderim açık mı — varsayılan KAPALI (test). */
  canliMi(): boolean {
    return process.env.MOREN_EVRAK_CANLI === '1';
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

  /**
   * MESAİ PENCERESİ — Pazartesi–Cuma, 09:00–17:00 (Türkiye saati).
   *
   * Sunucu UTC çalışıyor; TR saatini yerel saate güvenerek hesaplamak yaz/kış
   * saatinde kayar. Bu yüzden saat dilimi açıkça veriliyor.
   */
  mesaiIcindeMi(an: Date = new Date()): boolean {
    const tr = new Date(an.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
    const gun = tr.getDay(); // 0 Pazar, 6 Cumartesi
    if (gun === 0 || gun === 6) return false;
    const saat = tr.getHours();
    return saat >= 9 && saat < 17;
  }

  /** Mükellefin ekranda görünen adı */
  ad(t: any): string {
    return (
      t?.companyName ||
      `${t?.firstName || ''} ${t?.lastName || ''}`.trim() ||
      'Sayın Mükellef'
    );
  }

  /** "2026-07" → "Temmuz 2026" */
  donemAdi(yil: number, ay: number): string {
    const aylar = [
      'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
      'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
    ];
    return `${aylar[ay - 1]} ${yil}`;
  }

  /** Tenant şablonu; yoksa varsayılan metin */
  async sablon(tenantId: string, tur: 'TALEP' | 'GELDI'): Promise<string> {
    const tpl = await this.prisma.smsTemplate.findUnique({ where: { tenantId } }).catch(() => null);
    if (tur === 'TALEP') {
      return (
        tpl?.evrakTalepMesaji ||
        'Sayın {ad}, {dönem} dönemine ait muhasebe evraklarınız tarafımıza henüz ulaşmamıştır. ' +
          'Beyanname sürecinin aksamaması için evraklarınızı en kısa sürede iletmenizi rica ederiz. ' +
          'Moren Mali Müşavirlik'
      );
    }
    return (
      tpl?.evrakGeldiMesaji ||
      'Sayın {ad}, {dönem} dönemine ait evraklarınız tarafımıza ulaşmış olup işlemleriniz başlatılmıştır. ' +
        'Bilginize sunarız. Moren Mali Müşavirlik'
    );
  }

  /** {ad} / {dönem} yer tutucularını doldurur */
  doldur(sablon: string, ad: string, donem: string): string {
    return sablon
      .replace(/\{ad\}/g, ad)
      .replace(/\{dönem\}/g, donem)
      .replace(/\{donem\}/g, donem);
  }

  /** Mükellefin telefonları — phones[] öncelikli, yoksa phone */
  telefonlar(t: any): string[] {
    return t?.phones?.length ? t.phones.filter(Boolean) : t?.phone ? [t.phone] : [];
  }

  /**
   * TEK GÖNDERİM KAPISI.
   *
   * Test modunda mükellefe HİÇBİR mesaj gitmez; metin ofis sahibine, kime ve
   * neden gideceği başlıkta yazılı olarak iletilir.
   */
  async gonder(opts: {
    tenantId: string;
    taxpayer: any;
    metin: string;
    tur: 'TALEP' | 'GELDI';
    donem: string;
    sebep: string;
    /** Önizleme: mesai penceresini uygulama (yalnız sahibe giden testte) */
    mesaiYokSay?: boolean;
    /** Önizleme: MOREN_EVRAK_CANLI açık olsa bile mükellefe GÖNDERME */
    zorlaTest?: boolean;
  }): Promise<{ gonderildi: boolean; test: boolean; atlandi?: string }> {
    const { tenantId, taxpayer, metin, tur, donem, sebep } = opts;
    // zorlaTest, canlı şalterinin ÜSTÜNDE. Önizleme ucu bunu hep true verir;
    // böylece ileride MOREN_EVRAK_CANLI=1 açıldığında bile o uç mükellefe
    // mesaj atamaz — önizleme, gönderim yetkisi kazanmış olmaz.
    const test = opts.zorlaTest === true || !this.canliMi();

    // Mesai dışı gönderim yalnız önizlemede atlanabilir: gerçek akışta gece
    // mesaj atmamak bu kontrolün tek işi.
    if (!opts.mesaiYokSay && !this.mesaiIcindeMi()) {
      return { gonderildi: false, test, atlandi: 'mesai dışı' };
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
      const hedefler = this.telefonlar(taxpayer);
      const baslik =
        `🧪 EVRAK OTOMASYONU — TEST\n` +
        `Tür: ${tur === 'TALEP' ? 'Evrak talep hatırlatması' : 'Evrak geldi bilgilendirmesi'}\n` +
        `Mükellef: ${this.ad(taxpayer)}\n` +
        `Dönem: ${donem}\n` +
        `Gidecekti: ${hedefler.length ? hedefler.join(', ') : '(telefon yok — canlıda atlanırdı)'}\n` +
        `Sebep: ${sebep}\n` +
        `──────────\n`;
      let ok = false;
      for (const n of numaralar) {
        if (await this.whatsapp.sendMessage(n, baslik + metin, tenantId)) ok = true;
      }
      return { gonderildi: ok, test: true };
    }

    // ---- CANLI ----
    const hedefler = this.telefonlar(taxpayer);
    if (!hedefler.length) return { gonderildi: false, test: false, atlandi: 'telefon yok' };

    let ok = false;
    const ulasan: string[] = [];
    for (const n of hedefler) {
      if (await this.whatsapp.sendMessage(n, metin, tenantId)) {
        ok = true;
        ulasan.push(n);
      }
    }

    if (ok) {
      try {
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: taxpayer.id,
            channel: 'WHATSAPP',
            subject: `${tur === 'TALEP' ? 'Evrak hatırlatma' : 'Evrak geldi bilgisi'} — ${donem}`,
            content: this.telefonBasligi(metin, ulasan[0]),
            occurredAt: new Date(),
          },
        });
      } catch (err: any) {
        this.logger.warn(`[EvrakMesaj] CommunicationLog yazılamadı: ${err?.message}`);
      }
    }
    return { gonderildi: ok, test: false };
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
