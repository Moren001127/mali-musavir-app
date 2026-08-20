import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { calculateBeyannameDeadline } from '../schedule/beyanname-deadline.util';
import { DEFAULT_SENDER } from './akilli-bildirim.service';
import { ShortLinkService } from './short-link.controller';
import { mergePdfBuffers } from './pdf-merge.util';
import { randomUUID } from 'crypto';

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
    private readonly shortLink: ShortLinkService,
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

  /**
   * LİSTEDE NEDEN YOK — ödeme listesine girmeyen mükellefler ve sebepleri.
   *
   * Kullanıcı tespiti: "bazı mükelleflerde SGK tahakkuku olmasına rağmen
   * onları bu ödeme listesine dahil etmiyor." Ölçüm, elemenin çoğunlukla
   * yanlış olmadığını gösterdi: o mükelleflerin O DÖNEME AİT SGK BELGESİ
   * HENÜZ YOK. Ama liste bunu söylemiyordu — mükellef listede yoksa sebebi
   * hiçbir yerde görünmüyordu, hata mı eksik mi ayırt edilemiyordu.
   *
   * Burası yalnız OKUR ve `list()`'i hiç değiştirmez; mesaj şablonu da
   * etkilenmez (kullanıcı talimatı: mesaja dokunma).
   */
  async eksikler(tenantId: string, month: string) {
    const [my, mm] = month.split('-').map(Number);
    const prev = new Date(my, mm - 2, 1);
    const donem = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const sgkPeriod = donem.replace('-', '/');

    const [sgkDocs, gecmisSgk, beyanlar] = await Promise.all([
      // Bu döneme ait SGK fişleri — tutarı okunamayanları görmek için
      (this.prisma as any).portalDocument.findMany({
        where: {
          tenantId,
          belgeTuru: 'SGK_TAHAKKUK',
          OR: [{ period: sgkPeriod }, { period: donem }],
        },
        select: { taxpayerId: true, raw: true, title: true, taxpayer: { select: { companyName: true, firstName: true, lastName: true } } },
        take: 5000,
      }),
      // Daha önce SGK fişi gelmiş mükellefler — bu dönem hiç yoksa "belge
      // çekilmemiş" demektir; sisteme hiç SGK'sı olmayan mükellef karışmasın
      (this.prisma as any).portalDocument.findMany({
        where: { tenantId, belgeTuru: 'SGK_TAHAKKUK' },
        select: { taxpayerId: true, period: true, taxpayer: { select: { companyName: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      // Beyanname kaydı var ama tahakkuk tutarı okunmamış olanlar
      (this.prisma as any).beyanKaydi.findMany({
        where: { tenantId, donem, tahakkukTutari: null },
        select: { taxpayerId: true, beyanTipi: true, taxpayer: { select: { companyName: true, firstName: true, lastName: true } } },
        take: 5000,
      }),
    ]);

    const ad = (t: any, id: string) =>
      t?.companyName || `${t?.firstName || ''} ${t?.lastName || ''}`.trim() || id;

    const eksik: Array<{ taxpayerId: string; unvan: string; kaynak: 'VERGI' | 'SGK'; sebep: string }> = [];

    // 1) SGK fişi var ama tutar okunamıyor / sıfır → satır sessizce düşüyordu
    for (const d of sgkDocs) {
      if (!d.taxpayerId) continue;
      if (parseTutar((d.raw as any)?.tutar) != null) continue;
      const ham = (d.raw as any)?.tutar;
      eksik.push({
        taxpayerId: d.taxpayerId,
        unvan: ad(d.taxpayer, d.taxpayerId),
        kaynak: 'SGK',
        sebep:
          ham == null
            ? 'SGK fişinde tutar alanı yok'
            : `SGK tahakkuku ${String(ham)} — ödenecek tutar yok`,
      });
    }

    // 2) Geçmişte SGK'sı olan ama bu döneme ait fişi hiç gelmemiş olanlar
    const buDonem = new Set<string>(sgkDocs.map((d: any) => d.taxpayerId).filter(Boolean));
    const gecmiste = new Map<string, string>();
    for (const d of gecmisSgk) {
      if (!d.taxpayerId || buDonem.has(d.taxpayerId)) continue;
      if (!gecmiste.has(d.taxpayerId)) gecmiste.set(d.taxpayerId, ad(d.taxpayer, d.taxpayerId));
    }
    for (const [id, unvan] of gecmiste) {
      eksik.push({
        taxpayerId: id,
        unvan,
        kaynak: 'SGK',
        sebep: `${sgkPeriod} dönemine ait SGK tahakkuk fişi henüz çekilmemiş`,
      });
    }

    // 3) Beyanname var, tahakkuk tutarı okunmamış
    for (const b of beyanlar) {
      if (!b.taxpayerId) continue;
      eksik.push({
        taxpayerId: b.taxpayerId,
        unvan: ad(b.taxpayer, b.taxpayerId),
        kaynak: 'VERGI',
        sebep: `${b.beyanTipi} beyannamesi var, tahakkuk tutarı okunmamış`,
      });
    }

    return {
      month,
      donem,
      sgkDonemi: sgkPeriod,
      eksik: eksik.sort((a, b) => a.unvan.localeCompare(b.unvan, 'tr')),
    };
  }

  /** Hattat ile BİREBİR kalıp. baslik: 'Beyanname' | 'SGK'. */
  composeMessage(senderName: string, unvan: string, baslik: string, satirlar: OdemeSatiri[], links: string[] = []): string {
    const lines: string[] = [];
    lines.push('*Gönderen* ');
    lines.push(senderName);
    lines.push('');
    lines.push('*Merhaba* ');
    lines.push(` ${unvan},`);
    lines.push('');
    lines.push(`Aşağıdaki ${baslik} Dökümanları Bilginize Sunulmuştur,`);
    lines.push('');
    for (const s of satirlar) {
      // Vergi: "KDV1 - Tahakkuk - Son Ödeme: 28.7.2026 - 9.018,30  TL"
      // SGK  : "Tahakkuk Fişi - 2026/06 - Son Ödeme: 31.7.2026 - 24.277,05  TL"
      const parts = s.kaynak === 'VERGI' ? [s.tur, 'Tahakkuk'] : [s.tur, s.donem];
      if (s.sonGun) parts.push(`Son Ödeme: ${s.sonGun}`);
      parts.push(trMoney(s.tutar));
      lines.push(parts.join(' - '));
    }
    lines.push('');
    lines.push(`Toplam: ${trMoney(satirlar.reduce((a, s) => a + s.tutar, 0))}`);
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
      // Hattat birebir: Vergi ve SGK AYRI mesaj olarak gider
      const gruplar: Array<{ kaynak: 'VERGI' | 'SGK'; baslik: string; satirlar: OdemeSatiri[] }> = [
        { kaynak: 'VERGI', baslik: 'Beyanname', satirlar: row.satirlar.filter((s) => s.kaynak === 'VERGI') },
        { kaynak: 'SGK', baslik: 'SGK', satirlar: row.satirlar.filter((s) => s.kaynak === 'SGK') },
      ].filter((g) => g.satirlar.length > 0) as any;

      const targetPhone = testMode ? settings?.testPhone : row.phone;
      const targetEmail = testMode ? settings?.testEmail : row.email;

      for (const grup of gruplar) {
        // belgeler TEK PDF'te birleşir → mesajda TEK link
        const bufs: Buffer[] = [];
        for (const s of grup.satirlar) {
          if (!s.storageKey) continue;
          try {
            bufs.push(await this.storage.getBuffer(s.storageKey));
          } catch (e: any) {
            this.logger.warn(`belge okunamadı ${s.tur} ${s.donem}: ${e?.message}`);
          }
        }
        const merged = await mergePdfBuffers(bufs, this.logger);
        const mergedName = `${grup.baslik}-Dokumanlari.pdf`;
        let links: string[] = [];
        let emailAttachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
        if (merged) {
          const key = `${tenantId}/${row.taxpayerId}/bildirim/ODEME_${grup.kaynak}_${randomUUID()}.pdf`;
          await this.storage.putBuffer(key, merged, 'application/pdf');
          links = [await this.shortLink.create(tenantId, key, mergedName, 7)];
          emailAttachments = [{ filename: mergedName, content: merged, contentType: 'application/pdf' }];
        } else {
          for (const s of grup.satirlar) {
            if (!s.storageKey) continue;
            try {
              links.push(await this.shortLink.create(tenantId, s.storageKey, `${s.tur}-${s.donem}.pdf`, 7));
            } catch (e: any) {
              this.logger.warn(`link üretilemedi ${s.tur} ${s.donem}: ${e?.message}`);
            }
          }
        }
        const message = this.composeMessage(senderName, row.unvan, grup.baslik, grup.satirlar, links);
        const grupToplam = grup.satirlar.reduce((a: number, s: OdemeSatiri) => a + s.tutar, 0);
        const dedupeKey = `ODEME:${row.taxpayerId}:${month}:${grup.kaynak}`;

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
                { to: targetEmail, subject: `${grup.baslik} Dökümanları — ${row.unvan}`, text: message.replace(/\*/g, ''), attachments: emailAttachments },
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
              itemCount: grup.satirlar.length,
              totalAmount: grupToplam,
              docRefs: null,
              dedupeKey,
              testMode: !!testMode,
              sentAt: status === 'SENT' ? new Date() : null,
            },
            update: { status, error, sentAt: status === 'SENT' ? new Date() : null, testMode: !!testMode },
          });
          results.push({ taxpayerId: row.taxpayerId, unvan: row.unvan, grup: grup.baslik, channel, status, error });
        }
      }
    }
    return { ok: true, month, testMode, count: results.length, results };
  }
}
