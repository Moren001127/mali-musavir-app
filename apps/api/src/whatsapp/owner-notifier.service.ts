import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from './whatsapp.service';
import { StorageService } from '../storage/storage.service';

/**
 * Portalda olusan tum bildirimleri (notification.create) yakalar ve ofis sahibine
 * WhatsApp uzerinden anlik mesaj olarak iletir.
 *
 * - PrismaService middleware uzerinden tetiklenir (kod degisikligi yok)
 * - Tipe gore emoji + format mapping uygular
 * - Rate limit: ayni (tenant, type) icin 10 sn debounce (spam onleme)
 * - Type filter: env ile bazi tipler kapatilabilir
 */
@Injectable()
export class OwnerNotifierService implements OnModuleInit {
  private readonly logger = new Logger(OwnerNotifierService.name);
  /** key: tenantId::type, value: son gonderim timestamp (ms) */
  private lastSent = new Map<string, number>();
  /** Spam koruma: ayni tip icin debounce window */
  private readonly DEBOUNCE_MS = Number(process.env.OWNER_NOTIFY_DEBOUNCE_MS || 10_000);

  // WhatsApp'a İLETİLMEYECEK bildirim tipleri (kullanıcı kararı 2026-06-13): gürültü /
  // aksiyon gerektirmeyen, portal zilinde kalması yeterli olanlar. Kritik/zaman-hassas
  // tipler (PORTAL_CREDENTIAL_FAIL, E_TEBLIGAT, TAX_DEADLINE, LUCA_SYNC_ERROR,
  // AI_COST_LIMIT, AUTH_NEW_DEVICE, PENDING_DECISION, BANK_TRANSACTION_ALERT,
  // INVOICE_OVERDUE, TASK_DUE) WhatsApp'a gelmeye DEVAM eder. Gerekirse env
  // OWNER_NOTIFY_DISABLE_TYPES ile ek tip kapatılabilir.
  private static readonly DEFAULT_DISABLED_TYPES = new Set<string>([
    'DOCUMENT_UPLOADED', 'AGENT', 'AUTOMATION', 'SYSTEM',
    'AI', 'AI_PROPOSAL', 'MOREN_AI_ALERT', 'OFFICE_CHAT',
    'KDV_RESULT', 'MIHSAP_RESULT',
  ]);

  // SESSİZ SAAT (kullanıcı kararı 2026-07-04): gece 22:00–09:00 arası owner'a
  // anlık WhatsApp GİTMEZ (gece tebligat/beyanname sorguları tek tek mesaj
  // atıp uyandırıyordu). Bildirimler zaten DB'de birikir; sabah 09:00'da
  // OwnerDigestService tek toplu özet mesajı gönderir. İSTİSNA: güvenlik
  // (yeni cihaz girişi) gece de anında gider.
  private static readonly NIGHT_INSTANT_TYPES = new Set<string>(['AUTH_NEW_DEVICE']);

  /** Europe/Istanbul saatine göre sessiz saat penceresi içinde miyiz? */
  static isQuietHours(now: Date = new Date()): boolean {
    const start = Number(process.env.OWNER_NOTIFY_QUIET_START || 22); // saat (dahil)
    const end = Number(process.env.OWNER_NOTIFY_QUIET_END || 9);      // saat (hariç)
    if (Number.isNaN(start) || Number.isNaN(end) || start === end) return false;
    const hour = Number(
      new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', hour12: false, timeZone: 'Europe/Istanbul' }).format(now),
    );
    return start > end ? hour >= start || hour < end : hour >= start && hour < end;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    // Prisma middleware'i tetiklediginde callback calisir
    this.prisma.onNotificationCreated((n) => {
      // Sync icinde await yapma, fire-and-forget
      this.handleNotification(n).catch((err) => {
        this.logger.warn(`Owner notify hata: ${err?.message || err}`);
      });
    });
    this.logger.log('OwnerNotifierService kuruldu — portala dusen bildirimler WhatsApp owner\'a iletilecek');
  }

  private async handleNotification(n: any): Promise<void> {
    if (!n || !n.tenantId || !n.title) return;

    // WHATSAPP tipi: bot controller zaten kendi ozel formatiyla owner'a iletiyor
    // (mukellef/kayitsiz/owner bildirim akislari). Duplicate olmasin diye atlanir.
    if (n.type === 'WHATSAPP') return;

    // GALERI_HGS_OZET: borc ozeti metadata.message'taki hazir metinle, metadata.phones'taki
    // SABIT numaralara gonderilir (owner listesi DEGIL). Tip filtresinden once islenir.
    if (n.type === 'GALERI_HGS_OZET') {
      await this.sendGaleriHgsOzet(n).catch((err) =>
        this.logger.warn(`Galeri HGS ozet gonderim hatasi: ${err?.message || err}`));
      return;
    }

    // Tip filtreleme: koddaki varsayılan kapalı liste + env ek liste.
    if (OwnerNotifierService.DEFAULT_DISABLED_TYPES.has(n.type)) return;
    const disabledTypes = String(process.env.OWNER_NOTIFY_DISABLE_TYPES || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (disabledTypes.includes(n.type)) return;

    // Sessiz saat: gece anlık gönderme (güvenlik hariç) — sabah 09:00 özetine kalır.
    if (OwnerNotifierService.isQuietHours() && !OwnerNotifierService.NIGHT_INSTANT_TYPES.has(n.type)) {
      this.logger.debug(`Owner notify sessiz saat: ${n.type} sabah özetine ertelendi`);
      return;
    }

    // Debounce — ayni tip son 10 sn icinde gonderildiyse atla. E_TEBLIGAT MUAF: her bildirim
    // farkli mukellefin/tebligatin PDF'ini tasir, gece toplu is bitisinde kaybolmamali.
    if (n.type !== 'E_TEBLIGAT') {
      const key = `${n.tenantId}::${n.type}`;
      const now = Date.now();
      const last = this.lastSent.get(key) || 0;
      if (now - last < this.DEBOUNCE_MS) {
        this.logger.debug(`Owner notify debounce: ${key}`);
        return;
      }
      this.lastSent.set(key, now);
    }

    // Owner WhatsApp telefonlari
    const ownerPhones = this.getOwnerPhones();
    if (!ownerPhones.length) return;

    // e-Tebligat: generic "OTOMATİK BİLDİRİM" formati yerine firma ismiyle + tebligatin
    // PDF'ini dosya olarak gonder (kullanici karari 2026-06-13).
    if (n.type === 'E_TEBLIGAT') {
      await this.sendETebligatToOwner(n, ownerPhones).catch((err) =>
        this.logger.warn(`e-Tebligat owner gonderim hatasi: ${err?.message || err}`));
      return;
    }

    const message = this.formatMessage(n);

    for (const phone of ownerPhones) {
      try {
        await this.whatsapp.sendMessage(phone, message, n.tenantId, { quote: false });
      } catch (err: any) {
        this.logger.warn(`Owner WhatsApp gonderim hatasi (${phone}): ${err?.message || err}`);
      }
    }
  }

  /**
   * Galeri HGS borc ozeti: hazir metni (metadata.message) metadata.phones'taki sabit
   * numaralara gonderir. Numara yoksa env GALERI_HGS_WHATSAPP_PHONES, o da yoksa owner.
   */
  private async sendGaleriHgsOzet(n: any): Promise<void> {
    const meta = n.metadata && typeof n.metadata === 'object' ? n.metadata : {};
    const message = String(meta.message || n.body || '').trim();
    if (!message) return;
    let phones: string[] = Array.isArray(meta.phones) ? meta.phones : [];
    if (!phones.length) {
      phones = String(process.env.GALERI_HGS_WHATSAPP_PHONES || '').split(',').map((p) => p.trim()).filter(Boolean);
    }
    const targets = Array.from(new Set(phones.map((p) => this.normalize(p)).filter(Boolean)));
    if (!targets.length) {
      // Hedef numara tanimli degilse owner'a dus (sessizce kaybolmasin).
      targets.push(...this.getOwnerPhones());
    }
    for (const phone of targets) {
      try {
        await this.whatsapp.sendMessage(phone, message, n.tenantId, { quote: false });
      } catch (err: any) {
        this.logger.warn(`Galeri HGS WhatsApp hatasi (${phone}): ${err?.message || err}`);
      }
    }
  }

  /**
   * e-Tebligat bildirimi: metadata.newDocIds'teki her tebligat icin owner'a firma ismi
   * basligiyla + PDF dosyasi (S3 presigned URL) WhatsApp medya mesaji gonderir.
   */
  // OwnerDigestService sabah özeti sonrası gece tebligat PDF'lerini de bu yolla yollar.
  async sendETebligatToOwner(n: any, ownerPhones: string[]): Promise<void> {
    const meta = n.metadata && typeof n.metadata === 'object' ? n.metadata : {};
    const ids: string[] = Array.isArray(meta.newDocIds) ? meta.newDocIds.filter(Boolean) : [];
    if (!ids.length) return;

    const docs = await (this.prisma as any).portalDocument.findMany({
      where: { id: { in: ids }, tenantId: n.tenantId, belgeTuru: 'E_TEBLIGAT', storageKey: { not: null } },
      include: { taxpayer: { select: { companyName: true, firstName: true, lastName: true, taxNumber: true } } },
    });
    if (!docs.length) return;

    const ownerAd =
      String(process.env.MOREN_OWNER_DISPLAY_NAME || 'Muzaffer').trim().split(/\s+/)[0] || 'Muzaffer';

    // Toplu backfill (cok sayida yeni tebligat ayni anda) owner'i PDF yagmuruna bogmasin:
    // esik ustunde tek tek PDF yerine TEK OZET mesaj gonder. Gunluk normal hacim (<=esik)
    // PDF olarak gider.
    const maxPdf = Math.max(1, Number(process.env.ETEBLIGAT_OWNER_PDF_MAX || 6));
    if (docs.length > maxPdf) {
      const firmaSet = new Set<string>(docs.map((d: any) => this.docFirmaAdi(d)));
      const firmalar = Array.from(firmaSet).slice(0, 4).join(', ') + (firmaSet.size > 4 ? ' …' : '');
      const ozet = [
        `Merhaba ${ownerAd} Bey,`,
        '',
        `Bu gece *${docs.length}* mükellefinize Gelir İdaresi Başkanlığı tarafından yeni e-Tebligat gelmiştir.`,
        firmalar ? `İlgili mükellefler: ${firmalar}` : '',
        '',
        'Tümünü portaldan görüntüleyebilirsiniz. İncelemeniz için bilginize.',
      ].filter(Boolean).join('\n');
      for (const phone of ownerPhones) {
        try {
          await this.whatsapp.sendMessage(phone, ozet, n.tenantId, { quote: false });
        } catch (err: any) {
          this.logger.warn(`e-Tebligat ozet WhatsApp hatasi (${phone}): ${err?.message || err}`);
        }
      }
      return;
    }

    for (const d of docs) {
      const firma = this.docFirmaAdi(d);
      const r = d.raw && typeof d.raw === 'object' ? d.raw : {};
      const kurum = [r.kurumAciklama, r.altKurum].filter(Boolean).join(' · ');
      const belge = `${d.title || r.belgeTuruAciklama || 'Tebligat'}${d.referenceNo ? ' · ' + d.referenceNo : ''}`;

      const filename = `${d.referenceNo || 'tebligat'}.pdf`;
      let url: string | null = null;
      try {
        url = await this.storage.getPresignedInlineUrl(d.storageKey, filename, d.mimeType || 'application/pdf');
      } catch (e: any) {
        this.logger.warn(`e-Tebligat PDF URL uretilemedi (${d.id}): ${e?.message || e}`);
      }

      // STANDART ŞABLON — bilgilendirme mesajı ÖNCE gönderilir, belge SONRA ayrı dosya olarak.
      // (Eskiden PDF caption ile birlikte gidiyordu → karışık görünüyordu. Kullanıcı isteği:
      //  önce mesaj, sonra dosya, hepsi tek standart formatta.)
      // NAİF/DÜZGÜN ŞABLON (kullanıcı isteği 2026-08-06): soğuk emoji-listesi yerine
      //   sıcak, kurumsal prosa. Owner adıyla hitap + kalın anahtar cümle + sade detay.
      const detay = [
        kurum ? `Gönderen: ${kurum}` : '',
        `Belge: ${belge}`,
        r.tebligZamani ? `Tebliğ tarihi: ${r.tebligZamani}` : '',
      ].filter(Boolean).join('\n');
      const mesaj = [
        `Merhaba ${ownerAd} Bey,`,
        '',
        `*${firma}* mükellefinize Gelir İdaresi Başkanlığı tarafından yeni bir e-Tebligat gelmiştir.`,
        '',
        detay,
        '',
        url
          ? 'Tebligat içeriği ekte sunulmuştur. İncelemeniz için bilginize.'
          : 'Tebligatı portaldan görüntüleyebilirsiniz. İncelemeniz için bilginize.',
      ].filter(Boolean).join('\n');

      for (const phone of ownerPhones) {
        try {
          // 1) ÖNCE bilgilendirme mesajı
          await this.whatsapp.sendMessage(phone, mesaj, n.tenantId, { quote: false });
          // 2) SONRA belgeyi caption'sız temiz dosya olarak gönder
          if (url) {
            await this.whatsapp.sendMediaDetailed(phone, { url, mimeType: 'application/pdf', filename, caption: null }, n.tenantId, { quote: false });
          }
        } catch (err: any) {
          this.logger.warn(`e-Tebligat owner WhatsApp hatasi (${phone}): ${err?.message || err}`);
        }
      }
    }
  }

  /** Belge mukellefinin gosterilecek adi (firma / ad soyad / vergi no). */
  private docFirmaAdi(d: any): string {
    const t = d?.taxpayer;
    if (!t) return 'Mükellef';
    if (t.companyName) return t.companyName;
    const ad = [t.firstName, t.lastName].filter(Boolean).join(' ').trim();
    return ad || t.taxNumber || 'Mükellef';
  }

  /**
   * Mesaj formati — emoji + tip etiketi + baslik + body + zaman.
   * Type'a gore emoji secimi.
   */
  private formatMessage(n: any): string {
    const meta = this.formatMeta(n.type);
    const time = new Date(n.createdAt || Date.now()).toLocaleTimeString('tr-TR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
    });

    const title = String(n.title || '').slice(0, 100).trim();
    const body = String(n.body || '').slice(0, 400).trim();

    // İlk satır "📢 OTOMATİK BİLDİRİM" ile başlar → owner bunu SOHBET CEVABI sanmasın
    // (önceden bildirim sorunun hemen ardına düşünce "bota sordum bunu mu cevap verdi"
    // karışıklığı oluyordu — örn. portal şifre hatası bir mevzuat sorusunun cevabı gibi).
    const lines: string[] = [];
    lines.push(`📢 OTOMATİK BİLDİRİM · ${meta.label} · ${time}`);
    lines.push('');
    if (title) lines.push(title);
    if (body && body !== title) lines.push(body);
    lines.push('');
    lines.push('ℹ️ Bu otomatik bir sistem bildirimidir; mesajınıza verilen bir cevap değildir.');

    return lines.join('\n');
  }

  /** Bildirim tipi → emoji + label */
  private formatMeta(type: string): { emoji: string; label: string } {
    const map: Record<string, { emoji: string; label: string }> = {
      WHATSAPP: { emoji: '📩', label: 'WhatsApp' },
      MOREN_AI_ALERT: { emoji: '🤖', label: 'AI Uyari' },
      AI_COST_LIMIT: { emoji: '⚠️', label: 'AI Maliyet' },
      AI_PROPOSAL: { emoji: '🔔', label: 'AI Oneri' },
      E_TEBLIGAT: { emoji: '📨', label: 'e-Tebligat' },
      PORTAL_CREDENTIAL_FAIL: { emoji: '🔑', label: 'Portal Şifre' },
      TAX_DEADLINE: { emoji: '📅', label: 'Beyan Suresi' },
      TASK_DUE: { emoji: '✅', label: 'Gorev' },
      EVRAK: { emoji: '📂', label: 'Evrak' },
      EVRAK_GELDI: { emoji: '📥', label: 'Evrak Geldi' },
      EVRAK_ISLENDI: { emoji: '✅', label: 'Evrak Islendi' },
      KDV_KONTROL: { emoji: '🔍', label: 'KDV Kontrol' },
      BEYAN: { emoji: '📝', label: 'Beyan' },
      MESAJ: { emoji: '💬', label: 'Mesaj' },
      MUKELLEF: { emoji: '👤', label: 'Mukellef' },
      LUCA: { emoji: '📊', label: 'Luca' },
      MIHSAP: { emoji: '🧾', label: 'Mihsap' },
      AGENT: { emoji: '🤖', label: 'Agent' },
      SYSTEM: { emoji: 'ℹ️', label: 'Sistem' },
    };
    return map[type] || { emoji: '🔔', label: 'Bildirim' };
  }

  getOwnerPhones(): string[] {
    const raw = String(process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || '').trim();
    if (!raw) return [];
    return raw.split(',').map((p) => this.normalize(p)).filter(Boolean);
  }

  private normalize(raw: string): string {
    let digits = String(raw).replace(/[^\d]/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) digits = '90' + digits.slice(1);
    if (digits.length === 10 && digits.startsWith('5')) digits = '90' + digits;
    return digits;
  }
}
