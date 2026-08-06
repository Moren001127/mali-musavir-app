import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { calculateBeyannameDeadline } from '../schedule/beyanname-deadline.util';
import { DEFAULT_SENDER } from './akilli-bildirim.service';

export interface OdemeSatiri {
  tur: string; // KDV1, MUHSGK, Tahakkuk Fişi...
  kaynak: 'VERGI' | 'SGK';
  donem: string;
  sonGun: string | null; // g.a.yyyy
  tutar: number;
  storageKey?: string | null; // belge PDF anahtarı (link için)
}

export interface OdemeListesi {
  taxpayerId: string;
  unvan: string;
  phone: string | null;
  email: string | null;
  satirlar: OdemeSatiri[];
  toplam: number;
}

// Hattat ile birebir: "4.182,86  TL" (çift boşluk), "28.2.2026" (sıfırsız)
function trMoney(n: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + '  TL';
}
function trDate(d: Date): string {
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}
function parseTutar(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

@Injectable()
export class AylikOdemeService {
  private readonly logger = new Logger(AylikOdemeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly whatsapp: WhatsAppService,
    private readonly email: EmailService,
  ) {}

  /**
   * month: ÖDEME AYI ('YYYY-MM'). Tahakkuklar bir önceki DÖNEME aittir
   * (Temmuz'da ödenen = Haziran dönemi beyannameleri). taxpayerId verilirse tek mükellef.
   */
  async list(tenantId: string, month: string, taxpayerId?: string): Promise<OdemeListesi[]> {
    const [my, mm] = month.split('-').map(Number);
    const prev = new Date(my, mm - 2, 1);
    const donem = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const sgkPeriod = donem.replace('-', '/');
    const map = new Map<string, OdemeListesi>();

    const ensure = (tp: any): OdemeListesi => {
      let row = map.get(tp.id);
      if (!row) {
        row = {
          taxpayerId: tp.id,
          unvan: (tp.companyName || `${tp.firstName || ''} ${tp.lastName || ''}`.trim() || 'Mükellef').toString(),
          phone: tp.phone || (tp.phones && tp.phones[0]) || null,
          email: tp.email || (tp.emails && tp.emails[0]) || null,
          satirlar: [],
          toplam: 0,
        };
        map.set(tp.id, row);
      }
      return row;
    };

    // Vergi tahakkukları (aylık dönem + o ay vadesi bu aya düşen çeyreklik/yıllıklar hariç: v1 = donem eşleşmesi)
    const beyanlar = await (this.prisma as any).beyanKaydi.findMany({
      where: {
        tenantId,
        donem,
        tahakkukTutari: { not: null },
        ...(taxpayerId ? { taxpayerId } : {}),
      },
      include: { taxpayer: true },
      take: 5000,
    });
    for (const b of beyanlar) {
      if (!b.taxpayer) continue;
      const tutar = Number(b.tahakkukTutari);
      if (!Number.isFinite(tutar) || tutar === 0) continue;
      const row = ensure(b.taxpayer);
      const vade = calculateBeyannameDeadline(b.beyanTipi, b.donem);
      row.satirlar.push({
        tur: b.beyanTipi,
        kaynak: 'VERGI',
        donem: b.donem,
        sonGun: vade ? trDate(vade) : null,
        tutar,
        storageKey: b.pdfUrl || b.beyannameUrl || null,
      });
      row.toplam += tutar;
    }

    // SGK tahakkuk fişleri
    const sgkDocs = await (this.prisma as any).portalDocument.findMany({
      where: {
        tenantId,
        belgeTuru: 'SGK_TAHAKKUK',
        ...(taxpayerId ? { taxpayerId } : {}),
        OR: [{ period: sgkPeriod }, { period: donem }],
      },
      include: { taxpayer: true },
      take: 5000,
    });
    for (const d of sgkDocs) {
      if (!d.taxpayer) continue;
      const raw = (d.raw || {}) as Record<string, any>;
      const tutar = parseTutar(raw.tutar);
      if (tutar == null) continue;
      const row = ensure(d.taxpayer);
      // SGK son ödeme = dönemi izleyen ayın (ödeme ayının) son günü
      const sgkSon = new Date(my, mm, 0);
      row.satirlar.push({
        tur: (d.title || 'Tahakkuk Fişi').replace(/^SGK\s+/i, ''),
        kaynak: 'SGK',
        donem: d.period || sgkPeriod,
        sonGun: trDate(sgkSon),
        tutar,
        storageKey: d.storageKey || null,
      });
      row.toplam += tutar;
    }

    return [...map.values()]
      .filter((r) => r.satirlar.length > 0)
      .sort((a, b) => a.unvan.localeCompare(b.unvan, 'tr'));
  }

  /** Hattat ile birebir kalıp; sonda belge linkleri. */
  composeMessage(senderName: string, row: OdemeListesi, links: string[] = []): string {
    const lines: string[] = [];
    lines.push('*Gönderen* ');
    lines.push(senderName);
    lines.push('');
    lines.push('*Merhaba* ');
    lines.push(` ${row.unvan},`);
    lines.push('');
    lines.push('Aşağıdaki Ödeme Listeniz Bilginize Sunulmuştur,');
    lines.push('');
    for (const s of row.satirlar) {
      // Vergi: "KDV1 - Tahakkuk - Son Ödeme: 28.7.2026 - 9.018,30  TL"
      // SGK  : "Tahakkuk Fişi - 2026/06 - Son Ödeme: 31.7.2026 - 24.277,05  TL"
      const parts = s.kaynak === 'VERGI' ? [s.tur, 'Tahakkuk'] : [s.tur, s.donem];
      if (s.sonGun) parts.push(`Son Ödeme: ${s.sonGun}`);
      parts.push(trMoney(s.tutar));
      lines.push(parts.join(' - '));
    }
    lines.push('');
    lines.push(`Toplam: ${trMoney(row.toplam)}`);
    if (links.length > 0) {
      lines.push('');
      for (const l of links) lines.push(l);
    }
    return lines.join('\n');
  }

  /** Tek mükellefe (veya taxpayerId'siz tüm listeye) ödeme cetveli mesajı gönderir. */
  async send(tenantId: string, month: string, taxpayerId?: string) {
    const settings = await (this.prisma as any).smartDispatchSetting.findUnique({
      where: { tenantId_kategori: { tenantId, kategori: 'VERGI' } },
    });
    const testMode = settings?.testMode ?? true;
    const senderName = (settings?.senderName || DEFAULT_SENDER).toString();

    const rows = await this.list(tenantId, month, taxpayerId);
    const results: any[] = [];
    for (const row of rows) {
      const links: string[] = [];
      for (const s of row.satirlar) {
        if (!s.storageKey) continue;
        try {
          links.push(await this.storage.getPresignedInlineUrl(s.storageKey, `${s.tur}-${s.donem}.pdf`, 'application/pdf', 7 * 24 * 3600));
        } catch (e: any) {
          this.logger.warn(`link üretilemedi ${s.tur} ${s.donem}: ${e?.message}`);
        }
      }
      const message = this.composeMessage(senderName, row, links);
      const dedupeKey = `ODEME:${row.taxpayerId}:${month}`;
      const targetPhone = testMode ? settings?.testPhone : row.phone;
      const targetEmail = testMode ? settings?.testEmail : row.email;

      for (const channel of ['WHATSAPP', 'EMAIL'] as const) {
        if (channel === 'WHATSAPP' && settings && !settings.whatsapp) continue;
        if (channel === 'EMAIL' && settings && !settings.email) continue;
        let status = 'FAILED';
        let error: string | null = null;
        try {
          if (channel === 'WHATSAPP') {
            if (!targetPhone) throw new Error(testMode ? 'test telefonu girilmemiş' : 'mükellefin telefon numarası yok');
            const sent = await this.whatsapp.sendMessageDetailed(targetPhone, message, tenantId, { quote: false } as any);
            if (!(sent as any)?.ok) throw new Error((sent as any)?.error || 'whatsapp gönderilemedi');
            status = 'SENT';
          } else {
            if (!targetEmail) throw new Error(testMode ? 'test e-postası girilmemiş' : 'mükellefin e-postası yok');
            const res = await this.email.send(
              { to: targetEmail, subject: `${month} Dönemi Ödeme Listesi — ${row.unvan}`, text: message.replace(/\*/g, '') },
              tenantId,
            );
            if (!res.sent) throw new Error('e-posta gönderilemedi');
            status = 'SENT';
          }
        } catch (e: any) {
          error = e?.message || String(e);
        }
        await (this.prisma as any).documentDispatch.upsert({
          where: { tenantId_dedupeKey_channel: { tenantId, dedupeKey, channel } },
          create: {
            tenantId,
            taxpayerId: row.taxpayerId,
            kategori: 'ODEME_LISTESI',
            donem: month,
            channel,
            status,
            error,
            itemCount: row.satirlar.length,
            totalAmount: row.toplam,
            docRefs: null,
            dedupeKey,
            testMode: !!testMode,
            sentAt: status === 'SENT' ? new Date() : null,
          },
          update: { status, error, sentAt: status === 'SENT' ? new Date() : null, testMode: !!testMode },
        });
        results.push({ taxpayerId: row.taxpayerId, unvan: row.unvan, channel, status, error });
      }
    }
    return { ok: true, month, testMode, count: results.length, results };
  }
}
