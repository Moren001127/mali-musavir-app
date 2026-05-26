import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
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

type StartConversationBody = {
  taxpayerId?: string;
  phone?: string;
  templateName?: string;
  templateParams?: string[];
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
  getStatus(@Req() req: any) {
    return this.whatsappService.getStatus(req.user.tenantId);
  }

  @Get('inbox')
  async getInbox(@Req() req: any, @Query('limit') limit?: string) {
    const take = Math.min(100, Math.max(1, Number(limit) || 30));
    const logs = await this.prisma.communicationLog.findMany({
      where: {
        channel: 'WHATSAPP',
        taxpayer: { tenantId: req.user.tenantId },
      },
      orderBy: { occurredAt: 'desc' },
      take,
      select: {
        id: true,
        subject: true,
        content: true,
        occurredAt: true,
        taxpayer: {
          select: {
            id: true,
            companyName: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
      },
    });

    return logs.map((log) => {
      const subject = log.subject || '';
      const incoming = /gelen/i.test(subject);
      const taxpayerName =
        log.taxpayer.companyName ||
        `${log.taxpayer.firstName || ''} ${log.taxpayer.lastName || ''}`.trim() ||
        'Mukellef';
      return {
        id: log.id,
        subject,
        content: log.content || '',
        occurredAt: log.occurredAt,
        direction: incoming ? 'incoming' : 'outgoing',
        taxpayer: {
          id: log.taxpayer.id,
          name: taxpayerName,
          phone: log.taxpayer.phone,
        },
      };
    });
  }

  /**
   * MESAJ MERKEZİ — mükellef bazlı konuşma listesi
   * Her mükellef için: son mesaj snippet'i, son zamanı, okunmamış sayısı,
   * 24h penceresi açık mı (son inbound mesajdan beri 24 saat geçmediyse açık).
   */
  @Get('conversations')
  async getConversations(@Req() req: any) {
    const tenantId = req.user.tenantId;
    // Tüm WhatsApp loglarını çek, mükellef bazlı grupla
    const logs = await this.prisma.communicationLog.findMany({
      where: {
        channel: 'WHATSAPP',
        taxpayer: { tenantId },
      },
      orderBy: { occurredAt: 'desc' },
      take: 2000,
      select: {
        id: true,
        subject: true,
        content: true,
        occurredAt: true,
        taxpayer: {
          select: {
            id: true,
            companyName: true,
            firstName: true,
            lastName: true,
            phone: true,
            phones: true,
          },
        },
      },
    });

    const now = Date.now();
    const conversations = new Map<string, any>();

    for (const log of logs) {
      const tId = log.taxpayer.id;
      const subject = log.subject || '';
      const incoming = /gelen/i.test(subject);
      const name =
        log.taxpayer.companyName ||
        `${log.taxpayer.firstName || ''} ${log.taxpayer.lastName || ''}`.trim() ||
        'Mukellef';

      if (!conversations.has(tId)) {
        conversations.set(tId, {
          taxpayerId: tId,
          taxpayerName: name,
          phone: log.taxpayer.phone || (Array.isArray(log.taxpayer.phones) ? log.taxpayer.phones[0] : null),
          lastMessage: this.publicMessageContent(log.content).slice(0, 100),
          lastMessageAt: log.occurredAt,
          lastMessageDirection: incoming ? 'incoming' : 'outgoing',
          lastMessageFailed: this.isFailedSubject(subject),
          unreadCount: 0,
          windowOpen: false, // 24h pencere açık mı
          lastInboundAt: null as Date | null,
          totalMessages: 0,
        });
      }
      const conv = conversations.get(tId);
      conv.totalMessages++;
      // İlk işlenen log en yeni (orderBy desc) — son mesaj olarak işaretle
      if (incoming) {
        if (!conv.lastInboundAt || log.occurredAt > conv.lastInboundAt) {
          conv.lastInboundAt = log.occurredAt;
        }
      }
    }

    // 24h penceresi: son inbound + 24 saat
    const result = Array.from(conversations.values()).map((c) => {
      if (c.lastInboundAt) {
        const elapsed = now - new Date(c.lastInboundAt).getTime();
        c.windowOpen = elapsed < 24 * 60 * 60 * 1000;
      }
      return c;
    });

    // Son mesaj zamanına göre sırala (en yeni üstte)
    result.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    return result;
  }

  @Get('contacts')
  async getContacts(@Req() req: any, @Query('search') search?: string) {
    const tenantId = req.user.tenantId;
    const q = String(search || '').trim().toLocaleLowerCase('tr-TR');
    const qDigits = this.phoneDigits(q);

    const taxpayers = await this.prisma.taxpayer.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
      take: 300,
      select: {
        id: true,
        companyName: true,
        firstName: true,
        lastName: true,
        taxNumber: true,
        phone: true,
        phones: true,
        yetkililer: {
          where: { isActive: true },
          select: { firstName: true, lastName: true, gorev: true, telefon: true, isPrimary: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });

    const taxpayerIds = taxpayers.map((t) => t.id);
    const logs = taxpayerIds.length
      ? await this.prisma.communicationLog.findMany({
          where: { taxpayerId: { in: taxpayerIds }, channel: 'WHATSAPP' },
          orderBy: { occurredAt: 'desc' },
          take: 1000,
          select: { taxpayerId: true, subject: true, occurredAt: true },
        })
      : [];

    const now = Date.now();
    const meta = new Map<string, { lastMessageAt: Date | null; lastInboundAt: Date | null }>();
    for (const log of logs) {
      const current = meta.get(log.taxpayerId) || { lastMessageAt: null, lastInboundAt: null };
      if (!current.lastMessageAt || log.occurredAt > current.lastMessageAt) current.lastMessageAt = log.occurredAt;
      if (/gelen/i.test(log.subject || '') && (!current.lastInboundAt || log.occurredAt > current.lastInboundAt)) {
        current.lastInboundAt = log.occurredAt;
      }
      meta.set(log.taxpayerId, current);
    }

    return taxpayers
      .map((t) => {
        const name = this.taxpayerDisplayName(t);
        const phones = this.taxpayerContactPhones(t);
        const itemMeta = meta.get(t.id) || { lastMessageAt: null, lastInboundAt: null };
        const windowOpen = itemMeta.lastInboundAt
          ? (now - itemMeta.lastInboundAt.getTime()) < 24 * 60 * 60 * 1000
          : false;
        return {
          taxpayerId: t.id,
          taxpayerName: name,
          taxNumber: this.publicTaxNumber(t.taxNumber),
          phones,
          primaryPhone: phones[0]?.phone || null,
          hasConversation: Boolean(itemMeta.lastMessageAt),
          lastMessageAt: itemMeta.lastMessageAt,
          windowOpen,
        };
      })
      .filter((item) => {
        if (!q) return true;
        const haystack = [
          item.taxpayerName,
          item.taxNumber,
          item.primaryPhone,
          ...item.phones.map((p: any) => `${p.phone} ${p.label}`),
        ].join(' ').toLocaleLowerCase('tr-TR');
        const phoneHit = qDigits
          ? item.phones.some((p: any) => this.phoneDigits(p.phone).includes(qDigits))
          : false;
        return haystack.includes(q) || phoneHit;
      });
  }

  /**
   * Bir mükellefin tüm WhatsApp mesaj geçmişi (kronolojik sıralı — eski üstte)
   */
  @Get('conversations/:taxpayerId')
  async getConversationMessages(@Req() req: any, @Param('taxpayerId') taxpayerId: string) {
    const tenantId = req.user.tenantId;
    // Mükellef bu tenant'a ait mi kontrol et
    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: {
        id: true, companyName: true, firstName: true, lastName: true,
        phone: true, phones: true, taxNumber: true,
      },
    });
    if (!taxpayer) return { error: 'Mükellef bulunamadı', messages: [] };

    const logs = await this.prisma.communicationLog.findMany({
      where: { taxpayerId, channel: 'WHATSAPP' },
      orderBy: { occurredAt: 'asc' },
      take: 500,
      select: { id: true, subject: true, content: true, occurredAt: true },
    });

    const now = Date.now();
    let lastInboundAt: Date | null = null;
    const messages = logs.map((log) => {
      const subject = log.subject || '';
      const incoming = /gelen/i.test(subject);
      const contentParts = this.publicMessageParts(log.content);
      if (incoming) lastInboundAt = log.occurredAt;
      return {
        id: log.id,
        direction: incoming ? 'incoming' : 'outgoing',
        subject,
        content: contentParts.text,
        documents: contentParts.documents,
        occurredAt: log.occurredAt,
        failed: this.isFailedSubject(subject),
      };
    });

    const windowOpen = lastInboundAt
      ? (now - new Date(lastInboundAt).getTime()) < 24 * 60 * 60 * 1000
      : false;
    const windowExpiresAt = lastInboundAt
      ? new Date(new Date(lastInboundAt).getTime() + 24 * 60 * 60 * 1000)
      : null;

    return {
      taxpayer: {
        id: taxpayer.id,
        name: taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim() || 'Mükellef',
        phone: taxpayer.phone || (Array.isArray(taxpayer.phones) ? taxpayer.phones[0] : null),
        taxNumber: this.publicTaxNumber(taxpayer.taxNumber),
      },
      messages,
      windowOpen,
      windowExpiresAt,
    };
  }

  /**
   * Bir mükellefe serbest metin gönder.
   * 24h pencere açıksa → serbest metin
   * Kapalıysa → templateName ile şablon gönderir (frontend onaylı şablon seçer)
   */
  @Post('conversations/:taxpayerId/reply')
  async replyToConversation(
    @Req() req: any,
    @Param('taxpayerId') taxpayerId: string,
    @Body() body: { message?: string; templateName?: string; templateParams?: string[] },
  ) {
    const tenantId = req.user.tenantId;
    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { id: true, companyName: true, firstName: true, lastName: true, phone: true, phones: true },
    });
    if (!taxpayer) return { ok: false, error: 'Mükellef bulunamadı' };

    const phones = (Array.isArray(taxpayer.phones) && taxpayer.phones.length > 0)
      ? taxpayer.phones.filter(Boolean)
      : (taxpayer.phone ? [taxpayer.phone] : []);
    if (phones.length === 0) return { ok: false, error: 'Mükellefin telefon numarası yok' };

    const message = String(body?.message || '').trim();
    const templateName = body?.templateName?.trim();

    if (!message && !templateName) {
      return { ok: false, error: 'message veya templateName zorunlu' };
    }

    let delivered = false;
    let usedMethod: 'free-form' | 'template' = 'free-form';
    let logContent = message;

    for (const phone of phones) {
      let ok = false;
      if (templateName) {
        usedMethod = 'template';
        const params = body?.templateParams || [
          taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim() || 'Sayın Mükellef',
        ];
        ok = await this.whatsappService.sendTemplate(phone, params, templateName, tenantId);
        logContent = `[Şablon: ${templateName}] ${params.join(' | ')}`;
      } else {
        ok = await this.whatsappService.sendMessage(phone, message, tenantId);
      }
      if (ok) delivered = true;
    }

    if (delivered) {
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId,
          channel: 'WHATSAPP',
          subject: usedMethod === 'template' ? `WhatsApp şablon — ${templateName}` : 'WhatsApp portal cevabı',
          content: logContent,
          occurredAt: new Date(),
        },
      });
    }

    return { ok: delivered, method: usedMethod, phones };
  }

  @Post('conversations/start')
  async startConversation(@Req() req: any, @Body() body: StartConversationBody) {
    const tenantId = req.user.tenantId;
    const taxpayerId = String(body?.taxpayerId || '').trim();
    if (!taxpayerId) return { ok: false, error: 'Mükellef seçimi zorunlu' };

    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: {
        id: true,
        companyName: true,
        firstName: true,
        lastName: true,
        phone: true,
        phones: true,
        taxNumber: true,
      },
    });
    if (!taxpayer) return { ok: false, error: 'Mükellef bulunamadı' };

    const status = await this.whatsappService.getStatus(tenantId);
    const templateName = String(
      body?.templateName ||
      status.portalTemplateName ||
      status.templateName ||
      '',
    ).trim();
    if (!templateName) return { ok: false, error: 'İlk mesaj için Meta onaylı şablon adı zorunlu' };

    const fallbackPhone = this.taxpayerPhones(taxpayer)[0] || null;
    const phone = String(body?.phone || fallbackPhone || '').trim();
    if (!phone) return { ok: false, error: 'Mükellefin telefon numarası yok' };

    const displayName = this.taxpayerDisplayName(taxpayer);
    const params = Array.isArray(body?.templateParams) && body.templateParams.length
      ? body.templateParams.map((p) => String(p ?? '').trim()).filter(Boolean)
      : [displayName];

    const ok = await this.whatsappService.sendTemplate(phone, params, templateName, tenantId);
    await this.prisma.communicationLog.create({
      data: {
        taxpayerId,
        channel: 'WHATSAPP',
        subject: ok ? `WhatsApp şablon — ${templateName}` : `WhatsApp şablon gönderilemedi — ${templateName}`,
        content: `[Şablon: ${templateName}] ${params.join(' | ')}`,
        occurredAt: new Date(),
      },
    });

    return { ok, method: 'template', taxpayerId, phone, templateName };
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
          ? await this.whatsappService.sendTemplate(phone, [row.ad, preview.donem], templateName, req.user.tenantId)
          : await this.whatsappService.sendMessage(phone, row.mesaj, req.user.tenantId);
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
      whatsapp: await this.whatsappService.getStatus(req.user.tenantId),
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
        ? await this.whatsappService.sendTemplate(row.phone, [row.ad, preview.mesaj], preview.template, req.user.tenantId)
        : await this.whatsappService.sendMessage(row.phone, preview.mesaj, req.user.tenantId);
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
        ? await this.whatsappService.sendTemplate(phone, [tenant?.name || 'Moren', message], templateName, req.user.tenantId)
        : await this.whatsappService.sendMessage(phone, message, req.user.tenantId);
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
      whatsapp: await this.whatsappService.getStatus(tenantId),
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

  private taxpayerContactPhones(t: any): Array<{ phone: string; label: string; primary: boolean }> {
    const seen = new Set<string>();
    const result: Array<{ phone: string; label: string; primary: boolean }> = [];
    const add = (phone: any, label: string, primary = false) => {
      const value = String(phone || '').trim();
      if (!value) return;
      const key = this.phoneDigits(value) || value;
      if (seen.has(key)) return;
      seen.add(key);
      result.push({ phone: value, label, primary });
    };

    add(t.phone, 'Ana telefon', true);
    if (Array.isArray(t.phones)) {
      t.phones.forEach((phone: string, index: number) => add(phone, `Telefon ${index + 1}`, result.length === 0));
    }
    if (Array.isArray(t.yetkililer)) {
      for (const y of t.yetkililer) {
        const name = `${y.firstName || ''} ${y.lastName || ''}`.trim();
        const role = y.gorev ? ` - ${y.gorev}` : '';
        add(y.telefon, name ? `${name}${role}` : 'Yetkili', false);
      }
    }

    return result;
  }

  private phoneDigits(value?: string | null): string {
    return String(value || '').replace(/[^\d]/g, '');
  }

  private isFailedSubject(subject?: string | null): boolean {
    return /gonderilemedi|gönderilemedi|basarisiz|başarısız|hata/i.test(String(subject || ''));
  }

  private publicTaxNumber(taxNumber?: string | null): string {
    const value = String(taxNumber || '');
    return value.startsWith('WHATSAPP-') ? '' : value;
  }

  private publicMessageContent(content?: string | null): string {
    return this.publicMessageParts(content).text;
  }

  private publicMessageParts(content?: string | null): { text: string; documents: Array<{ id: string; title: string }> } {
    const documents: Array<{ id: string; title: string }> = [];
    const text = String(content || '').replace(/\[\[document:([^|\]]+)\|([^\]]+)\]\]/g, (_all, id, title) => {
      documents.push({ id, title });
      return '';
    }).trim();
    return { text, documents };
  }
}
