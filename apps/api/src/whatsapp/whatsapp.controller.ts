import { Body, Controller, Get, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomBytes, randomUUID } from 'crypto';
import { memoryStorage } from 'multer';
import { WhatsAppService } from './whatsapp.service';
import { BaileysService } from './baileys.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

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
  displayName?: string;
  initialMessage?: string;
  templateName?: string;
  templateParams?: string[];
};

type LinkConversationBody = {
  targetTaxpayerId?: string;
};

type SendMediaBody = {
  documentId?: string;
  caption?: string;
};

type PortalMessageBody = {
  taxpayerIds?: string[];
  message?: string;
  useTemplate?: boolean;
  templateName?: string;
  templateParams?: string[];
  sendToAllPhones?: boolean;
  requireApproval?: boolean;
  previewId?: string;
  confirmationText?: string;
  period?: string;
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
    private storage: StorageService,
    private baileys: BaileysService,
  ) {}

  @Get('status')
  getStatus(@Req() req: any) {
    return this.whatsappService.getStatus(req.user.tenantId);
  }

  @Get('templates')
  getTemplates(@Req() req: any) {
    return this.whatsappService.listTemplates(req.user.tenantId);
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
            taxNumber: true,
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
      const phone = this.extractWhatsAppPhone(log.content) || this.defaultWhatsAppPhone(log.taxpayer);
      const conversationId = this.conversationId(tId, phone);
      const name =
        log.taxpayer.companyName ||
        `${log.taxpayer.firstName || ''} ${log.taxpayer.lastName || ''}`.trim() ||
        'Mukellef';

      if (!conversations.has(conversationId)) {
        conversations.set(conversationId, {
          conversationId,
          taxpayerId: tId,
          taxpayerName: name,
          unknownContact: this.isWhatsAppVirtualTaxNumber(log.taxpayer.taxNumber),
          phone,
          lastMessage: this.publicMessageContent(log.content).slice(0, 100),
          lastMessageAt: log.occurredAt,
          lastMessageDirection: incoming ? 'incoming' : 'outgoing',
          lastMessageFailed: this.isFailedSubject(subject),
          unreadCount: 0,
          windowOpen: false, // 24h pencere açık mı
          lastInboundAt: null as Date | null,
          totalMessages: 0,
          whatsAppJid: this.extractWhatsAppJid(log.content),
          avatarUrl: null as string | null,
        });
      }
      const conv = conversations.get(conversationId);
      conv.totalMessages++;
      if (!conv.whatsAppJid) conv.whatsAppJid = this.extractWhatsAppJid(log.content);
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
    await Promise.all(result.slice(0, 60).map(async (c) => {
      c.avatarUrl = await this.baileys.profilePictureUrl(tenantId, c.whatsAppJid || c.phone).catch(() => null);
      delete c.whatsAppJid;
    }));
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
  async getConversationMessages(@Req() req: any, @Param('taxpayerId') taxpayerRef: string) {
    const tenantId = req.user.tenantId;
    const ref = this.parseConversationRef(taxpayerRef);
    const taxpayerId = ref.taxpayerId;
    // Mükellef bu tenant'a ait mi kontrol et
    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: {
        id: true, companyName: true, firstName: true, lastName: true,
        phone: true, phones: true, taxNumber: true,
      },
    });
    if (!taxpayer) return { error: 'Mükellef bulunamadı', messages: [] };

    const allLogs = await this.prisma.communicationLog.findMany({
      where: { taxpayerId, channel: 'WHATSAPP' },
      orderBy: { occurredAt: 'asc' },
      take: 500,
      select: { id: true, subject: true, content: true, occurredAt: true },
    });
    const logs = ref.phone
      ? allLogs.filter((log) => this.logMatchesConversation(log.content, ref.phone, taxpayer))
      : allLogs;

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

    const documentIds = Array.from(new Set(messages.flatMap((m) => m.documents.map((doc) => doc.id))));
    const documentMap = await this.buildPublicDocumentMap(tenantId, documentIds);
    for (const message of messages) {
      message.documents = message.documents.map((doc) => documentMap.get(doc.id) || doc);
    }

    const windowOpen = lastInboundAt
      ? (now - new Date(lastInboundAt).getTime()) < 24 * 60 * 60 * 1000
      : false;
    const windowExpiresAt = lastInboundAt
      ? new Date(new Date(lastInboundAt).getTime() + 24 * 60 * 60 * 1000)
      : null;
    const phone = ref.phone || this.defaultWhatsAppPhone(taxpayer);
    const avatarJid = logs.map((log) => this.extractWhatsAppJid(log.content)).reverse().find(Boolean) || null;
    const avatarUrl = await this.baileys.profilePictureUrl(tenantId, avatarJid || phone).catch(() => null);

    return {
      conversationId: this.conversationId(taxpayer.id, phone),
      taxpayer: {
        id: taxpayer.id,
        name: taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim() || 'Mükellef',
        phone,
        taxNumber: this.publicTaxNumber(taxpayer.taxNumber),
        unknownContact: this.isWhatsAppVirtualTaxNumber(taxpayer.taxNumber),
        avatarUrl,
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
  @Post('conversations/:taxpayerId/link')
  async linkConversationToTaxpayer(
    @Req() req: any,
    @Param('taxpayerId') taxpayerRef: string,
    @Body() body: LinkConversationBody,
  ) {
    const tenantId = req.user.tenantId;
    const ref = this.parseConversationRef(taxpayerRef);
    const taxpayerId = ref.taxpayerId;
    const targetTaxpayerId = String(body?.targetTaxpayerId || '').trim();
    if (!targetTaxpayerId) return { ok: false, error: 'Hedef mukellef secimi zorunlu' };

    const [source, target] = await Promise.all([
      this.prisma.taxpayer.findFirst({
        where: { id: taxpayerId, tenantId },
        select: { id: true, taxNumber: true, phone: true, phones: true, companyName: true },
      }),
      this.prisma.taxpayer.findFirst({
        where: { id: targetTaxpayerId, tenantId, isActive: true },
        select: { id: true, phone: true, phones: true },
      }),
    ]);

    if (!source) return { ok: false, error: 'Konusma bulunamadi' };
    if (!target) return { ok: false, error: 'Hedef mukellef bulunamadi' };
    if (!this.isWhatsAppVirtualTaxNumber(source.taxNumber)) {
      return { ok: false, error: 'Sadece kayitsiz WhatsApp konusmalari baglanabilir' };
    }

    const sourcePhones = [source.phone, ...(Array.isArray(source.phones) ? source.phones : [])]
      .map((p) => this.normalizePhoneForWhatsApp(p))
      .filter(Boolean);
    const targetPhones = [
      ...(Array.isArray(target.phones) ? target.phones : []),
      ...sourcePhones,
    ].filter(Boolean);
    const mergedPhones = Array.from(new Map(targetPhones.map((phone) => [this.normalizePhoneForWhatsApp(phone) || phone, phone])).values());

    const sourceLogs = await this.prisma.communicationLog.findMany({
      where: { taxpayerId: source.id, channel: 'WHATSAPP' },
      select: { id: true, content: true },
    });
    const logIdsToMove = ref.phone
      ? sourceLogs.filter((log) => this.logMatchesConversation(log.content, ref.phone, source)).map((log) => log.id)
      : sourceLogs.map((log) => log.id);

    await this.prisma.$transaction([
      this.prisma.communicationLog.updateMany({
        where: { id: { in: logIdsToMove.length ? logIdsToMove : ['__none__'] }, channel: 'WHATSAPP' },
        data: { taxpayerId: target.id },
      }),
      this.prisma.taxpayer.update({
        where: { id: target.id },
        data: {
          phone: target.phone || mergedPhones[0] || null,
          phones: mergedPhones,
        },
      }),
      this.prisma.taxpayer.update({
        where: { id: source.id },
        data: {
          notes: `Bu kayitsiz WhatsApp konusmasi mukellef kaydina baglandi: ${target.id}`,
          isActive: false,
        },
      }),
    ]);

    return { ok: true, taxpayerId: target.id, conversationId: this.conversationId(target.id, ref.phone || sourcePhones[0] || target.phone) };
  }

  @Post('conversations/:taxpayerId/media')
  async sendConversationMedia(
    @Req() req: any,
    @Param('taxpayerId') taxpayerRef: string,
    @Body() body: SendMediaBody,
  ) {
    const tenantId = req.user.tenantId;
    const ref = this.parseConversationRef(taxpayerRef);
    const taxpayerId = ref.taxpayerId;
    const documentId = String(body?.documentId || '').trim();
    if (!documentId) return { ok: false, error: 'documentId zorunlu' };

    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { id: true, phone: true, phones: true },
    });
    if (!taxpayer) return { ok: false, error: 'Mukellef bulunamadi' };

    const doc = await (this.prisma as any).document.findFirst({
      where: { id: documentId, isDeleted: false, taxpayerId, taxpayer: { tenantId } },
      select: { id: true, title: true, mimeType: true, sizeBytes: true, s3Key: true },
    });
    if (!doc) return { ok: false, error: 'Belge bulunamadi' };

    const targetPhone = ref.phone || this.defaultWhatsAppPhone(taxpayer);
    const sendTarget = await this.whatsAppSendTarget(taxpayer, targetPhone);
    const phones = sendTarget ? [sendTarget] : [];
    if (!phones.length) return { ok: false, error: 'Telefon numarasi yok' };

    const filename = this.documentFilename(doc.title, doc.mimeType);
    const mediaUrl = await this.storage.getPresignedDownloadUrl(doc.s3Key, filename);
    const caption = String(body?.caption || '').trim();
    const errors: string[] = [];
    let delivered = false;

    for (const phone of phones) {
      const result = await this.whatsappService.sendMediaDetailed(phone, {
        url: mediaUrl,
        mimeType: doc.mimeType,
        filename,
        caption,
      }, tenantId);
      if (result.ok) delivered = true;
      else if (result.error) errors.push(`${targetPhone || phone}: ${result.error}`);
    }

    const content = `${caption || `[Medya: ${doc.title}]`}\n[[document:${doc.id}|${doc.title}]]`;
    await this.prisma.communicationLog.create({
      data: {
        taxpayerId,
        channel: 'WHATSAPP',
        subject: delivered ? 'WhatsApp portal medya' : 'WhatsApp portal medya (gonderilemedi)',
        content: this.withWhatsAppPhone(
          delivered ? content : `${content}\n\nHata: ${errors.join(' | ') || 'WhatsApp medya gonderimi basarisiz.'}`,
          targetPhone,
        ),
        occurredAt: new Date(),
      },
    });

    return {
      ok: delivered,
      document: { id: doc.id, title: doc.title, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, url: mediaUrl },
      error: delivered ? undefined : (errors.join(' | ') || 'WhatsApp medya gonderimi basarisiz.'),
    };
  }

  @Post('conversations/:taxpayerId/media/upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
  }))
  async uploadAndSendConversationMedia(
    @Req() req: any,
    @Param('taxpayerId') taxpayerRef: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { caption?: string },
  ) {
    const tenantId = req.user.tenantId;
    const ref = this.parseConversationRef(taxpayerRef);
    const taxpayerId = ref.taxpayerId;
    if (!file?.buffer?.length) return { ok: false, error: 'Dosya zorunlu' };

    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { id: true, phone: true, phones: true },
    });
    if (!taxpayer) return { ok: false, error: 'Mukellef bulunamadi' };

    const targetPhone = ref.phone || this.defaultWhatsAppPhone(taxpayer);
    const sendTarget = await this.whatsAppSendTarget(taxpayer, targetPhone);
    const phones = sendTarget ? [sendTarget] : [];
    if (!phones.length) return { ok: false, error: 'Telefon numarasi yok' };

    const originalName = this.safeMediaFilename(file.originalname || 'whatsapp-dosya.bin');
    const mimeType = file.mimetype || 'application/octet-stream';
    const s3Key = `${tenantId}/${taxpayerId}/whatsapp/${randomUUID()}-${originalName}`;
    const sizeBytes = file.size || file.buffer.length;

    await this.storage.putBuffer(s3Key, file.buffer, mimeType, {
      source: 'whatsapp-portal',
      originalName: encodeURIComponent(originalName),
    });

    const doc = await (this.prisma as any).document.create({
      data: {
        taxpayerId,
        title: originalName,
        category: 'EVRAK',
        mimeType,
        sizeBytes,
        s3Key,
        notes: 'WhatsApp portal mesajindan manuel gonderildi.',
      },
      select: { id: true, title: true, mimeType: true, sizeBytes: true, s3Key: true },
    });

    await (this.prisma as any).documentVersion.create({
      data: {
        documentId: doc.id,
        versionNo: 1,
        s3Key,
        sizeBytes,
        uploadedBy: req.user?.sub || req.user?.userId || 'whatsapp-portal',
        notes: 'WhatsApp portal medya gonderimi',
      },
    });

    const filename = this.documentFilename(doc.title, doc.mimeType);
    const mediaUrl = await this.storage.getPresignedDownloadUrl(doc.s3Key, filename);
    const caption = String(body?.caption || '').trim();
    const errors: string[] = [];
    let delivered = false;

    for (const phone of phones) {
      const result = await this.whatsappService.sendMediaDetailed(phone, {
        url: mediaUrl,
        mimeType: doc.mimeType,
        filename,
        caption,
      }, tenantId);
      if (result.ok) delivered = true;
      else if (result.error) errors.push(`${targetPhone || phone}: ${result.error}`);
    }

    const content = `${caption || `[Medya: ${doc.title}]`}\n[[document:${doc.id}|${doc.title}]]`;
    await this.prisma.communicationLog.create({
      data: {
        taxpayerId,
        channel: 'WHATSAPP',
        subject: delivered ? 'WhatsApp portal medya' : 'WhatsApp portal medya (gonderilemedi)',
        content: this.withWhatsAppPhone(
          delivered ? content : `${content}\n\nHata: ${errors.join(' | ') || 'WhatsApp medya gonderimi basarisiz.'}`,
          targetPhone,
        ),
        occurredAt: new Date(),
      },
    });

    return {
      ok: delivered,
      document: { id: doc.id, title: doc.title, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, url: mediaUrl },
      error: delivered ? undefined : (errors.join(' | ') || 'WhatsApp medya gonderimi basarisiz.'),
    };
  }

  @Post('conversations/:taxpayerId/reply')
  async replyToConversation(
    @Req() req: any,
    @Param('taxpayerId') taxpayerRef: string,
    @Body() body: { message?: string; templateName?: string; templateParams?: string[] },
  ) {
    const tenantId = req.user.tenantId;
    const ref = this.parseConversationRef(taxpayerRef);
    const taxpayerId = ref.taxpayerId;
    const taxpayer = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { id: true, companyName: true, firstName: true, lastName: true, phone: true, phones: true },
    });
    if (!taxpayer) return { ok: false, error: 'Mükellef bulunamadı' };

    const targetPhone = ref.phone || this.defaultWhatsAppPhone(taxpayer);
    const sendTarget = await this.whatsAppSendTarget(taxpayer, targetPhone);
    const phones = sendTarget ? [sendTarget] : [];
    if (phones.length === 0) return { ok: false, error: 'Mükellefin telefon numarası yok' };

    const message = String(body?.message || '').trim();
    const templateName = body?.templateName?.trim();

    if (!message && !templateName) {
      return { ok: false, error: 'message veya templateName zorunlu' };
    }

    const detailedErrors: string[] = [];
    let detailedDelivered = false;
    let detailedMethod: 'free-form' | 'template' = 'free-form';
    let detailedLogContent = message;

    for (const phone of phones) {
      let result: { ok: boolean; error?: string } = { ok: false };
      if (templateName) {
        detailedMethod = 'template';
        const params = body?.templateParams || [this.taxpayerDisplayName(taxpayer)];
        result = await this.whatsappService.sendTemplateDetailed(phone, params, templateName, tenantId);
        detailedLogContent = `[Sablon: ${templateName}] ${params.join(' | ')}`;
      } else {
        result = await this.whatsappService.sendMessageDetailed(phone, message, tenantId);
      }
      if (result.ok) detailedDelivered = true;
      else if (result.error) detailedErrors.push(`${targetPhone || phone}: ${result.error}`);
    }

    await this.prisma.communicationLog.create({
      data: {
        taxpayerId,
        channel: 'WHATSAPP',
        subject: detailedDelivered
          ? (detailedMethod === 'template' ? `WhatsApp sablon - ${templateName}` : 'WhatsApp portal cevabi')
          : (detailedMethod === 'template' ? `WhatsApp sablon gonderilemedi - ${templateName}` : 'WhatsApp portal cevabi (gonderilemedi)'),
        content: this.withWhatsAppPhone(
          detailedDelivered ? detailedLogContent : `${detailedLogContent}\n\nHata: ${detailedErrors.join(' | ') || 'WhatsApp gonderimi basarisiz.'}`,
          targetPhone,
        ),
        occurredAt: new Date(),
      },
    });

    return {
      ok: detailedDelivered,
      method: detailedMethod,
      phones: targetPhone ? [targetPhone] : phones,
      conversationId: this.conversationId(taxpayerId, targetPhone),
      error: detailedDelivered ? undefined : (detailedErrors.join(' | ') || 'WhatsApp gonderimi basarisiz.'),
    };

    /*
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
    */
  }

  @Post('conversations/start')
  async startConversation(@Req() req: any, @Body() body: StartConversationBody) {
    const tenantId = req.user.tenantId;
    const taxpayerId = String(body?.taxpayerId || '').trim();
    const manualPhone = String(body?.phone || '').trim();
    if (!taxpayerId && manualPhone) {
      const contact = await this.ensureManualWhatsAppContact(tenantId, manualPhone, body?.displayName);
      const status = await this.whatsappService.getStatus(tenantId);
      const initialMessage = String(body?.initialMessage || '').trim();
      if (this.baileys.isConnected(tenantId) && initialMessage) {
        const manualResult = await this.whatsappService.sendMessageDetailed(manualPhone, initialMessage, tenantId);
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: contact.id,
            channel: 'WHATSAPP',
            subject: manualResult.ok ? 'WhatsApp sohbet baslatma' : 'WhatsApp sohbet baslatma (gonderilemedi)',
            content: this.withWhatsAppPhone(
              manualResult.ok
                ? initialMessage
                : `${initialMessage}\n\nHata: ${manualResult.error || 'WhatsApp gonderimi basarisiz.'}`,
              manualPhone,
            ),
            occurredAt: new Date(),
          },
        });
        return {
          ok: manualResult.ok,
          method: 'free-form',
          taxpayerId: contact.id,
          phone: manualPhone,
          conversationId: this.conversationId(contact.id, manualPhone),
          error: manualResult.error,
        };
      }
      const manualTemplateName = String(body?.templateName || status.portalTemplateName || status.templateName || '').trim();
      if (!manualTemplateName) return { ok: false, error: 'Ilk mesaj icin Meta onayli sablon adi zorunlu' };
      const manualName = this.taxpayerDisplayName(contact);
      const manualParams = Array.isArray(body?.templateParams) && body.templateParams.length
        ? body.templateParams.map((p) => String(p ?? '').trim()).filter(Boolean)
        : [manualName];
      const manualResult = await this.whatsappService.sendTemplateDetailed(manualPhone, manualParams, manualTemplateName, tenantId);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: contact.id,
          channel: 'WHATSAPP',
          subject: manualResult.ok ? `WhatsApp sablon - ${manualTemplateName}` : `WhatsApp sablon gonderilemedi - ${manualTemplateName}`,
          content: this.withWhatsAppPhone(
            manualResult.ok
              ? `[Sablon: ${manualTemplateName}] ${manualParams.join(' | ')}`
              : `[Sablon: ${manualTemplateName}] ${manualParams.join(' | ')}\n\nHata: ${manualResult.error || 'WhatsApp gonderimi basarisiz.'}`,
            manualPhone,
          ),
          occurredAt: new Date(),
        },
      });
      return {
        ok: manualResult.ok,
        method: 'template',
        taxpayerId: contact.id,
        phone: manualPhone,
        conversationId: this.conversationId(contact.id, manualPhone),
        templateName: manualTemplateName,
        error: manualResult.error,
      };
    }
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
    const fallbackPhone = this.taxpayerPhones(taxpayer)[0] || null;
    const phone = String(body?.phone || fallbackPhone || '').trim();
    if (!phone) return { ok: false, error: 'Mukellefin telefon numarasi yok' };
    const initialMessage = String(body?.initialMessage || '').trim();
    if (this.baileys.isConnected(tenantId) && initialMessage) {
      const sendTarget = await this.whatsAppSendTarget(taxpayer, phone);
      const startResult = await this.whatsappService.sendMessageDetailed(sendTarget || phone, initialMessage, tenantId);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId,
          channel: 'WHATSAPP',
          subject: startResult.ok ? 'WhatsApp sohbet baslatma' : 'WhatsApp sohbet baslatma (gonderilemedi)',
          content: this.withWhatsAppPhone(
            startResult.ok
              ? initialMessage
              : `${initialMessage}\n\nHata: ${startResult.error || 'WhatsApp gonderimi basarisiz.'}`,
            phone,
          ),
          occurredAt: new Date(),
        },
      });
      return { ok: startResult.ok, method: 'free-form', taxpayerId, phone, conversationId: this.conversationId(taxpayerId, phone), error: startResult.error };
    }
    const templateName = String(
      body?.templateName ||
      status.portalTemplateName ||
      status.templateName ||
      '',
    ).trim();
    if (!templateName) return { ok: false, error: 'İlk mesaj için Meta onaylı şablon adı zorunlu' };

    const displayName = this.taxpayerDisplayName(taxpayer);
    const params = Array.isArray(body?.templateParams) && body.templateParams.length
      ? body.templateParams.map((p) => String(p ?? '').trim()).filter(Boolean)
      : [displayName];

    const startResult = await this.whatsappService.sendTemplateDetailed(phone, params, templateName, tenantId);
    await this.prisma.communicationLog.create({
      data: {
        taxpayerId,
        channel: 'WHATSAPP',
        subject: startResult.ok ? `WhatsApp sablon - ${templateName}` : `WhatsApp sablon gonderilemedi - ${templateName}`,
        content: this.withWhatsAppPhone(
          startResult.ok
            ? `[Sablon: ${templateName}] ${params.join(' | ')}`
            : `[Sablon: ${templateName}] ${params.join(' | ')}\n\nHata: ${startResult.error || 'WhatsApp gonderimi basarisiz.'}`,
          phone,
        ),
        occurredAt: new Date(),
      },
    });

    return { ok: startResult.ok, method: 'template', taxpayerId, phone, conversationId: this.conversationId(taxpayerId, phone), templateName, error: startResult.error };
    /*
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
    */
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
  async previewPortalMessage(@Req() req: any, @Body() body: PortalMessageBody) {
    return this.buildPortalMessagePreview(req.user.tenantId, body, {
      createApproval: true,
      userId: this.requestUserId(req),
    });

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
  async sendPortalMessage(@Req() req: any, @Body() body: PortalMessageBody) {
    {
      const tenantId = req.user.tenantId;
      const approval = await this.resolvePortalMessageApproval(tenantId, this.requestUserId(req), body);
      if (!approval.ok) return approval;

      const preview = await this.buildPortalMessagePreview(tenantId, approval.body || body, { createApproval: false });
      let basarili = 0;
      let hatali = 0;
      const results: any[] = [];

      for (const row of preview.rows as any[]) {
        if (!row.gonderilecek) {
          results.push({ taxpayerId: row.id, ad: row.ad, ok: false, skipped: true, error: row.sebep });
          continue;
        }

        const phoneResults: Array<{ phone: string; ok: boolean; error?: string }> = [];
        const errors: string[] = [];
        let delivered = false;
        for (const phone of row.phones) {
          const sendTarget = await this.whatsAppSendTarget({
            id: row.id,
            phone,
            phones: row.phones,
          }, phone);
          const result = preview.template
            ? await this.whatsappService.sendTemplateDetailed(sendTarget || phone, row.templateParams || [], preview.template, tenantId)
            : await this.whatsappService.sendMessageDetailed(sendTarget || phone, row.mesaj, tenantId);
          phoneResults.push({ phone, ok: result.ok, error: result.error });
          if (result.ok) delivered = true;
          else errors.push(`${phone}: ${result.error || 'WhatsApp gonderimi basarisiz.'}`);
        }

        delivered ? basarili++ : hatali++;
        const logContent = preview.template
          ? `[Sablon: ${preview.template}] ${(row.templateParams || []).join(' | ')}`
          : row.mesaj;
        for (const phoneResult of phoneResults) {
          await this.prisma.communicationLog.create({
            data: {
              taxpayerId: row.id,
              channel: 'WHATSAPP',
              subject: phoneResult.ok ? 'Portal WhatsApp mesaji' : 'Portal WhatsApp mesaji (gonderilemedi)',
              content: this.withWhatsAppPhone(
                phoneResult.ok ? logContent : `${logContent}\n\nHata: ${phoneResult.error || 'WhatsApp gonderimi basarisiz.'}`,
                phoneResult.phone,
              ),
              occurredAt: new Date(),
            },
          });
        }
        results.push({ taxpayerId: row.id, ad: row.ad, phones: row.phones, ok: delivered, error: delivered ? undefined : errors.join(' | ') });
      }

      if (approval.approvalId) {
        await (this.prisma as any).ownerApprovalRequest.update({
          where: { id: approval.approvalId },
          data: {
            status: 'EXECUTED',
            approvedAt: new Date(),
            consumedAt: new Date(),
            responseText: body?.confirmationText || body?.previewId || null,
          },
        }).catch(() => null);
        await this.writeOwnerApprovalAudit(tenantId, this.requestUserId(req), 'EXECUTE', approval.approvalId, {
          previewId: approval.previewId,
          basarili,
          hatali,
        });
      }

      return { ...preview, basarili, hatali, results, previewId: approval.previewId || preview.previewId || null };
    }

    const preview = await this.previewPortalMessage(req, body);
    let basarili = 0;
    let hatali = 0;
    for (const row of preview.rows as any[]) {
      if (!row.gonderilecek) continue;
      const ok = preview.template
        ? await this.whatsappService.sendTemplate(row.phone, [row.ad, preview.mesaj], preview.template || undefined, req.user.tenantId)
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

  private requestUserId(req: any): string | null {
    return req?.user?.sub || req?.user?.userId || req?.user?.id || null;
  }

  private async buildPortalMessagePreview(
    tenantId: string,
    body: PortalMessageBody = {},
    opts: { createApproval?: boolean; userId?: string | null } = {},
  ) {
    const taxpayerIds = Array.isArray(body?.taxpayerIds)
      ? Array.from(new Set(body.taxpayerIds.map((id) => String(id || '').trim()).filter(Boolean)))
      : [];
    const messageTemplate = String(body?.message || '').trim();
    const useTemplate = Boolean(body?.useTemplate);
    const status = await this.whatsappService.getStatus(tenantId);
    const template = useTemplate
      ? String(body?.templateName || status.portalTemplateName || status.templateName || process.env.WHATSAPP_PORTAL_TEMPLATE_NAME || process.env.WHATSAPP_TEMPLATE_NAME || '').trim()
      : '';
    const period = this.portalPeriodLabel(body?.period);
    const paramTemplates = Array.isArray(body?.templateParams)
      ? body.templateParams.map((p) => String(p ?? '').trim()).filter(Boolean)
      : [];

    const taxpayers = taxpayerIds.length
      ? await this.prisma.taxpayer.findMany({
          where: { tenantId, id: { in: taxpayerIds } },
          select: {
            id: true,
            companyName: true,
            firstName: true,
            lastName: true,
            taxNumber: true,
            phone: true,
            phones: true,
          },
          orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
        })
      : [];

    const rows = taxpayers.map((t: any) => {
      const allPhones = this.taxpayerPhones(t);
      const phones = body?.sendToAllPhones ? allPhones : allPhones.slice(0, 1);
      const context = this.portalTemplateContext(t, messageTemplate, period, phones[0] || allPhones[0] || '');
      const mesaj = this.renderPortalTemplate(messageTemplate, context);
      const effectiveParamTemplates = template
        ? (paramTemplates.length ? paramTemplates : this.defaultPortalTemplateParams(template, messageTemplate))
        : [];
      const templateParams = effectiveParamTemplates.map((value) => this.renderPortalTemplate(value, context));
      const reasons: string[] = [];
      if (!phones.length) reasons.push('telefon yok');
      if (!template && !mesaj) reasons.push('mesaj bos');
      if (template && !template.trim()) reasons.push('sablon adi yok');

      return {
        id: t.id,
        ad: context.ad,
        taxNumber: this.publicTaxNumber(t.taxNumber),
        phone: phones[0] || null,
        phones,
        mesaj,
        templateParams,
        gonderilecek: reasons.length === 0,
        sebep: reasons.join(', ') || null,
      };
    });

    const gonderilecek = rows.filter((r) => r.gonderilecek).length;
    const targetCount = rows.filter((r) => r.gonderilecek).reduce((sum, row) => sum + row.phones.length, 0);
    let approval: any = null;
    if (opts.createApproval && gonderilecek > 0) {
      const payload: PortalMessageBody = {
        taxpayerIds,
        message: messageTemplate,
        useTemplate,
        templateName: template || undefined,
        templateParams: paramTemplates,
        sendToAllPhones: Boolean(body?.sendToAllPhones),
        period,
      };
      approval = await this.createPortalOwnerApproval(
        tenantId,
        opts.userId || null,
        payload,
        `${targetCount} WhatsApp hedefi icin ${template ? `Meta sablonu (${template})` : 'serbest portal mesaji'} hazirlandi.`,
      );
    }

    return {
      whatsapp: status,
      mesaj: messageTemplate,
      template: template || null,
      period,
      sendToAllPhones: Boolean(body?.sendToAllPhones),
      gonderilecek,
      atlanacak: rows.filter((r) => !r.gonderilecek).length,
      targetCount,
      approvalRecommended: targetCount > 1,
      requiresConfirmation: Boolean(approval),
      previewId: approval?.previewId || null,
      expiresAt: approval?.expiresAt || null,
      confirmationText: approval ? `ONAYLIYORUM #${approval.previewId}` : null,
      variables: ['{{ad}}', '{{mukellef}}', '{{vkn}}', '{{telefon}}', '{{donem}}', '{{mesaj}}'],
      rows,
    };
  }

  private async resolvePortalMessageApproval(tenantId: string, userId: string | null, body: PortalMessageBody = {}) {
    const previewId = this.extractPreviewId(body?.confirmationText || body?.previewId);
    if (!previewId) {
      if (body?.requireApproval) {
        return { ok: false, error: 'Toplu gonderim icin once preview alin ve ONAYLIYORUM #PRV-XXXX formatinda onay girin.' };
      }
      return { ok: true as const, body: null as PortalMessageBody | null, approvalId: null as string | null, previewId: null as string | null };
    }

    const confirmation = String(body?.confirmationText || '').trim().toLocaleUpperCase('tr-TR');
    if (confirmation !== `ONAYLIYORUM #${previewId}`) {
      return { ok: false, error: `Onay metni gecersiz. Beklenen format: ONAYLIYORUM #${previewId}` };
    }

    const approval = await (this.prisma as any).ownerApprovalRequest.findFirst({
      where: { tenantId, previewId, agent: 'whatsapp', action: 'portal_message_send' },
    });
    if (!approval) return { ok: false, error: `Preview bulunamadi: ${previewId}` };
    if (approval.status !== 'PENDING') return { ok: false, error: `Preview artik kullanilamaz: ${approval.status}` };
    if (new Date(approval.expiresAt).getTime() < Date.now()) {
      await (this.prisma as any).ownerApprovalRequest.update({
        where: { id: approval.id },
        data: { status: 'EXPIRED', responseText: body?.confirmationText || null },
      }).catch(() => null);
      await this.writeOwnerApprovalAudit(tenantId, userId, 'EXPIRE', approval.id, { previewId });
      return { ok: false, error: `Preview suresi doldu: ${previewId}. Yeni onizleme olusturun.` };
    }

    return {
      ok: true as const,
      body: approval.payload as PortalMessageBody,
      approvalId: approval.id as string,
      previewId,
    };
  }

  private async createPortalOwnerApproval(tenantId: string, userId: string | null, payload: PortalMessageBody, impact: string) {
    const previewId = await this.nextPreviewId();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const approval = await (this.prisma as any).ownerApprovalRequest.create({
      data: {
        tenantId,
        userId,
        previewId,
        agent: 'whatsapp',
        action: 'portal_message_send',
        payload,
        impact,
        expiresAt,
      },
    });
    await this.writeOwnerApprovalAudit(tenantId, userId, 'CREATE', approval.id, { previewId, impact, payload, expiresAt });
    return approval;
  }

  private async writeOwnerApprovalAudit(tenantId: string, userId: string | null, action: string, resourceId: string | null, data: any) {
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action,
        resource: 'owner_approval_request',
        resourceId,
        newData: data,
      },
    }).catch(() => null);
  }

  private async nextPreviewId(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const previewId = `PRV-${randomBytes(2).toString('hex').toUpperCase()}`;
      const exists = await (this.prisma as any).ownerApprovalRequest.findUnique({ where: { previewId } }).catch(() => null);
      if (!exists) return previewId;
    }
    return `PRV-${randomBytes(2).toString('hex').toUpperCase()}`;
  }

  private extractPreviewId(value: any): string | null {
    const raw = String(value || '').trim().toLocaleUpperCase('tr-TR');
    const match = raw.match(/#?(PRV-[A-F0-9]{4})\b/);
    return match ? match[1] : null;
  }

  private defaultPortalTemplateParams(templateName: string, message: string): string[] {
    const normalized = String(templateName || '').trim().toLocaleLowerCase('tr-TR');
    if (!normalized) return [];
    if (normalized === 'evrak_iletisim') return ['{{ad}}'];
    return String(message || '').trim() ? ['{{ad}}', '{{mesaj}}'] : ['{{ad}}'];
  }

  private portalTemplateContext(t: any, message: string, period: string, phone: string) {
    const ad = this.taxpayerDisplayName(t);
    return {
      ad,
      mukellef: ad,
      unvan: ad,
      firstName: String(t.firstName || '').trim(),
      lastName: String(t.lastName || '').trim(),
      vkn: String(t.taxNumber || '').trim(),
      taxNumber: String(t.taxNumber || '').trim(),
      telefon: phone,
      phone,
      donem: period,
      period,
      mesaj: message,
      message,
    };
  }

  private renderPortalTemplate(value: string, context: Record<string, any>): string {
    const aliases = new Map<string, string>();
    Object.entries(context).forEach(([key, raw]) => {
      const value = String(raw ?? '');
      aliases.set(key.toLocaleLowerCase('tr-TR'), value);
      aliases.set(`taxpayer.${key}`.toLocaleLowerCase('tr-TR'), value);
    });
    aliases.set('taxpayer.name', String(context.ad || ''));
    aliases.set('taxpayer.taxnumber', String(context.taxNumber || context.vkn || ''));

    return String(value || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}|\{\s*([a-zA-Z0-9_.-]+)\s*\}/g, (all, key1, key2) => {
      const key = String(key1 || key2 || '').toLocaleLowerCase('tr-TR');
      return aliases.has(key) ? aliases.get(key)! : all;
    }).trim();
  }

  private portalPeriodLabel(raw?: string): string {
    const value = String(raw || '').trim();
    const match = value.match(/^(\d{4})-(\d{1,2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Math.min(12, Math.max(1, Number(match[2])));
      return `${this.aylarTr[month - 1]} ${year}`;
    }
    if (value) return value;
    const now = new Date();
    return `${this.aylarTr[now.getMonth()]} ${now.getFullYear()}`;
  }

  private async ensureManualWhatsAppContact(tenantId: string, phone: string, displayName?: string) {
    const normalized = this.normalizePhoneForWhatsApp(phone);
    const phoneValue = normalized || String(phone || '').trim();
    const taxNumber = `WHATSAPP-${phoneValue || 'MANUAL'}`;
    const phoneWhere = phoneValue ? [{ phone: phoneValue }, { phones: { has: phoneValue } }] : [];
    const existing = await this.prisma.taxpayer.findFirst({
      where: {
        tenantId,
        OR: [{ taxNumber }, ...phoneWhere],
      },
      select: { id: true, companyName: true, firstName: true, lastName: true, phone: true, phones: true, taxNumber: true },
    });
    if (existing) return existing;

    return this.prisma.taxpayer.create({
      data: {
        tenantId,
        type: 'GERCEK_KISI',
        companyName: String(displayName || '').trim() || `Kayitsiz WhatsApp ${phoneValue}`,
        taxNumber,
        taxOffice: 'WHATSAPP',
        phone: phoneValue,
        phones: phoneValue ? [phoneValue] : [],
        emails: [],
        notes: 'Mesaj Merkezi manuel konusma baslatma ile olusturulan kayitsiz WhatsApp kisi kaydi.',
        isActive: false,
        whatsappEvrakTalep: false,
        whatsappEvrakGeldi: false,
      },
      select: { id: true, companyName: true, firstName: true, lastName: true, phone: true, phones: true, taxNumber: true },
    });
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

  private async buildPublicDocumentMap(tenantId: string, documentIds: string[]): Promise<Map<string, any>> {
    const result = new Map<string, any>();
    if (!documentIds.length) return result;

    const documents = await (this.prisma as any).document.findMany({
      where: {
        id: { in: documentIds },
        isDeleted: false,
        taxpayer: { tenantId },
      },
      select: { id: true, title: true, mimeType: true, sizeBytes: true, s3Key: true },
    });

    for (const doc of documents) {
      let url: string | null = null;
      try {
        url = await this.storage.getPresignedDownloadUrl(doc.s3Key, this.documentFilename(doc.title, doc.mimeType));
      } catch {
        url = null;
      }
      result.set(doc.id, {
        id: doc.id,
        title: doc.title,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        url,
      });
    }

    return result;
  }

  private documentFilename(title?: string | null, mimeType?: string | null): string {
    const safeTitle = String(title || 'belge').trim() || 'belge';
    if (/\.[a-z0-9]{2,8}$/i.test(safeTitle)) return safeTitle;
    const subtype = String(mimeType || '').split('/')[1] || 'bin';
    return `${safeTitle}.${subtype.split(';')[0] || 'bin'}`;
  }

  private safeMediaFilename(value: string): string {
    const cleaned = String(value || 'whatsapp-dosya.bin')
      .replace(/[^\w.\-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120);
    return cleaned || 'whatsapp-dosya.bin';
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

  private normalizePhoneForWhatsApp(value?: string | null): string {
    let digits = this.phoneDigits(value);
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) digits = `90${digits.slice(1)}`;
    if (digits.length === 10 && digits.startsWith('5')) digits = `90${digits}`;
    return digits;
  }

  private conversationId(taxpayerId: string, phone?: string | null): string {
    const normalized = this.normalizePhoneForWhatsApp(phone);
    return normalized ? `${taxpayerId}__wa__${normalized}` : taxpayerId;
  }

  private parseConversationRef(ref: string): { taxpayerId: string; phone: string | null } {
    const raw = decodeURIComponent(String(ref || '').trim());
    const marker = '__wa__';
    const index = raw.indexOf(marker);
    if (index < 0) return { taxpayerId: raw, phone: null };
    return {
      taxpayerId: raw.slice(0, index),
      phone: this.normalizePhoneForWhatsApp(raw.slice(index + marker.length)) || null,
    };
  }

  private defaultWhatsAppPhone(taxpayer: any): string | null {
    return this.normalizePhoneForWhatsApp(taxpayer?.phone || (Array.isArray(taxpayer?.phones) ? taxpayer.phones[0] : null)) || null;
  }

  private isWhatsAppLid(value?: string | null): boolean {
    const digits = this.phoneDigits(value);
    return digits.startsWith('111') && digits.length >= 14;
  }

  private async whatsAppSendTarget(taxpayer: any, displayPhone?: string | null): Promise<string | null> {
    const display = this.normalizePhoneForWhatsApp(displayPhone) || this.defaultWhatsAppPhone(taxpayer);
    if (!display) return null;
    const latestJid = taxpayer?.id ? await this.latestWhatsAppJid(taxpayer.id, display) : null;
    if (latestJid) return latestJid;
    if (this.isWhatsAppLid(display)) return this.phoneDigits(display);

    const taxpayerPhones = [
      taxpayer?.phone,
      ...(Array.isArray(taxpayer?.phones) ? taxpayer.phones : []),
    ].filter(Boolean);
    const hasDisplayPhone = taxpayerPhones.some((phone) => this.normalizePhoneForWhatsApp(phone) === display);
    const lid = taxpayerPhones.find((phone) => this.isWhatsAppLid(phone));

    return hasDisplayPhone && lid ? this.phoneDigits(lid) : display;
  }

  private async latestWhatsAppJid(taxpayerId: string, phone?: string | null): Promise<string | null> {
    const requestedPhone = this.normalizePhoneForWhatsApp(phone);
    const logs = await this.prisma.communicationLog.findMany({
      where: { taxpayerId, channel: 'WHATSAPP' },
      orderBy: { occurredAt: 'desc' },
      take: 80,
      select: { content: true },
    });

    for (const log of logs) {
      const logPhone = this.extractWhatsAppPhone(log.content);
      if (requestedPhone && logPhone && logPhone !== requestedPhone) continue;
      const jid = this.extractWhatsAppJid(log.content);
      if (jid) return jid;
    }
    return null;
  }

  private extractWhatsAppPhone(content?: string | null): string | null {
    const match = String(content || '').match(/\[\[wa_phone:([0-9+ ]+)\]\]/);
    return match ? (this.normalizePhoneForWhatsApp(match[1]) || null) : null;
  }

  private extractWhatsAppJid(content?: string | null): string | null {
    const match = String(content || '').match(/\[\[wa_jid:([^\]]+)\]\]/);
    const jid = String(match?.[1] || '').trim();
    return jid.includes('@') ? jid : null;
  }

  private withWhatsAppPhone(content: string, phone?: string | null): string {
    const normalized = this.normalizePhoneForWhatsApp(phone);
    return normalized ? `[[wa_phone:${normalized}]]\n${content}` : content;
  }

  private logMatchesConversation(content: string | null | undefined, requestedPhone: string | null, taxpayer: any): boolean {
    if (!requestedPhone) return true;
    const logPhone = this.extractWhatsAppPhone(content);
    if (logPhone) return logPhone === requestedPhone;
    return requestedPhone === this.defaultWhatsAppPhone(taxpayer);
  }

  private isFailedSubject(subject?: string | null): boolean {
    return /gonderilemedi|gönderilemedi|basarisiz|başarısız|hata/i.test(String(subject || ''));
  }

  private publicTaxNumber(taxNumber?: string | null): string {
    const value = String(taxNumber || '');
    return value.startsWith('WHATSAPP-') ? '' : value;
  }

  private isWhatsAppVirtualTaxNumber(taxNumber?: string | null): boolean {
    const value = String(taxNumber || '');
    return value.startsWith('WHATSAPP-') && !value.startsWith('WHATSAPP-OWNER-');
  }

  private publicMessageContent(content?: string | null): string {
    return this.publicMessageParts(content).text;
  }

  private publicMessageParts(content?: string | null): { text: string; documents: Array<{ id: string; title: string }> } {
    const documents: Array<{ id: string; title: string }> = [];
    const rawText = String(content || '')
      .replace(/\[\[wa_phone:[^\]]+\]\]\s*/g, '')
      .replace(/\[\[wa_jid:[^\]]+\]\]\s*/g, '')
      .replace(/\[\[document:([^|\]]+)\|([^\]]+)\]\]/g, (_all, id, title) => {
        documents.push({ id, title });
        return '';
      }).trim();
    return { text: this.renderWhatsAppLogText(rawText), documents };
  }

  private renderWhatsAppLogText(rawText: string): string {
    const raw = String(rawText || '').trim();
    const templateMatch = raw.match(/^\[Sablon:\s*([^\]]+)\]\s*([\s\S]*?)(?:\n\nHata:\s*([\s\S]+))?$/i);
    if (!templateMatch) return raw;

    const templateName = templateMatch[1].trim();
    const params = templateMatch[2]
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean);
    const error = templateMatch[3]?.trim();
    let text = '';

    if (templateName.toLocaleLowerCase('tr-TR') === 'evrak_iletisim' && params[0]) {
      text = `Merhaba ${params[0]}, d\u00f6nem evrak ve muhasebe i\u015flemlerinizle ilgili ileti\u015fim i\u00e7in size bu hattan ula\u015f\u0131yoruz. Uygun oldu\u011funuzda yan\u0131t verebilirsiniz.`;
    } else {
      text = `\u015eablon g\u00f6nderildi: ${templateName}`;
      if (params.length) text += `\n${params.join(' | ')}`;
    }

    if (error) text += `\n\nG\u00f6nderim hatas\u0131: ${error}`;
    return text;
  }
}
