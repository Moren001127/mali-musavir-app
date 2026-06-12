import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from './whatsapp.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
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

    // Tip filtreleme — env'den disable edilebilir (virgulle ayrilmis tip listesi)
    const disabledTypes = String(process.env.OWNER_NOTIFY_DISABLE_TYPES || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (disabledTypes.includes(n.type)) return;

    // Debounce — ayni tip son 10 sn icinde gonderildiyse atla
    const key = `${n.tenantId}::${n.type}`;
    const now = Date.now();
    const last = this.lastSent.get(key) || 0;
    if (now - last < this.DEBOUNCE_MS) {
      this.logger.debug(`Owner notify debounce: ${key}`);
      return;
    }
    this.lastSent.set(key, now);

    // Owner WhatsApp telefonlari
    const ownerPhones = this.getOwnerPhones();
    if (!ownerPhones.length) return;

    const message = this.formatMessage(n);

    for (const phone of ownerPhones) {
      try {
        await this.whatsapp.sendMessage(phone, message, n.tenantId);
      } catch (err: any) {
        this.logger.warn(`Owner WhatsApp gonderim hatasi (${phone}): ${err?.message || err}`);
      }
    }
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

  private getOwnerPhones(): string[] {
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
