import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { calculateBeyannameDeadline } from '../schedule/beyanname-deadline.util';

export interface OdemeSatiri {
  tur: string; // KDV1, MUHSGK, SGK Tahakkuk Fişi...
  donem: string;
  sonGun: string | null; // dd.MM.yyyy
  tutar: number;
}

export interface OdemeListesi {
  taxpayerId: string;
  unvan: string;
  phone: string | null;
  email: string | null;
  satirlar: OdemeSatiri[];
  toplam: number;
}

function trMoney(n: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' TL';
}
function trDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
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
    private readonly whatsapp: WhatsAppService,
    private readonly email: EmailService,
  ) {}

  /** month: 'YYYY-MM'. taxpayerId verilirse tek mükellef. */
  async list(tenantId: string, month: string, taxpayerId?: string): Promise<OdemeListesi[]> {
    const sgkPeriod = month.replace('-', '/');
    const map = new Map<string, OdemeListesi>();

    const ensure = (tp: any): OdemeListesi => {
      let row = map.get(tp.id);
      if (!row) {
        row = {
          taxpayerId: tp.id,
          unvan: (tp.unvan || tp.name || 'Mükellef').toString(),
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
        donem: month,
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
      row.satirlar.push({ tur: b.beyanTipi, donem: b.donem, sonGun: vade ? trDate(vade) : null, tutar });
      row.toplam += tutar;
    }

    // SGK tahakkuk fişleri
    const sgkDocs = await (this.prisma as any).portalDocument.findMany({
      where: {
        tenantId,
        belgeTuru: 'SGK_TAHAKKUK',
        ...(taxpayerId ? { taxpayerId } : {}),
        OR: [{ period: sgkPeriod }, { period: month }],
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
      row.satirlar.push({ tur: d.title || 'SGK Tahakkuk Fişi', donem: d.period || sgkPeriod, sonGun: null, tutar });
      row.toplam += tutar;
    }

    return [...map.values()]
      .filter((r) => r.satirlar.length > 0)
      .sort((a, b) => a.unvan.localeCompare(b.unvan, 'tr'));
  }

  composeMessage(tenantName: string, row: OdemeListesi, month: string): string {
    const lines: string[] = [];
    lines.push('*Gönderen*');
    lines.push(tenantName);
    lines.push('');
    lines.push('*Merhaba*');
    lines.push(` ${row.unvan},`);
    lines.push('');
    lines.push(`${month} Dönemi Ödeme Listeniz Bilginize Sunulmuştur,`);
    lines.push('');
    for (const s of row.satirlar) {
      const parts = [s.tur, `Dönem: ${s.donem}`];
      if (s.sonGun) parts.push(`Son Ödeme: ${s.sonGun}`);
      parts.push(trMoney(s.tutar));
      lines.push(parts.join(' - '));
    }
    lines.push('');
    lines.push(`Toplam: ${trMoney(row.toplam)}`);
    return lines.join('\n');
  }

  /** Tek mükellefe (veya taxpayerId'siz tüm listeye) ödeme cetveli mesajı gönderir. */
  async send(tenantId: string, month: string, taxpayerId?: string) {
    const settings = await (this.prisma as any).smartDispatchSetting.findUnique({
      where: { tenantId_kategori: { tenantId, kategori: 'VERGI' } },
    });
    const testMode = settings?.testMode ?? true;
    const tenant = await (this.prisma as any).tenant.findUnique({ where: { id: tenantId } });
    const tenantName = (tenant?.name || 'MOREN MALİ MÜŞAVİRLİK').toString().toUpperCase();

    const rows = await this.list(tenantId, month, taxpayerId);
    const results: any[] = [];
    for (const row of rows) {
      const message = this.composeMessage(tenantName, row, month);
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
