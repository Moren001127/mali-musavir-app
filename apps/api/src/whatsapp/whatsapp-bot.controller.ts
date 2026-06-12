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
const OWNER_PORTAL_NAME = process.env.MOREN_OWNER_PORTAL_NAME || OFFICE_NAME;

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

  private withWhatsAppMeta(content: string, msg: IncomingWhatsAppMessage): string {
    const parts: string[] = [];
    const normalized = this.normalize(msg.from);
    const jid = String(msg.replyTo || '').trim();
    if (normalized) parts.push(`[[wa_phone:${normalized}]]`);
    if (jid && jid.includes('@')) parts.push(`[[wa_jid:${jid}]]`);
    parts.push(content);
    return parts.join('\n');
  }

  private replyTarget(msg: IncomingWhatsAppMessage): string {
    const from = String(msg.from || '').trim();
    const replyTo = String(msg.replyTo || '').trim();
    if (replyTo.includes('@lid') && from) return from;
    return String(replyTo || from).trim();
  }

  /**
   * AI cevabı üretilirken telefonda "yazıyor…" göstergesini CANLI tutar; durdurucu
   * fonksiyon döndürür. WhatsApp'ta "composing" presence ~10 sn'de söner, bu yüzden
   * periyodik tazelenir. Cevap hazır olunca dönen fonksiyon çağrılıp kapatılır.
   * Böylece kullanıcı işlem boyunca boş ekrana bakıp "geç cevap veriyor" sanmaz.
   */
  private startTypingIndicator(tenantId: string, phone: string): () => void {
    if (process.env.MOREN_BOT_TYPING === '0') return () => undefined;
    let stopped = false;
    const ping = () => { this.whatsapp.setTyping(phone, tenantId, true).catch(() => undefined); };
    ping();
    const refreshMs = Math.max(4000, Number(process.env.MOREN_BOT_TYPING_REFRESH_MS) || 8000);
    const timer = setInterval(() => { if (!stopped) ping(); }, refreshMs);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();
    return () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      this.whatsapp.setTyping(phone, tenantId, false).catch(() => undefined);
    };
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
        OWNER_PORTAL_NAME,
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
            companyName: displayName || OWNER_PORTAL_NAME,
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
            companyName: displayName || OWNER_PORTAL_NAME,
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
        ? (displayName || OWNER_PORTAL_NAME)
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
        content: this.withWhatsAppMeta(incomingContent, msg),
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

    const stopPersonalTyping = this.startTypingIndicator(tenant.id, this.replyTarget(msg));
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
    } finally {
      stopPersonalTyping();
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

  private ownerDisplayName(): string {
    return String(process.env.MOREN_OWNER_DISPLAY_NAME || 'Muzaffer').trim() || 'Muzaffer';
  }

  private normalizeForIntent(text: string): string {
    return String(text || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isOwnerIdentityQuestion(text: string): boolean {
    const normalized = this.normalizeForIntent(text);
    return /\bben\s+kim(im|in)?\b/.test(normalized)
      || /\bbeni\s+tani/.test(normalized)
      || /\bkimim\b/.test(normalized)
      || /\bkimin\b/.test(normalized);
  }

  private ownerIdentityReply(ownerTenant: any): string {
    const ownerName = this.ownerDisplayName();
    const officeName = ownerTenant?.name || OFFICE_NAME;
    return `${ownerName}, sen ${officeName} sahibi olarak tanımlısın. Bu hat owner WhatsApp hattın; seni müşteri gibi değil ofis sahibi olarak görüyorum.`;
  }

  // ============================================================
  // FAZ 2 — BELGE GÖNDERME (owner → kendi WhatsApp'ı)
  // ============================================================

  /** Owner mesajı bir belge gönderme isteği mi? (gönder/ilet + belge türü) */
  private isOwnerDocumentSendRequest(text: string): boolean {
    const n = this.normalizeForIntent(text);
    // Fiil kökleri + ÇEKİMLER (gönder, gönderir, GÖNDERECEKSİN, gönderecektin,
    // göndersene, yolla, yollar, iletir, paylaş...). Eskiden yalnız düz "gönder"
    // emri tanınıyordu → "göndereceksin/gönderecektin" gibi çekimler kaçıp AI'ya
    // düşüyor, AI "gönderiyorum" diye yalan söylüyordu.
    const wantsSend = /\b(gonder|yolla|ilet|paylas)\w*/.test(n)
      || /\b(at|atar)\b/.test(n)
      || /\bpdf\b|dosya\s*olarak|belge\s*olarak/.test(n);
    // Belge anahtar kelimeleri + beyan tipleri (muhtasar/kdv/damga...). "Muhtasarını
    // gönder" eskiden listede olmadığı için belge isteği SAYILMIYOR, AI'ya düşüp
    // "gönderiyorum" deyip GÖNDERMİYORDU. inferBeyanTipiFromOwnerText yedek kapı.
    const aboutDoc = /(beyan|tahakkuk|fatura|belge|pdf|ekstre|dosya|evrak|sozlesme|vekalet|imza\s*sirku|levha|sicil|ruhsat|muhtasar|muhsgk|stopaj|kdv|damga|gecici|kurumlar|poset|bordro|bildirge)/.test(n)
      || !!this.inferBeyanTipiFromOwnerText(text);
    return wantsSend && aboutDoc;
  }

  /** Mesajda geçen belge kategorisi (Document.category) ipucu. */
  private inferDocCategory(text: string): 'SOZLESME' | 'FATURA' | 'BEYANNAME' | 'EVRAK' | null {
    const n = this.normalizeForIntent(text);
    if (/sozlesme/.test(n)) return 'SOZLESME';
    if (/fatura/.test(n)) return 'FATURA';
    if (/beyan|tahakkuk/.test(n)) return 'BEYANNAME';
    if (/evrak|vekalet|imza\s*sirku|levha|sicil|ruhsat/.test(n)) return 'EVRAK';
    return null;
  }

  /** Belge başlığı araması için mesajdaki anlamlı kelimeler (mükellef adı + dolgu hariç). */
  private docTitleKeywords(text: string, taxpayerAd: string): string[] {
    const STOP = new Set([
      'gonder', 'gonderir', 'ilet', 'iletir', 'yolla', 'at', 'atar', 'paylas', 'bana', 'icin',
      'nin', 'nun', 'nin', 'pdf', 'dosya', 'olarak', 'belge', 'beyanname', 'beyan', 'tahakkuk',
      'fatura', 'sozlesme', 'evrak', 'ekstre', 'lutfen', 'rica', 've', 'bir', 'bu', 'su', 'ile',
      'ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik',
    ]);
    const adKel = new Set(this.normalizeForIntent(taxpayerAd).split(/\s+/));
    return this.normalizeForIntent(text)
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w) && !adKel.has(w) && !/^\d+$/.test(w));
  }

  private docFilename(d: { title: string; mimeType: string }): string {
    const base = String(d.title || 'belge').replace(/[^\w.-]+/g, '_').slice(0, 60);
    const ext = /pdf/.test(d.mimeType) ? 'pdf'
      : /jpeg|jpg/.test(d.mimeType) ? 'jpg'
        : /png/.test(d.mimeType) ? 'png'
          : /word|officedocument.word/.test(d.mimeType) ? 'docx'
            : /excel|spreadsheet/.test(d.mimeType) ? 'xlsx' : '';
    return ext && !base.toLowerCase().endsWith(ext) ? `${base}.${ext}` : base;
  }

  /** Mesajda geçen mükellefi bul: adının ilk anlamlı kelimesi metinde geçiyor mu. */
  private async findTaxpayerInOwnerText(tenantId: string, text: string): Promise<any | null> {
    const n = this.normalizeForIntent(text);
    const taxpayers = await this.prisma.taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, companyName: true, firstName: true, lastName: true },
    });
    let best: { tp: any; len: number } | null = null;
    for (const tp of taxpayers) {
      const ad = (tp.companyName || `${tp.firstName || ''} ${tp.lastName || ''}`).trim();
      const adN = this.normalizeForIntent(ad);
      // adın 3+ harfli kelimeleri; en az biri mesajda substring olarak geçmeli
      const kelimeler = adN.split(/\s+/).filter((w) => w.length >= 3);
      const hit = kelimeler.find((w) => n.includes(w));
      if (hit && (!best || hit.length > best.len)) best = { tp, len: hit.length };
    }
    return best?.tp || null;
  }

  /**
   * Owner konuşma geçmişinde EN SON bahsedilen mükellefi + dönemi bulur.
   * "Muhtasarını da gönder" gibi isimsiz DEVAM isteklerinde bağlamı taşımak için
   * — yoksa AI rastgele/yanlış mükellef tutturuyordu.
   */
  private async findRecentOwnerDocContext(
    tenantId: string,
    ownerContactId: string,
  ): Promise<{ taxpayer: any | null; donem: string | null }> {
    let taxpayer: any = null;
    let donem: string | null = null;
    const logs = await this.prisma.communicationLog.findMany({
      where: { taxpayerId: ownerContactId, channel: 'WHATSAPP' },
      orderBy: { occurredAt: 'desc' },
      take: 14,
      select: { content: true },
    });
    if (!logs.length) return { taxpayer, donem };
    const taxpayers = await this.prisma.taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, companyName: true, firstName: true, lastName: true },
    });
    // 1) KESİN: en son gönderilen belgenin mükellef id'si + dönemi (bulanık isim DEĞİL).
    //    "Tahakkukunu da gönder" gibi devam isteklerinde ortak kelime ("TAŞIMACILIK")
    //    yanlış mükellef seçiyordu — bu işaret onu kökten engeller.
    for (const log of logs) {
      const m = String(log.content || '').match(/\[\[doc_ctx:([^|\]]+)\|?([^\]]*)\]\]/);
      if (m) {
        const tp = taxpayers.find((t) => t.id === m[1].trim());
        if (tp) { taxpayer = tp; if (m[2] && m[2].trim()) donem = m[2].trim(); break; }
      }
    }
    // 2) İşaret yoksa: bulanık isim eşleştirme (eski yol, taxpayer zaten bulunduysa atlar).
    for (const log of logs) {
      const content = String(log.content || '');
      if (!taxpayer) {
        const n = this.normalizeForIntent(content);
        let best: { tp: any; len: number } | null = null;
        // Ortak sektör/hukuki ekler tek başına EŞLEŞMESİN; yoksa "gida/insaat/arı"
        // gibi parçalar yanlış mükellefe çapalanıp YANLIŞ BELGE gönderilebiliyordu.
        const DOC_STOPWORDS = new Set(['ltd', 'sti', 'tic', 'san', 'sanayi', 'ticaret', 'insaat', 'gida', 'limited', 'anonim', 'sirket', 'sirketi', 'holding', 'grup', 'kollektif', 'komandit', 'icin']);
        for (const tp of taxpayers) {
          const ad = (tp.companyName || `${tp.firstName || ''} ${tp.lastName || ''}`).trim();
          // min 4 harf + kelime SINIRI (başlangıç): "ari" artık "hazirladim" içinde
          // eşleşmez, ama "fatih" → "fatihin"/"fatih'in" yine eşleşir (önek).
          const kelimeler = this.normalizeForIntent(ad).split(/\s+/)
            .filter((w) => w.length >= 4 && !DOC_STOPWORDS.has(w));
          const hit = kelimeler.find((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(n));
          if (hit && (!best || hit.length > best.len)) best = { tp, len: hit.length };
        }
        if (best) taxpayer = best.tp;
      }
      if (!donem) {
        const d = this.extractPeriodFromOwnerText(content);
        if (d) donem = d;
      }
      if (taxpayer && donem) break;
    }
    return { taxpayer, donem };
  }

  /** Mesaj isimsiz bir DEVAM/gönderim isteği gibi mi? ("da gönder", "onu da", "bekliyorum"). */
  private looksLikeFollowUpSend(text: string): boolean {
    const n = this.normalizeForIntent(text);
    const hasSendVerb = /\b(gonder|yolla|ilet|paylas)\w*/.test(n) || /gondersene|atsana/.test(n);
    const hasPronoun = /\b(onu|bunu|sunu|onlari|hepsini|digerini|oburu|oburunu)\b/.test(n);
    const hasDocWord = /muhtasar|muhsgk|stopaj|kdv|beyan|tahakkuk|fatura|gecici|damga|kurumlar|gelir|poset|belge|pdf|ekstre|evrak/.test(n);
    const hasDaDe = /(^|\s)(da|de)(\s|$)/.test(n);
    // Salt "da/de" veya "bekliyorum" yetmez ("ben de geliyorum" tetiklemesin);
    // gönderme fiili VEYA zamir VEYA (da/de + belge kelimesi) gerekli.
    return hasSendVerb || hasPronoun || (hasDaDe && hasDocWord);
  }

  /** AI'nın döndürdüğü tek beyan tipini, BeyanKaydi sorgusu için eşanlamlı listeye çevirir. */
  private beyanTipiToList(t?: string | null): string[] | null {
    const v = String(t || '').toUpperCase().trim();
    if (!v) return null;
    const map: Record<string, string[]> = {
      KDV: ['KDV1', 'KDV2', 'KDV'], KDV1: ['KDV1'], KDV2: ['KDV2'],
      MUHSGK: ['MUHSGK'], MUHTASAR: ['MUHSGK'],
      KGECICI: ['KGECICI'], GGECICI: ['GGECICI'],
      GECICI: ['KGECICI', 'GGECICI', 'GECICI_VERGI', 'GECICI'],
      KURUMLAR: ['KURUMLAR'], GELIR: ['GELIR'], DAMGA: ['DAMGA'], POSET: ['POSET'],
    };
    return map[v] || [v];
  }

  /**
   * Owner belge isteğini AI ile anlar — kelime/çekim/yazım hatasından bağımsız,
   * konuşma bağlamlı, mükellef TÜRÜNE göre (şirket→Kurum geçici). SADECE JSON ister.
   * isDocumentSend=false → belge isteği değil (sohbete bırak). Hata/kapalı → null (regex'e düş).
   * Kapatma: MOREN_OWNER_DOC_AI=0.
   */
  private async extractOwnerDocIntentViaAI(
    tenantId: string,
    ownerContactId: string,
    recentCtx: { taxpayer: any | null; donem: string | null },
    msg: IncomingWhatsAppMessage,
  ): Promise<{ isDocumentSend: boolean; taxpayer: any | null; tipler: string[] | null; donem: string | null } | null> {
    if (process.env.MOREN_OWNER_DOC_AI === '0') return null;
    const taxpayers = await this.prisma.taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, companyName: true, firstName: true, lastName: true, type: true },
      take: 1500,
    });
    if (!taxpayers.length) return null;
    const liste = taxpayers.map((t) => {
      const ad = (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`).trim();
      const tur = (t as any).type === 'TUZEL_KISI' ? 'sirket(kurum)' : 'gercek kisi';
      return `id=${t.id}|${ad}|${tur}`;
    }).join('\n').slice(0, 14000);

    const logs = await this.prisma.communicationLog.findMany({
      where: { taxpayerId: ownerContactId, channel: 'WHATSAPP' },
      orderBy: { occurredAt: 'desc' }, take: 8,
      select: { subject: true, content: true },
    });
    const konusma = logs.reverse().map((l) => {
      const who = /gelen/i.test(l.subject || '') ? 'Patron' : 'Bot';
      const t = String(l.content || '').replace(/\[\[[^\]]*\]\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
      return t ? `${who}: ${t}` : '';
    }).filter(Boolean).join('\n');

    const system = 'Bir mali musavirlik ofisi asistanisin. Patron WhatsApp\'tan yazdi. Gorevin: mesajin bir BELGE/BEYANNAME GONDERME istegi olup olmadigini ve hangi mukellef + beyan tipi + donem oldugunu cikarmak. SADECE tek satir JSON dondur, baska hicbir sey yazma.';
    const prompt = [
      `Patronun yeni mesaji: "${String(msg.text || '').slice(0, 400)}"`,
      konusma ? `\nSon konusma (eski->yeni):\n${konusma}` : '',
      `\nMukellefler (id|ad|tur):\n${liste}`,
      '\nBeyan tipleri: KDV1, KDV2, MUHSGK(muhtasar/SGK prim), KGECICI(kurum gecici), GGECICI(gelir gecici), KURUMLAR, GELIR, DAMGA, POSET.',
      'Kurallar:',
      '- "gecici/gecici vergi": mukellef sirket(kurum) ise KGECICI, gercek kisi ise GGECICI.',
      '- "muhtasar/sgk/prim"=MUHSGK. "kdv"=KDV1.',
      recentCtx.taxpayer
        ? `- ÖNEMLİ: En son işlem yapılan mükellef = id=${recentCtx.taxpayer.id} (${(recentCtx.taxpayer.companyName || `${recentCtx.taxpayer.firstName || ''} ${recentCtx.taxpayer.lastName || ''}`).trim()}). Mesajda BAŞKA mükellef adı AÇIKÇA geçmiyorsa ("tahakkukunu da gönder","onu da yolla","muhtasarini da") taxpayerId olarak KESİNLİKLE BUNU ver, başka mükellefe atlama.`
        : '- Mesajda mukellef adi yoksa SON konusulan mukellefi kullan.',
      `- Donem: "nisan 2026"->2026-04, "2026 1.donem/ceyrek"->2026-Q1; yoksa son konusulan donem${recentCtx.donem ? ` (=${recentCtx.donem})` : ''}; o da yoksa null.`,
      '- Yazim hatasi/cekim onemsiz. Belge/dosya gonderme istegi DEGILSE (selam, soru, sohbet) isDocumentSend=false.',
      '\nSADECE su JSON: {"isDocumentSend":true|false,"taxpayerId":"<id|null>","beyanTipi":"<TIP|null>","donem":"<YYYY-MM|YYYY-Qn|null>"}',
    ].filter(Boolean).join('\n');

    const res = await claudeTextViaMax({ prompt, system, model: MAX_MODEL_CHEAP, maxTurns: 1, timeoutMs: 20000 });
    if (!res?.ok || !res.text) return null;
    const jsonMatch = res.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    let parsed: any;
    try { parsed = JSON.parse(jsonMatch[0]); } catch { return null; }
    if (parsed?.isDocumentSend !== true) {
      return { isDocumentSend: false, taxpayer: null, tipler: null, donem: null };
    }
    const taxpayer = parsed.taxpayerId
      ? (taxpayers.find((t) => t.id === String(parsed.taxpayerId)) || null)
      : (recentCtx.taxpayer || null);
    const tipler = this.beyanTipiToList(parsed.beyanTipi);
    const donem = parsed.donem && /^\d{4}-(\d{2}|Q[1-4])$/i.test(String(parsed.donem))
      ? String(parsed.donem)
      : (recentCtx.donem || null);
    this.logger.log(`[OwnerDocSend] AI niyet: send=${parsed.isDocumentSend} tp=${taxpayer ? (taxpayer.companyName || taxpayer.firstName || taxpayer.id) : 'yok'} tip=${parsed.beyanTipi} donem=${donem}`);
    return { isDocumentSend: true, taxpayer, tipler, donem };
  }

  /** Mesajdan dönem çıkar: "YYYY-MM" ya da ay adı (+yıl, yoksa cari yıl). */
  private extractPeriodFromOwnerText(text: string): string | null {
    const direct = String(text || '').match(/\b(20\d{2})[-/.](0[1-9]|1[0-2])\b/);
    if (direct) return `${direct[1]}-${direct[2]}`;
    const n = this.normalizeForIntent(text);
    const aylar: Record<string, number> = {
      ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6,
      temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
    };
    for (const [ad, no] of Object.entries(aylar)) {
      if (n.includes(ad)) {
        const yilM = n.match(/\b(20\d{2})\b/);
        const yil = yilM ? Number(yilM[1]) : new Date().getFullYear();
        return `${yil}-${String(no).padStart(2, '0')}`;
      }
    }
    return null;
  }

  /** Mesajda açıkça geçen beyan tipini grup olarak çıkar (yoksa null = hepsi). */
  private inferBeyanTipiFromOwnerText(text: string): string[] | null {
    const n = this.normalizeForIntent(text);
    if (/\bkdv\b|katma deger/.test(n)) return ['KDV1', 'KDV2', 'KDV'];
    if (/muhtasar|muhsgk|stopaj/.test(n)) return ['MUHSGK'];
    if (/damga/.test(n)) return ['DAMGA'];
    if (/kurumlar/.test(n)) return ['KURUMLAR'];
    if (/gecici/.test(n)) return ['GGECICI', 'KGECICI', 'GECICI_VERGI', 'GECICI'];
    if (/poset/.test(n)) return ['POSET'];
    if (/gelir vergisi/.test(n)) return ['GELIR'];
    return null;
  }

  /**
   * "Evrakı gelen/işlenen/kontrol edilen/beyannamesi verilebilecek/evrak bekleyen KİMLER
   * var" gibi TOPLU DURUM sorularını — AI'ya bırakmadan — aylık durum kayıtlarından
   * DETERMİNİSTİK yanıtlar. AI bu sorularda sürekli "çekemiyorum/Luca'ya bağlantım yok"
   * halüsinasyonu yapıyordu. Dönem = BEYANNAME dönemi (işlem ayı−1); kayıtlar işlem ayında.
   */
  private detectOwnerStatusIntent(text: string):
    | 'beyanname_hazir' | 'kontrol_bekleyen' | 'evrak_islenen' | 'evrak_gelen'
    | 'evrak_bekleyen' | 'islem_bekleyen' | 'verildi' | 'verilmedi' | null {
    const n = this.normalizeForIntent(text); // aksan sıyrılmış (ş→s, ı→i, ç→c ...)
    const isList = /\b(kim|kimler|kac|listele|hangi|kimlerin|olanlar)\b/.test(n) || /\bvar m[ıi]\b/.test(n);
    if (!isList) return null;

    // ── ÖNCE OLUMSUZ / BEKLEYEN kalıplar (en spesifik; olumlu kalıplardan ÖNCE
    //    değerlendirilmeli, yoksa "edilmemiş" gibi olumsuzlar olumluya sızar). ──
    // KONTROL bekleyen / edilmemiş / edilecek / yapılmamış → portal "kontrol-bekliyor"
    if (/kontrol[^.]*?(bekle|edilmed|edilmemis|edilmeyen|edilecek|edilmeli|edilsin|yapilmad|yapilmamis|yapilacak|yapilmali|bitmemis|bitmedi|gecmemis|gecmedi|olmamis|olmadi)/.test(n)) return 'kontrol_bekleyen';
    // BEYANNAME verilmeyen / verilmedi / geciken / eksik → portal "beyanname-verilmedi" (aşama != verildi)
    if (/(beyanname|beyan)[^.]*?(verilmed|verilmeyen|verilmemis|vermedi|vermeyen|vermemis|gecik|eksik|kalan)/.test(n)) return 'verilmedi';
    // EVRAK gelmeyen / gelmedi / bekleyen → portal "evrak-bekliyor". (evrag: "evrağı" ğ→g)
    if (/(evrak|evrag|belge)[^.]*?(bekle|gelmedi|gelmemis|gelmeyen|gelmiyen|yok)/.test(n)) return 'evrak_bekleyen';
    // İŞLEM bekleyen / işlenmeyen / işlenmemiş → portal "islem-bekliyor"
    if (/islenmemis|islenmeyen|islenmedi|henuz islen|(islem|islenme)[^.]*?(bekle|memis|meyen|medi)/.test(n)) return 'islem_bekleyen';

    // ── OLUMLU kalıplar ──
    // Beyanname verilebilecek / hazır + "kontrol edilen/biten/yapılan" → portal "beyan-hazir"
    if (/(beyanname|beyan)[^.]*?(verilebil|verilecek|verilir|hazir)|kontrol[^.]*?(edilen|edildi|biten|bitti|bitmis|yapilan|yapildi|yapilmis|gecen|gecti|gecmis|gecirildi|tamamlan)|kontrolden gec/.test(n)) return 'beyanname_hazir';
    // Beyanname verilen / verildi → portal "verildi"
    if (/(beyanname|beyan)[^.]*?(verildi|verilen|verilmis|gonderildi|tamamlan)/.test(n)) return 'verildi';
    // Evrakı gelip işlenen → evrak+işlem ✓
    if (/(evrak|evrag|belge)[^.]*?islen|gelip[^.]*?islen|islenip|islenen|islenmis/.test(n)) return 'evrak_islenen';
    // Evrakı gelen (sade; olumsuzlar zaten yukarıda elendi) → evrak geldi
    if (/(evrak|evrag|belge)[^.]*?(gel(en|di|mis)|teslim|getir)/.test(n)) return 'evrak_gelen';
    return null;
  }

  /**
   * Owner durum listesi ŞABLONU: başlık + dönem/sayı + her firma AYRI SATIR (numaralı).
   * Eskiden virgüllü tek satır düz metindi; kullanıcı alt alta okunaklı liste istedi.
   */
  private formatOwnerStatusList(baslik: string, donemLabel: string, names: string[]): string {
    if (!names.length) {
      return `📋 ${baslik}\n🗓️ ${donemLabel} dönemi\n\nBu durumda mükellef yok.`;
    }
    const gosterilecek = names.slice(0, 60);
    const satirlar = gosterilecek.map((ad, i) => `${i + 1}. ${ad}`).join('\n');
    const fazla = names.length > 60 ? `\n… ve ${names.length - 60} mükellef daha.` : '';
    return `📋 ${baslik}\n🗓️ ${donemLabel} dönemi · ${names.length} mükellef\n\n${satirlar}${fazla}`;
  }

  private async maybeHandleOwnerStatusQuery(
    ownerTenant: any,
    ownerContactId: string,
    msg: IncomingWhatsAppMessage,
  ): Promise<boolean> {
    const intent = this.detectOwnerStatusIntent(msg.text || '');
    if (!intent) return false;
    // Kayıtlar İŞLEM ayında (bu ay) tutulur; owner'a-dönük dönem = BEYANNAME dönemi (bu ay−1).
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const prev = new Date(year, month - 2, 1);
    const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    const donemLabel = `${aylar[prev.getMonth()]} ${prev.getFullYear()}`;
    const taxpayers = await this.prisma.taxpayer.findMany({
      where: { tenantId: ownerTenant.id, isActive: true },
      select: {
        id: true, companyName: true, firstName: true, lastName: true,
        monthlyStatuses: {
          where: { year, month },
          select: {
            evraklarGeldi: true, evraklarIslendi: true, beyannameVerildi: true,
            // "Kontrol bitti" = portaldaki deriveStage ile AYNI: İND+HES+ARŞİV üçü de ✓.
            indirilecekKdvKontrol: true, hesaplananKdvKontrol: true, eArsivKontrol: true,
          },
          take: 1,
        },
      },
      orderBy: [{ companyName: 'asc' }, { firstName: 'asc' }],
    });
    const rows = taxpayers.map((t) => {
      const s = (t as any).monthlyStatuses?.[0] || null;
      const ad = (t.companyName || `${t.firstName || ''} ${t.lastName || ''}`).trim() || 'Mükellef';
      const kontrolBitti = !!(s?.indirilecekKdvKontrol && s?.hesaplananKdvKontrol && s?.eArsivKontrol);
      return {
        isim: ad,
        evrakGeldi: s?.evraklarGeldi ?? false,
        islendi: s?.evraklarIslendi ?? false,
        kontrolBitti,
        verildi: s?.beyannameVerildi ?? false,
      };
    });
    let filtered: typeof rows;
    let baslik: string;
    switch (intent) {
      case 'beyanname_hazir':
        // Portaldaki "Beyanname verilebilir" ile AYNI: evrak gelmiş + işlenmiş + kontrol
        // bitmiş (İND+HES+ARŞİV) + henüz verilmemiş.
        filtered = rows.filter((r) => r.evrakGeldi && r.islendi && r.kontrolBitti && !r.verildi);
        baslik = 'Beyannamesi verilebilecek (kontrolü bitmiş, henüz verilmemiş)';
        break;
      case 'kontrol_bekleyen':
        // Portal "kontrol-bekliyor": evrak gelmiş + işlenmiş AMA kontrol (İND/HES/ARŞİV)
        // henüz bitmemiş, beyanname verilmemiş.
        filtered = rows.filter((r) => r.evrakGeldi && r.islendi && !r.kontrolBitti && !r.verildi);
        baslik = 'Kontrol bekleyen (evrak işlendi, kontrol edilmemiş)';
        break;
      case 'evrak_islenen':
        filtered = rows.filter((r) => r.evrakGeldi && r.islendi);
        baslik = 'Evrakı gelip işlenen';
        break;
      case 'evrak_gelen':
        filtered = rows.filter((r) => r.evrakGeldi);
        baslik = 'Evrakı gelen';
        break;
      case 'evrak_bekleyen':
        filtered = rows.filter((r) => !r.evrakGeldi);
        baslik = 'Evrak bekleyen (henüz gelmedi)';
        break;
      case 'islem_bekleyen':
        filtered = rows.filter((r) => r.evrakGeldi && !r.islendi);
        baslik = 'Evrakı gelip henüz işlenmemiş';
        break;
      case 'verildi':
        filtered = rows.filter((r) => r.verildi);
        baslik = 'Beyannamesi verilmiş';
        break;
      case 'verilmedi':
        // Portal "beyanname-verilmedi": aşama != verildi (henüz verilmemiş hepsi).
        filtered = rows.filter((r) => !r.verildi);
        baslik = 'Beyannamesi henüz verilmemiş';
        break;
      default:
        return false;
    }
    const names = filtered.map((r) => r.isim);
    const reply = this.formatOwnerStatusList(baslik, donemLabel, names);
    const sent = await this.whatsapp.sendMessage(this.replyTarget(msg), reply, ownerTenant.id);
    await this.prisma.communicationLog.create({
      data: {
        taxpayerId: ownerContactId, channel: 'WHATSAPP',
        subject: sent ? 'WhatsApp owner durum cevabi' : 'WhatsApp owner durum cevabi (gonderilemedi)',
        content: this.withWhatsAppPhone(reply, msg.from), occurredAt: new Date(),
      },
    });
    this.logger.log(`[OwnerStatus] intent=${intent} donem=${donemLabel} sonuc=${names.length}`);
    return true;
  }

  /**
   * Owner belge gönderme akışı. handled=true dönerse normal AI akışı atlanır.
   * Mükellef bulunamazsa false döner → AI cevaplasın (yanlış yakalama olmasın).
   */
  private async maybeHandleOwnerDocumentSend(
    ownerTenant: any,
    ownerContactId: string,
    msg: IncomingWhatsAppMessage,
  ): Promise<boolean> {
    if (!this.storage) return false;

    // GATE (gevşek): bu mesaj belge gönderme OLABİLİR mi? Kelime VEYA son konuşma
    // belge-bağlamlı + devam ifadesi. Gate sadece "AI'ya danışayım mı" kararı;
    // asıl HANGİ MÜKELLEF/TİP/DÖNEM'i AI çözer — kelimeye/çekime bağımlı değil.
    const recentCtx = await this.findRecentOwnerDocContext(ownerTenant.id, ownerContactId);
    const gate = this.isOwnerDocumentSendRequest(msg.text)
      || (!!recentCtx.taxpayer && this.looksLikeFollowUpSend(msg.text));
    if (!gate) return false;

    // AI ANLAMA: ne yazılırsa yazılsın hangi mükellef + beyan tipi + dönem (mükellef
    // TÜRÜ dahil: şirket→Kurum geçici, gerçek kişi→Gelir geçici). Başarısız/kararsızsa
    // eski regex çıkarımına düşer (çalışan durumlar korunur).
    let taxpayer: any = null;
    let tipler: string[] | null = null;
    let donem: string | null = null;
    const ai = await this.extractOwnerDocIntentViaAI(ownerTenant.id, ownerContactId, recentCtx, msg)
      .catch((e: any) => { this.logger.warn(`[OwnerDocSend] AI niyet hatasi: ${e?.message || e}`); return null; });
    if (ai && ai.isDocumentSend === false) return false; // AI: belge isteği değil → sohbete bırak
    if (ai?.isDocumentSend && ai.taxpayer) {
      taxpayer = ai.taxpayer; tipler = ai.tipler; donem = ai.donem;
    } else {
      // AI yok/kararsız → eski regex (çalışan durumlar bozulmasın).
      taxpayer = (await this.findTaxpayerInOwnerText(ownerTenant.id, msg.text)) || recentCtx.taxpayer;
      tipler = this.inferBeyanTipiFromOwnerText(msg.text);
      donem = this.extractPeriodFromOwnerText(msg.text) || recentCtx.donem;
    }
    if (!taxpayer) return false; // mükellef çözülemedi → AI'ya bırak

    const adi = (taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`).trim();
    const n = this.normalizeForIntent(msg.text);
    const wantsBeyanname = !!(tipler && tipler.length) || /beyan|tahakkuk|muhtasar|muhsgk|kdv|gecici|damga|kurumlar|gelir|poset|stopaj/.test(n);

    const sendOwnerText = async (reply: string) => {
      const sent = await this.whatsapp.sendMessage(this.replyTarget(msg), reply, ownerTenant.id);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: ownerContactId, channel: 'WHATSAPP',
          subject: sent ? 'WhatsApp owner belge cevabi' : 'WhatsApp owner belge cevabi (gonderilemedi)',
          content: this.withWhatsAppPhone(reply, msg.from), occurredAt: new Date(),
        },
      });
    };

    // Ortak gönderim: presigned URL + sendMedia + log.
    const sendDoc = async (s3Key: string, mimeType: string, filename: string, caption: string, markerDonem = ''): Promise<boolean> => {
      try {
        const url = await this.storage!.getPresignedDownloadUrl(s3Key, filename);
        const ok = await this.baileys.sendMedia(ownerTenant.id, this.replyTarget(msg), { url, mimeType, filename, caption });
        // KESİN bağlam işareti: hangi mükellef + dönem için belge gittiğini gizli yaz.
        // "Tahakkukunu da gönder" gibi isimsiz devam isteğinde bulanık isim eşleştirme
        // (ortak "TAŞIMACILIK" kelimesi → yanlış mükellef) yerine bu kesin id kullanılır.
        const ctxMarker = `[[doc_ctx:${taxpayer.id}|${markerDonem || ''}]]`;
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: ownerContactId, channel: 'WHATSAPP',
            subject: ok ? 'WhatsApp owner belge gonderildi' : 'WhatsApp owner belge gonderilemedi',
            content: this.withWhatsAppPhone(`[BELGE] ${caption} ${ctxMarker}`, msg.from), occurredAt: new Date(),
          },
        });
        if (!ok) await sendOwnerText(`${caption} dosyasını göndermeye çalıştım ama WhatsApp iletmedi; biraz sonra tekrar dene.`);
        return ok;
      } catch (e: any) {
        this.logger.warn(`[OwnerDocSend] gonderim hatasi: ${e?.message || e}`);
        await sendOwnerText(`${caption} dosyasını gönderirken bir sorun oldu; kaydı kontrol edip tekrar deneyeyim.`);
        return false;
      }
    };

    // A) BEYANNAME — beyan tipi/“beyanname/tahakkuk” geçiyorsa önce BeyanKaydi PDF.
    if (wantsBeyanname) {
      const baseWhere: any = { tenantId: ownerTenant.id, taxpayerId: taxpayer.id };
      if (tipler?.length) baseWhere.beyanTipi = { in: tipler };
      // Önce tam dönemle dene; bulamazsan dönemsiz tara (geçici çeyrek "2026-Q1" gibi
      // format farkı / dönem yokluğu durumunda yıla göre ya da en yeni PDF'li kayda düş).
      let withDoc: any = null;
      if (donem && /^\d{4}-\d{2}$/.test(donem)) {
        const k1 = await (this.prisma as any).beyanKaydi.findMany({ where: { ...baseWhere, donem }, orderBy: [{ donem: 'desc' }], take: 6 });
        withDoc = k1.find((k: any) => k.beyannameUrl || k.pdfUrl);
      }
      if (!withDoc) {
        const k2 = await (this.prisma as any).beyanKaydi.findMany({ where: baseWhere, orderBy: [{ donem: 'desc' }], take: 12 });
        const yil = String(donem || '').slice(0, 4);
        withDoc = (yil ? k2.find((k: any) => (k.beyannameUrl || k.pdfUrl) && String(k.donem || '').startsWith(yil)) : null)
          || k2.find((k: any) => k.beyannameUrl || k.pdfUrl);
      }
      if (withDoc) {
        const key = withDoc.beyannameUrl || withDoc.pdfUrl;
        await sendDoc(key, 'application/pdf',
          `${adi}-${withDoc.beyanTipi}-${withDoc.donem}.pdf`.replace(/[^\w.-]+/g, '_'),
          `${adi} · ${this.beyanLabel(withDoc.beyanTipi)} · ${withDoc.donem}`,
          String(withDoc.donem || ''));
        return true;
      }
      // Beyanname PDF yok → mükellefin yüklü belgelerine (Document) düş.
    }

    // B) DOCUMENT — mükellef kartına yüklü her tür belge (evrak/fatura/sözleşme/dosya).
    const kategori = this.inferDocCategory(msg.text);
    const docWhere: any = { taxpayerId: taxpayer.id, isDeleted: false };
    if (kategori) docWhere.category = kategori;
    let docs = await this.prisma.document.findMany({
      where: docWhere,
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true, title: true, category: true, mimeType: true, s3Key: true },
    });

    // Başlık anahtar kelimeleriyle daralt (birden çok belge varsa).
    const keys = this.docTitleKeywords(msg.text, adi);
    if (keys.length && docs.length > 1) {
      const filtered = docs.filter((d) => { const t = this.normalizeForIntent(d.title); return keys.some((k) => t.includes(k)); });
      if (filtered.length) docs = filtered;
    }

    if (docs.length === 1) {
      const d = docs[0];
      await sendDoc(d.s3Key, d.mimeType, this.docFilename(d), `${adi} · ${d.title}`);
      return true;
    }
    if (docs.length > 1) {
      const liste = docs.slice(0, 6).map((d, i) => `${i + 1}. ${d.title}${d.category && d.category !== 'DIGER' ? ` (${d.category.toLowerCase()})` : ''}`).join('\n');
      await sendOwnerText(`${adi} için ${docs.length} belge var, hangisini göndereyim?\n${liste}\nİsmini yazarsan onu yollarım.`);
      return true;
    }

    // C) Hiçbir belge yok.
    if (wantsBeyanname) {
      await sendOwnerText(`${adi} için ${donem ? donem + ' ' : ''}${tipler ? this.beyanLabel(tipler[0]) + ' ' : ''}beyanname PDF'i bulamadım. Mükellef kartına yüklü bir belge de yok.`);
    } else {
      await sendOwnerText(`${adi} için gönderebileceğim kayıtlı belge bulamadım.`);
    }
    return true;
  }

  private beyanLabel(tip: string): string {
    const map: Record<string, string> = {
      KDV1: 'KDV1', KDV2: 'KDV2', MUHSGK: 'MUHSGK', DAMGA: 'Damga', POSET: 'Poşet',
      KURUMLAR: 'Kurumlar', GELIR: 'Gelir', GGECICI: 'Gelir Geçici', KGECICI: 'Kurum Geçici',
      GECICI_VERGI: 'Geçici Vergi', BILDIRGE: 'Bildirge', EDEFTER: 'E-Defter',
    };
    return map[String(tip || '').toUpperCase()] || tip;
  }

  private repairOwnerReply(reply: string, ownerTenant: any): string {
    const normalized = this.normalizeForIntent(reply);
    if (
      normalized.includes('sistemde henuz tanimli degilsiniz')
      || normalized.includes('sizi taniyabilmem icin')
      || normalized.includes('adinizi ya da vergi numaranizi')
      || normalized.includes('adiniz veya firma unvaniniz')
    ) {
      return this.ownerIdentityReply(ownerTenant);
    }
    if (
      /su an.*cevap.*uretemedim/.test(normalized)
      || /birazdan tekrar.*dener/.test(normalized)
      || /claude max|agent sdk|max baglanti|max yanit|ucretli api|api hatti kapali/.test(normalized)
    ) {
      return 'Mesajini aldim. AI baglantisi anlik yavasladi; teknik hata metni gondermeden yeniden deneyecegim. Birazdan tekrar yazarsan kaldigimiz yerden cevaplayacagim.';
    }
    return reply;
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
        OWNER_PORTAL_NAME,
      );
      const incomingContent = await this.contentWithSavedMedia(ownerTenant.id, ownerContact.id, msg);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: ownerContact.id,
          channel: 'WHATSAPP',
          subject: 'WhatsApp owner gelen mesaj',
          content: this.withWhatsAppMeta(incomingContent, msg),
          occurredAt: new Date(),
        },
      });
      this.refreshTaxpayerMemory(ownerTenant.id, ownerContact.id);

      if (!this.ownerAutoReplyEnabled()) {
        this.logger.log(`[Owner botu kapali] owner mesaji kaydedildi, otomatik cevap atlanadi: ${this.normalize(msg.from)}`);
        return;
      }

      if (this.isOwnerIdentityQuestion(msg.text)) {
        const reply = this.ownerIdentityReply(ownerTenant);
        const sent = await this.whatsapp.sendMessage(this.replyTarget(msg), reply, ownerTenant.id);
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: ownerContact.id,
            channel: 'WHATSAPP',
            subject: sent ? 'WhatsApp owner kimlik cevabi' : 'WhatsApp owner kimlik cevabi (gonderilemedi - master switch veya hata)',
            content: this.withWhatsAppPhone(reply, msg.from),
            occurredAt: new Date(),
          },
        });
        this.refreshTaxpayerMemory(ownerTenant.id, ownerContact.id);
        return;
      }

      // DURUM LİSTESİ (deterministik): "evrakı gelen/işlenen/kontrol edilen/beyannamesi
      // verilebilecek/evrak bekleyen KİMLER var" → AI'ya BIRAKMA (sürekli "çekemiyorum"
      // halüsinasyonu yapıyordu); aylık durumdan listeyi doğrudan kod hesaplayıp döndür.
      if (await this.maybeHandleOwnerStatusQuery(ownerTenant, ownerContact.id, msg)) {
        return;
      }

      // FAZ 2 — BELGE GÖNDERME: owner "X beyannamesini/faturasını gönder" derse
      // PDF'i bulup WhatsApp'tan owner'a yolla (kendi belgesi → onay gerekmez).
      if (await this.maybeHandleOwnerDocumentSend(ownerTenant, ownerContact.id, msg)) {
        return;
      }

      const recentContext = await this.botContext.buildRecentWhatsAppContext(ownerContact.id);
      const ownerName = this.ownerDisplayName();
      const officeName = ownerTenant.name || OFFICE_NAME;
      const prompt = [
        `KIMLIK: Karsindaki kisi ${ownerName}. ${officeName} sahibi ve owner WhatsApp hattindan yaziyor.`,
        'ASLA "sistemde tanimli degilsiniz", "adinizi/vergi numaranizi yazin", "sizi taniyabilmem icin" deme. Bu kisi musteri degil, ofis sahibi.',
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
        '5) Selamlama mesajına (selam, merhaba, kolay gelsin, sağ ol) SICAK ve PROFESYONEL karşılık ver + yardım teklif et, 1 cümle. Örnek: "Merhaba, buyurun; bugün nasıl yardımcı olabilirim?". ASLA "ne var?", "ne lazım?", "ne istiyorsun?", "nedir bu son haberler?" gibi laubali/savsaklayan/küstah ifade kullanma — karşındaki ofisin SAHİBİ, ona saygılı ve nazik bir asistan gibi konuş.',
        '6) Sana gereken portal verisini SİSTEM önceden hazırlar; sen SADECE sonucu yaz. ASLA bir araç/tool/fonksiyon ADI yazma; ASLA "get_xxx çağırıyorum/çağıracağım", "X aracını/tool\'unu kullanıyorum", "şimdi çekiyorum/sorguluyorum/bakıyorum" gibi iç adım ANLATMA. Veri elinde yoksa "elimde ... kaydı yok / eksik" de — uydurma.',
        '7) Riskli işlemlerde önce preview + ONAYLIYORUM bekle.',
        '8) BELGE GÖNDERME aktiftir (beyanname/tahakkuk PDF + mükellef kartına yüklü tüm evrak/fatura/sözleşme/dosyalar) ve sistem otomatik yapar. Bu mesaja kadar geldiysen mükellef NET DEĞİL demektir — kısaca "hangi mükellefin hangi belgesini göndereyim?" diye SOR. DİKKAT: belge gönderimini SADECE sistem yapar, sen DEĞİL. Bu yüzden "gönderiyorum / gönderiliyor / gönderecektim / yolluyorum / şimdi atıyorum / tekrar deniyorum / birazdan düşer / sistem aksaklığı oldu" gibi YAPMADIĞIN/YAPAMAYACAĞIN eylem cümlelerini ASLA kurma (geçmiş, şimdiki, gelecek hiçbir zaman). Eğer belge gerçekten gönderildiyse zaten ayrı bir [BELGE] mesajı düşer; senin görevin sadece NETLEŞTİRİCİ soru sormak ya da bilgi vermek.',
        '9) "Gönder" = belgeyi BİRİNE ilet demektir; "GİB\'e gönder/beyan ver" SANMA. Owner GİB\'e beyan vermeni istemez. Beyanname zaten verildiyse onu "GİB\'e gönderiyorum" diye KARIŞTIRMA.',
        '10) Mesajda hangi beyan tipi sorulduysa SADECE onu konuş. "KDV" sorulduysa MUHSGK/Damga ekleme; "MUHSGK" sorulduysa KDV ekleme.',
        '11) NE YAPABİLİRSİN: (a) Portal verisini sorgulayıp anlatmak (mizan, KDV, beyanname durumu, borç, fatura, mükellef bilgisi, sistem sağlığı). (b) Belge/PDF göndermek (sistem otomatik yapar). BUNLARI rahatça yap. NE YAPAMAZSIN (WhatsApp\'tan): Luca/ajan çalıştırma-başlatma-durdurma, hatırlatma/SMS/mesaj gönderme, beyanname verme, ayar değiştirme gibi İŞLEM BAŞLATMA. Böyle bir komutta ASLA "başlattım/başlatıyorum/gönderdim/yaptım/kuyruğa aldım" deme — bunun yerine DÜRÜSTÇE: "Bu işlemi WhatsApp üzerinden başlatamıyorum; portaldan (ilgili modülden) yapabilirsiniz. İstersen durumu buradan kontrol edip anlatabilirim." de.',
        '12) DÖNEM: Evrak/işlem/aylık-takip durumundan bahsederken DÖNEM = BEYANNAME dönemidir (tool sonucundaki "beyannameDonem"), İŞLEM ayı DEĞİL. Mayıs ayının faturaları Haziran\'da işlenir; "Haziran\'da evrak geldi/işlendi" DEME, "Mayıs dönemi evrakı" de. Tool "donemNotu" verirse ona uy.',
        '',
        'MALİ TABLO ANALİZİ (gelir tablosu / bilanço / mizan / KDV): düz metin paragraf DEĞİL — kalemleri ALT ALTA yaz, emoji bölüm başlığı (💰 KALEMLER, 📊 YORUM), Türk sayı formatı (1.234.567,89 ₺), sonda 1-2 madde kısa yorum. Tek kalem sorulduysa (örn. net kâr) tek satır cevap ver.',
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
      // İşlem boyunca "yazıyor…" göster (owner 10-20 sn boş ekrana bakmasın).
      const stopOwnerTyping = this.startTypingIndicator(ownerTenant.id, this.replyTarget(msg));
      let answer: any;
      try {
        // Owner WhatsApp → ÇALIŞAN AJAN köprüsü.
        // Ajan model yönlendirme (kritik→Opus 4.8, diğer→Sonnet) + öğrenme uygular,
        // cevabı mevcut TOOL'LU MorenAI beyninden üretir (mizan/KDV/beyan sorgu korunur).
        answer = await this.calisan.runViaMorenAi({
          tenantId: ownerTenant.id,
          conversationId,
          message: prompt,
          originalMessage: msg.text,
          source: 'calisan-whatsapp',
        });
      } catch (err: any) {
        stopOwnerTyping();
        this.logger.warn(`Owner AI cevabi uretilemedi (fetch hatasi?): ${err?.message || err}`);
        const fallbackText = 'Mesajini aldim. AI baglantisi anlik yavasladi; teknik hata metni gondermeden yeniden deneyecegim. Birazdan tekrar yazarsan kaldigimiz yerden cevaplayacagim.';
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
      stopOwnerTyping();
      // Owner uzun yapılandırılmış brifing/rapor isteyebilir (compactFinalAnswer 3200'e
      // izin veriyor, post-filter 3500); burada 1400'de kesmek raporu yarıda bırakıyordu.
      const rawReply = (answer?.assistantMessage || '').slice(0, 3500);
      // Owner için de post-filter uygula — iç monolog/markdown temizle
      const reply = this.repairOwnerReply(
        this.postFilter.filterTaxpayerReply(rawReply, { mode: 'owner' }),
        ownerTenant,
      );
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
        // Owner cevabı da KALİTE DENETİMİNE alınır (Bot Kalite'de görünür) — async,
        // gönderim sonrası, owner-modu (uzunluk/emoji cezası yok; yalan/çelişki/sahte-eylem/
        // robotik denetimi var). Owner=patron olduğu için müşteri-tonlu öğrenme dersi yazılmaz.
        this.asyncQualityAudit({
          tenantId: ownerTenant.id,
          taxpayerId: ownerContact.id,
          conversationId: ownerContact.id,
          intent: 'OWNER',
          customerMessage: msg.text || null,
          recentReplies: [],
          originalReply: rawReply,
          finalReply: reply,
          retryCount: 0,
          fallbackUsed: false,
          localReasons: [],
          ownerMode: true,
        }).catch(() => {});
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
          content: this.withWhatsAppMeta(incomingContent, msg),
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
        // SIRA: önce post-filter (devrik/markdown temizliği), SONRA eval —
        // eval'in GÖNDERİLECEK son metni denetlemesi için.
        const filteredRaw = this.postFilter.filterTaxpayerReply(rawReply, { recentReplies: recentUnknownReplies });
        const reply = await this.qualityGateReply({
          tenantId: tenant.id,
          taxpayerId: contact.id,
          messageId: msg.id || null,
          intent: 'UNKNOWN_CONTACT',
          customerMessage: msg.text,
          reply: filteredRaw,
          recentReplies: recentUnknownReplies,
        });
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
        content: this.withWhatsAppMeta(await this.contentWithSavedMedia(taxpayer.tenantId, taxpayer.id, msg), msg),
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
        const filteredRate = this.postFilter.filterTaxpayerReply('Mesajlariniz alindi; yogunluk nedeniyle konuyu siraya aldik.', { recentReplies });
        const limitedReply = await this.qualityGateReply({
          tenantId: taxpayer.tenantId,
          taxpayerId: taxpayer.id,
          messageId: msg.id || null,
          intent: 'RATE_LIMIT',
          customerMessage: msg.text,
          reply: filteredRate,
          recentReplies,
        });
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
      const filteredGuard = this.postFilter.filterTaxpayerReply(guardedReply, { recentReplies });
      const filteredReply = await this.qualityGateReply({
        tenantId: taxpayer.tenantId,
        taxpayerId: taxpayer.id,
        messageId: msg.id || null,
        intent: classified.intent,
        customerMessage: msg.text,
        reply: filteredGuard,
        recentReplies,
      });
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
      '— SICAK VE DOĞAL, AMA DÜRÜST —',
      `• Sıcak, insan gibi konuş; adın ${BOT_NAME}, ofisten. KİMSE SORMADAN "ben yapay zekayım/dil modeliyim" diye robotik teknik açıklama YAPMA — gereksiz yere kimlik dökme.`,
      `• AMA "bot musun / yapay zeka mısın / gerçek insan mısın" diye DOĞRUDAN sorulursa DÜRÜST ol: "Ofisin dijital asistanıyım, ${BOT_NAME} diye seslenebilirsiniz; size yardımcı olmak için buradayım" gibi nazik+net cevap ver. ASLA "yok, gerçek insanım / gerçekten ${BOT_NAME}'im" diye YALAN SÖYLEME.`,
      '• Teknik jargonu ("dil modeli", "Moren AI") öne çıkarma; "ofisin asistanı" demek yeterli.',
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
      '— VERİYE ERİŞİM —',
      '• Mükellef KENDİ verisini sorarsa TAHMİN ETME, ilgili read-only tool\'u çağır ve GERÇEK rakamı söyle:',
      '  KDV/durum → get_my_kdv · faturalar → get_my_invoices · beyanname durumu → get_my_beyanname · borç/bakiye → get_my_balance.',
      '  Evrak listesi → get_my_documents · genel iş durumu → get_my_work_status.',
      '• taxpayerId/başka mükellef bilgisi GÖNDERME — backend aktif mükellefi kendisi bağlar; mükellef sadece kendi verisini görür.',
      '• BEYANNAME TUTARI: ödenecek/tahakkuk tutarını ASLA söyleme. Beyannamenin verildi/hazır DURUMUNU söyle; tutar sorulursa "müşavirimiz kesinleştirince paylaşır" de.',
      '• Tool veri döndürmezse/boşsa rakam uydurma; "bir bakıp döneyim" tarzı doğal geç.',
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

    // İşlem boyunca "yazıyor…" göster (müşteri 10-20 sn boş ekrana bakmasın).
    // try/finally: AI hata verse bile gösterge mutlaka kapanır.
    const stopCustTyping = this.startTypingIndicator(taxpayer.tenantId, this.replyTarget(msg));
    let reply = '';
    try {
      const answer = await this.morenAi.chat(taxpayer.tenantId, null, {
        taxpayerId: taxpayer.id,
        message: prompt,
        taxpayerText: msg.text, // veri tool prefetch gating'i ham müşteri mesajına bakar
        // voiceMode KAPALI — WhatsApp metin cevabi. Sesli/true olunca max_token 260'a duser
        // ve compactFinalAnswer 220 karakterde keser => cevaplar yarida kalir (sacma/eksik).
        voiceMode: false,
        toolMode: 'taxpayer-readonly',
        source: 'whatsapp-bot',
      });

      const rawAiReply = answer.assistantMessage || '';
      const contextBlock = [taxpayerContext, recentContext].filter(Boolean).join('\n\n');
      // SIRA: önce post-filter, SONRA eval (gönderilecek son metin denetlensin).
      // Retry de aynı sırayı izler: yeni ham cevap → post-filter → tekrar eval.
      const filteredAiReply = this.postFilter.filterTaxpayerReply(rawAiReply, { recentReplies });
      reply = await this.qualityGateReply({
        tenantId: taxpayer.tenantId,
        taxpayerId: taxpayer.id,
        messageId: msg.id || null,
        intent: classified.intent,
        customerMessage: msg.text,
        reply: filteredAiReply,
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
            taxpayerText: msg.text, // veri tool prefetch gating'i ham müşteri mesajına bakar
            voiceMode: false,
            toolMode: 'taxpayer-readonly',
            source: 'whatsapp-bot',
          });
          return this.postFilter.filterTaxpayerReply(retryAnswer.assistantMessage || '', { recentReplies });
        },
      });
    } finally {
      stopCustTyping();
    }
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
    // Max eval ÜCRETSİZ (Max aboneliği, costUsd=0). Kaliteyi yakalamak için
    // varsayılan: HER cevap denetlensin. Latency/throttle sorun olursa
    // MOREN_AI_EVAL_SAMPLE_RATE=0.2 gibi düşürülebilir.
    const sampleRate = Number(process.env.MOREN_AI_EVAL_SAMPLE_RATE || 1);
    if (sampleRate < 1 && Math.random() > sampleRate) {
      return input.reply;
    }
    // HIZ: varsayılan olarak gönderim ÖNCESİ yalnız LOKAL eval (anında, ücretsiz) çalışır;
    // yavaş LLM-yargıç denetimi cevap gönderildikten SONRA arka planda yapılır
    // (kalite logu + öğrenme döngüsü korunur, gecikme hot-path'ten çıkar).
    // Eski davranış (LLM denetimi gönderimden önce + retry): MOREN_AI_EVAL_BLOCKING=1.
    const blockingEval = process.env.MOREN_AI_EVAL_BLOCKING === '1';
    const evalOpts = blockingEval ? undefined : { allowLlm: false };
    const recentReplies = input.recentReplies || [];
    let firstEval = await this.botEval.evaluateReply(
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
      evalOpts,
    );

    // GRİ BÖLGE YÜKSELTMESİ (FAST modda): lokal denetim 6-7 verdiyse cevap şüpheli —
    // gönderim ÖNCESİ tam LLM yargıca sor. Temiz cevaplar (8+) beklemez, akış hızlı
    // kalır; düşükler (<6) zaten retry/fallback'e gidiyor. Saçma ama gramer-temiz
    // cevaplar böylece müşteriye GİTMEDEN yakalanır. Kapatma: MOREN_AI_EVAL_ESCALATE=0.
    if (!blockingEval && process.env.MOREN_AI_EVAL_ESCALATE !== '0'
        && firstEval.score >= 6 && firstEval.score < 8) {
      try {
        const escalated = await this.botEval.evaluateReply(
          input.reply,
          {
            tenantId: input.tenantId,
            taxpayerId: input.taxpayerId || null,
            intent: input.intent || null,
            message: input.customerMessage || null,
            contextBlock: input.contextBlock || null,
            source: 'online-escalation',
          },
          recentReplies,
        );
        if (escalated.score < firstEval.score) firstEval = escalated;
      } catch (err: any) {
        this.logger.warn(`Eval yukseltme hatasi (gonderim engellenmedi): ${err?.message || err}`);
      }
    }

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
          evalOpts,
        );
        reasons = Array.from(new Set([...reasons, ...finalEval.reasons]));
      }
    }

    if (finalEval.score < 6) {
      finalReply = this.botEval.safeFallback();
      fallbackUsed = true;
    }

    // BLOCKING modda LLM-yargıç gönderimden ÖNCE çalıştı → log + öğrenmeyi burada yaz.
    // FAST modda (varsayılan) bu iş async yapılır (aşağıdaki else dalı).
    if (blockingEval) {
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
        customerMessage: input.customerMessage ? String(input.customerMessage).slice(0, 500) : null,
        recentReplyCount: recentReplies.length,
      },
    }).catch((err) => {
      this.logger.warn(`BotQualityLog yazilamadi: ${err?.message || err}`);
    });

    // ÖĞRENME DÖNGÜSÜ: cevap fallback'e düştüyse (en kötü kalite), sebebe göre
    // DEDUP'lu bir ders yaz. agent-scope recall (buildMemoryContext) bunu sonraki
    // cevaplara taşır → bot gün geçtikçe aynı hatayı tekrarlamaz. Title sebebe
    // göre sabit olduğundan AiMemory'yi şişirmez (tek kayıt güncellenir).
    if (fallbackUsed) {
      const reasonKey = String(reasons[0] || 'genel').split(':')[0];
      this.calisan.recordSelfImprovementLesson({
        tenantId: input.tenantId,
        title: `Bot dusuk kaliteli cevap: ${reasonKey}`,
        content: `Intent: ${input.intent || '-'} | Musteri: ${String(input.customerMessage || '').slice(0, 200)} | Reddedilen cevap: ${String(input.reply || '').slice(0, 200)} | Sebepler: ${reasons.join(', ')}\nDers: Bu tip mesajda dogal, kisa (1-2 cumle), devriksiz/akici Turkce yaz; sablon kalip ve uydurma rakam/tarih kullanma.`,
        tags: ['self-improvement', 'whatsapp', 'bot-quality', String(input.intent || 'genel')],
        importance: 3,
      }).catch(() => {});
    }
    } else {
      // FAST MODE: gönderimi geciktirme — final cevabı arka planda TAM LLM denetiminden
      // geçir; kalite logu + (düşük puanda) öğrenme dersi async yazılır. Böylece her
      // cevap yine %100 denetlenir ama kullanıcı LLM-yargıcı beklemez.
      this.asyncQualityAudit({
        tenantId: input.tenantId,
        taxpayerId: input.taxpayerId || null,
        conversationId: input.conversationId || null,
        messageId: input.messageId || null,
        intent: input.intent || null,
        customerMessage: input.customerMessage || null,
        contextBlock: input.contextBlock || null,
        recentReplies,
        originalReply: input.reply,
        finalReply,
        retryCount,
        fallbackUsed,
        localReasons: reasons,
      }).catch(() => undefined);
    }

    return finalReply;
  }

  /**
   * FAST eval modunda: gönderilmiş cevabı arka planda TAM LLM denetiminden geçirir,
   * kalite logunu yazar ve LLM-yargıç düşük puan verirse self-improvement dersi düşer.
   * Gönderim akışını HİÇ bloklamaz (fire-and-forget).
   */
  private async asyncQualityAudit(a: {
    tenantId: string;
    taxpayerId?: string | null;
    conversationId?: string | null;
    messageId?: string | null;
    intent?: string | null;
    customerMessage?: string | null;
    contextBlock?: string | null;
    recentReplies: string[];
    originalReply: string;
    finalReply: string;
    retryCount: number;
    fallbackUsed: boolean;
    localReasons: string[];
    ownerMode?: boolean;
  }): Promise<void> {
    try {
      const ev = await this.botEval.evaluateReply(
        a.finalReply,
        {
          tenantId: a.tenantId,
          taxpayerId: a.taxpayerId || null,
          intent: a.intent || null,
          message: a.customerMessage || null,
          contextBlock: a.contextBlock || null,
          source: a.ownerMode ? 'online-async-owner' : 'online-async',
          ownerMode: a.ownerMode || false,
        },
        a.recentReplies,
      );
      const reasons = Array.from(new Set([...(a.localReasons || []), ...ev.reasons]));
      const status = a.fallbackUsed
        ? 'FALLBACK_USED'
        : a.retryCount > 0
          ? 'RETRY_USED'
          : ev.warning
            ? 'EVAL_WARN'
            : ev.score < 6
              ? 'LOW_SCORE'
              : 'PASSED';
      await this.qualityLog.createLog({
        tenantId: a.tenantId,
        taxpayerId: a.taxpayerId || null,
        conversationId: a.conversationId || a.taxpayerId || null,
        messageId: a.messageId || null,
        source: 'ONLINE_EVAL',
        status,
        score: ev.score,
        intent: a.intent || null,
        reasons,
        originalReply: a.originalReply,
        finalReply: a.finalReply,
        retryCount: a.retryCount,
        fallbackUsed: a.fallbackUsed,
        evalModel: ev.model,
        inputTokens: ev.inputTokens,
        outputTokens: ev.outputTokens,
        costUsd: ev.costUsd,
        metadata: {
          firstScore: ev.score,
          finalScore: ev.score,
          evalWarning: ev.warning || null,
          customerMessage: a.customerMessage ? String(a.customerMessage).slice(0, 500) : null,
          recentReplyCount: a.recentReplies.length,
          async: true,
        },
      }).catch((err) => {
        this.logger.warn(`BotQualityLog (async) yazilamadi: ${err?.message || err}`);
      });

      if ((ev.score < 6 || a.fallbackUsed) && !a.ownerMode) {
        const reasonKey = String(reasons[0] || 'genel').split(':')[0];
        this.calisan.recordSelfImprovementLesson({
          tenantId: a.tenantId,
          title: `Bot dusuk kaliteli cevap: ${reasonKey}`,
          content: `Intent: ${a.intent || '-'} | Musteri: ${String(a.customerMessage || '').slice(0, 200)} | Gonderilen cevap: ${String(a.finalReply || '').slice(0, 200)} | Sebepler: ${reasons.join(', ')}\nDers: Bu tip mesajda dogal, kisa (1-2 cumle), devriksiz/akici Turkce yaz; sablon kalip ve uydurma rakam/tarih kullanma.`,
          tags: ['self-improvement', 'whatsapp', 'bot-quality', String(a.intent || 'genel')],
          importance: 3,
        }).catch(() => {});
      }
    } catch (err: any) {
      this.logger.warn(`asyncQualityAudit hatasi: ${err?.message || err}`);
    }
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
