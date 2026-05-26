import { Body, Controller, Get, Logger, Optional, Post, Query, Res } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MorenAiService } from '../moren-ai/moren-ai.service';
import { WhatsAppService } from './whatsapp.service';
import { AutomationEventBus } from '../automations/automation-event-bus.service';
import { StorageService } from '../storage/storage.service';
import { randomUUID } from 'crypto';
import { IntentClassifierService } from './intent-classifier.service';
import { WhatsAppBotContextService } from './bot-context.service';
import { WhatsAppBotPostFilterService } from './bot-post-filter.service';
import { WhatsAppRateLimiterService } from './rate-limiter.service';
import { BotEvalService } from './bot-eval.service';
import { QualityLogService } from './quality-log.service';

type IncomingWhatsAppMessage = {
  from: string;
  text: string;
  id?: string;
  phoneNumberId?: string;
  media?: {
    kind: string;
    id?: string;
    mimeType?: string;
    filename?: string;
    caption?: string;
  };
};

@Controller('whatsapp/webhook')
export class WhatsAppBotController {
  private readonly logger = new Logger(WhatsAppBotController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly morenAi: MorenAiService,
    private readonly whatsapp: WhatsAppService,
    private readonly intentClassifier: IntentClassifierService,
    private readonly botContext: WhatsAppBotContextService,
    private readonly postFilter: WhatsAppBotPostFilterService,
    private readonly rateLimiter: WhatsAppRateLimiterService,
    private readonly botEval: BotEvalService,
    private readonly qualityLog: QualityLogService,
    @Optional() private readonly eventBus?: AutomationEventBus,
    @Optional() private readonly storage?: StorageService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: any,
  ) {
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '';
    if (mode === 'subscribe' && expected && token === expected) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('forbidden');
  }

  @Post()
  async receive(@Body() body: any) {
    const messages = this.extractMessages(body);
    for (const msg of messages) {
      await this.handleMessage(msg).catch((e) => {
        this.logger.warn(`WhatsApp bot mesajı işlenemedi: ${e?.message || e}`);
      });
    }
    return { ok: true, count: messages.length };
  }

  private extractMessages(body: any): IncomingWhatsAppMessage[] {
    const out: IncomingWhatsAppMessage[] = [];
    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        const phoneNumberId = change?.value?.metadata?.phone_number_id;
        for (const m of change?.value?.messages || []) {
          const parsed = this.describeMetaMessage(m);
          if (m?.from && parsed.text) {
            out.push({ from: m.from, text: parsed.text, id: m.id, phoneNumberId, media: parsed.media });
          }
        }
      }
    }
    return out;
  }

  private describeMetaMessage(m: any): Pick<IncomingWhatsAppMessage, 'text' | 'media'> {
    const text = m?.text?.body || m?.button?.text || '';
    if (text) return { text };

    const mediaKeys = ['image', 'document', 'audio', 'video', 'sticker'] as const;
    for (const key of mediaKeys) {
      const media = m?.[key];
      if (!media) continue;
      const caption = String(media.caption || '').trim();
      const filename = String(media.filename || '').trim();
      const label =
        key === 'image' ? 'G\u00f6rsel' :
        key === 'document' ? 'Belge/PDF' :
        key === 'audio' ? 'Ses kayd\u0131' :
        key === 'video' ? 'Video' :
        'Sticker';
      const details = [filename, caption].filter(Boolean).join(' - ');
      return {
        text: details ? `[${label}] ${details}` : `[${label} mesaj\u0131]`,
        media: {
          kind: key,
          id: media.id,
          mimeType: media.mime_type,
          filename,
          caption,
        },
      };
    }

    if (m?.type) return { text: `[Desteklenmeyen WhatsApp mesaj\u0131: ${m.type}]` };
    return { text: '' };
  }

  private normalize(raw?: string | null): string {
    if (!raw) return '';
    let digits = String(raw).replace(/[^\d]/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) digits = '90' + digits.slice(1);
    if (digits.length === 10 && digits.startsWith('5')) digits = '90' + digits;
    return digits;
  }

  private withWhatsAppPhone(content: string, phone?: string | null): string {
    const normalized = this.normalize(phone);
    return normalized ? `[[wa_phone:${normalized}]]\n${content}` : content;
  }

  private buildOwnerNotification(input: {
    title: string;
    taxpayerName?: string;
    phone: string;
    text: string;
    unknown?: boolean;
    mediaKind?: string;
    filename?: string;
  }): string {
    const lines = [
      input.unknown ? 'Yeni WhatsApp mesaj\u0131 geldi (kay\u0131ts\u0131z numara).' : 'Yeni WhatsApp mesaj\u0131 geldi.',
      input.taxpayerName ? `M\u00fckellef: ${input.taxpayerName}` : null,
      `Telefon: ${this.formatPhone(input.phone)}`,
      input.mediaKind ? `Medya: ${input.mediaKind}${input.filename ? ` - ${input.filename}` : ''}` : null,
      `Mesaj: ${String(input.text || '(metin yok)').slice(0, 700)}`,
      input.unknown
        ? 'Aksiyon: Portal > Mesajlar ekran\u0131nda "M\u00fckellefe Ba\u011fla" ile kayda e\u015fle\u015ftirebilirsin.'
        : 'Durum: Portal > Mesajlar ekran\u0131na kaydedildi. Yan\u0131t\u0131 portaldan verirsen sadece bu numaraya gider.',
    ].filter(Boolean);
    return lines.join('\n');
  }

  private formatPhone(phone: string): string {
    const normalized = this.normalize(phone);
    if (normalized.startsWith('90') && normalized.length === 12) {
      return `+90 ${normalized.slice(2, 5)} ${normalized.slice(5, 8)} ${normalized.slice(8, 10)} ${normalized.slice(10)}`;
    }
    return phone;
  }

  private notificationBody(msg: IncomingWhatsAppMessage, action?: string): string {
    const body = this.mediaNotificationText(msg) || String(msg.text || '').trim() || '(mesaj metni yok)';
    return action ? `${body}\n${action}` : body;
  }

  private mediaNotificationText(msg: IncomingWhatsAppMessage): string | null {
    const media = msg.media;
    if (!media) return null;
    if (media.kind === 'image') return 'G\u00f6rsel g\u00f6nderdi';
    if (media.kind === 'audio') return 'Ses kayd\u0131 g\u00f6nderdi';
    if (media.kind === 'video') return 'Video g\u00f6nderdi';
    if (media.kind === 'sticker') return 'Sticker g\u00f6nderdi';
    if (media.kind === 'document') {
      const filename = String(media.filename || '').toLowerCase();
      const mime = String(media.mimeType || '').toLowerCase();
      return mime.includes('pdf') || filename.endsWith('.pdf') ? 'PDF g\u00f6nderdi' : 'Belge g\u00f6nderdi';
    }
    return 'Medya g\u00f6nderdi';
  }

  private async findTaxpayerByPhone(phone: string) {
    const normalized = this.normalize(phone);
    const taxpayers = await this.prisma.taxpayer.findMany({
      where: { isActive: true },
      select: {
        id: true,
        tenantId: true,
        companyName: true,
        firstName: true,
        lastName: true,
        type: true,
        taxNumber: true,
        phone: true,
        phones: true,
      },
      take: 1000,
    });
    return taxpayers.find((t: any) => {
      const phones = [t.phone, ...(Array.isArray(t.phones) ? t.phones : [])].filter(Boolean);
      return phones.some((p) => this.normalize(p) === normalized);
    }) || null;
  }

  private async findOwnerTenantByPhone(phone: string) {
    const normalized = this.normalize(phone);
    const ownerPhones = String(process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || '')
      .split(',')
      .map((p) => this.normalize(p))
      .filter(Boolean);

    if (ownerPhones.includes(normalized)) {
      const tenantSlug = process.env.MOREN_OWNER_TENANT_SLUG || process.env.DEFAULT_TENANT_SLUG || 'moren';
      const tenant = await this.prisma.tenant.findFirst({
        where: { slug: tenantSlug },
        select: { id: true, name: true, slug: true, phone: true },
      });
      if (tenant) return tenant;
    }

    const integrationRows = await (this.prisma as any).integrationConnection.findMany({
      where: { provider: 'WHATSAPP_META', isActive: true },
      select: { tenantId: true, config: true },
      take: 200,
    }).catch(() => []);
    const integrationMatch = integrationRows.find((row: any) => {
      const phones = String(row?.config?.ownerPhones || '')
        .split(',')
        .map((p) => this.normalize(p))
        .filter(Boolean);
      return phones.includes(normalized);
    });
    if (integrationMatch?.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: integrationMatch.tenantId },
        select: { id: true, name: true, slug: true, phone: true },
      });
      if (tenant) return tenant;
    }

    const tenants = await this.prisma.tenant.findMany({
      where: { phone: { not: null } },
      select: { id: true, name: true, slug: true, phone: true },
      take: 200,
    });
    return tenants.find((t) => this.normalize(t.phone) === normalized) || null;
  }

  private async findTenantForInbound(msg: IncomingWhatsAppMessage) {
    if (msg.phoneNumberId) {
      const rows = await (this.prisma as any).integrationConnection.findMany({
        where: { provider: 'WHATSAPP_META' },
        select: { tenantId: true, config: true },
        take: 200,
      }).catch(() => []);
      const match = rows.find((row: any) => String(row?.config?.phoneNumberId || '') === String(msg.phoneNumberId));
      if (match?.tenantId) {
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: match.tenantId },
          select: { id: true, name: true, slug: true, phone: true },
        });
        if (tenant) return tenant;
      }
    }

    const tenantSlug = process.env.MOREN_OWNER_TENANT_SLUG || process.env.DEFAULT_TENANT_SLUG || 'moren';
    return this.prisma.tenant.findFirst({
      where: { slug: tenantSlug },
      select: { id: true, name: true, slug: true, phone: true },
    });
  }

  private async ensureWhatsAppConversationContact(
    tenantId: string,
    phone: string,
    kind: 'owner' | 'unknown',
    displayName?: string,
  ) {
    const normalized = this.normalize(phone) || String(phone || '').replace(/[^\d]/g, '');
    const suffix = normalized || 'unknown';
    const taxNumber = kind === 'owner' ? `WHATSAPP-OWNER-${tenantId}` : `WHATSAPP-${suffix}`;
    const phoneWhere = normalized ? [{ phone: normalized }, { phones: { has: normalized } }] : [];

    const existing = await this.prisma.taxpayer.findFirst({
      where: {
        tenantId,
        OR: [{ taxNumber }, ...phoneWhere],
      },
      select: {
        id: true,
        tenantId: true,
        companyName: true,
        firstName: true,
        lastName: true,
        type: true,
        taxNumber: true,
        phone: true,
        phones: true,
      },
    });
    if (existing) {
      if (kind === 'owner' && existing.taxNumber !== taxNumber) {
        return this.prisma.taxpayer.update({
          where: { id: existing.id },
          data: {
            companyName: displayName || 'Ofis Sahibi WhatsApp',
            taxNumber,
            taxOffice: 'WHATSAPP',
            notes: 'Mesaj Merkezi icin ofis sahibi WhatsApp kaydina donusturuldu.',
            isActive: false,
          },
          select: {
            id: true,
            tenantId: true,
            companyName: true,
            firstName: true,
            lastName: true,
            type: true,
            taxNumber: true,
            phone: true,
            phones: true,
          },
        });
      }
      return existing;
    }

    const companyName =
      kind === 'owner'
        ? (displayName || 'Ofis Sahibi WhatsApp')
        : `Kayitsiz WhatsApp ${normalized || phone}`;

    return this.prisma.taxpayer.create({
      data: {
        tenantId,
        type: 'GERCEK_KISI',
        companyName,
        taxNumber,
        taxOffice: 'WHATSAPP',
        phone: normalized || phone,
        phones: normalized ? [normalized] : [],
        emails: [],
        notes: kind === 'owner'
          ? 'Mesaj Merkezi icin otomatik olusturulan ofis sahibi WhatsApp kaydi.'
          : 'Mesaj Merkezi icin otomatik olusturulan kayitsiz WhatsApp kisi kaydi.',
        isActive: false,
        whatsappEvrakTalep: false,
        whatsappEvrakGeldi: false,
      },
      select: {
        id: true,
        tenantId: true,
        companyName: true,
        firstName: true,
        lastName: true,
        type: true,
        taxNumber: true,
        phone: true,
        phones: true,
      },
    });
  }

  private displayName(t: any): string {
    return t?.companyName || `${t?.firstName || ''} ${t?.lastName || ''}`.trim() || 'Mukellef';
  }

  private async contentWithSavedMedia(
    tenantId: string,
    taxpayerId: string,
    msg: IncomingWhatsAppMessage,
  ): Promise<string> {
    if (!msg.media?.id || !this.storage) return msg.text;
    try {
      const downloaded = await this.whatsapp.downloadMedia(msg.media.id, tenantId);
      if (!downloaded?.buffer?.length) return `${msg.text}\n[Medya dosyasi indirilemedi]`;

      const filename = this.safeMediaFilename(msg.media.filename || `whatsapp-${msg.media.kind}.${this.extFromMime(downloaded.mimeType)}`);
      const s3Key = `${tenantId}/${taxpayerId}/whatsapp/${randomUUID()}-${filename}`;
      await this.storage.putBuffer(s3Key, downloaded.buffer, downloaded.mimeType, {
        source: 'whatsapp-meta',
        mediaId: msg.media.id,
      });

      const doc = await (this.prisma as any).document.create({
        data: {
          taxpayerId,
          title: filename,
          category: 'EVRAK',
          mimeType: downloaded.mimeType,
          sizeBytes: downloaded.sizeBytes,
          s3Key,
          notes: `WhatsApp ${msg.media.kind} mesajindan otomatik kaydedildi.`,
        },
        select: { id: true, title: true },
      });
      await (this.prisma as any).documentVersion.create({
        data: {
          documentId: doc.id,
          versionNo: 1,
          s3Key,
          sizeBytes: downloaded.sizeBytes,
          uploadedBy: 'whatsapp-webhook',
          notes: `WhatsApp mediaId=${msg.media.id}`,
        },
      });

      return `${msg.text}\n[[document:${doc.id}|${doc.title}]]`;
    } catch (err: any) {
      this.logger.warn(`WhatsApp medya kaydetme hatasi: ${err?.message || err}`);
      return `${msg.text}\n[Medya dosyasi kaydedilemedi]`;
    }
  }

  private safeMediaFilename(value: string): string {
    const cleaned = String(value || 'whatsapp-media.bin')
      .replace(/[^\w.\-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120);
    return cleaned || 'whatsapp-media.bin';
  }

  private extFromMime(mimeType: string): string {
    if (/pdf/i.test(mimeType)) return 'pdf';
    if (/png/i.test(mimeType)) return 'png';
    if (/jpe?g/i.test(mimeType)) return 'jpg';
    if (/webp/i.test(mimeType)) return 'webp';
    if (/mp4/i.test(mimeType)) return 'mp4';
    if (/mpeg|mp3/i.test(mimeType)) return 'mp3';
    if (/ogg|opus/i.test(mimeType)) return 'ogg';
    return 'bin';
  }

  private async handleMessage(msg: IncomingWhatsAppMessage) {
    const ownerTenant = await this.findOwnerTenantByPhone(msg.from);
    if (ownerTenant) {
      const ownerContact = await this.ensureWhatsAppConversationContact(
        ownerTenant.id,
        msg.from,
        'owner',
        `${ownerTenant.name || 'Ofis'} sahibi`,
      );
      const incomingContent = await this.contentWithSavedMedia(ownerTenant.id, ownerContact.id, msg);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: ownerContact.id,
          channel: 'WHATSAPP',
          subject: 'WhatsApp owner gelen mesaj',
          content: this.withWhatsAppPhone(incomingContent, msg.from),
          occurredAt: new Date(),
        },
      });

      const recentContext = await this.botContext.buildRecentWhatsAppContext(ownerContact.id);
      const prompt = [
        'Bu mesaj ofis sahibinden WhatsApp uzerinden geldi.',
        'Cevap kisa ve is odakli olsun. Portal verilerini kullan, gerekirse tool calistir.',
        'Kritik islemlerde komutu dogrudan calistirma; once onizleme ve ONAYLIYORUM iste.',
        'Agent yonlendirme gerekiyorsa hangi agent/action/payload olacagini net soyle.',
        recentContext,
        `Ofis sahibi mesaji: ${msg.text}`,
      ].join('\n');

      const answer = await this.morenAi.chat(ownerTenant.id, null, {
        message: prompt,
        voiceMode: true,
        toolMode: 'owner',
      });
      const reply = (answer.assistantMessage || '').slice(0, 1400);
      if (reply) {
        const sent = await this.whatsapp.sendMessage(msg.from, reply, ownerTenant.id);
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: ownerContact.id,
            channel: 'WHATSAPP',
            subject: sent ? 'WhatsApp owner bot cevabi' : 'WhatsApp owner bot cevabi (gonderilemedi - master switch veya hata)',
            content: this.withWhatsAppPhone(reply, msg.from),
            occurredAt: new Date(),
          },
        });
      }
      return;
    }

    const taxpayer: any = await this.findTaxpayerByPhone(msg.from);
    if (!taxpayer) {
      const tenant = await this.findTenantForInbound(msg);
      if (!tenant) {
        this.logger.warn(`WhatsApp bot: telefon eslesmedi ve tenant bulunamadi ${msg.from}`);
        return;
      }
      const contact = await this.ensureWhatsAppConversationContact(tenant.id, msg.from, 'unknown');
      const incomingContent = await this.contentWithSavedMedia(tenant.id, contact.id, msg);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: contact.id,
          channel: 'WHATSAPP',
          subject: 'WhatsApp gelen kayitsiz numara mesaji',
          content: this.withWhatsAppPhone(incomingContent, msg.from),
          occurredAt: new Date(),
        },
      });

      const automationActive = await this.whatsapp.isAutomationActive(tenant.id);
      const unknownActionText = `Portal > Mesajlar'dan m\u00fckellefe ba\u011flayabilirsin`;
      await this.prisma.notification.create({
        data: {
          tenantId: tenant.id,
          type: 'WHATSAPP',
          title: automationActive
            ? `\uD83D\uDCE9 Kay\u0131ts\u0131z numara: ${this.formatPhone(msg.from)}`
            : `\uD83D\uDD34 [PAS\u0130F] Kay\u0131ts\u0131z numara: ${this.formatPhone(msg.from)}`,
          body: this.notificationBody(msg, unknownActionText).slice(0, 500),
          metadata: {
            taxpayerId: contact.id,
            phone: msg.from,
            messageId: msg.id || null,
            unknownContact: true,
            actionText: unknownActionText,
            automationActive,
          },
        },
      }).catch(() => null);

      await this.sendOwnerNotification(
        tenant.id,
        this.buildOwnerNotification({
          title: 'Kayıtsız WhatsApp mesajı',
          taxpayerName: this.displayName(contact),
          phone: msg.from,
          text: msg.text,
          unknown: true,
          mediaKind: msg.media?.kind,
          filename: msg.media?.filename,
        }),
      );

      if (this.eventBus) {
        this.eventBus.emit('WhatsApp.MessageReceived', {
          tenantId: tenant.id,
          taxpayerId: contact.id,
          taxpayerUnvan: this.displayName(contact),
          taxpayerVkn: contact.taxNumber ?? '',
          from: msg.from,
          text: msg.text,
          messageId: msg.id,
          unknownContact: true,
          source: 'meta',
        });
      }

      if (!automationActive) {
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: contact.id,
            channel: 'WHATSAPP',
            subject: 'WhatsApp kayitsiz bot cevabi atlandi - master switch pasif',
            content: this.withWhatsAppPhone('Master switch pasif oldugu icin kayitsiz numaraya otomatik cevap gonderilmedi.', msg.from),
            occurredAt: new Date(),
          },
        });
        return;
      }

      const rate = this.rateLimiter.registerIncoming(tenant.id, contact.id);
      if (!rate.limited || rate.shouldNotify) {
        const recentUnknownReplies = await this.botContext.getRecentOutgoingReplies(contact.id).catch(() => []);
        const rawReply = 'Merhaba, Moren Mali Musavirlik hattina ulastiniz. Kaydinizi eslestirebilmemiz icin ad/unvan ve VKN/TCKN bilginizi paylasabilir misiniz?';
        const qualityReply = await this.qualityGateReply({
          tenantId: tenant.id,
          taxpayerId: contact.id,
          messageId: msg.id || null,
          intent: 'UNKNOWN_CONTACT',
          customerMessage: msg.text,
          reply: rawReply,
          recentReplies: recentUnknownReplies,
        });
        const reply = this.postFilter.filterTaxpayerReply(qualityReply, { recentReplies: recentUnknownReplies });
        const sent = await this.whatsapp.sendMessage(msg.from, reply, tenant.id);
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: contact.id,
            channel: 'WHATSAPP',
            subject: sent ? 'WhatsApp kayitsiz bot cevabi' : 'WhatsApp kayitsiz bot cevabi (gonderilemedi - master switch veya hata)',
            content: this.withWhatsAppPhone(reply, msg.from),
            occurredAt: new Date(),
          },
        });
      }
      return;
    }
    // Otomasyon event'i: müvekkelden WhatsApp mesajı geldi
    if (this.eventBus) {
      const unvan =
        taxpayer.type === 'TUZEL_KISI'
          ? taxpayer.companyName || ''
          : `${taxpayer.firstName ?? ''} ${taxpayer.lastName ?? ''}`.trim();
      this.eventBus.emit('WhatsApp.MessageReceived', {
        tenantId: taxpayer.tenantId,
        taxpayerId: taxpayer.id,
        taxpayerUnvan: unvan || '(isim yok)',
        taxpayerVkn: taxpayer.taxNumber ?? '',
        from: msg.from,
        text: msg.text,
        messageId: msg.id,
      });
    }

    await this.prisma.communicationLog.create({
      data: {
        taxpayerId: taxpayer.id,
        channel: 'WHATSAPP',
        subject: 'WhatsApp gelen mükellef sorusu',
        content: this.withWhatsAppPhone(await this.contentWithSavedMedia(taxpayer.tenantId, taxpayer.id, msg), msg.from),
        occurredAt: new Date(),
      },
    });

    const taxpayerName =
      taxpayer.companyName ||
      `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim() ||
      'Mukellef';
    const automationActive = await this.whatsapp.isAutomationActive(taxpayer.tenantId);
    const passiveActionText = 'Bot pasif modda, otomatik cevap at\u0131lmad\u0131. Manuel cevap i\u00e7in Mesajlar ekran\u0131na git.';
    await this.prisma.notification.create({
      data: {
        tenantId: taxpayer.tenantId,
        type: 'WHATSAPP',
        title: automationActive
          ? `\uD83D\uDCE9 ${taxpayerName} firmas\u0131ndan yeni mesaj`
          : `\uD83D\uDD34 [PAS\u0130F] Yeni mesaj: ${taxpayerName}`,
        body: this.notificationBody(
          msg,
          automationActive ? undefined : passiveActionText,
        ).slice(0, 500),
        metadata: {
          taxpayerId: taxpayer.id,
          phone: msg.from,
          messageId: msg.id || null,
          automationActive,
          actionText: automationActive
            ? undefined
            : passiveActionText,
        },
      },
    }).catch(() => null);

    await this.sendOwnerNotification(
      taxpayer.tenantId,
      this.buildOwnerNotification({
        title: 'WhatsApp mesajı',
        taxpayerName,
        phone: msg.from,
        text: msg.text,
        mediaKind: msg.media?.kind,
        filename: msg.media?.filename,
      }),
    );

    const classified = this.intentClassifier.classify(msg.text);
    await this.maybeCreateDocumentRequestTask(taxpayer, msg.text);
    const recentReplies = await this.botContext.getRecentOutgoingReplies(taxpayer.id);

    if (!automationActive) {
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: taxpayer.id,
          channel: 'WHATSAPP',
          subject: 'WhatsApp bot cevabi atlandi - master switch pasif',
          content: this.withWhatsAppPhone(`Intent: ${classified.intent}. Master switch pasif oldugu icin otomatik cevap gonderilmedi.`, msg.from),
          occurredAt: new Date(),
        },
      });
      return;
    }

    const rate = this.rateLimiter.registerIncoming(taxpayer.tenantId, taxpayer.id);
    if (rate.limited) {
      if (rate.shouldNotify) {
        const qualityReply = await this.qualityGateReply({
          tenantId: taxpayer.tenantId,
          taxpayerId: taxpayer.id,
          messageId: msg.id || null,
          intent: 'RATE_LIMIT',
          customerMessage: msg.text,
          reply: 'Mesajlariniz alindi; yogunluk nedeniyle konuyu siraya aldik.',
          recentReplies,
        });
        const limitedReply = this.postFilter.filterTaxpayerReply(qualityReply, { recentReplies });
        const sent = await this.whatsapp.sendMessage(msg.from, limitedReply, taxpayer.tenantId);
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: taxpayer.id,
            channel: 'WHATSAPP',
            subject: sent ? 'WhatsApp bot rate limit cevabi' : 'WhatsApp bot rate limit cevabi (gonderilemedi - master switch veya hata)',
            content: this.withWhatsAppPhone(limitedReply, msg.from),
            occurredAt: new Date(),
          },
        });
      }
      return;
    }

    const guardedReply = this.intentClassifier.cannedReply(classified.intent, recentReplies) || this.buildGuardedTaxpayerReply(msg.text);
    if (guardedReply) {
      const qualityReply = await this.qualityGateReply({
        tenantId: taxpayer.tenantId,
        taxpayerId: taxpayer.id,
        messageId: msg.id || null,
        intent: classified.intent,
        customerMessage: msg.text,
        reply: guardedReply,
        recentReplies,
      });
      const filteredReply = this.postFilter.filterTaxpayerReply(qualityReply, { recentReplies });
      const sent = await this.whatsapp.sendMessage(msg.from, filteredReply, taxpayer.tenantId);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: taxpayer.id,
          channel: 'WHATSAPP',
          subject: sent ? 'WhatsApp bot cevabi' : 'WhatsApp bot cevabi (gönderilemedi - master switch veya hata)',
          content: this.withWhatsAppPhone(filteredReply, msg.from),
          occurredAt: new Date(),
        },
      });
      return;
    }

    const taxpayerContext = await this.botContext.buildTaxpayerContextBlock(taxpayer.tenantId, taxpayer.id);
    const recentContext = await this.botContext.buildRecentWhatsAppContext(taxpayer.id);
    const prompt = [
      'Bu mesaj WhatsApp mukellef botundan geldi.',
      'KURAL USTUNLUGU: Bu WhatsApp mukellef cevabi kurallari genel Moren AI ton kurallarinin ustundedir.',
      'SADECE mukellefe gidecek nihai WhatsApp cevabini yaz.',
      'Baslik, markdown, madde isareti, emoji, ic not, ofis notu, neden bu cevap, test modu, arac/tool aciklamasi YAZMA.',
      'Kendine Moren AI deme; "ofisimiz" veya "Moren Mali Musavirlik" gibi konus.',
      'Cevap 1-2 kisa cumle olsun; mumkunse tek cumlede sicak, net, profesyonel ve taahhut vermeyen bir dil kullan.',
      'Onceki cevaplarinla ayni kaliplari tekrar etme. "ofise iletildi", "kontrol edilecek", "donus yapacak" ifadelerini art arda kullanma; sinonim ve dogal varyasyon sec.',
      'Sadece kendi kayitlariyla ilgili konus. Portal verisi yoksa rakam veya durum uydurma; kisa bir inceleme/bilgilendirme cumlesi kur.',
      'Tool/veri sonucu yoksa evrak listesi, KDV tutari, odeme tarihi, beyanname durumu, tahsilat ve cari bakiye konularinda kesin bilgi verme; kayitlarin incelenecegini kisa soyle.',
      'Evrak listesi, donem, tutar, mail gonderimi, isleme alma, eksik var/yok gibi bilgileri tool/veri sonucu olmadan ASLA uydurma.',
      'Beyanname gonderme, odeme taahhudu, hukuki/vergisel kesin karar gibi kritik konularda kesin taahhut verme; mali musavir kontrolu gerektigini kisa ve farkli cumleyle soyle.',
      'Dekont/evrak/belge bildirimi varsa alindigini soyle, kayda eklendigini belirt; tarih/saat taahhudu verme.',
      'Kendi kendine gun, tarih, saat, sure, "hemen", "bugun", "yarin", "haftaya kadar" gibi taahhut ekleme.',
      'Mukellef tarih onerirse kabul/ret verme; "Notunuzu aldik, ofis takvimine gore kontrol edecegiz." de.',
      `Intent: ${classified.intent}`,
      'Gerekirse sadece get_my_* read-only toollarini kullan. Tool inputuna taxpayerId yazma; backend aktif mukellefi kendisi baglar.',
      taxpayerContext,
      recentContext,
      `Mukellef mesaji: ${msg.text}`,
    ].join('\n');

    const answer = await this.morenAi.chat(taxpayer.tenantId, null, {
      taxpayerId: taxpayer.id,
      message: prompt,
      voiceMode: true,
      toolMode: 'taxpayer-readonly',
    });

    const rawAiReply = answer.assistantMessage || '';
    const contextBlock = [taxpayerContext, recentContext].filter(Boolean).join('\n\n');
    const qualityReply = await this.qualityGateReply({
      tenantId: taxpayer.tenantId,
      taxpayerId: taxpayer.id,
      messageId: msg.id || null,
      intent: classified.intent,
      customerMessage: msg.text,
      reply: rawAiReply,
      contextBlock,
      recentReplies,
      retry: async (reasons) => {
        const retryPrompt = this.botEval.buildRetryPrompt(
          rawAiReply,
          reasons,
          {
            tenantId: taxpayer.tenantId,
            taxpayerId: taxpayer.id,
            intent: classified.intent,
            message: msg.text,
            contextBlock,
          },
          recentReplies,
        );
        const retryAnswer = await this.morenAi.chat(taxpayer.tenantId, null, {
          taxpayerId: taxpayer.id,
          message: retryPrompt,
          voiceMode: true,
          toolMode: 'taxpayer-readonly',
        });
        return retryAnswer.assistantMessage || '';
      },
    });
    const reply = this.postFilter.filterTaxpayerReply(qualityReply, { recentReplies });
    if (reply) {
      const sent = await this.whatsapp.sendMessage(msg.from, reply, taxpayer.tenantId);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: taxpayer.id,
          channel: 'WHATSAPP',
          subject: sent ? 'WhatsApp bot cevabı (MOREN AI)' : 'WhatsApp bot cevabı (gönderilemedi - master switch veya hata)',
          content: this.withWhatsAppPhone(reply, msg.from),
          occurredAt: new Date(),
        },
      });
    }
  }

  private async qualityGateReply(input: {
    tenantId: string;
    taxpayerId?: string | null;
    conversationId?: string | null;
    messageId?: string | null;
    intent?: string | null;
    customerMessage?: string | null;
    reply: string;
    contextBlock?: string | null;
    recentReplies?: string[];
    retry?: (reasons: string[]) => Promise<string>;
  }): Promise<string> {
    const recentReplies = input.recentReplies || [];
    const firstEval = await this.botEval.evaluateReply(
      input.reply,
      {
        tenantId: input.tenantId,
        taxpayerId: input.taxpayerId || null,
        intent: input.intent || null,
        message: input.customerMessage || null,
        contextBlock: input.contextBlock || null,
        source: 'online',
      },
      recentReplies,
    );

    let finalReply = input.reply;
    let finalEval = firstEval;
    let retryCount = 0;
    let fallbackUsed = false;
    let reasons = [...firstEval.reasons];

    if (firstEval.shouldRetry && input.retry) {
      const retryReply = await input.retry(firstEval.reasons).catch((err) => {
        this.logger.warn(`Bot QA retry uretilemedi: ${err?.message || err}`);
        return '';
      });
      if (retryReply) {
        retryCount = 1;
        finalReply = retryReply;
        finalEval = await this.botEval.evaluateReply(
          retryReply,
          {
            tenantId: input.tenantId,
            taxpayerId: input.taxpayerId || null,
            intent: input.intent || null,
            message: input.customerMessage || null,
            contextBlock: input.contextBlock || null,
            source: 'online-retry',
          },
          recentReplies,
        );
        reasons = Array.from(new Set([...reasons, ...finalEval.reasons]));
      }
    }

    if (finalEval.score < 6) {
      finalReply = this.botEval.safeFallback();
      fallbackUsed = true;
    }

    const status = fallbackUsed
      ? 'FALLBACK_USED'
      : retryCount > 0
        ? 'RETRY_USED'
        : firstEval.warning
          ? 'EVAL_WARN'
          : finalEval.score < 6
            ? 'LOW_SCORE'
            : 'PASSED';

    await this.qualityLog.createLog({
      tenantId: input.tenantId,
      taxpayerId: input.taxpayerId || null,
      conversationId: input.conversationId || input.taxpayerId || null,
      messageId: input.messageId || null,
      source: 'ONLINE_EVAL',
      status,
      score: finalEval.score,
      intent: input.intent || null,
      reasons,
      originalReply: input.reply,
      finalReply,
      retryCount,
      fallbackUsed,
      evalModel: finalEval.model,
      inputTokens: firstEval.inputTokens + (retryCount ? finalEval.inputTokens : 0),
      outputTokens: firstEval.outputTokens + (retryCount ? finalEval.outputTokens : 0),
      costUsd: firstEval.costUsd + (retryCount ? finalEval.costUsd : 0),
      metadata: {
        firstScore: firstEval.score,
        finalScore: finalEval.score,
        evalWarning: firstEval.warning || finalEval.warning || null,
      },
    }).catch((err) => {
      this.logger.warn(`BotQualityLog yazilamadi: ${err?.message || err}`);
    });

    return finalReply;
  }

  private buildGuardedTaxpayerReply(text: string): string | null {
    const t = this.normalizeText(text);

    if (/(beyanname|beyan|tahakkuk)/i.test(t) && /(ver|gonder|gonderin|onay|imza|imzala)/i.test(t)) {
      return 'Beyanname islemi mali musavir kontrolunden gecmeden yapilmaz. Kontrol sonrasi size net bilgi verilecek.';
    }

    if (/(kdv|borc|borcu|odeme|tutar|ne kadar)/i.test(t)) {
      return 'KDV tutari ve odeme tarihi kayitlar uzerinden incelenecek; netlesince size bilgi verilecek.';
    }

    if (/(dekont|makbuz)/i.test(t)) {
      return 'Dekont bilginiz alindi; kayitlarla eslestirme yapilacak.';
    }

    if (/(bugun|yarin|gelemeyecegim|gelemem|getirsem|ugrasam|biraksam)/i.test(t)) {
      return 'Takvim notunuz alindi; uygunluk durumuna gore size bilgi verilecek.';
    }

    if (/(evrak|belge|fis|fatura)/i.test(t) && /(hangi|ne|gerek|eksik|getir|gonder|ilettim|gonderdim)/i.test(t)) {
      return 'Evrak durumunuz ve donem takviminiz incelenecek; gerekiyorsa belge listesi paylasilacak.';
    }

    return null;
  }

  private normalizeText(raw: string): string {
    return String(raw || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c');
  }

  private async maybeCreateDocumentRequestTask(taxpayer: any, text: string) {
    if (!/(evrak|belge|beyanname|tahakkuk|fis|fiş|dekont|makbuz|rapor)/i.test(text)) return;
    const user = await this.prisma.user.findFirst({
      where: { tenantId: taxpayer.tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!user) return;
    const ad = taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim() || 'Mukellef';
    await (this.prisma as any).task.create({
      data: {
        tenantId: taxpayer.tenantId,
        taxpayerId: taxpayer.id,
        createdById: user.id,
        title: `WhatsApp evrak talebi: ${ad}`,
        description: text,
        category: 'MUKELLEF',
        priority: 'HIGH',
        tags: ['whatsapp', 'evrak-talebi'],
        notifyInApp: true,
        notifyBrowser: true,
      },
    }).catch(() => null);
  }

  private async sendOwnerNotification(tenantId: string, message: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, phone: true },
    }).catch(() => null);

    const status: any = await this.whatsapp.getStatus(tenantId).catch(() => ({}));
    const rawPhones = [
      status?.ownerPhones,
      process.env.MOREN_OWNER_WHATSAPP_PHONES,
      process.env.MOREN_OWNER_WHATSAPP_PHONE,
      tenant?.phone,
    ]
      .filter(Boolean)
      .join(',')
      .split(',')
      .map((p) => this.normalize(p))
      .filter(Boolean);
    const phones = Array.from(new Set(rawPhones));
    if (!phones.length) return;

    const templateName = String(status?.ownerAlertTemplateName || process.env.WHATSAPP_OWNER_ALERT_TEMPLATE_NAME || '').trim();
    const body = message.slice(0, 900);
    for (const phone of phones) {
      const result = templateName
        ? await this.whatsapp.sendTemplateDetailed(phone, [tenant?.name || 'Moren', body], templateName, tenantId)
        : await this.whatsapp.sendMessageDetailed(phone, body, tenantId);
      if (!result.ok) {
        this.logger.warn(`Owner WhatsApp bildirimi gonderilemedi ${phone}: ${result.error || 'bilinmeyen hata'}`);
      }
    }
  }

  private async buildRecentWhatsAppContext(taxpayerId: string): Promise<string> {
    const logs = await this.prisma.communicationLog.findMany({
      where: { taxpayerId, channel: 'WHATSAPP' },
      orderBy: { occurredAt: 'desc' },
      take: 12,
      select: { subject: true, content: true, occurredAt: true },
    }).catch(() => []);
    if (!logs.length) return '';

    const rows = logs.reverse().map((log) => {
      const subject = String(log.subject || '');
      const speaker = /gelen/i.test(subject)
        ? 'Mukellef'
        : (/bot|cevab|portal|sablon|medya/i.test(subject) ? 'Ofis' : 'Sistem');
      const content = String(log.content || '')
        .replace(/\[\[wa_phone:[^\]]+\]\]/g, '')
        .replace(/\[\[document:([^|\]]+)\|([^\]]+)\]\]/g, '[dosya: $2]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
      const at = log.occurredAt.toISOString().slice(0, 16).replace('T', ' ');
      return `- ${at} ${speaker}: ${content || '(bos)'}`;
    });

    return [
      '## Bu kisiyle son WhatsApp konusmalari',
      'Cevabi bu gecmise gore baglamli ver; ayni bilgiyi gereksiz tekrar etme. Gecmisteki belirsiz bilgileri kesin bilgi gibi sunma.',
      rows.join('\n'),
    ].join('\n');
  }
}
