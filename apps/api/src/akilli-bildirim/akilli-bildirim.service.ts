import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { EmailService } from '../email/email.service';
import { calculateBeyannameDeadline } from '../schedule/beyanname-deadline.util';
import { ShortLinkService } from './short-link.controller';

export type DispatchKategori = 'VERGI' | 'SGK' | 'ETEBLIGAT';
export const DISPATCH_KATEGORILER: DispatchKategori[] = ['VERGI', 'SGK', 'ETEBLIGAT'];

interface DispatchItem {
  line: string | null; // mesaj satırı; null = satır yazılmaz (belge yalnız link olarak eklenir)
  amount: number | null;
  files: Array<{ storageKey: string; filename: string }>;
  refId: string; // BeyanKaydi.id veya PortalDocument.id
  donem?: string | null;
}

interface TaxpayerBundle {
  taxpayerId: string;
  unvan: string;
  phone: string | null;
  email: string | null;
  items: DispatchItem[];
}

const KATEGORI_BASLIK: Record<DispatchKategori, string> = {
  VERGI: 'Beyanname',
  SGK: 'SGK',
  ETEBLIGAT: 'E-Tebligat',
};

// Hattat ile birebir: "4.182,86  TL" (çift boşluk), "28.2.2026" (ay sıfırsız)
function trMoney(n: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + '  TL';
}

function trDate(d: Date): string {
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

/** SGK dönemi 'YYYY/MM' → son ödeme = dönemi izleyen ayın son günü */
function sgkSonOdeme(period: string | null | undefined): Date | null {
  if (!period) return null;
  const m = /^(\d{4})[\/-](\d{1,2})$/.exec(String(period).trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) + 1, 0);
}

export const DEFAULT_SENDER = 'MOREN MALİ MÜŞAVİRLİK';

@Injectable()
export class AkilliBildirimService {
  private readonly logger = new Logger(AkilliBildirimService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly whatsapp: WhatsAppService,
    private readonly email: EmailService,
    private readonly shortLink: ShortLinkService,
  ) {}

  // ---------- AYARLAR ----------

  async getSettings(tenantId: string) {
    const rows = await (this.prisma as any).smartDispatchSetting.findMany({ where: { tenantId } });
    const byKat: Record<string, any> = {};
    for (const r of rows) byKat[r.kategori] = r;
    const out = [] as any[];
    for (const kategori of DISPATCH_KATEGORILER) {
      if (byKat[kategori]) {
        out.push(byKat[kategori]);
      } else {
        out.push(
          await (this.prisma as any).smartDispatchSetting.create({
            data: { tenantId, kategori },
          }),
        );
      }
    }
    return out;
  }

  async updateSetting(tenantId: string, kategori: DispatchKategori, patch: Record<string, unknown>) {
    const allowed = [
      'whatsapp',
      'email',
      'sendHour',
      'manualInstant',
      'enabled',
      'testMode',
      'testPhone',
      'testEmail',
      'senderName',
      'excludedTaxpayerIds',
    ];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (k in patch) data[k] = (patch as any)[k];
    return (this.prisma as any).smartDispatchSetting.upsert({
      where: { tenantId_kategori: { tenantId, kategori } },
      create: { tenantId, kategori, ...data },
      update: data,
    });
  }

  // ---------- ADAY TOPLAMA ----------

  /** Son `sinceHours` saatte gelen/güncellenen belgeleri mükellef bazında kategoriye göre toplar. */
  private async collectBundles(
    tenantId: string,
    kategori: DispatchKategori,
    sinceHours: number,
    taxpayerId?: string,
  ): Promise<TaxpayerBundle[]> {
    const since = new Date(Date.now() - sinceHours * 3600 * 1000);
    const map = new Map<string, TaxpayerBundle>();

    const ensure = async (tp: { id: string; companyName?: string | null; firstName?: string | null; lastName?: string | null; phone?: string | null; phones?: string[]; email?: string | null; emails?: string[] }) => {
      let b = map.get(tp.id);
      if (!b) {
        b = {
          taxpayerId: tp.id,
          unvan: (tp.companyName || `${tp.firstName || ''} ${tp.lastName || ''}`.trim() || 'Mükellef').toString(),
          phone: tp.phone || (tp.phones && tp.phones[0]) || null,
          email: tp.email || (tp.emails && tp.emails[0]) || null,
          items: [],
        };
        map.set(tp.id, b);
      }
      return b;
    };

    if (kategori === 'VERGI') {
      const kayitlar = await (this.prisma as any).beyanKaydi.findMany({
        where: {
          tenantId,
          updatedAt: { gte: since },
          ...(taxpayerId ? { taxpayerId } : {}),
          OR: [{ pdfUrl: { not: null } }, { beyannameUrl: { not: null } }],
        },
        include: { taxpayer: true },
        orderBy: { updatedAt: 'desc' },
        take: 2000,
      });
      for (const k of kayitlar) {
        if (!k.taxpayer) continue;
        const b = await ensure(k.taxpayer);
        const vade = calculateBeyannameDeadline(k.beyanTipi, k.donem);
        const tutar = k.tahakkukTutari != null ? Number(k.tahakkukTutari) : null;
        const parts = [`${k.beyanTipi} - Tahakkuk`];
        if (vade) parts.push(`Son Ödeme: ${trDate(vade)}`);
        if (tutar != null) parts.push(trMoney(tutar));
        const files: DispatchItem['files'] = [];
        const adSlug = b.unvan.replace(/[^a-zA-Z0-9ĞÜŞİÖÇğüşıöç ]/g, '').slice(0, 40).trim().replace(/\s+/g, '_');
        if (k.beyannameUrl) files.push({ storageKey: k.beyannameUrl, filename: `${adSlug}-${k.beyanTipi}-${k.donem}-beyanname.pdf` });
        if (k.pdfUrl) files.push({ storageKey: k.pdfUrl, filename: `${adSlug}-${k.beyanTipi}-${k.donem}-tahakkuk.pdf` });
        b.items.push({ line: parts.join(' - '), amount: tutar, files, refId: k.id, donem: k.donem });
      }
    } else {
      const belgeTurleri =
        kategori === 'SGK' ? ['SGK_TAHAKKUK', 'SGK_HIZMET_LISTESI'] : ['E_TEBLIGAT'];
      const docs = await (this.prisma as any).portalDocument.findMany({
        where: {
          tenantId,
          belgeTuru: { in: belgeTurleri },
          createdAt: { gte: since },
          ...(taxpayerId ? { taxpayerId } : {}),
          storageKey: { not: null },
        },
        include: { taxpayer: true },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      });
      for (const d of docs) {
        if (!d.taxpayer) continue;
        const b = await ensure(d.taxpayer);
        const raw = (d.raw || {}) as Record<string, any>;
        let line: string | null;
        let amount: number | null = null;
        if (kategori === 'SGK') {
          // Hattat birebir: mesajda YALNIZ Tahakkuk Fişi satırları yazılır;
          // Hizmet Listesi tutarı toplamı ŞİŞİRMESİN diye satırsız, yalnız link olarak gider.
          if (d.belgeTuru === 'SGK_HIZMET_LISTESI') {
            line = null;
          } else {
            const tutarRaw = raw.tutar != null ? String(raw.tutar).replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.') : null;
            amount = tutarRaw ? Number(tutarRaw) : null;
            if (amount != null && !Number.isFinite(amount)) amount = null;
            const donem = d.period || raw.donem || '';
            // "Tahakkuk Fişi - 2026/01 - Son Ödeme: 28.2.2026 - 24.277,05  TL"
            const baslik = (d.title || 'SGK Belgesi').replace(/^SGK\s+/i, '');
            const parts = [`${baslik}${donem ? ` - ${donem}` : ''}`];
            const vade = sgkSonOdeme(donem);
            if (vade) parts.push(`Son Ödeme: ${trDate(vade)}`);
            if (amount != null) parts.push(trMoney(amount));
            line = parts.join(' - ');
          }
        } else {
          const teblig = raw.tebligZamani || raw.tebligTarihi || raw.tebligatTarihi || raw.tarih || null;
          const kurum = raw.kurumAciklama || raw.altKurum || 'GİB';
          line = `${kurum} - E-Tebligat${teblig ? ` - Tebliğ Tarihi: ${teblig}` : ''}`;
        }
        const fname = `${(d.title || 'belge').toString().replace(/[^a-zA-Z0-9ĞÜŞİÖÇğüşıöç ]/g, '').slice(0, 50).trim().replace(/\s+/g, '_')}.pdf`;
        b.items.push({ line, amount, files: [{ storageKey: d.storageKey, filename: fname }], refId: d.id, donem: d.period || null });
      }
    }

    return [...map.values()].filter((b) => b.items.length > 0);
  }

  // ---------- MESAJ ----------

  /** Hattat ile birebir format: Gönderen → Merhaba ÜNVAN → satırlar → Toplam → PDF link(ler)i. */
  composeMessage(senderName: string, bundle: TaxpayerBundle, kategori: DispatchKategori, links: string[] = []): string {
    const lines: string[] = [];
    lines.push('*Gönderen* ');
    lines.push(senderName);
    lines.push('');
    lines.push('*Merhaba* ');
    lines.push(` ${bundle.unvan},`);
    lines.push('');
    lines.push(`Aşağıdaki ${KATEGORI_BASLIK[kategori]} Dökümanları Bilginize Sunulmuştur,`);
    lines.push('');
    for (const it of bundle.items) if (it.line) lines.push(it.line);
    const amounts = bundle.items.map((i) => i.amount).filter((a): a is number => a != null);
    if (amounts.length > 0) {
      lines.push('');
      lines.push(`Toplam: ${trMoney(amounts.reduce((a, b) => a + b, 0))}`);
    }
    if (links.length > 0) {
      lines.push('');
      for (const l of links) lines.push(l);
    }
    return lines.join('\n');
  }

  // ---------- GÖNDERİM ----------

  private dedupeKeyFor(kategori: DispatchKategori, bundle: TaxpayerBundle): string {
    const ids = bundle.items.map((i) => i.refId).sort().join(',');
    const h = createHash('sha1').update(ids).digest('hex').slice(0, 16);
    return `${kategori}:${bundle.taxpayerId}:${h}`;
  }

  /**
   * Bir kategori için toplama + gönderim. dryRun=true ise sadece ne gönderileceğini döndürür.
   * testMode açıkken alıcı, ayarlarındaki testPhone/testEmail olur (gerçek mükellefe gitmez).
   */
  async runKategori(
    tenantId: string,
    kategori: DispatchKategori,
    opts: { sinceHours?: number; taxpayerId?: string; dryRun?: boolean; force?: boolean } = {},
  ) {
    const settings = (await this.getSettings(tenantId)).find((s: any) => s.kategori === kategori);
    if (!settings) return { ok: false, error: 'ayar yok' };
    if (!opts.force && !settings.enabled) return { ok: false, skipped: true, reason: 'kapalı (enabled=false)' };

    const senderName = (settings.senderName || DEFAULT_SENDER).toString();

    const bundles = await this.collectBundles(tenantId, kategori, opts.sinceHours ?? 26, opts.taxpayerId);
    const excluded = new Set<string>(settings.excludedTaxpayerIds || []);
    const results: any[] = [];

    for (const bundle of bundles) {
      if (excluded.has(bundle.taxpayerId)) continue;
      const dedupeKey = this.dedupeKeyFor(kategori, bundle);
      // Hattat birebir: mesajın sonunda KISA belge linki (7 gün geçerli)
      const links: string[] = [];
      for (const it of bundle.items) {
        for (const f of it.files) {
          try {
            links.push(await this.shortLink.create(tenantId, f.storageKey, f.filename, 7));
          } catch (e: any) {
            this.logger.warn(`link üretilemedi ${f.filename}: ${e?.message}`);
          }
        }
      }
      const message = this.composeMessage(senderName, bundle, kategori, links);
      const amounts = bundle.items.map((i) => i.amount).filter((a): a is number => a != null);
      const total = amounts.length ? amounts.reduce((a, b) => a + b, 0) : null;

      if (opts.dryRun) {
        results.push({ taxpayerId: bundle.taxpayerId, unvan: bundle.unvan, dedupeKey, message, itemCount: bundle.items.length, total });
        continue;
      }

      const channels: Array<'WHATSAPP' | 'EMAIL'> = [];
      if (settings.whatsapp) channels.push('WHATSAPP');
      if (settings.email) channels.push('EMAIL');

      for (const channel of channels) {
        // dedupe: aynı belgeler bu kanaldan zaten gönderildiyse atla
        const existing = await (this.prisma as any).documentDispatch.findUnique({
          where: { tenantId_dedupeKey_channel: { tenantId, dedupeKey, channel } },
        });
        if (existing && existing.status === 'SENT') {
          results.push({ taxpayerId: bundle.taxpayerId, channel, status: 'SKIPPED', reason: 'daha önce gönderildi' });
          continue;
        }

        const targetPhone = settings.testMode ? settings.testPhone : bundle.phone;
        const targetEmail = settings.testMode ? settings.testEmail : bundle.email;

        let status = 'FAILED';
        let error: string | null = null;
        try {
          if (channel === 'WHATSAPP') {
            if (!targetPhone) throw new Error(settings.testMode ? 'test telefonu girilmemiş' : 'mükellefin telefon numarası yok');
            // Hattat birebir: tek mesaj, belge LİNK ile (ek balonu yok)
            const sent = await this.whatsapp.sendMessageDetailed(targetPhone, message, tenantId, { quote: false } as any);
            if (!(sent as any)?.ok) throw new Error((sent as any)?.error || 'whatsapp gönderilemedi');
            status = 'SENT';
          } else {
            if (!targetEmail) throw new Error(settings.testMode ? 'test e-postası girilmemiş' : 'mükellefin e-postası yok');
            const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
            for (const it of bundle.items) {
              for (const f of it.files) {
                try {
                  const buf = await this.storage.getBuffer(f.storageKey);
                  attachments.push({ filename: f.filename, content: buf, contentType: 'application/pdf' });
                } catch (e: any) {
                  this.logger.warn(`ek okunamadı ${f.filename}: ${e?.message}`);
                }
              }
            }
            const res = await this.email.send(
              {
                to: targetEmail,
                subject: `${KATEGORI_BASLIK[kategori]} Dökümanları — ${bundle.unvan}`,
                text: message.replace(/\*/g, ''),
                attachments,
              },
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
            taxpayerId: bundle.taxpayerId,
            kategori,
            donem: bundle.items[0]?.donem || null,
            channel,
            status,
            error,
            itemCount: bundle.items.length,
            totalAmount: total,
            docRefs: bundle.items.map((i) => i.refId),
            dedupeKey,
            testMode: !!settings.testMode,
            sentAt: status === 'SENT' ? new Date() : null,
          },
          update: { status, error, sentAt: status === 'SENT' ? new Date() : null, testMode: !!settings.testMode },
        });
        results.push({ taxpayerId: bundle.taxpayerId, unvan: bundle.unvan, channel, status, error });
      }
    }
    return { ok: true, kategori, count: results.length, results };
  }

  async runAll(tenantId: string, opts: { sinceHours?: number; dryRun?: boolean } = {}) {
    const out: any[] = [];
    for (const kategori of DISPATCH_KATEGORILER) {
      out.push(await this.runKategori(tenantId, kategori, opts));
    }
    return out;
  }

  // ---------- İLETİM RAPORU ----------

  async report(tenantId: string, month?: string) {
    const now = new Date();
    const ay = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [y, m] = ay.split('-').map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);

    const rows = await (this.prisma as any).documentDispatch.findMany({
      where: { tenantId, createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: 'desc' },
    });
    const taxpayers = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, id: { in: [...new Set(rows.map((r: any) => r.taxpayerId))] } },
      select: { id: true, companyName: true, firstName: true, lastName: true },
    });
    const tpName = new Map<string, string>(
      taxpayers.map((t: any) => [t.id, t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.id]),
    );

    const perTaxpayer = new Map<string, any>();
    let sent = 0;
    let failed = 0;
    let badContact = 0;
    for (const r of rows) {
      const key = r.taxpayerId;
      let row = perTaxpayer.get(key);
      if (!row) {
        row = { taxpayerId: key, unvan: tpName.get(key) || key, VERGI: null, SGK: null, ETEBLIGAT: null, ODEME_LISTESI: null };
        perTaxpayer.set(key, row);
      }
      const prev = row[r.kategori];
      // aynı kategori için en iyi durumu göster (SENT > FAILED > SKIPPED)
      const rank = (s: string | null) => (s === 'SENT' ? 3 : s === 'FAILED' ? 2 : s === 'SKIPPED' ? 1 : 0);
      if (rank(r.status) > rank(prev?.status || null)) row[r.kategori] = { status: r.status, error: r.error, channel: r.channel };
      if (r.status === 'SENT') sent += 1;
      else if (r.status === 'FAILED') {
        failed += 1;
        if ((r.error || '').includes('telefon') || (r.error || '').includes('e-posta')) badContact += 1;
      }
    }
    return {
      month: ay,
      totals: { total: rows.length, sent, failed, badContact },
      taxpayers: [...perTaxpayer.values()].sort((a, b) => a.unvan.localeCompare(b.unvan, 'tr')),
      today: await this.todaySummary(tenantId),
    };
  }

  async todaySummary(tenantId: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows = await (this.prisma as any).documentDispatch.findMany({
      where: { tenantId, createdAt: { gte: start } },
      select: { status: true, taxpayerId: true, itemCount: true, error: true },
    });
    const sentRows = rows.filter((r: any) => r.status === 'SENT');
    return {
      belge: sentRows.reduce((a: number, r: any) => a + (r.itemCount || 0), 0),
      mukellef: new Set(sentRows.map((r: any) => r.taxpayerId)).size,
      bekleyen: rows.filter((r: any) => r.status === 'PENDING').length,
      hata: rows.filter((r: any) => r.status === 'FAILED').length,
      ilkHata: rows.find((r: any) => r.status === 'FAILED')?.error || null,
    };
  }

  /** FAILED kayıtları yeniden dener. */
  async resendFailed(tenantId: string, month?: string) {
    const now = new Date();
    const ay = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [y, m] = ay.split('-').map(Number);
    const failedRows = await (this.prisma as any).documentDispatch.findMany({
      where: { tenantId, status: 'FAILED', createdAt: { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) } },
      select: { taxpayerId: true, kategori: true },
    });
    const pairs = new Set<string>(failedRows.map((r: any) => `${r.kategori}:${r.taxpayerId}`));
    const out: any[] = [];
    for (const pair of pairs) {
      const [kategori, taxpayerId] = pair.split(':');
      out.push(await this.runKategori(tenantId, kategori as DispatchKategori, { taxpayerId, sinceHours: 24 * 40, force: true }));
    }
    return { retried: pairs.size, out };
  }
}
