import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WhatsAppService } from './whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';

type EvrakReminderBody = {
  taxpayerIds?: string[];
  year?: number;
  month?: number;
  force?: boolean;
  includeNotDue?: boolean;
};

@Controller('whatsapp')
@UseGuards(AuthGuard('jwt'))
export class WhatsAppController {
  private readonly aylarTr = [
    'Ocak', 'Subat', 'Mart', 'Nisan', 'Mayis', 'Haziran',
    'Temmuz', 'Agustos', 'Eylul', 'Ekim', 'Kasim', 'Aralik',
  ];

  constructor(
    private whatsappService: WhatsAppService,
    private prisma: PrismaService,
  ) {}

  @Get('status')
  getStatus() {
    return this.whatsappService.getStatus();
  }

  @Post('evrak-reminders/preview')
  async previewEvrakReminders(@Req() req: any, @Body() body: EvrakReminderBody = {}) {
    return this.buildEvrakReminderPreview(req.user.tenantId, body);
  }

  @Post('evrak-reminders/send')
  async sendEvrakReminders(@Req() req: any, @Body() body: EvrakReminderBody = {}) {
    const preview = await this.buildEvrakReminderPreview(req.user.tenantId, body);
    const templateName = process.env.WHATSAPP_DOCUMENT_TEMPLATE_NAME || process.env.WHATSAPP_TEMPLATE_NAME || undefined;
    const results: any[] = [];

    for (const row of preview.rows.filter((r: any) => r.gonderilebilir)) {
      let delivered = false;
      for (const phone of row.phones) {
        const ok = templateName
          ? await this.whatsappService.sendTemplate(phone, [row.ad, preview.donem], templateName)
          : await this.whatsappService.sendMessage(phone, row.mesaj);
        delivered = delivered || ok;
      }

      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: row.taxpayerId,
          channel: 'WHATSAPP',
          subject: `Evrak hatirlatma - ${preview.donem} - ${delivered ? 'Gonderildi' : 'Basarisiz'}`,
          content: row.mesaj,
          occurredAt: new Date(),
        },
      });

      if (delivered) {
        await this.prisma.taxpayer.update({
          where: { id: row.taxpayerId },
          data: { lastReminderSentAt: new Date() },
        });
      }
      results.push({ taxpayerId: row.taxpayerId, ad: row.ad, phones: row.phones, ok: delivered });
    }

    return {
      ...preview,
      results,
      basarili: results.filter((r) => r.ok).length,
      basarisiz: results.filter((r) => !r.ok).length,
    };
  }

  @Post('portal-message/preview')
  async previewPortalMessage(@Req() req: any, @Body() body: { taxpayerIds?: string[]; message?: string; useTemplate?: boolean; templateName?: string }) {
    const taxpayerIds = Array.isArray(body?.taxpayerIds) ? body.taxpayerIds : [];
    const message = String(body?.message || '').trim();
    const taxpayers = await this.prisma.taxpayer.findMany({
      where: { tenantId: req.user.tenantId, id: { in: taxpayerIds } },
      select: { id: true, companyName: true, firstName: true, lastName: true, phone: true, phones: true },
    });
    const rows = taxpayers.map((t: any) => {
      const phone = t.phone || (Array.isArray(t.phones) ? t.phones.find(Boolean) : null);
      return {
        id: t.id,
        ad: t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim(),
        phone,
        gonderilecek: Boolean(phone && message),
        sebep: !phone ? 'telefon yok' : !message ? 'mesaj boş' : null,
      };
    });
    return {
      whatsapp: this.whatsappService.getStatus(),
      mesaj: message,
      template: body?.useTemplate ? (body?.templateName || process.env.WHATSAPP_PORTAL_TEMPLATE_NAME || process.env.WHATSAPP_TEMPLATE_NAME || null) : null,
      gonderilecek: rows.filter((r) => r.gonderilecek).length,
      atlanacak: rows.filter((r) => !r.gonderilecek).length,
      rows,
    };
  }

  @Post('portal-message/send')
  async sendPortalMessage(@Req() req: any, @Body() body: { taxpayerIds?: string[]; message?: string; useTemplate?: boolean; templateName?: string }) {
    const preview = await this.previewPortalMessage(req, body);
    let basarili = 0;
    let hatali = 0;
    for (const row of preview.rows as any[]) {
      if (!row.gonderilecek) continue;
      const ok = preview.template
        ? await this.whatsappService.sendTemplate(row.phone, [row.ad, preview.mesaj], preview.template)
        : await this.whatsappService.sendMessage(row.phone, preview.mesaj);
      if (ok) {
        basarili++;
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: row.id,
            channel: 'WHATSAPP',
            subject: 'Portal WhatsApp mesajı',
            content: preview.mesaj,
            occurredAt: new Date(),
          },
        });
      } else {
        hatali++;
      }
    }
    return { ...preview, basarili, hatali };
  }

  @Post('owner-alert/send')
  async sendOwnerAlert(@Req() req: any, @Body() body: { message?: string; templateName?: string }) {
    const message = String(body?.message || '').trim();
    if (!message) return { ok: false, error: 'message zorunlu' };
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: req.user.tenantId },
      select: { id: true, name: true, phone: true },
    });
    const rawPhones = String(process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || tenant?.phone || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    let basarili = 0;
    let hatali = 0;
    for (const phone of rawPhones) {
      const templateName = body?.templateName || process.env.WHATSAPP_OWNER_ALERT_TEMPLATE_NAME || '';
      const ok = templateName
        ? await this.whatsappService.sendTemplate(phone, [tenant?.name || 'Moren', message], templateName)
        : await this.whatsappService.sendMessage(phone, message);
      ok ? basarili++ : hatali++;
    }
    return { ok: basarili > 0, basarili, hatali, hedef: rawPhones.length };
  }

  private async buildEvrakReminderPreview(tenantId: string, body: EvrakReminderBody) {
    const now = new Date();
    const year = Number(body.year) || now.getFullYear();
    const monthInput = Number(body.month) || now.getMonth() + 1;
    const month = Math.min(12, Math.max(1, monthInput));
    const donem = `${this.aylarTr[month - 1]} ${year}`;
    const currentPeriod = year === now.getFullYear() && month === now.getMonth() + 1;
    const dueCutoffDay = currentPeriod ? now.getDate() : 31;
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const selectedIds = Array.isArray(body.taxpayerIds) ? body.taxpayerIds.filter(Boolean) : [];

    const where: any = { tenantId, isActive: true };
    if (selectedIds.length) where.id = { in: selectedIds };

    const taxpayers = await this.prisma.taxpayer.findMany({
      where,
      select: {
        id: true,
        companyName: true,
        firstName: true,
        lastName: true,
        phone: true,
        phones: true,
        evrakTeslimGunu: true,
        whatsappEvrakTalep: true,
        lastReminderSentAt: true,
      },
      orderBy: [{ evrakTeslimGunu: 'asc' }, { companyName: 'asc' }, { firstName: 'asc' }],
    });

    const ids = taxpayers.map((t) => t.id);
    const [statuses, logs, template] = await Promise.all([
      ids.length
        ? this.prisma.taxpayerMonthlyStatus.findMany({
            where: { tenantId, year, month, taxpayerId: { in: ids } },
            select: { taxpayerId: true, evraklarGeldi: true },
          })
        : Promise.resolve([]),
      ids.length
        ? this.prisma.communicationLog.findMany({
          where: {
            taxpayerId: { in: ids },
            channel: 'WHATSAPP',
              subject: { contains: 'Evrak' },
          },
            select: { taxpayerId: true, occurredAt: true },
            orderBy: { occurredAt: 'desc' },
          })
        : Promise.resolve([]),
      this.prisma.smsTemplate.findUnique({ where: { tenantId } }),
    ]);

    const statusMap = new Map(statuses.map((s) => [s.taxpayerId, s]));
    const lastLogMap = new Map<string, Date>();
    for (const log of logs) {
      if (!lastLogMap.has(log.taxpayerId)) lastLogMap.set(log.taxpayerId, log.occurredAt);
    }

    const messageTemplate =
      template?.evrakTalepMesaji ||
      'Sayin {ad}, {donem} donemi evraklarinizi tarafimiza teslim etmenizi rica ederiz. Moren Mali Musavirlik';

    const rows = taxpayers.map((t: any) => {
      const ad = this.taxpayerDisplayName(t);
      const phones = this.taxpayerPhones(t);
      const evraklarGeldi = Boolean(statusMap.get(t.id)?.evraklarGeldi);
      const dueDay = Number(t.evrakTeslimGunu || 1);
      const lastReminder = lastLogMap.get(t.id) || t.lastReminderSentAt || null;
      const reasons: string[] = [];

      if (!t.whatsappEvrakTalep) reasons.push('WhatsApp evrak talebi kapali');
      if (!phones.length) reasons.push('Telefon yok');
      if (evraklarGeldi) reasons.push('Bu ay evrak geldi isaretli');
      if (!body.includeNotDue && dueDay > dueCutoffDay) reasons.push(`Evrak teslim gunu gelmedi (${dueDay})`);
      if (!body.force && lastReminder && lastReminder > twoDaysAgo) reasons.push('Son 2 gunde hatirlatma gonderildi');

      const mesaj = messageTemplate
        .replace(/\{ad\}/g, ad)
        .replace(/\{dönem\}/g, donem)
        .replace(/\{donem\}/g, donem);

      return {
        taxpayerId: t.id,
        ad,
        phones,
        phone: phones[0] || null,
        evrakTeslimGunu: dueDay,
        evraklarGeldi,
        sonHatirlatmaTarihi: lastReminder,
        gonderilebilir: reasons.length === 0,
        atlamaSebebi: reasons.join(', ') || null,
        mesaj,
      };
    });

    return {
      year,
      month,
      donem,
      whatsapp: this.whatsappService.getStatus(),
      template: {
        message: messageTemplate,
        metaTemplateName: process.env.WHATSAPP_DOCUMENT_TEMPLATE_NAME || process.env.WHATSAPP_TEMPLATE_NAME || null,
      },
      aday: rows.length,
      gonderilecek: rows.filter((r) => r.gonderilebilir).length,
      atlanacak: rows.filter((r) => !r.gonderilebilir).length,
      rows,
    };
  }

  private taxpayerDisplayName(t: any) {
    return t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'Sayin Mukellef';
  }

  private taxpayerPhones(t: any): string[] {
    const phones = [
      ...(Array.isArray(t.phones) ? t.phones : []),
      t.phone,
    ]
      .map((p) => String(p || '').trim())
      .filter(Boolean);
    return Array.from(new Set(phones));
  }
}
