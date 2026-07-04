import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from './whatsapp.service';
import { EmailService } from '../email/email.service';
import { OwnerNotifierService } from './owner-notifier.service';

/**
 * SABAH 09:00 GECE ÖZETİ (kullanıcı kararı 2026-07-04):
 * Gece (sessiz saat 22:00–09:00) owner'a anlık WhatsApp gitmez — owner-notifier
 * erteler, bildirimler DB'de birikir. Bu servis sabah 09:00'da gece birikenleri
 * TEK toplu tablo-özet olarak WhatsApp + e-posta ile gönderir; gece gelen
 * e-Tebligat PDF'leri özetin ardından dosya olarak iletilir.
 *
 * Kapatmak için: OWNER_MORNING_DIGEST_ENABLED=0
 * Saat değiştirmek için: OWNER_MORNING_DIGEST_CRON (6 alanlı, Istanbul)
 * E-posta alıcısı: MOREN_OWNER_EMAIL (yoksa tenant.email)
 */
@Injectable()
export class OwnerDigestService {
  private readonly logger = new Logger(OwnerDigestService.name);

  /** Özet mesajına hiç girmeyecek gürültü tipleri. */
  private static readonly EXCLUDED_TYPES = new Set<string>([
    'WHATSAPP',        // bot sohbet akışı — Mesajlar ekranının işi
    'OFFICE_CHAT',     // ofis içi sohbet
    'GALERI_HGS_OZET', // sabit numaralara giden hazır özet
  ]);

  /** Tip → başlık satırı (emoji + Türkçe etiket). Sıra = özet sırası. */
  private static readonly TYPE_LABELS: Array<{ type: string; emoji: string; label: string }> = [
    { type: 'E_TEBLIGAT', emoji: '📨', label: 'e-Tebligat' },
    { type: 'TAX_DEADLINE', emoji: '⏰', label: 'Beyanname/Vergi süresi' },
    { type: 'PORTAL_CREDENTIAL_FAIL', emoji: '🔑', label: 'Portal şifre hatası' },
    { type: 'LUCA_SYNC_ERROR', emoji: '🔴', label: 'Luca hatası' },
    { type: 'AI_COST_LIMIT', emoji: '💰', label: 'AI maliyet tavanı' },
    { type: 'AUTH_NEW_DEVICE', emoji: '🖥️', label: 'Yeni cihaz girişi' },
    { type: 'PENDING_DECISION', emoji: '❓', label: 'Onay bekleyen' },
    { type: 'BANK_TRANSACTION_ALERT', emoji: '🏦', label: 'Banka hareketi' },
    { type: 'INVOICE_OVERDUE', emoji: '🧾', label: 'Geciken fatura' },
    { type: 'TASK_DUE', emoji: '📌', label: 'Görev süresi' },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly email: EmailService,
    private readonly ownerNotifier: OwnerNotifierService,
  ) {}

  @Cron(process.env.OWNER_MORNING_DIGEST_CRON || '0 0 9 * * *', { timeZone: 'Europe/Istanbul' })
  async morningDigest(): Promise<void> {
    if (process.env.OWNER_MORNING_DIGEST_ENABLED === '0') return;
    try {
      await this.run();
    } catch (e: any) {
      this.logger.warn(`[OwnerDigest] sabah özeti hatası: ${e?.message || e}`);
    }
  }

  private async run(): Promise<void> {
    const tenants: Array<{ id: string; name?: string | null; email?: string | null }> = await (this.prisma as any).tenant
      .findMany({ select: { id: true, name: true, email: true } })
      .catch(() => []);
    if (!tenants.length) return;

    // Pencere: sessiz saatin başından (dün 22:00) şimdiye.
    const quietStart = Number(process.env.OWNER_NOTIFY_QUIET_START || 22);
    const quietEnd = Number(process.env.OWNER_NOTIFY_QUIET_END || 9);
    const windowHours = ((24 - quietStart) + quietEnd + 24) % 24 || 11;
    const from = new Date(Date.now() - windowHours * 3600 * 1000);

    for (const t of tenants) {
      try {
        await this.digestForTenant(t, from);
      } catch (e: any) {
        this.logger.warn(`[OwnerDigest] ${t.id}: ${e?.message || e}`);
      }
    }
  }

  private async digestForTenant(
    tenant: { id: string; name?: string | null; email?: string | null },
    from: Date,
  ): Promise<void> {
    const rows: any[] = await this.prisma.notification.findMany({
      where: { tenantId: tenant.id, createdAt: { gte: from } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    const items = rows.filter((n) => !OwnerDigestService.EXCLUDED_TYPES.has(String(n.type)));

    // Aynı bildirim birden çok kullanıcıya kopyalanmış olabilir (createForAllUsers)
    // → başlık+tip bazında teke indir ki sayılar şişmesin.
    const seen = new Set<string>();
    const uniq = items.filter((n) => {
      const key = `${n.type}::${n.title}::${n.body}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const { text, html, hasContent } = this.buildDigest(uniq, from);

    // 1) WhatsApp (master switch açıksa + owner numarası tanımlıysa)
    const phones = this.ownerNotifier.getOwnerPhones();
    if (phones.length && (await this.whatsapp.isAutomationActive(tenant.id).catch(() => false))) {
      for (const phone of phones) {
        await this.whatsapp
          .sendMessage(phone, text, tenant.id, { quote: false })
          .catch((e: any) => this.logger.warn(`[OwnerDigest] WhatsApp hata (${phone}): ${e?.message || e}`));
      }
      // Gece gelen e-Tebligat PDF'leri özetin ARDINDAN dosya olarak gitsin.
      if (hasContent) {
        const tebligatlar = uniq.filter((n) => String(n.type) === 'E_TEBLIGAT');
        for (const n of tebligatlar) {
          await this.ownerNotifier
            .sendETebligatToOwner(n, phones)
            .catch((e: any) => this.logger.warn(`[OwnerDigest] tebligat PDF hata: ${e?.message || e}`));
        }
      }
      this.logger.log(`[OwnerDigest] ${tenant.id} sabah özeti WhatsApp'a gönderildi (${uniq.length} bildirim)`);
    }

    // 2) E-posta raporu (gece beyanname/SGK/tebligat sorguları — kullanıcı madde 10)
    const to = String(process.env.MOREN_OWNER_EMAIL || tenant.email || '').trim();
    if (to) {
      const tarih = new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' });
      await this.email
        .send({ to, subject: `Gece Özeti · ${tarih} — beyanname / SGK / e-Tebligat`, html, text }, tenant.id)
        .then((r) => { if (r.sent) this.logger.log(`[OwnerDigest] ${tenant.id} sabah özeti e-postası gönderildi (${to})`); })
        .catch((e: any) => this.logger.warn(`[OwnerDigest] e-posta hata: ${e?.message || e}`));
    }
  }

  /** Gece bildirimlerinden standart WhatsApp metni + e-posta HTML'i üretir. */
  private buildDigest(items: any[], from: Date): { text: string; html: string; hasContent: boolean } {
    const now = new Date();
    const fmt = (d: Date) =>
      d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const tarih = now.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', day: '2-digit', month: 'long' });

    // Tip bazında grupla
    const byType = new Map<string, any[]>();
    for (const n of items) {
      const arr = byType.get(String(n.type)) || [];
      arr.push(n);
      byType.set(String(n.type), arr);
    }

    const lines: string[] = [];
    const htmlRows: string[] = [];
    const knownTypes = new Set(OwnerDigestService.TYPE_LABELS.map((m) => m.type));

    for (const meta of OwnerDigestService.TYPE_LABELS) {
      const arr = byType.get(meta.type);
      if (!arr?.length) continue;
      const detay = arr
        .slice(0, 3)
        .map((n) => String(n.title || '').replace(/\s+/g, ' ').trim().slice(0, 60))
        .filter(Boolean)
        .join(' | ');
      lines.push(`${meta.emoji} ${meta.label}: ${arr.length}${detay ? ' — ' + detay : ''}${arr.length > 3 ? ' …' : ''}`);
      htmlRows.push(
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${meta.emoji} ${meta.label}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center"><b>${arr.length}</b></td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555">${detay}${arr.length > 3 ? ' …' : ''}</td></tr>`,
      );
    }

    // Haritada olmayan tipler tek satırda "Diğer" olarak
    const otherCount = items.filter((n) => !knownTypes.has(String(n.type))).length;
    if (otherCount > 0) {
      lines.push(`🔔 Diğer: ${otherCount}`);
      htmlRows.push(
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">🔔 Diğer</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center"><b>${otherCount}</b></td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee"></td></tr>`,
      );
    }

    const hasContent = lines.length > 0;
    const cizgi = '━━━━━━━━━━━━━━';
    const text = [
      `🌅 GECE ÖZETİ · ${tarih}`,
      `⏱️ ${fmt(from)} → ${fmt(now)}`,
      cizgi,
      ...(hasContent ? lines : ['✅ Gece sorgularında yeni bildirim yok.']),
      cizgi,
      hasContent ? 'Ayrıntılar portalda → Bildirimler' : 'Sistem gece boyunca sorunsuz çalıştı.',
    ].join('\n');

    const html = [
      `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px">`,
      `<h2 style="margin:0 0 4px">🌅 Gece Özeti — ${tarih}</h2>`,
      `<p style="margin:0 0 14px;color:#666">${fmt(from)} → ${fmt(now)} arasındaki gece sorgulamaları (beyanname · SGK · e-Tebligat · sistem)</p>`,
      hasContent
        ? `<table style="border-collapse:collapse;width:100%;font-size:14px">` +
          `<tr style="background:#f6f4ef"><th style="padding:6px 10px;text-align:left">Konu</th><th style="padding:6px 10px">Adet</th><th style="padding:6px 10px;text-align:left">Detay</th></tr>` +
          htmlRows.join('') +
          `</table>`
        : `<p style="padding:12px;background:#f0f9f0;border:1px solid #cde8cd;border-radius:8px">✅ Gece sorgularında yeni bildirim yok — sistem sorunsuz çalıştı.</p>`,
      `<p style="margin-top:14px;color:#888;font-size:12px">Bu rapor her sabah 09:00'da otomatik gönderilir · Moren Portal</p>`,
      `</div>`,
    ].join('');

    return { text, html, hasContent };
  }
}
