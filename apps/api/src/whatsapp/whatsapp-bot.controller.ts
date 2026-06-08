import { Body, Controller, Get, Logger, Optional, OnModuleInit, Post, Query, Res } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MorenAiService } from '../moren-ai/moren-ai.service';
import { WhatsAppService } from './whatsapp.service';
import { BaileysService } from './baileys.service';
import { BAILEYS_PROVIDER } from './baileys-auth-store';
import { AutomationEventBus } from '../automations/automation-event-bus.service';
import { StorageService } from '../storage/storage.service';
import { randomUUID } from 'crypto';
import { IntentClassifierService } from './intent-classifier.service';
import { WhatsAppBotContextService } from './bot-context.service';
import { WhatsAppBotPostFilterService } from './bot-post-filter.service';
import { WhatsAppRateLimiterService } from './rate-limiter.service';
import { WhatsAppBotCacheService } from './bot-cache.service';
import { BotEvalService } from './bot-eval.service';
import { QualityLogService } from './quality-log.service';
import { BuseGunaydinCron } from '../schedule/buse-gunaydin.cron';
import { CalisanService } from '../calisan/calisan.service';
import { claudeTextViaMax, MAX_MODEL_CHEAP } from '../common/max-inference';

type IncomingWhatsAppMessage = {
  from: string;
  text: string;
  id?: string;
  replyTo?: string;
  phoneNumberId?: string;
  media?: {
    kind: string;
    id?: string;
    mimeType?: string;
    filename?: string;
    caption?: string;
  };
};

// Asistanın müşteriye görünen insan ismi. Değiştirmek için MOREN_BOT_NAME env'i.
const BOT_NAME = process.env.MOREN_BOT_NAME || 'Elif';
const OFFICE_NAME = process.env.MOREN_OFFICE_NAME || 'Moren Mali Müşavirlik';

@Controller('whatsapp/webhook')
export class WhatsAppBotController implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppBotController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly morenAi: MorenAiService,
    private readonly whatsapp: WhatsAppService,
    private readonly intentClassifier: IntentClassifierService,
    private readonly botContext: WhatsAppBotContextService,
    private readonly postFilter: WhatsAppBotPostFilterService,
    private readonly rateLimiter: WhatsAppRateLimiterService,
    private readonly botCache: WhatsAppBotCacheService,
    private readonly botEval: BotEvalService,
    private readonly qualityLog: QualityLogService,
    private readonly buseGunaydin: BuseGunaydinCron,
    private readonly baileys: BaileysService,
    private readonly calisan: CalisanService,
    @Optional() private readonly eventBus?: AutomationEventBus,
    @Optional() private readonly storage?: StorageService,
  ) {}

  /**
   * Baileys (QR) gelen mesajlarını webhook ile BİREBİR aynı bot hattına bağlar
   * ve sunucu açılışında kayıtlı QR oturumlarını otomatik yeniden bağlar
   * (deploy sonrası QR tekrar okutmaya gerek kalmaz).
   */
  async onModuleInit() {
    this.baileys.setInboundHandler((msg) => this.handleMessage(msg as IncomingWhatsAppMessage));
    this.baileys.setLidMappingHandler((tenantId, lid, phone) => this.handleLidPhoneMapping(tenantId, lid, phone));
    try {
      const rows = await (this.prisma as any).integrationConnection.findMany({
        where: { provider: BAILEYS_PROVIDER },
        select: { tenantId: true, config: true },
      });
      for (const r of rows || []) {
        if ((r?.config as any)?.credsJson) {
          this.logger.log(`[Baileys] tenant=${r.tenantId} kayıtlı oturum bulundu, yeniden bağlanılıyor`);
          this.baileys.connect(r.tenantId).catch((e: any) =>
            this.logger.warn(`[Baileys] otomatik bağlanma hatası tenant=${r.tenantId}: ${e?.message || e}`));
        }
      }
    } catch (e: any) {
      this.logger.warn(`[Baileys] başlangıç oturum taraması hatası: ${e?.message || e}`);
    }
  }

  /** Manuel günaydın testi: POST /whatsapp/webhook/test-buse-gunaydin */
  @Post('test-buse-gunaydin')
  async testBuseGunaydin() {
    return this.buseGunaydin.send('manual');
  }

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

  private replyTarget(msg: IncomingWhatsAppMessage): string {
    return String(msg.replyTo || msg.from || '').trim();
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
    // Sade format: 2-3 sat\u0131r, h\u0131zl\u0131 okunur
    // Kay\u0131tl\u0131:  "\ud83d\udce9 MAL\u0130 M\u00dc\u015eAV\u0130RL\u0130K firmas\u0131ndan yeni mesaj
    //            "Merhaba, evrak g\u00f6nderece\u011fim""
    // Kay\u0131ts\u0131z: "\ud83d\udce9 Kay\u0131ts\u0131z numaradan mesaj \u2014 +90 535 058 74 75
    //            "te\u015fekk\u00fcr ederim, iyiyim siz nas\u0131ls\u0131n\u0131z"
    //            \u2192 Portal > Mesajlar'dan m\u00fckellefe ba\u011flayabilirsin"

    const phoneFormatted = this.formatPhone(input.phone);
    const mediaLabel = input.mediaKind
      ? `\ud83d\udcce ${this.mediaKindLabel(input.mediaKind)}${input.filename ? ` (${input.filename})` : ''}`
      : null;

    let body: string;
    if (input.mediaKind && !input.text) {
      body = mediaLabel || '(medya mesaj\u0131)';
    } else {
      const msgText = String(input.text || '').slice(0, 400).trim();
      body = msgText ? `"${msgText}"` : '(metin yok)';
      if (mediaLabel) body = `${body}\n${mediaLabel}`;
    }

    if (input.unknown) {
      return [
        `\ud83d\udce9 Kay\u0131ts\u0131z numaradan mesaj \u2014 ${phoneFormatted}`,
        '',
        body,
        '',
        `\u2192 Portal > Mesajlar'dan m\u00fckellefe ba\u011flayabilirsin`,
      ].join('\n');
    }

    const name = input.taxpayerName || 'M\u00fckellef';
    return [
      `\ud83d\udce9 ${name} \u2014 yeni WhatsApp mesaj\u0131`,
      '',
      body,
    ].join('\n');
  }

  private mediaKindLabel(kind: string): string {
    switch (kind) {
      case 'image': return 'G\u00f6rsel';
      case 'audio': return 'Ses kayd\u0131';
      case 'video': return 'Video';
      case 'sticker': return 'Sticker';
      case 'document': return 'Belge/PDF';
      default: return 'Medya';
    }
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

    this.logger.log(`[OwnerCheck] incoming=${normalized} envPhones=${ownerPhones.join('|')} match=${ownerPhones.includes(normalized)}`);

    if (ownerPhones.includes(normalized)) {
      // 1) Önce env'de TENANT_ID varsa direkt onu kullan (en sağlam yol)
      const tenantId = process.env.MOREN_OWNER_TENANT_ID;
      if (tenantId) {
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, name: true, slug: true, phone: true },
        }).catch(() => null);
        if (tenant) {
          this.logger.log(`[OwnerCheck] tenant matched via env TENANT_ID: ${tenant.id} (${tenant.slug})`);
          return tenant;
        }
        this.logger.warn(`[OwnerCheck] env TENANT_ID=${tenantId} bulunamadi, slug fallback denenecek`);
      }

      // 2) Slug ile dene (default "moren")
      const tenantSlug = process.env.MOREN_OWNER_TENANT_SLUG || process.env.DEFAULT_TENANT_SLUG || 'moren';
      const tenant = await this.prisma.tenant.findFirst({
        where: { slug: tenantSlug },
        select: { id: true, name: true, slug: true, phone: true },
      });
      if (tenant) {
        this.logger.log(`[OwnerCheck] tenant matched via env slug: ${tenant.id} (${tenant.slug})`);
        return tenant;
      }
      this.logger.warn(`[OwnerCheck] env phone matched but tenant slug=${tenantSlug} not found`);

      // 3) Son fallback: tek tenant varsa direkt onu kullan (single-tenant kurulum)
      const allTenants = await this.prisma.tenant.findMany({
        select: { id: true, name: true, slug: true, phone: true },
        take: 2,
      });
      if (allTenants.length === 1) {
        this.logger.log(`[OwnerCheck] tek tenant tespit edildi, owner kabul edildi: ${allTenants[0].id} (${allTenants[0].slug})`);
        return allTenants[0];
      }
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

    const tenantId = process.env.MOREN_OWNER_TENANT_ID;
    if (tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true, phone: true },
      }).catch(() => null);
      if (tenant) return tenant;
    }

    const tenantSlug = process.env.MOREN_OWNER_TENANT_SLUG || process.env.DEFAULT_TENANT_SLUG || 'moren';
    const tenantBySlug = await this.prisma.tenant.findFirst({
      where: { slug: tenantSlug },
      select: { id: true, name: true, slug: true, phone: true },
    });
    if (tenantBySlug) return tenantBySlug;

    const tenants = await this.prisma.tenant.findMany({
      select: { id: true, name: true, slug: true, phone: true },
      take: 2,
    });
    return tenants.length === 1 ? tenants[0] : null;
  }

  private async handleLidPhoneMapping(tenantId: string, lidRaw: string, phoneRaw: string) {
    const lid = this.normalize(lidRaw);
    const phone = this.normalize(phoneRaw);
    if (!lid || !phone || lid === phone) return;

    const source = await this.prisma.taxpayer.findFirst({
      where: {
        tenantId,
        OR: [
          { taxNumber: `WHATSAPP-${lid}` },
          { phone: lid },
          { phones: { has: lid } },
        ],
      },
      select: {
        id: true,
        tenantId: true,
        companyName: true,
        taxNumber: true,
        phone: true,
        phones: true,
      },
    });
    if (!source) return;
    if (!this.isWhatsAppVirtualTaxNumber(source.taxNumber)) return;

    const candidates = await this.prisma.taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        companyName: true,
        firstName: true,
        lastName: true,
        taxNumber: true,
        phone: true,
        phones: true,
      },
      take: 1000,
    });
    const target = candidates.find((t: any) => {
      if (t.id === source.id || this.isWhatsAppVirtualTaxNumber(t.taxNumber)) return false;
      const phones = [t.phone, ...(Array.isArray(t.phones) ? t.phones : [])].filter(Boolean);
      return phones.some((p) => this.normalize(p) === phone);
    });

    const logs = await this.prisma.communicationLog.findMany({
      where: { taxpayerId: source.id, channel: 'WHATSAPP' },
      select: { id: true, content: true },
    });
    const replaceLidMarker = (content?: string | null) =>
      String(content || '').replace(new RegExp(`\\[\\[wa_phone:${lid}\\]\\]`, 'g'), `[[wa_phone:${phone}]]`);

    const ownerTenant = await this.findOwnerTenantByPhone(phone);
    if (ownerTenant?.id === tenantId) {
      const ownerContact = await this.ensureWhatsAppConversationContact(
        tenantId,
        phone,
        'owner',
        `${ownerTenant.name || 'Ofis'} sahibi`,
      );
      const ownerPhones = Array.from(new Set([
        phone,
        lid,
        ownerContact.phone || '',
        ...(Array.isArray(ownerContact.phones) ? ownerContact.phones : []),
      ].filter(Boolean)));

      const updates = [
        ...logs.map((log) => this.prisma.communicationLog.update({
          where: { id: log.id },
          data: { taxpayerId: ownerContact.id, content: replaceLidMarker(log.content) },
        })),
        this.prisma.taxpayer.update({
          where: { id: ownerContact.id },
          data: { phone, phones: ownerPhones, isActive: true },
        }),
      ];

      if (source.id !== ownerContact.id) {
        updates.push(this.prisma.taxpayer.update({
          where: { id: source.id },
          data: {
            notes: `Bu LID/kayitsiz WhatsApp konusmasi owner sohbetine tasindi: ${ownerContact.id} (${phone})`,
            isActive: false,
          },
        }));
      }

      await this.prisma.$transaction(updates);
      this.logger.log(`[WhatsApp] LID konusmasi owner sohbetine tasindi: tenant=${tenantId} lid=${lid} phone=${phone} owner=${ownerContact.id}`);
      return;
    }

    if (target) {
      await this.prisma.$transaction([
        ...logs.map((log) => this.prisma.communicationLog.update({
          where: { id: log.id },
          data: { taxpayerId: target.id, content: replaceLidMarker(log.content) },
        })),
        this.prisma.taxpayer.update({
          where: { id: source.id },
          data: {
            notes: `Bu LID WhatsApp konusmasi telefon eslesmesiyle mukellefe tasindi: ${target.id} (${phone})`,
            isActive: false,
          },
        }),
      ]);
      this.logger.log(`[WhatsApp] LID konusmasi mukellefe tasindi: tenant=${tenantId} lid=${lid} phone=${phone} target=${target.id}`);
      return;
    }

    const mergedPhones = Array.from(new Set([phone, lid, ...(Array.isArray(source.phones) ? source.phones : [])].filter(Boolean)));
    await this.prisma.$transaction([
      ...logs.map((log) => this.prisma.communicationLog.update({
        where: { id: log.id },
        data: { content: replaceLidMarker(log.content) },
      })),
      this.prisma.taxpayer.update({
        where: { id: source.id },
        data: {
          companyName: `Kayitsiz WhatsApp ${phone}`,
          taxNumber: `WHATSAPP-${phone}`,
          phone,
          phones: mergedPhones,
          notes: `WhatsApp LID eslesmesi alindi. LID: ${lid}`,
        },
      }),
    ]);
    this.logger.log(`[WhatsApp] LID konusmasi gercek telefonla guncellendi: tenant=${tenantId} lid=${lid} phone=${phone}`);
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
    const select = {
      id: true,
      tenantId: true,
      companyName: true,
      firstName: true,
      lastName: true,
      type: true,
      taxNumber: true,
      phone: true,
      phones: true,
    };

    if (kind === 'owner') {
      const owner = await this.prisma.taxpayer.findFirst({
        where: { tenantId, taxNumber },
        select,
      });
      if (owner) {
        const mergedPhones = Array.from(new Set([
          normalized || owner.phone || '',
          owner.phone || '',
          ...(Array.isArray(owner.phones) ? owner.phones : []),
        ].filter(Boolean)));
        return this.prisma.taxpayer.update({
          where: { id: owner.id },
          data: {
            companyName: displayName || owner.companyName || 'OFIS SAHIBI',
            taxOffice: 'WHATSAPP',
            phone: normalized || owner.phone,
            phones: mergedPhones,
            notes: 'Mesaj Merkezi icin ofis sahibi WhatsApp kaydi.',
            isActive: true,
          },
          select,
        });
      }
    }

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
      // Owner: eski "Kayıtsız" kaydı bulunduysa veya isim hâlâ "Kayitsiz" prefix'iyle başlıyorsa
      // tam olarak owner'a dönüştür (companyName + taxNumber + notes hepsi güncellensin)
      const isStaleUnknown =
        kind === 'owner' &&
        (
          existing.taxNumber !== taxNumber ||
          /^(Kayitsiz|Kayıtsız)\s+WhatsApp/i.test(String(existing.companyName || ''))
        );

      if (isStaleUnknown) {
        return this.prisma.taxpayer.update({
          where: { id: existing.id },
          data: {
            companyName: displayName || 'OFİS SAHİBİ',
            taxNumber,
            taxOffice: 'WHATSAPP',
            phone: normalized || existing.phone,
            phones: Array.from(new Set([
              normalized || existing.phone || '',
              existing.phone || '',
              ...(Array.isArray(existing.phones) ? existing.phones : []),
            ].filter(Boolean))),
            notes: 'Mesaj Merkezi icin ofis sahibi WhatsApp kaydina donusturuldu.',
            isActive: true,  // ✅ Owner aktif olmalı (mesaj merkezinde görünmesi için)
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
        ? (displayName || 'OFİS SAHİBİ')
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
        // ✅ Owner aktif olmalı (mesaj merkezi üst sıra). Unknown pasif kalır.
        isActive: kind === 'owner',
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

  private isWhatsAppVirtualTaxNumber(taxNumber?: string | null): boolean {
    const value = String(taxNumber || '');
    return value.startsWith('WHATSAPP-') && !value.startsWith('WHATSAPP-OWNER-');
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

  private refreshTaxpayerMemory(tenantId: string, taxpayerId: string): void {
    void this.botContext.refreshConversationMemory(tenantId, taxpayerId).catch((err: any) => {
      this.logger.warn(`WhatsApp hafiza guncellenemedi ${taxpayerId}: ${err?.message || err}`);
    });
  }

  /**
   * Buse / kişisel kişiler için özel branch: ofis tonunda DEĞİL, Moren'in sıcak/sevecen
   * asistanı tonunda yazar. Moren'in karşıdaki kişiye olan sevgisini doğal yerlerde
   * ifade eder. AI çağrısı tool'suz, biraz yüksek temperature ile çeşitlilik sağlar.
   */
  private async handlePersonalContactMessage(
    tenant: { id: string; name?: string | null },
    contact: { phone: string; name: string },
    msg: IncomingWhatsAppMessage,
  ): Promise<void> {
    const personalRecord = await this.ensureWhatsAppPersonalContact(tenant.id, contact);
    const incomingContent = await this.contentWithSavedMedia(tenant.id, personalRecord.id, msg);
    await this.prisma.communicationLog.create({
      data: {
        taxpayerId: personalRecord.id,
        channel: 'WHATSAPP',
        subject: `WhatsApp ${contact.name} (kisisel) gelen mesaj`,
        content: this.withWhatsAppPhone(incomingContent, msg.from),
        occurredAt: new Date(),
      },
    });
    this.refreshTaxpayerMemory(tenant.id, personalRecord.id);

    const recentContext = await this.botContext.buildRecentWhatsAppContext(personalRecord.id);
    const ownerName = String(process.env.MOREN_OWNER_DISPLAY_NAME || 'Muzaffer').trim() || 'Muzaffer';
    const her = contact.name;

    const prompt = [
      `Sen ${ownerName}'in (mali müşavir) yapay zeka asistanısın. Karşındaki kişi ${ownerName}'in SEVGİLİSİ ${her}.`,
      `${her} senin asistan olduğunu biliyor — ${ownerName} değilsin. Ama mesafeli bir bot da değilsin: ${ownerName}'in ${her}'ye olan sevgisini, hayranlığını, gururunu bilen ve onun adına ${her}'ye sıcak duygular ileten yakın bir asistansın.`,
      '',
      '═══ TEK GÖREVİN ═══',
      `${her} ile SEVGİLİ tonunda samimi sohbet etmek. ASIL ODAK ${her} — onun günü, hisleri, yaptıkları, hayalleri. Sen onun yanında ol, dinle, eğlendir, gerektiğinde teselli et.`,
      '',
      `★ KRİTİK: ${ownerName} senin "müşterin" değil, "promote edeceğin biri" DEĞİL. Bot, ${her}'ye sürekli "${ownerName} seni şöyle düşünüyor, böyle özlüyor" gibi reklam yapmaz. Bu yapmacık ve rahatsız edici.`,
      '',
      'NE KONUŞURSUN (öncelik sırasıyla):',
      `1) ${her}'nin günü, ruh hali, hisleri, yaptıkları, planları, hayalleri — ASIL KONU BU.`,
      `2) ${her}'ye doğal iltifat: somut, kısa, günlük dilde ("saçın güzel görünüyordu", "kahkahan bulaşıcı").`,
      `3) ${ownerName}'den BAHSETMEK görev DEĞİL — sadece ${her} kendisi sorarsa veya konu organik açıldıysa kısa değin.`,
      '',
      `═══ ${ownerName}'DEN BAHSETME KURALI ═══`,
      `- ${her} ${ownerName}'i sormuşsa, ondan şikayet etmişse, ya da konu organik açılmışsa: kısa ve doğal değin. "Bugün çok yoğundu", "müsait olunca yazar" tarzı.`,
      `- ${her} kendi gününden, kendi hislerinden bahsediyorsa: ${ownerName}'i KARIŞTIRMA. O an sadece ${her}'yi dinle, onun konusunda kal.`,
      `- ${her} eğleniyor/şakalaşıyorsa: "ama unutma ${ownerName} ..." gibi DERS VERME, ortamı bozma.`,
      `- ${ownerName} adına savunma/açıklama yapma. ${her} sitemi varsa Dertleşme moduna geç.`,
      `- HER MESAJDA ${ownerName} ismini sokuşturma. Çoğu mesajda hiç geçmemeli.`,
      '',
      '═══ KESİNLİKLE KONUŞMAZSIN ═══',
      '- İŞ, EVRAK, FATURA, BEYANNAME, KDV, MÜKELLEF, OFİS işleri — TEK KELİME YOK.',
      `- ${her} işle ilgili bir şey sorarsa BİLE konuyu tatlıca değiştir: "Bu işleri konuşmayalım canım, sen daha güzel şeylere değersin ❤️" gibi.`,
      '- "İletildi", "kontrol edilecek", "ofise iletildi", "size dönüş yapılacak" gibi mali müşavirlik kalıbı YASAK.',
      '- "Mali müşavirimiz", "ekibimiz" gibi kurumsal hiçbir lafa girme — burası senin için bir iş yeri değil, sevdiği insanın yakını olarak konuş.',
      '',
      `═══ DERTLEŞME MODU — ${her} dert/sitem/üzüntü paylaşırsa ═══`,
      `${her} ${ownerName}'le ilgili sitem ediyorsa ("ilgilenmiyor", "yokum gibi davranıyor", "üzdü beni" gibi) veya kendi içsel derdini paylaşıyorsa (yorgun, mutsuz, kaygılı, kendine güveni kırık):`,
      '',
      `1) ÖNCE HİSSİNİ KARŞILA. ${ownerName}'i hemen savunmaya GEÇME, çözüm/tavsiye VERME. Sadece duyduğunu, anladığını göster.`,
      `   Örnek: "Anlıyorum seni canım, bunu hissetmek zor 🥹"`,
      `   Örnek: "Hakkın var böyle hissetmeye, bastırma bunu 🌷"`,
      `   Örnek: "Bunu paylaşman benim için kıymetli, dinliyorum seni 💕"`,
      '',
      `2) SAVUNMACI OLMA. ${ownerName}'i körü körüne kollama — ${her} haklı olabilir, onu da kabul et.`,
      `   Yanlış: "Ama o seni çok seviyor, yanılıyorsun" (savunma)`,
      `   Doğru: "Hissettiğin şey gerçek, görmezden gelinmemeli — bunu ona söylemen önemli"`,
      '',
      '3) TAVSİYE/ÇÖZÜM SON GELİR. Eğer verecek bir köprü/perspektif varsa duyguyu karşıladıktan SONRA, çok yumuşak ve kısa.',
      `   "Ona söyle bunu — söylemezsen anlamayabilir 💖" gibi tek bir cümle yeter; uzun açıklama YOK.`,
      '',
      '4) AKIŞI BÖLME. Konuyu değiştirme, başka şeye atlama. Buse ne paylaşıyorsa onun ÜZERİNDE kal; o bırakmadan sen bırakma.',
      '',
      '5) Sahte teselli verme ("her şey çok güzel olacak" gibi boş cümleler). Gerçek, yere basan, kısa cümleler.',
      '',
      `Bu mod sadece dert/sitem anlarında. Normal sohbette (napıyon, ne yaptın, akşam ne yapıyoruz vs.) DERTLEŞME modu DEĞİL — normal sevgili tonu.`,
      '',
      '═══ TON ═══',
      '★ EN ÖNEMLİ: GERÇEK BİR SEVGİLİ NASIL WHATSAPP YAZARSA ÖYLE YAZ. Şiir/aşk romanı DEĞİL. Kısa, sıcak, doğal mesaj.',
      '- Sevgili hitabı: canım, güzelim, tatlım, aşkım — birini seç, her cümleye sıkıştırma.',
      '- Övgü spesifik ve günlük dilde: "saçın çok güzel görünüyordu" gibi somut, "gülüşün hayata anlam katıyor" gibi edebi DEĞİL.',
      `- Hayran dokunuşu: "${ownerName} senden bahsetti yine" gibi günlük — "${ownerName}'in seninle nasıl gurur duyduğunu görsen" gibi kitabi değil.`,
      '- Oyunbaz: hafif şakacılık doğal yerde.',
      '- Destekleyici: kötü hissediyorsa kısa içten teselli, iyi habere coşku.',
      '',
      '═══ YASAKLI YAPMACIK DİL ═══',
      '- "Sabah ışığı seni aydınlatırken...", "Sen olmadan ... eksik", "senin için sabırsızım" — bunlar AŞK ROMANI dili, YASAK.',
      '- Em-dash (—) ile birleşik uzun cümleler.',
      '- Kafiyeli/şiirsel laflar ("sen yokken bile sen varsın" gibi).',
      '- "Çünkü sen ...", "...nin için ki ..." poetic gerekçelendirme.',
      '- Genel klişe iltifatlar ("sen müthiş bir insansın", "harika bir kadınsın").',
      '',
      '═══ UZUNLUK + EMOJI ═══',
      '- 1-2 kısa cümle. Çok mecbur kalırsan 3.',
      '- Doğal konuşma dili — küçük harf, eksik virgül, gerçek mesaj rahatlığı.',
      '- 1-3 emoji yeterli. Favoriler: ❤️ 🩷 💕 💖 🥹 😘 🌷 ✨ ☀️',
      '',
      '═══ SINIRLAR ═══',
      `- ${ownerName} adına KESİN söz verme (yarın gelirim, akşam ararım). En fazla: "${ownerName}'e söyleyeyim", "${ownerName} müsait olunca yazar 💕".`,
      `- ${her} cinsel/açık konu açarsa nazikçe yumuşat: "Bunu sana ${ownerName} söylesin 😊"`,
      `- Para, randevu, ciddi plan: "Bunu ${ownerName} kendisi söyler sana ✨"`,
      `- ASLA ${her}'nin seni ${ownerName} sanmasına yol açma. Ama "ben Muzaffer'in asistanıyım" diye HER mesaja koymaya da gerek yok — sadece karışıklık olursa hatırlat.`,
      '',
      recentContext,
      `${her}'nin mesajı: ${msg.text}`,
      '',
      `SADECE ${her}'ye gidecek nihai WhatsApp cevabını yaz — başka hiçbir şey yazma. Doğrudan mesaj metni, etiket yok.`,
    ].join('\n');

    let rawReply = '';
    try {
      // ÖNCE MAX (ücretsiz). Araçsız saf metin sohbet — Max yeterli.
      const max = await claudeTextViaMax({ prompt, model: MAX_MODEL_CHEAP });
      if (max.ok) {
        rawReply = (max.text || '').slice(0, 800);
      } else if (process.env.AI_ALLOW_API_FALLBACK === '1') {
        const answer = await this.morenAi.chat(tenant.id, null, {
          message: prompt,
          voiceMode: false,
          toolMode: 'none',
          source: 'whatsapp-bot',
        } as any);
        rawReply = (answer.assistantMessage || '').slice(0, 800);
      } else {
        this.logger.warn(`Personal contact bot — Max cevabi uretilemedi (${contact.name}): ${max.error}`);
        return;
      }
    } catch (err: any) {
      this.logger.warn(`Personal contact bot cevabi uretilemedi (${contact.name}): ${err?.message || err}`);
      return;
    }

    // Post-filter ATLAMAK gerekiyor — bu kişisel akış, mali-müşavirlik tonu için yapılmış
    // global replace'ler ("hemen" → "kontrol sonrasi", "Moren AI" → "ofisimiz") burada yanlış sonuç verir.
    // Minimal temizlik yeterli: markdown ayraçlarını sil, AI iç monologunu kes.
    const reply = this.lightCleanupForPersonal(rawReply);
    if (!reply) return;

    const sent = await this.whatsapp.sendMessage(this.replyTarget(msg), reply, tenant.id);
    await this.prisma.communicationLog.create({
      data: {
        taxpayerId: personalRecord.id,
        channel: 'WHATSAPP',
        subject: sent
          ? `WhatsApp ${contact.name} (kisisel) bot cevabi`
          : `WhatsApp ${contact.name} (kisisel) bot cevabi (gonderilemedi)`,
        content: this.withWhatsAppPhone(reply, msg.from),
        occurredAt: new Date(),
      },
    });
    this.refreshTaxpayerMemory(tenant.id, personalRecord.id);
  }

  /** Personal akış için hafif temizlik: markdown ayraçlarını ve AI iç-monolog prefix'lerini sil. */
  private lightCleanupForPersonal(raw: string): string {
    let text = String(raw || '').trim();
    text = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/[*_`>#~]/g, '')
      .replace(/^\s*(Anlad[ıi]m|G[öo]r[üu]yorum|Tamam|Pekala|Pekâla)[\s,:—–-]+/gi, '')
      .replace(/^\s*Cevap\s*[:]?\s*/gi, '')
      .replace(/^"([^"]+)"$/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    const max = Number(process.env.WHATSAPP_PERSONAL_REPLY_MAX_CHARS || 600);
    if (text.length > max) text = text.slice(0, max).replace(/\s+\S*$/, '').trim();
    return text;
  }

  /**
   * Buse vb. kişisel kişiler için ayrı bir contact kaydı tut: ne unknown ne mükellef.
   * taxNumber benzersiz (WHATSAPP-PERSONAL-<phone>), tip GERCEK_KISI, isActive true.
   */
  private async ensureWhatsAppPersonalContact(
    tenantId: string,
    contact: { phone: string; name: string },
  ) {
    const normalized = this.normalize(contact.phone);
    const taxNumber = `WHATSAPP-PERSONAL-${normalized}`;
    const existing = await this.prisma.taxpayer.findFirst({
      where: {
        tenantId,
        OR: [{ taxNumber }, { phone: normalized }, { phones: { has: normalized } }],
      },
      select: {
        id: true,
        tenantId: true,
        companyName: true,
        taxNumber: true,
        phone: true,
        phones: true,
      },
    });
    if (existing) {
      if (existing.taxNumber !== taxNumber || existing.companyName !== contact.name) {
        return this.prisma.taxpayer.update({
          where: { id: existing.id },
          data: {
            companyName: contact.name,
            taxNumber,
            taxOffice: 'WHATSAPP',
            notes: 'Ofis sahibi tarafindan tanimlanmis kisisel kontak (WhatsApp). Bot ozel ton kullanir.',
            isActive: true,
          },
          select: { id: true, tenantId: true, companyName: true, taxNumber: true, phone: true, phones: true },
        });
      }
      return existing;
    }

    return this.prisma.taxpayer.create({
      data: {
        tenantId,
        type: 'GERCEK_KISI',
        companyName: contact.name,
        taxNumber,
        taxOffice: 'WHATSAPP',
        phone: normalized,
        phones: normalized ? [normalized] : [],
        emails: [],
        notes: 'Ofis sahibi tarafindan tanimlanmis kisisel kontak (WhatsApp). Bot ozel ton kullanir.',
        isActive: true,
        whatsappEvrakTalep: false,
        whatsappEvrakGeldi: false,
      },
      select: { id: true, tenantId: true, companyName: true, taxNumber: true, phone: true, phones: true },
    });
  }

  /**
   * Ofisin sahibi tarafından tanımlanmış "kişisel kişiler" (örn. partner/aile).
   * Bu kişilere bot, mali müşavirlik tonunda değil; sıcak, samimi, asistan tonunda
   * cevap üretir. Format: `MOREN_PERSONAL_CONTACT_PHONES=905363048246:Buse,905001234567:Anne`
   * (phone:displayName virgül ile ayrılır)
   */
  /**
   * WhatsApp owner sohbetleri tek bir AI conversation'da birikir.
   * Yan etki: portal "MOREN AI" listesinde tek satır, başlık temiz, system prompt cache'leniyor.
   */
  private async getOrCreateOwnerWhatsAppConversation(
    tenantId: string,
    ownerContactId: string,
    tenantName?: string | null,
  ): Promise<string> {
    const title = `📱 WhatsApp Sohbeti — ${tenantName || 'Ofis'}`;
    const existing = await this.prisma.aiConversation.findFirst({
      where: { tenantId, taxpayerId: ownerContactId, title },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    }).catch(() => null);
    if (existing) return existing.id;
    const created = await this.prisma.aiConversation.create({
      data: { tenantId, userId: null, taxpayerId: ownerContactId, title },
      select: { id: true },
    });
    return created.id;
  }

  private findPersonalContactByPhone(phone: string): { phone: string; name: string } | null {
    const normalized = this.normalize(phone);
    if (!normalized) return null;
    // Env var yoksa hardcoded default kullan (ofis sahibinin partneri).
    // Override etmek/genişletmek için: MOREN_PERSONAL_CONTACT_PHONES=phone1:Name1,phone2:Name2
    const DEFAULT_PERSONAL_CONTACTS = '905363048246:Buse';
    const raw = (String(process.env.MOREN_PERSONAL_CONTACT_PHONES || '').trim()) || DEFAULT_PERSONAL_CONTACTS;
    if (!raw) return null;
    for (const entry of raw.split(',')) {
      const [p, n] = entry.split(':').map((s) => (s || '').trim());
      const np = this.normalize(p);
      if (np && np === normalized) {
        return { phone: np, name: n || 'Kişisel kişi' };
      }
    }
    return null;
  }

  private clientAutoReplyEnabled(): boolean {
    return process.env.MOREN_CLIENT_BOT_ENABLED === '1';
  }

  private ownerAutoReplyEnabled(): boolean {
    return process.env.MOREN_OWNER_BOT_REPLY_ENABLED !== '0';
  }

  private async handleMessage(msg: IncomingWhatsAppMessage) {
    // ─── Kişisel kişi (örn. partner) branch'i ──────────────────────
    // Owner / taxpayer / unknown akışlarından ÖNCE çalışır.
    // Bot bu kişiye mali müşavirlik tonunda değil, sıcak/samimi asistan tonunda yazar.
    const personalContact = this.findPersonalContactByPhone(msg.from);
    if (personalContact) {
      const ownerTenantForPersonal = await this.findTenantForInbound(msg);
      if (ownerTenantForPersonal) {
        await this.handlePersonalContactMessage(ownerTenantForPersonal, personalContact, msg);
        return;
      }
    }
    // ───────────────────────────────────────────────────────────────

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
      this.refreshTaxpayerMemory(ownerTenant.id, ownerContact.id);

      if (!this.ownerAutoReplyEnabled()) {
        this.logger.log(`[Owner botu kapali] owner mesaji kaydedildi, otomatik cevap atlanadi: ${this.normalize(msg.from)}`);
        return;
      }

      const recentContext = await this.botContext.buildRecentWhatsAppContext(ownerContact.id);
      const prompt = [
        'ÖNEMLİ: Sen Moren Mali Müşavirlik ofisinin WhatsApp asistanısın. Karşındaki kişi ofisin SAHİBİ — bana doğrudan yazıyor.',
        '',
        'KESİN KURALLAR:',
        '1) ASLA "müşteri X yaptı/dedi/selamlaştı" gibi 3. tekil dille konuşma. "Sen", "size" diye konuş.',
        '2) ASLA "Anladım — ...", "Görüyorum...", "Şimdilik:", "Yapılacak:", "Plan:" gibi düşünce/brifing yazma.',
        '3) Yıldız tabanlı markdown (** __ ` # > ~) YASAK ama WhatsApp doğal formatları SERBEST:',
        '   - Satır arası (\\n\\n) bölüm ayırmak için kullan',
        '   - Liste için • veya - kullan',
        '   - Emoji bölüm başlığı için: 📊 DURUM, ⚠️ RİSKLİ, 🤖 AJANLAR, 🚗 HGS, ▶️ AKSİYON',
        '   - Sayıları Türk formatı: 14.421,50 ₺ (binlik nokta, ondalık virgül)',
        '4) ASLA "Cevap (WhatsApp):" gibi etiketle başlama. Doğrudan cevap yaz.',
        '5) Kısa selamlama mesajına (kolay gelsin, merhaba, sağ ol) kısa selamlama cevabı ver (1 cümle).',
        '6) Veri/komut isteğinde tool çağır, sonucu kısa söyle.',
        '7) Riskli işlemlerde önce preview + ONAYLIYORUM bekle.',
        '',
        '★ UZUN BRİFİNG / DURUM RAPORU formatı:',
        '   Başlık (emoji + büyük harfle başlık satırı)',
        '   Boş satır',
        '   Bölüm başlığı (emoji + BÖLÜM ADI)',
        '   • bullet liste',
        '   Boş satır',
        '   Sonraki bölüm...',
        '   Tek paragrafta yapışık yazma; bölümleri boş satırlarla ayır.',
        '',
        'KISA SOHBET için: 1-2 cümle, sade. Brifing yapısı uygulama.',
        '',
        'SADECE müşavire (size) gidecek FINAL CEVABI yaz, başka hiçbir şey yazma.',
        recentContext,
        `Mesajınız: ${msg.text}`,
      ].join('\n');

      // Portal'da WhatsApp owner sohbetleri tek bir persistent conversation'a yazılır.
      // Bu hem listede kirlilik yapmaz hem prompt-caching ile maliyeti düşürür.
      const conversationId = await this.getOrCreateOwnerWhatsAppConversation(ownerTenant.id, ownerContact.id, ownerTenant.name);

      // AI çağrısı — fetch failed gibi geçici sorunlarda kullanıcıya bos kalmasın diye
      // try/catch + fallback. Eskiden hata sessizce yakalanıyor, kullanıcı bekliyordu.
      let answer: any;
      try {
        // Owner WhatsApp → ÇALIŞAN AJAN köprüsü.
        // Ajan model yönlendirme (kritik→Opus 4.8, diğer→Sonnet) + öğrenme uygular,
        // cevabı mevcut TOOL'LU MorenAI beyninden üretir (mizan/KDV/beyan sorgu korunur).
        answer = await this.calisan.runViaMorenAi({
          tenantId: ownerTenant.id,
          conversationId,
          message: prompt,
          source: 'calisan-whatsapp',
        });
      } catch (err: any) {
        this.logger.warn(`Owner AI cevabi uretilemedi (fetch hatasi?): ${err?.message || err}`);
        const fallbackText = `Su an cevap uretemedim (gecici servis sorunu olabilir). Lutfen birazdan tekrar dener misin?`;
        try {
          await this.whatsapp.sendMessage(this.replyTarget(msg), fallbackText, ownerTenant.id);
          await this.prisma.communicationLog.create({
            data: {
              taxpayerId: ownerContact.id,
              channel: 'WHATSAPP',
              subject: 'WhatsApp owner fallback (AI fetch failed)',
              content: this.withWhatsAppPhone(fallbackText, msg.from),
              occurredAt: new Date(),
            },
          });
        } catch { /* en kotu ihtimal, sessiz hata */ }
        return;
      }
      const rawReply = (answer?.assistantMessage || '').slice(0, 1400);
      // Owner için de post-filter uygula — iç monolog/markdown temizle
      const reply = this.postFilter.filterTaxpayerReply(rawReply, { mode: 'owner' });
      if (reply) {
        const sent = await this.whatsapp.sendMessage(this.replyTarget(msg), reply, ownerTenant.id);
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: ownerContact.id,
            channel: 'WHATSAPP',
            subject: sent ? 'WhatsApp owner bot cevabi' : 'WhatsApp owner bot cevabi (gonderilemedi - master switch veya hata)',
            content: this.withWhatsAppPhone(reply, msg.from),
            occurredAt: new Date(),
          },
        });
        this.refreshTaxpayerMemory(ownerTenant.id, ownerContact.id);
      }
      return;
    }

    // Gelen mesaj kaydi, musteri auto-reply ayarindan bagimsizdir.
    // MOREN_CLIENT_BOT_ENABLED yalniz otomatik cevap uretimini acar/kapatir.
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
      this.refreshTaxpayerMemory(tenant.id, contact.id);

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

      if (!this.clientAutoReplyEnabled()) {
        this.logger.log(`[Musteri botu kapali] kayitsiz mesaj kaydedildi, otomatik cevap atlanadi: ${this.normalize(msg.from)}`);
        return;
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
        this.refreshTaxpayerMemory(tenant.id, contact.id);
        return;
      }

      const rate = this.rateLimiter.registerIncoming(tenant.id, contact.id);
      if (!rate.limited || rate.shouldNotify) {
        const recentUnknownReplies = await this.botContext.getRecentOutgoingReplies(contact.id).catch(() => []);

        // Kayıtsız numara için intent'e göre değişken cevap
        const intentResult = this.intentClassifier.classify(msg.text || '');
        let rawReply: string;
        const totalLogs = await this.prisma.communicationLog.count({
          where: { taxpayerId: contact.id, channel: 'WHATSAPP' },
        }).catch(() => 0);
        const isFirstContact = totalLogs <= 1; // bu gelen mesaj zaten log'a yazıldı (1)

        if (isFirstContact) {
          // İlk temas — kendini tanıt + kim olduğunu sor
          rawReply = 'Merhaba, Moren Mali Müşavirlik iletişim hattına hoş geldiniz. Size yardımcı olabilmemiz için adınızı veya firma unvanınızı paylaşır mısınız?';
        } else if (intentResult.intent === 'SELAMLAMA') {
          // Selamlama — sıcak ve doğal cevap
          rawReply = 'Merhaba, iyiyim teşekkür ederim. Size nasıl yardımcı olabiliriz? Mali müşavirlik işlemleriniz için ad veya firma unvanınızı paylaşırsanız sizi kayıtlarımızda bulabiliriz.';
        } else if (intentResult.intent === 'BILGI_SORUSU') {
          rawReply = 'Sorduğunuz konuyu mali müşavirimize iletmek için sizi sistemimizde tanıyabilmemiz gerekiyor. Adınızı veya firma unvanınızı paylaşır mısınız?';
        } else if (intentResult.intent === 'EVRAK_TESLIM' || intentResult.intent === 'ODEME_BILDIRIMI') {
          rawReply = 'Bilginiz alındı. Kayıtlarımıza işleyebilmemiz için adınızı veya firma unvanınızı paylaşır mısınız?';
        } else {
          rawReply = 'Mesajınız alındı, mali müşavirimiz en kısa sürede size dönüş yapacak. Aramızda kayıtlı görünmüyorsunuz; adınızı veya firma unvanınızı paylaşırsanız ekibimiz hızlıca eşleştirme yapabilir.';
        }
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
        const sent = await this.whatsapp.sendMessage(this.replyTarget(msg), reply, tenant.id);
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: contact.id,
            channel: 'WHATSAPP',
            subject: sent ? 'WhatsApp kayitsiz bot cevabi' : 'WhatsApp kayitsiz bot cevabi (gonderilemedi - master switch veya hata)',
            content: this.withWhatsAppPhone(reply, msg.from),
            occurredAt: new Date(),
          },
        });
        this.refreshTaxpayerMemory(tenant.id, contact.id);
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
    this.refreshTaxpayerMemory(taxpayer.tenantId, taxpayer.id);

    const taxpayerName =
      taxpayer.companyName ||
      `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim() ||
      'Mukellef';
    const automationActive = await this.whatsapp.isAutomationActive(taxpayer.tenantId);
    const clientAutoReplyEnabled = this.clientAutoReplyEnabled();
    const botCanReply = automationActive && clientAutoReplyEnabled;
    const passiveActionText = clientAutoReplyEnabled
      ? 'Bot pasif modda, otomatik cevap at\u0131lmad\u0131. Manuel cevap i\u00e7in Mesajlar ekran\u0131na git.'
      : 'Musteri botu kapali; mesaj Mesajlar ekranina kaydedildi, otomatik cevap atilmadi.';
    await this.prisma.notification.create({
      data: {
        tenantId: taxpayer.tenantId,
        type: 'WHATSAPP',
        title: botCanReply
          ? `\uD83D\uDCE9 ${taxpayerName} firmas\u0131ndan yeni mesaj`
          : `\uD83D\uDD34 [PAS\u0130F] Yeni mesaj: ${taxpayerName}`,
        body: this.notificationBody(
          msg,
          botCanReply ? undefined : passiveActionText,
        ).slice(0, 500),
        metadata: {
          taxpayerId: taxpayer.id,
          phone: msg.from,
          messageId: msg.id || null,
          automationActive,
          clientAutoReplyEnabled,
          actionText: botCanReply ? undefined : passiveActionText,
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

    if (!clientAutoReplyEnabled) {
      this.logger.log(`[Musteri botu kapali] kayitli mesaj kaydedildi, otomatik cevap atlanadi: taxpayer=${taxpayer.id} phone=${this.normalize(msg.from)}`);
      return;
    }

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
      this.refreshTaxpayerMemory(taxpayer.tenantId, taxpayer.id);
      return;
    }

    const recentReplies = await this.botContext.getRecentOutgoingReplies(taxpayer.id);
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
        const sent = await this.whatsapp.sendMessage(this.replyTarget(msg), limitedReply, taxpayer.tenantId);
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: taxpayer.id,
            channel: 'WHATSAPP',
            subject: sent ? 'WhatsApp bot rate limit cevabi' : 'WhatsApp bot rate limit cevabi (gonderilemedi - master switch veya hata)',
            content: this.withWhatsAppPhone(limitedReply, msg.from),
            occurredAt: new Date(),
          },
        });
        this.refreshTaxpayerMemory(taxpayer.tenantId, taxpayer.id);
      }
      return;
    }

    // Hazir/templated sablonlar = en bariz "robot" sinyali. Mukellef hattinda
    // ARTIK KULLANILMIYOR; her sey dogal AI sesiyle cevaplaniyor. Sadece beyanname
    // onaylama gibi kritik komutlar icin guvenlik guard'i kaliyor (bot asla otomatik onaylamaz).
    const guardedReply = this.buildGuardedTaxpayerReply(msg.text);
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
      const sent = await this.whatsapp.sendMessage(this.replyTarget(msg), filteredReply, taxpayer.tenantId);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: taxpayer.id,
          channel: 'WHATSAPP',
          subject: sent ? 'WhatsApp bot cevabi' : 'WhatsApp bot cevabi (gönderilemedi - master switch veya hata)',
          content: this.withWhatsAppPhone(filteredReply, msg.from),
          occurredAt: new Date(),
        },
      });
      this.refreshTaxpayerMemory(taxpayer.tenantId, taxpayer.id);
      return;
    }

    // ─── Cache lookup ──────────────────────────────────────────────
    // Aynı mükelleften son 24 saatte aynı (normalize edilmiş) soru gelmişse
    // AI'ya gitmeden son onaylı cevabı dön. Hata/generic cevaplar shouldNotCache
    // filtresiyle zaten cache'lenmiyor (bkz. bot-cache.service.ts).
    const cachedReply = this.botCache.get(taxpayer.tenantId, taxpayer.id, msg.text);
    if (cachedReply) {
      const filteredCached = this.postFilter.filterTaxpayerReply(cachedReply, { recentReplies });
      if (filteredCached) {
        const sent = await this.whatsapp.sendMessage(this.replyTarget(msg), filteredCached, taxpayer.tenantId);
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: taxpayer.id,
            channel: 'WHATSAPP',
            subject: sent ? 'WhatsApp bot cevabı (cache hit)' : 'WhatsApp bot cevabı cache hit (gönderilemedi)',
            content: this.withWhatsAppPhone(filteredCached, msg.from),
            occurredAt: new Date(),
          },
        });
        this.refreshTaxpayerMemory(taxpayer.tenantId, taxpayer.id);
        return;
      }
    }
    // ───────────────────────────────────────────────────────────────

    const taxpayerContext = await this.botContext.buildTaxpayerContextBlock(taxpayer.tenantId, taxpayer.id);
    const recentContext = await this.botContext.buildRecentWhatsAppContext(taxpayer.id);
    const prompt = [
      `Sen ${BOT_NAME}'sin — ${OFFICE_NAME} ofisinde çalışan bir asistansın. WhatsApp'tan ofisin mükellefiyle yazışıyorsun.`,
      'GERÇEK BİR İNSAN gibi yaz. Karşındaki kişi seninle bir insanla konuştuğunu hissetmeli.',
      '',
      '— DOĞAL KONUŞMA —',
      `• Sen ${BOT_NAME}'sin, gerçek bir kişi. Kısa, sıcak, akıcı yaz; WhatsApp'ta bir insan nasıl yazarsa öyle.`,
      '• TONU MÜŞTERİYE UYDUR: O samimi/teklifsiz yazıyorsa sen de samimi ol; resmi yazıyorsa ölçülü ol. Onun enerjisini yansıt.',
      '• Robotik/kurumsal kalıplardan KAÇIN: "ilgili kişiye aktarıldı", "kayda alındı", "dönüş yapılacaktır", "talebiniz işleme alınmıştır" gibi şeyler ASLA deme. Bir insan nasıl söylerse öyle söyle.',
      '• Her seferinde aynı kalıbı tekrarlama; cümlelerini değiştir, doğal aksın.',
      '• Doğal bağlaçlar/ifadeler kullanabilirsin ("tabii", "bir bakayım", "şu an şöyle görünüyor", "merak etme") — ama abartma, kısa tut.',
      '• Emoji: müşteri kullanıyorsa ya da içtenlik katacaksa ara sıra, çok az.',
      '',
      '— SEN BİR YAPAY ZEKA DEĞİLSİN (müşteriye göre) —',
      `• ASLA bot/yapay zeka/asistan yazılımı olduğunu söyleme ya da ima etme. Sen ${BOT_NAME}'sin, ofisten.`,
      `• "Bot musun / yapay zeka mısın / robot musun" diye sorarsa, rahat ve insanca geçiştir: "Yok, ofisten ${BOT_NAME} :)" gibi, sonra yardımına devam et. Savunmaya geçme.`,
      '• "Moren AI", "yapay zeka", "dil modeli" gibi kelimeleri ASLA kullanma.',
      '',
      '— NE SÖYLERSİN, NE SÖYLEMEZSİN —',
      '• SADECE sorulana cevap ver. "KDV ne kadar?" → veride varsa tutarı söyle. "Beyannamem hazır mı?" → durumu söyle. "Evraklarım geldi mi?" → durumu söyle.',
      '• Selam/sohbet gelirse SADECE doğal bir selam ver, "nasıl yardımcı olayım?" de. Selamlamaya karşılık evrak/beyanname/ödeme durumu DÖKME.',
      '• Sorulmayan durumu kendiliğinden duyurma. Mükellef sormadan "evraklarınız geldi/işlendi" gibi cümle kurma.',
      '• Mükellef "ben göndermedim / öyle bir şey yok" diyorsa, veride aksini görsen bile ISRAR ETME; "bir kontrol edeyim, sana netini söylerim" gibi yumuşak geç. Kendinle çelişme.',
      '• Veri yoksa rakam/tarih/durum UYDURMA — "bir bakıp sana döneyim" de (ama bunu da her seferinde aynı kelimelerle değil).',
      '• Beyanname gönderme/onaylama gibi kritik işleri ASLA kendi başına onaylama; "müşavirimiz son bir bakınca ilerletiriz" gibi söyle.',
      '',
      '— BİÇİM —',
      '• En fazla 2-3 kısa cümle. Markdown yok (* _ # > ` ~), başlık yok, madde işareti yok.',
      '• "Anladım", "Müşteri...", "Cevap:", "Şimdilik:" gibi iç düşünce/etiket yazma. Doğrudan mesajı yaz.',
      '',
      `Intent (ipucu, müşteriye söyleme): ${classified.intent}`,
      'Gerekirse get_my_* read-only tool çağır. taxpayerId verme — backend kendisi bağlar.',
      '',
      '═══ MÜKELLEF VERİSİ (cevabı burada ara) ═══',
      taxpayerContext,
      recentContext,
      '═══════════════════════════════════════════',
      '',
      `Mükellefin mesajı: ${msg.text}`,
      '',
      `SADECE ${BOT_NAME}'in göndereceği mesajı yaz — başka hiçbir şey yazma, etiket koyma.`,
    ].join('\n');

    const answer = await this.morenAi.chat(taxpayer.tenantId, null, {
      taxpayerId: taxpayer.id,
      message: prompt,
      // voiceMode KAPALI — WhatsApp metin cevabi. Sesli/true olunca max_token 260'a duser
      // ve compactFinalAnswer 220 karakterde keser => cevaplar yarida kalir (sacma/eksik).
      voiceMode: false,
      toolMode: 'taxpayer-readonly',
      source: 'whatsapp-bot',
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
          voiceMode: false,
          toolMode: 'taxpayer-readonly',
          source: 'whatsapp-bot',
        });
        return retryAnswer.assistantMessage || '';
      },
    });
    const reply = this.postFilter.filterTaxpayerReply(qualityReply, { recentReplies });
    if (reply) {
      // Cache'e yaz — sonraki aynı soru AI'ya gitmeden bu cevapla dönsün.
      // shouldNotCache filtresi (bot-cache.service.ts) generic/hata cevaplarını eler.
      this.botCache.set(taxpayer.tenantId, taxpayer.id, msg.text, reply);

      const sent = await this.whatsapp.sendMessage(this.replyTarget(msg), reply, taxpayer.tenantId);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: taxpayer.id,
          channel: 'WHATSAPP',
          subject: sent ? 'WhatsApp bot cevabı (MOREN AI)' : 'WhatsApp bot cevabı (gönderilemedi - master switch veya hata)',
          content: this.withWhatsAppPhone(reply, msg.from),
          occurredAt: new Date(),
        },
      });
      this.refreshTaxpayerMemory(taxpayer.tenantId, taxpayer.id);
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
    // Maliyet tasarrufu: live cevaplarin %X'i eval'den gecsin (varsayilan %20).
    // Gece synthetic test'ler ayri cron'da, bu sample etkilemez.
    // Ayarlama: MOREN_AI_EVAL_SAMPLE_RATE=0.2 (0-1 arasi)
    const sampleRate = Number(process.env.MOREN_AI_EVAL_SAMPLE_RATE || 0.2);
    if (sampleRate < 1 && Math.random() > sampleRate) {
      return input.reply;
    }
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

  /**
   * SADECE gerçek yan etkili komutlar için hazır cevap döndür.
   * Bilgi sorularını (KDV ne kadar, beyannamem hazır mı vs.) AI'ya bırak
   * — AI context'teki gerçek veriyi kullanıp cevaplasın.
   */
  // Mesaj bir soru / bilgi talebi gibi mi? Oyleyse hazir sablon yerine AI cevaplamali.
  private messageLooksLikeQuestion(raw: string): boolean {
    if (!raw) return false;
    if (raw.includes('?')) return true;
    const t = this.normalizeText(raw);
    return /\bm[iu]\b|m[iu]sin|m[iu]siniz|m[iu]sun|m[iu]sunuz|\bne kadar\b|\bne zaman\b|\bkac\b|\bnedir\b|\bhangi\b|\bnasil\b|ogrenebilir|soyler|bakar m|hazir m|geldi m|oldu m|kaldi m|var m|yok m|odendi m|\bborc|\bbakiye|\bkalan\b/.test(t);
  }

  private buildGuardedTaxpayerReply(text: string): string | null {
    const t = this.normalizeText(text);

    // Sadece BEYANNAME ONAY/GÖNDERME KOMUTU için hazır guard
    // (Müşteri "beyannameyi onaylıyorum, gönder" dediğinde bot asla otomatik göndermesin)
    if (/(beyanname|beyan|tahakkuk)/i.test(t) && /(onayliyorum|onayladim|imzaladim|gonder hemen|gonderebilirsin)/i.test(t)) {
      return 'Onay bilginiz alindi; son kontrol tamamlaninca size net bilgi verilecek.';
    }

    // Diğer her şey AI'ya gider — context'teki veriyle cevap üretsin
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
