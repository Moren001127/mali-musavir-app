import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WhatsAppService } from './whatsapp.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('whatsapp')
@UseGuards(AuthGuard('jwt'))
export class WhatsAppController {
  constructor(
    private whatsappService: WhatsAppService,
    private prisma: PrismaService,
  ) {}

  @Get('status')
  getStatus() {
    return this.whatsappService.getStatus();
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
}
