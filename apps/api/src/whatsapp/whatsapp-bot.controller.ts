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
import { CalisanService } from '../calisan/calisan.service';
import { claudeTextViaMax, MAX_MODEL_CHEAP } from '../common/max-inference';
import { buildOwnerStatusReply, resolveTaxpayerByText, buildTaxpayerSelfReply, buildTaxpayerQuickReply } from '../moren-ai/monthly-status.shared';

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
  // KURU-TEST (dry-run): gerçek handleMessage akışını GÖNDERMEDEN çalıştırır; üretilen
  // cevabı __dryReply'a yakalar. GO_LIVE/automation kapıları dry-run'da atlanır. Müşteriye
  // mesaj GİTMEZ — gerçek yolu (hızlı-yol + agentic + yargıç) güvenle test etmek için.
  __dryRun?: boolean;
  __dryReply?: string;
  __dryKind?: string;
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

  // GEÇİCİ ÖZ-TEST: owner AI'yı bir batarya gerçekçi soruyla GERÇEK yoldan (calisan→MorenAI)
  // çalıştırıp üretilen cevapları döndürür. Hataları kullanıcı tek tek test etmeden ben
  // toplu bulayım diye. Token korumalı; iş bitince KALDIRILACAK.
  // ARKA PLANDA çalışır (HTTP zaman aşımı olmasın), her sonucu botQualityLog'a
  // (source='SELFTEST', scenarioKey=runId) yazar. Sonuçlar DB'den okunur.
  @Post('owner-selftest')
  async ownerSelftest(@Body() body: any) {
    if (String(body?.token || '') !== (process.env.MOREN_SELFTEST_TOKEN || 'moren-st-7Yq2x')) {
      return { ok: false, error: 'unauthorized' };
    }
    const ownerPhone = String(process.env.MOREN_OWNER_WHATSAPP_PHONES || process.env.MOREN_OWNER_WHATSAPP_PHONE || '')
      .split(',')[0]?.trim();
    const tenant = ownerPhone ? await this.findOwnerTenantByPhone(ownerPhone) : null;
    if (!tenant) return { ok: false, error: 'owner tenant bulunamadi' };
    const questions: string[] = Array.isArray(body?.questions) ? body.questions.slice(0, 50) : [];
    const runId = String(body?.runId || ('st-' + Date.now()));
    const mode = String(body?.mode || 'owner') === 'taxpayer' ? 'taxpayer' : 'owner';
    const taxpayerId = mode === 'taxpayer' ? String(body?.taxpayerId || 'cmnydmger001leazy6moim5b2') : null;
    // Fire-and-forget: cevap beklemeden çalış, her soruyu botQualityLog'a yaz.
    void (async () => {
      const tpCtx = taxpayerId ? await this.botContext.buildTaxpayerContextBlock(tenant.id, taxpayerId).catch(() => '') : '';
      for (let i = 0; i < questions.length; i++) {
        const q = String(questions[i]);
        const t0 = Date.now();
        let answer = '', err = '';
        try {
          if (mode === 'taxpayer') {
            // GERÇEK MÜKELLEF AKIŞINA SADIK: taxpayer-readonly + mükellef prompt + post-filtre.
            const prompt = [
              "Sen ofisin dijital asistanısın; WhatsApp'tan ofisin MÜKELLEFİYLE (müşterisiyle) yazışıyorsun. Kısa, sıcak, doğal yaz (2-3 cümle, markdown yok).",
              'Mükellef KENDİ verisini sorarsa (KDV/durum/fatura/beyanname/borç/evrak) get_my_* ile GERÇEK rakamı söyle. Beyanname ödenecek TUTARINI kendin söyleme.',
              'Genel mevzuat/vergi/SGK sorusunu (fatura kaç günde, kdv oranı, işe giriş süresi, yıllık izin vb.) NET cevapla — "müşavirinize sorun" DEME.',
              'Cevaplayamadığın/elinde veri olmayan/emin olmadığın durumda "kontrol edip döneyim/müşavir kesinleştirir" DEME → MÜŞAVİRE ESKALE ET: yanıtın başına [[ESKALE]] koy, sonra SADECE "Konuyu müşavirimiz Muzaffer Bey\'e iletiyorum; en kısa sürede sizinle bu konuda iletişime geçecektir." de. Genel mevzuat ve elinde gerçek verisi olan kendi-verisi sorusu eskale DEĞİL.',
              '═══ MÜKELLEF VERİSİ ═══', tpCtx, '═══',
              `Mükellefin mesajı: ${q}`,
            ].join('\n');
            const a = await this.morenAi.chat(tenant.id, null, {
              taxpayerId: taxpayerId!, message: prompt, taxpayerText: q, voiceMode: false,
              toolMode: 'taxpayer-readonly', source: 'whatsapp-bot',
            } as any);
            answer = this.postFilter.filterTaxpayerReply(a.assistantMessage || '', {});
          } else {
            const prompt = this.buildOwnerWhatsAppPrompt(this.ownerDisplayName(), tenant.name || '', '', q, false);
            const a = await this.calisan.runViaMorenAi({
              tenantId: tenant.id, message: prompt, originalMessage: q, source: 'owner-selftest',
            });
            answer = this.postFilter.filterTaxpayerReply(a.assistantMessage || '', { mode: 'owner' });
          }
        } catch (e: any) { err = e?.message || String(e); }
        await this.prisma.botQualityLog.create({
          data: {
            tenantId: tenant.id, source: 'SELFTEST', status: err ? 'SYNTHETIC_FAIL' : 'EVAL_WARN',
            score: 0, scenarioKey: runId, intent: q.slice(0, 190),
            finalReply: (answer || ('HATA: ' + err)).slice(0, 4000),
            metadata: { idx: i, ms: Date.now() - t0, err: err || undefined, mode },
          },
        }).catch(() => null);
      }
    })();
    return { ok: true, tenant: tenant.id, runId, mode, started: questions.length };
  }

  /**
   * KURU-TEST: GERÇEK handleMessage akışını (kayıtlı mükellef yolu: hızlı-yol → cache-atla →
   * agentic → yargıç) bir mükellefin telefonuyla GÖNDERMEDEN çalıştırır; üretilen cevabı + süreyi
   * botQualityLog'a yazar. Selftest'in aksine controller'ı ATLAMAZ → gerçek üretim yolunu test eder.
   * Token korumalı; geçici. Body: { token, phone, questions[], runId? }
   */
  @Post('dry-run')
  async dryRun(@Body() body: any) {
    if (String(body?.token || '') !== (process.env.MOREN_SELFTEST_TOKEN || 'moren-st-7Yq2x')) {
      return { ok: false, error: 'unauthorized' };
    }
    const phone = String(body?.phone || '').trim();
    const questions: string[] = Array.isArray(body?.questions) ? body.questions.slice(0, 60) : [];
    if (!phone || !questions.length) return { ok: false, error: 'phone ve questions zorunlu' };
    const runOne = async (q: string, i: number) => {
      const msg: IncomingWhatsAppMessage = { from: phone, text: q, id: `dry-${Date.now()}-${i}`, __dryRun: true };
      const t0 = Date.now();
      let err = '';
      try { await this.handleMessage(msg); } catch (e: any) { err = e?.message || String(e); }
      return {
        soru: q,
        cevap: msg.__dryReply || (err ? `HATA: ${err}` : '(cevap üretilmedi — akış başka dalda bitti)'),
        yol: msg.__dryKind || null,
        ms: Date.now() - t0,
      };
    };
    // ASYNC mod: hemen dön, arka planda işle (502/timeout olmasın); sonuçlar communicationLog'a
    // 'TEST' etiketiyle yazılır (Mesajlar'dan + DB'den okunabilir). Büyük batarya için.
    if (body?.async === true) {
      void (async () => { for (let i = 0; i < questions.length; i++) await runOne(questions[i], i); })();
      return { ok: true, mode: 'async', started: questions.length };
    }
    const results: any[] = [];
    for (let i = 0; i < questions.length; i++) results.push(await runOne(String(questions[i]), i));
    return { ok: true, results };
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

  private async findTaxpayerByPhone(phone: string, tenantId?: string) {
    const normalized = this.normalize(phone);
    const taxpayers = await this.prisma.taxpayer.findMany({
      // Tenant'a kilitle: aksi halde aynı telefon başka ofiste kayıtlıysa
      // çapraz-tenant mükellef verisi sızabilir (çoklu ofis senaryosu).
      where: { isActive: true, ...(tenantId ? { tenantId } : {}) },
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
      // NOT: "tek tenant varsa owner kabul et" fallback'i KALDIRILDI (fail-closed).
      // Owner için MOREN_OWNER_TENANT_ID veya MOREN_OWNER_TENANT_SLUG zorunlu;
      // aksi halde owner yetkisi verilmez (yanlış kişiye owner verisi gitmesin).
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

  private clientAutoReplyEnabled(): boolean {
    // GÜVENLİK KAPISI (2026-06-22, kullanıcı talimatı): Mükellef tarafı, sistemin tam
    // profesyonel olduğundan EMİN OLUNANA KADAR kapalı tutulacak — mükellefe otomatik
    // HİÇBİR cevap gitmesin. Bu kapı, MOREN_CLIENT_BOT_ENABLED=1 olsa bile mükellef
    // oto-cevabını KAPALI tutar. Bu tek kapı hem AI cevabını hem belge gönderimini keser
    // (akış handleMessage'da bu false ise mükellefe bir şey göndermeden return eder).
    // YAYINA ALMAK (mükellef tarafını açmak) için: Railway'de MOREN_CLIENT_BOT_GO_LIVE=1.
    if (process.env.MOREN_CLIENT_BOT_GO_LIVE !== '1') return false;
    return process.env.MOREN_CLIENT_BOT_ENABLED !== '0';
  }

  /**
   * Owner mesajı belge göndermenin ÖTESİNDE analiz/özet/soru da istiyor mu?
   * ("...gönder VE tablo olarak özetle" gibi) → belgeyi gönderdikten sonra AI'ya devam et.
   * Sadece "X belgesini gönder" ise (ek istek yok) belge gönderilip akış biter.
   */
  private ownerMessageAlsoWantsAnswer(text: string): boolean {
    const t = String(text || '').toLocaleLowerCase('tr');
    // Analiz/özet/soru sinyalleri (gönderme fiilinin ötesinde bir talep)
    return /(özetle|ozetle|özet|tablo|analiz|yorumla|yorum|açıkla|acikla|kıyasla|kiyasla|karşılaştır|karsilastir|durumu(nu)?|ne kadar|kaç|hesapla|göster|goster|nedir|mı\b|mi\b|mu\b|mü\b|\?)/.test(t);
  }

  // Owner WhatsApp cevabı için sistem-talimatı (KIMLIK + kurallar). handleMessage ve
  // öz-test AYNI prompt'u kullanır → öz-test gerçek akışa sadık kalır.
  private buildOwnerWhatsAppPrompt(ownerName: string, officeName: string, recentContext: string, text: string, ownerDocSent: boolean): string {
    return [
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
      '   - Bölüm başlığı BÜYÜK HARF (DURUM, RİSKLİ, AJANLAR, HGS, AKSİYON) — EMOJİ KULLANMA, sade/profesyonel',
      '   - Sayıları Türk formatı: 14.421,50 ₺ (binlik nokta, ondalık virgül)',
      '4) ASLA "Cevap (WhatsApp):" gibi etiketle başlama. Doğrudan cevap yaz.',
      '5) Selamlama mesajına (selam, merhaba, kolay gelsin, sağ ol) SICAK ve PROFESYONEL karşılık ver + yardım teklif et, 1 cümle. Örnek: "Merhaba, buyurun; bugün nasıl yardımcı olabilirim?". ASLA "ne var?", "ne lazım?", "ne istiyorsun?", "nedir bu son haberler?" gibi laubali/savsaklayan/küstah ifade kullanma — karşındaki ofisin SAHİBİ, ona saygılı ve nazik bir asistan gibi konuş.',
      '6) Sana gereken portal verisini SİSTEM önceden hazırlar; sen SADECE sonucu yaz. ASLA bir araç/tool/fonksiyon ADI yazma; ASLA "get_xxx çağırıyorum/çağıracağım", "X aracını/tool\'unu kullanıyorum", "şimdi çekiyorum/sorguluyorum/bakıyorum" gibi iç adım ANLATMA. Veri elinde yoksa "elimde ... kaydı yok / eksik" de — uydurma.',
      '7) Riskli işlemlerde önce preview + ONAYLIYORUM bekle.',
      '8) BELGE GÖNDERME aktiftir (beyanname/tahakkuk PDF + mükellef kartına yüklü tüm evrak/fatura/sözleşme/dosyalar) ve sistem otomatik yapar. Bu mesaja kadar geldiysen mükellef NET DEĞİL demektir — kısaca "hangi mükellefin hangi belgesini göndereyim?" diye SOR. DİKKAT: belge gönderimini SADECE sistem yapar, sen DEĞİL. Bu yüzden "gönderiyorum / gönderiliyor / gönderecektim / yolluyorum / şimdi atıyorum / tekrar deniyorum / birazdan düşer / sistem aksaklığı oldu" gibi YAPMADIĞIN/YAPAMAYACAĞIN eylem cümlelerini ASLA kurma (geçmiş, şimdiki, gelecek hiçbir zaman). Eğer belge gerçekten gönderildiyse zaten ayrı bir [BELGE] mesajı düşer; senin görevin sadece NETLEŞTİRİCİ soru sormak ya da bilgi vermek.',
      '9) "Gönder" = belgeyi BİRİNE ilet demektir; "GİB\'e gönder/beyan ver" SANMA. Owner GİB\'e beyan vermeni istemez. Beyanname zaten verildiyse onu "GİB\'e gönderiyorum" diye KARIŞTIRMA.',
      '10) Mesajda hangi beyan tipi sorulduysa SADECE onu konuş. "KDV" sorulduysa MUHSGK/Damga ekleme; "MUHSGK" sorulduysa KDV ekleme.',
      '11) NE YAPABİLİRSİN: (a) Portal verisini sorgulayıp anlatmak (mizan, KDV, beyanname durumu, borç, fatura, mükellef bilgisi, sistem sağlığı). (b) Belge/PDF göndermek (sistem otomatik yapar). (c) Vergi/SGK/iş hukuku/mevzuat sorularını (süre, ceza, oran, had, nasıl yapılır) kıdemli mali müşavir bilgisiyle NET cevaplamak — "mali müşavire danışın" DEME; güncel tutar/oran/ceza gerekiyorsa resmi kaynaktan teyit et, kaynak yoksa kuralı + teyit noktasını söyle, sayı uydurma. BUNLARI rahatça yap. NE YAPAMAZSIN (WhatsApp\'tan): Luca/ajan çalıştırma-başlatma-durdurma, hatırlatma/SMS/mesaj gönderme, beyanname verme, ayar değiştirme gibi İŞLEM BAŞLATMA. Böyle bir komutta ASLA "başlattım/başlatıyorum/gönderdim/yaptım/kuyruğa aldım" deme — bunun yerine DÜRÜSTÇE: "Bu işlemi WhatsApp üzerinden başlatamıyorum; portaldan (ilgili modülden) yapabilirsiniz. İstersen durumu buradan kontrol edip anlatabilirim." de.',
      '12) DÖNEM: Evrak/işlem/aylık-takip durumundan bahsederken DÖNEM = BEYANNAME dönemidir (tool sonucundaki "beyannameDonem"), İŞLEM ayı DEĞİL. Mayıs ayının faturaları Haziran\'da işlenir; "Haziran\'da evrak geldi/işlendi" DEME, "Mayıs dönemi evrakı" de. Tool "donemNotu" verirse ona uy.',
      '13) DÖNEM VARSAYILANI: Kullanıcı dönem belirtmezse, içinde bulunulan AYI (cari ay) varsayma — onun verisi henüz işlenmemiş olur. Varsayılan = AKTİF BEYAN DÖNEMİ = bir önceki ay (ör. bugün Haziran ise Mayıs). Tool en güncel veri dönemini verirse onu kullan; boşsa "cari ay" deyip "veri yok" deme, bir önceki dönemi kontrol et.',
      '14) KİMLİK & DİL: Kendine "ofisimiz" DEME ("ben ofisimiz" YANLIŞ). Gerek olursa "Ben MOREN AI, ofisinin asistanı/mali müşavir beyni" de. ASLA geliştirici/teknik terim kullanma: "harness, hooks, ortam/env değişkeni, Claude Code, kısayol, konfigürasyon" gibi şeyler mükellef/ofis işiyle ALAKASIZ — bunları söyleme. Sen bir mali müşavir asistanısın, yazılım aracı gibi konuşma.',
      '15) EKSİK CEVAP YASAK: "…getiriyorum / çekiyorum / bir dakika / bulayım / kontrol edeyim / araçlara erişimim var" gibi YAPACAĞINI anlatıp veriyi VERMEDEN cevabı bitirme. Ya gerçek veriyi/sonucu yaz, ya da veri yoksa "elimde … kaydı yok" de. Ara-işlem cümlesini SON cevap olarak gönderme.',
      '',
      'MALİ TABLO ANALİZİ (gelir tablosu / bilanço / mizan / KDV): düz metin paragraf DEĞİL — kalemleri ALT ALTA yaz, BÜYÜK HARF bölüm başlığı (KALEMLER, YORUM) — EMOJİ YOK, Türk sayı formatı (1.234.567,89 ₺), sonda 1-2 madde kısa yorum. Tek kalem sorulduysa (örn. net kâr) tek satır cevap ver.',
      '',
      '★ UZUN BRİFİNG / DURUM RAPORU formatı:',
      '   Başlık (BÜYÜK HARF başlık satırı, emoji yok)',
      '   Boş satır',
      '   Bölüm başlığı (BÖLÜM ADI, emoji yok)',
      '   • bullet liste',
      '   Boş satır',
      '   Sonraki bölüm...',
      '   Tek paragrafta yapışık yazma; bölümleri boş satırlarla ayır.',
      '',
      'KISA SOHBET için: 1-2 cümle, sade. Brifing yapısı uygulama.',
      '',
      'SADECE müşavire (size) gidecek FINAL CEVABI yaz, başka hiçbir şey yazma.',
      ownerDocSent
        ? '[SİSTEM NOTU: Mesajda istenen belge(ler) owner\'a ZATEN gönderildi. Sen SADECE mesajdaki ANALİZ / ÖZET / SORU kısmını cevapla (ör. "tablo olarak KDV durumunu özetle"). Belgeyi "gönderdim/gönderiyorum" DEME, belge işini tekrar etme.]'
        : '',
      recentContext,
      `Mesajınız: ${text}`,
    ].join('\n');
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
    // BİLGİ/MEVZUAT SORUSU belge gönderme DEĞİL: "kdv orani da kalmadi", "ceza nedir",
    // "arastir" gibi cümleler yanlışlıkla rastgele mükellef belgesi gönderiyordu (SONGÜL
    // YAZAR vakası). Gönderme fiili yoksa ve mesaj soru/araştırma/olumsuzluk taşıyorsa iptal.
    const looksKnowledge = /\b(nedir|nasil|kac|orani|oran|mi|mı|musun|misin|arastir|ogren|hesapla|kalmadi|yanlis|dogru mu|emin|sahi mi|gercek mi)\b/.test(n) || /\?\s*$/.test(String(text || '').trim());
    if (looksKnowledge && !hasSendVerb) return false;
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
  ): Promise<{ isDocumentSend: boolean; taxpayer: any | null; items: Array<{ tipler: string[] | null; donem: string | null; belge: 'beyanname' | 'tahakkuk' | 'ikisi' }> } | null> {
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
      '- PATRON BIRDEN FAZLA belge isteyebilir ("X beyannamesi ve tahakkuku ILE Y beyannamesi ve tahakkuku"). HER istenen belge icin AYRI dizi ogesi uret. Farkli tip/donem = ayri oge.',
      '- "belge" alani: "...beyannamesi"->beyanname, "...tahakkuku / tahakkuk fisi"->tahakkuk, "beyannamesi ve tahakkuku" ya da sadece tip yazilmissa->ikisi.',
      '\nSADECE su JSON: {"isDocumentSend":true|false,"taxpayerId":"<id|null>","belgeler":[{"beyanTipi":"<TIP>","donem":"<YYYY-MM|YYYY-Qn|null>","belge":"beyanname|tahakkuk|ikisi"}]}',
    ].filter(Boolean).join('\n');

    const res = await claudeTextViaMax({ prompt, system, model: MAX_MODEL_CHEAP, maxTurns: 1, timeoutMs: 20000 });
    if (!res?.ok || !res.text) return null;
    const jsonMatch = res.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    let parsed: any;
    try { parsed = JSON.parse(jsonMatch[0]); } catch { return null; }
    if (parsed?.isDocumentSend !== true) {
      return { isDocumentSend: false, taxpayer: null, items: [] };
    }
    const taxpayer = parsed.taxpayerId
      ? (taxpayers.find((t) => t.id === String(parsed.taxpayerId)) || null)
      : (recentCtx.taxpayer || null);
    const normDonem = (d: any): string | null =>
      d && /^\d{4}-(\d{2}|Q[1-4])$/i.test(String(d)) ? String(d) : (recentCtx.donem || null);
    const normBelge = (b: any): 'beyanname' | 'tahakkuk' | 'ikisi' =>
      ['beyanname', 'tahakkuk', 'ikisi'].includes(String(b)) ? (String(b) as any) : 'ikisi';

    // YENİ: belgeler[] dizisi (çok-belge). Eski tek-alan formatı da desteklenir.
    const belgelerRaw = Array.isArray(parsed.belgeler) ? parsed.belgeler : [];
    let items = belgelerRaw
      .map((b: any) => ({ tipler: this.beyanTipiToList(b?.beyanTipi), donem: normDonem(b?.donem), belge: normBelge(b?.belge) }))
      .filter((it: any) => it.tipler && it.tipler.length);
    if (!items.length && parsed.beyanTipi) {
      const tipler = this.beyanTipiToList(parsed.beyanTipi);
      if (tipler?.length) items = [{ tipler, donem: normDonem(parsed.donem), belge: 'ikisi' }];
    }
    this.logger.log(`[OwnerDocSend] AI niyet: send=${parsed.isDocumentSend} tp=${taxpayer ? (taxpayer.companyName || taxpayer.firstName || taxpayer.id) : 'yok'} belge=${items.length} (${items.map((i: any) => `${i.tipler?.[0]}/${i.donem}/${i.belge}`).join(', ')})`);
    return { isDocumentSend: true, taxpayer, items };
  }

  /** Mesajda beyanname mi, tahakkuk mu, ikisi mi istendiğini çıkar (regex fallback). */
  private inferBelgeKindFromText(text: string): 'beyanname' | 'tahakkuk' | 'ikisi' {
    const n = this.normalizeForIntent(text);
    const tah = /tahakkuk/.test(n);
    const bey = /beyanname/.test(n);
    return bey && tah ? 'ikisi' : tah ? 'tahakkuk' : bey ? 'beyanname' : 'ikisi';
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
  private async maybeHandleOwnerStatusQuery(
    ownerTenant: any,
    ownerContactId: string,
    msg: IncomingWhatsAppMessage,
  ): Promise<boolean> {
    // TEK KAYNAK: intent algılama + tek-kaynak veri + biçimlendirme hepsi
    // monthly-status.shared → buildOwnerStatusReply'da. MOREN AI sayfası (moren-ai.chat
    // owner fast-path) AYNI fonksiyonu çağırır → sayfa ile WhatsApp birebir aynı cevap.
    const res = await buildOwnerStatusReply(this.prisma, ownerTenant.id, msg.text || '');
    if (!res) return false;
    const { reply, intent, donemLabel, count } = res;
    const sent = await this.whatsapp.sendMessage(this.replyTarget(msg), reply, ownerTenant.id);
    await this.prisma.communicationLog.create({
      data: {
        taxpayerId: ownerContactId, channel: 'WHATSAPP',
        subject: sent ? 'WhatsApp owner durum cevabi' : 'WhatsApp owner durum cevabi (gonderilemedi)',
        content: this.withWhatsAppPhone(reply, msg.from), occurredAt: new Date(),
      },
    });
    this.logger.log(`[OwnerStatus] intent=${intent} donem=${donemLabel} sonuc=${count}`);
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
    let items: Array<{ tipler: string[] | null; donem: string | null; belge: 'beyanname' | 'tahakkuk' | 'ikisi' }> = [];
    const ai = await this.extractOwnerDocIntentViaAI(ownerTenant.id, ownerContactId, recentCtx, msg)
      .catch((e: any) => { this.logger.warn(`[OwnerDocSend] AI niyet hatasi: ${e?.message || e}`); return null; });
    if (ai && ai.isDocumentSend === false) return false; // AI: belge isteği değil → sohbete bırak
    if (ai?.isDocumentSend && ai.taxpayer) {
      taxpayer = ai.taxpayer; items = ai.items || [];
    } else {
      // AI yok/kararsız → eski regex (çalışan durumlar bozulmasın).
      taxpayer = (await this.findTaxpayerInOwnerText(ownerTenant.id, msg.text)) || recentCtx.taxpayer;
      const tiplerFb = this.inferBeyanTipiFromOwnerText(msg.text);
      const donemFb = this.extractPeriodFromOwnerText(msg.text) || recentCtx.donem;
      if (tiplerFb?.length) items = [{ tipler: tiplerFb, donem: donemFb, belge: this.inferBelgeKindFromText(msg.text) }];
    }
    if (!taxpayer) return false; // mükellef çözülemedi → AI'ya bırak

    const adi = (taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`).trim();
    const n = this.normalizeForIntent(msg.text);
    const wantsBeyanname = items.length > 0 || /beyan|tahakkuk|muhtasar|muhsgk|kdv|gecici|damga|kurumlar|gelir|poset|stopaj/.test(n);

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
        // STANDART: önce bilgilendirme mesajı, sonra temiz dosya (her şey tek düzende).
        await sendOwnerText(`📎 ${caption}`);
        const ok = await this.baileys.sendMedia(ownerTenant.id, this.replyTarget(msg), { url, mimeType, filename, caption: null });
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

    // A) BEYANNAME/TAHAKKUK — istenen HER (tip + dönem + belge türü) için AYRI dosya.
    // Birden fazla belge istenmişse hepsi gönderilir (eskiden yalnız ilki gidiyordu);
    // "beyannamesi ve tahakkuku" ikisini de yollar (beyannameUrl + pdfUrl ayrı dosyalar).
    if (wantsBeyanname) {
      // Tip yazılmamış ama "beyanname gönder" gibi genel istek → tek öge ile dene.
      const sendList = items.length ? items : [{ tipler: null, donem: recentCtx.donem, belge: this.inferBelgeKindFromText(msg.text) }];

      const { sentAny, bulunamayan } = await this.sendBeyanItemsLoop(ownerTenant.id, taxpayer, adi, sendList, sendDoc);
      if (sentAny) {
        if (bulunamayan.length) await sendOwnerText(`Şunları bulamadım: ${bulunamayan.join(', ')}. Diğerlerini gönderdim.`);
        return true;
      }
      // Belirli tip istenmiş ama hiçbiri bulunamadıysa NET bildir; tip yoksa Document'a düş.
      if (items.length) {
        await sendOwnerText(`${adi} için ${bulunamayan.join(', ') || 'istenen beyanname/tahakkuk'} PDF'i bulamadım.`);
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
      const ilk = items[0];
      const etiket = ilk ? `${ilk.donem ? ilk.donem + ' ' : ''}${this.beyanLabel(ilk.tipler?.[0] || '')}`.trim() : '';
      await sendOwnerText(`${adi} için ${etiket ? etiket + ' ' : ''}beyanname PDF'i bulamadım. Mükellef kartına yüklü bir belge de yok.`);
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

  /**
   * PAYLAŞILIR beyanname/tahakkuk gönderim döngüsü (owner + mükellef ortak kullanır).
   * İstenen HER (tip+dönem+belge) için beyanname (beyannameUrl) ve/veya tahakkuk (pdfUrl)
   * AYRI dosya olarak gönderir. Mükellef yolunda taxpayer = mesajı atan mükellefin KENDİSİ
   * (tenantId + taxpayerId ile kilitli; başka mükellefin verisi sızmaz).
   */
  private async sendBeyanItemsLoop(
    tenantId: string,
    taxpayer: any,
    adi: string,
    items: Array<{ tipler: string[] | null; donem: string | null; belge: 'beyanname' | 'tahakkuk' | 'ikisi' }>,
    sendDoc: (s3Key: string, mimeType: string, filename: string, caption: string, markerDonem?: string) => Promise<boolean>,
  ): Promise<{ sentAny: boolean; bulunamayan: string[] }> {
    const findRec = async (tipler: string[] | null, donem: string | null): Promise<any> => {
      const baseWhere: any = { tenantId, taxpayerId: taxpayer.id };
      if (tipler?.length) baseWhere.beyanTipi = { in: tipler };
      let rec: any = null;
      if (donem && /^\d{4}-\d{2}$/.test(donem)) {
        const k1 = await (this.prisma as any).beyanKaydi.findMany({ where: { ...baseWhere, donem }, orderBy: [{ donem: 'desc' }], take: 6 });
        rec = k1.find((k: any) => k.beyannameUrl || k.pdfUrl);
      }
      if (!rec) {
        const k2 = await (this.prisma as any).beyanKaydi.findMany({ where: baseWhere, orderBy: [{ donem: 'desc' }], take: 12 });
        const yil = String(donem || '').slice(0, 4);
        rec = (yil ? k2.find((k: any) => (k.beyannameUrl || k.pdfUrl) && String(k.donem || '').startsWith(yil)) : null)
          || k2.find((k: any) => k.beyannameUrl || k.pdfUrl);
      }
      return rec;
    };
    let sentAny = false;
    const bulunamayan: string[] = [];
    for (const it of items) {
      const rec = await findRec(it.tipler, it.donem);
      const etiket = `${it.donem ? it.donem + ' ' : ''}${this.beyanLabel(it.tipler?.[0] || '')}`.trim() || 'beyanname';
      if (!rec) { bulunamayan.push(etiket); continue; }
      const wantBey = it.belge === 'beyanname' || it.belge === 'ikisi';
      const wantTah = it.belge === 'tahakkuk' || it.belge === 'ikisi';
      const tip = this.beyanLabel(rec.beyanTipi);
      let any = false;
      if (wantBey && rec.beyannameUrl) {
        await sendDoc(rec.beyannameUrl, 'application/pdf', `${adi}-${rec.beyanTipi}-${rec.donem}-beyanname.pdf`.replace(/[^\w.-]+/g, '_'), `${adi} · ${tip} Beyanname · ${rec.donem}`, String(rec.donem || ''));
        any = true; sentAny = true;
      }
      if (wantTah && rec.pdfUrl) {
        await sendDoc(rec.pdfUrl, 'application/pdf', `${adi}-${rec.beyanTipi}-${rec.donem}-tahakkuk.pdf`.replace(/[^\w.-]+/g, '_'), `${adi} · ${tip} Tahakkuk · ${rec.donem}`, String(rec.donem || ''));
        any = true; sentAny = true;
      }
      if (!any) {
        if (wantBey && !rec.beyannameUrl) bulunamayan.push(`${etiket} beyanname`);
        if (wantTah && !rec.pdfUrl) bulunamayan.push(`${etiket} tahakkuk`);
      }
    }
    return { sentAny, bulunamayan };
  }

  /** Mükellef mesajından istenen belgeleri (tip+dönem+belge) AI ile çıkar — mükellef
   *  SABİT olduğu için yalnız belge listesi çözülür (mükellef çözümü yok). */
  private async extractDocItemsViaAI(text: string, taxpayerType: string | null): Promise<Array<{ tipler: string[] | null; donem: string | null; belge: 'beyanname' | 'tahakkuk' | 'ikisi' }> | null> {
    if (process.env.MOREN_OWNER_DOC_AI === '0') return null;
    const turHint = taxpayerType === 'TUZEL_KISI'
      ? 'Bu mukellef SIRKET(kurum): "gecici/gecici vergi"=KGECICI.'
      : 'Bu mukellef GERCEK KISI: "gecici/gecici vergi"=GGECICI.';
    const system = 'Bir mali musavirlik ofisi asistanisin. Mukellef kendi belgelerini istiyor. Mesajdan hangi beyan tipi + donem + belge turu istendigini cikar. SADECE tek satir JSON dondur, baska hicbir sey yazma.';
    const prompt = [
      `Mukellef mesaji: "${String(text || '').slice(0, 400)}"`,
      turHint,
      'Beyan tipleri: KDV1, KDV2, MUHSGK(muhtasar/SGK), KGECICI, GGECICI, KURUMLAR, GELIR, DAMGA, POSET. "kdv"=KDV1.',
      'Donem: "nisan 2026"->2026-04, "2026 1.donem/ceyrek"->2026-Q1; yoksa null.',
      'Birden fazla belge istenebilir -> her biri AYRI oge. "beyannamesi"->beyanname, "tahakkuku/tahakkuk fisi"->tahakkuk, "beyannamesi ve tahakkuku" ya da sadece tip->ikisi.',
      'Belge/beyanname gonderme istegi DEGILSE (selam, soru) belgeler bos dizi olsun.',
      'SADECE su JSON: {"belgeler":[{"beyanTipi":"<TIP>","donem":"<YYYY-MM|YYYY-Qn|null>","belge":"beyanname|tahakkuk|ikisi"}]}',
    ].join('\n');
    const res = await claudeTextViaMax({ prompt, system, model: MAX_MODEL_CHEAP, maxTurns: 1, timeoutMs: 20000 });
    if (!res?.ok || !res.text) return null;
    const m = res.text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    let parsed: any;
    try { parsed = JSON.parse(m[0]); } catch { return null; }
    const raw = Array.isArray(parsed?.belgeler) ? parsed.belgeler : [];
    const items = raw
      .map((b: any) => ({
        tipler: this.beyanTipiToList(b?.beyanTipi),
        donem: b?.donem && /^\d{4}-(\d{2}|Q[1-4])$/i.test(String(b.donem)) ? String(b.donem) : null,
        belge: (['beyanname', 'tahakkuk', 'ikisi'].includes(String(b?.belge)) ? String(b.belge) : 'ikisi') as 'beyanname' | 'tahakkuk' | 'ikisi',
      }))
      .filter((it: any) => it.tipler && it.tipler.length);
    return items.length ? items : null;
  }

  /**
   * Mükellef KENDİ beyanname/tahakkuk PDF'ini WhatsApp'tan isteyince gönderir (çok-belge).
   * Yalnız mesajı atan mükellefin KENDİ verisi (tenantId+taxpayerId kilitli). Kullanıcı
   * kararı (2026-06-15): mükellef kendi resmi belgesini alabilir (tutar dahil).
   */
  private async maybeHandleTaxpayerDocumentSend(taxpayer: any, msg: IncomingWhatsAppMessage): Promise<boolean> {
    if (!this.storage) return false;
    if (!this.isOwnerDocumentSendRequest(msg.text)) return false; // belge-gönderme anahtar kelime kapısı
    let items = await this.extractDocItemsViaAI(msg.text, taxpayer.type ?? null).catch(() => null);
    if (!items?.length) {
      const tipler = this.inferBeyanTipiFromOwnerText(msg.text);
      const donem = this.extractPeriodFromOwnerText(msg.text);
      if (tipler?.length) items = [{ tipler, donem, belge: this.inferBelgeKindFromText(msg.text) }];
    }
    if (!items?.length) return false; // beyanname/tahakkuk isteği değil → normal akışa bırak

    const adi = (taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`).trim();
    const sendText = async (reply: string) => {
      const sent = await this.whatsapp.sendMessage(this.replyTarget(msg), reply, taxpayer.tenantId);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: taxpayer.id, channel: 'WHATSAPP',
          subject: sent ? 'WhatsApp mukellef belge cevabi' : 'WhatsApp mukellef belge cevabi (gonderilemedi)',
          content: this.withWhatsAppPhone(reply, msg.from), occurredAt: new Date(),
        },
      });
    };
    const sendDoc = async (s3Key: string, mimeType: string, filename: string, caption: string, markerDonem = ''): Promise<boolean> => {
      try {
        const url = await this.storage!.getPresignedDownloadUrl(s3Key, filename);
        // STANDART: önce bilgilendirme mesajı, sonra temiz dosya (her şey tek düzende).
        await sendText(`📎 ${caption}`);
        const ok = await this.baileys.sendMedia(taxpayer.tenantId, this.replyTarget(msg), { url, mimeType, filename, caption: null });
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: taxpayer.id, channel: 'WHATSAPP',
            subject: ok ? 'WhatsApp mukellef belge gonderildi' : 'WhatsApp mukellef belge gonderilemedi',
            content: this.withWhatsAppPhone(`[BELGE] ${caption} [[doc_ctx:${taxpayer.id}|${markerDonem || ''}]]`, msg.from), occurredAt: new Date(),
          },
        });
        if (!ok) await sendText(`${caption} dosyasını göndermeye çalıştım ama WhatsApp iletmedi; biraz sonra tekrar deneyin.`);
        return ok;
      } catch (e: any) {
        this.logger.warn(`[TaxpayerDocSend] gonderim hatasi: ${e?.message || e}`);
        await sendText(`${caption} dosyasını gönderirken bir sorun oldu; az sonra tekrar deneyin.`);
        return false;
      }
    };

    const { sentAny, bulunamayan } = await this.sendBeyanItemsLoop(taxpayer.tenantId, taxpayer, adi, items, sendDoc);
    if (sentAny) {
      if (bulunamayan.length) await sendText(`Şunları bulamadım: ${bulunamayan.join(', ')}. Diğerlerini gönderdim.`);
      return true;
    }
    await sendText(`${bulunamayan.join(', ') || 'İstediğiniz beyanname/tahakkuk'} kaydını bulamadım; hazır olduğunda iletebilirim.`);
    return true;
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

      // OWNER → SERBEST NUMARAYA MESAJ: owner "0532… numarasına 'X' gönder" derse o numaraya
      // doğrudan WhatsApp mesajı yollar (numara + gönderme fiili + mesaj-niyeti şart → karışmaz).
      // İsim-relay'den ÖNCE: numara varsa serbest-mesaj, yoksa isim-relay çalışır.
      if (await this.maybeHandleOwnerSendToNumber(ownerTenant, msg)) {
        return;
      }

      // MÜŞAVİR → MÜKELLEF İLETME: owner "<Mükellef>'e ilet: <cevap>" derse, o mükellefe
      // "müşavirimize danıştık" çerçevesiyle iletir (eskalasyonun geri dönüşü). İki nokta
      // ZORUNLU + isim ≥2 ayırt edici kelimeyle çözülür → yanlış müşteriye gitmez.
      if (await this.maybeHandleOwnerRelayToTaxpayer(ownerTenant, msg)) {
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
      // Mesaj AYRICA analiz/özet/soru içeriyorsa (ör. "...gönder VE tablo olarak özetle")
      // belgeyi gönderdikten SONRA da AI'ya devam et ki o kısmı da cevaplansın (eskiden
      // sadece belge gönderip return ediyordu → özet/analiz isteği sessizce düşüyordu).
      const ownerDocSent = await this.maybeHandleOwnerDocumentSend(ownerTenant, ownerContact.id, msg);
      if (ownerDocSent && !this.ownerMessageAlsoWantsAnswer(msg.text)) {
        return;
      }

      const recentContext = await this.botContext.buildRecentWhatsAppContext(ownerContact.id);
      const ownerName = this.ownerDisplayName();
      const officeName = ownerTenant.name || OFFICE_NAME;
      const prompt = this.buildOwnerWhatsAppPrompt(ownerName, officeName, recentContext, msg.text, ownerDocSent);

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
    // Önce bu mesajın geldiği ofisi (tenant) çöz, sonra mükellefi YALNIZ o
    // tenant içinde ara — çapraz-tenant veri sızıntısını engeller.
    const inboundTenant = await this.findTenantForInbound(msg);
    if (!inboundTenant) {
      this.logger.warn(`WhatsApp bot: tenant bulunamadi ${msg.from}`);
      return;
    }
    const taxpayer: any = await this.findTaxpayerByPhone(msg.from, inboundTenant.id);
    if (!taxpayer) {
      const tenant = inboundTenant;
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

        // "Siz kimsiniz / kim ile görüşüyorum / nedir bu numara" → ÖNCE soruyu
        // CEVAPLA (kimliğini söyle), sonra isim iste. Eskiden bu soru else'e düşüp
        // "kayıtlı değilsiniz, adınızı paylaşın" diye KAÇAMAK cevap alıyordu (canlı
        // eval: "Siz kimsin?" → evasive, skor 4).
        const asksIdentity = /\bkimsin(iz)?\b|kim(ler)?\s*(le|siniz|sin)|kiminle|kim ile|nedir bu( numara| hat)?|hangi (firma|ofis|kurum|numara)|sizi tan[ıi]m[ıi]yorum|kim ar[ıi]yor/i.test(msg.text || '');

        // MÜŞTERİ ADAYI: kayıtlı olmayan biri hizmet/fiyat sorabilir ya da yeni mükellef
        // olmak/tanışmak isteyebilir. Eskiden bu mesajlar BILGI_SORUSU/GENEL'e düşüp
        // soğuk "adınızı paylaşın" cevabı alıyordu — bir aday için kötü ilk izlenim.
        // Bu yüzden ÖNCE sıcak, satış-bilinçli ama yalan/fiyat-taahhüt içermeyen,
        // lead toplayan cevap veriyoruz.
        // Mevcut-müşteri eylemi (evrak/ödeme/onay/şikayet) → aday SAYMA, kendi dalına gitsin.
        const actionIntent = ['EVRAK_TESLIM', 'ODEME_BILDIRIMI', 'BEYANNAME_ONAY_TALEBI', 'SIKAYET'].includes(intentResult.intent);
        // "kdv borcum ne kadar" gibi KENDİ verisini soran (kayıtsız) biri fiyat sormuyor →
        // fiyat dalına SOKMA, "sizi tanıyalım"a bırak.
        // Teslim/eylem fiili (evrak gönderdim vb.) → mevcut müşteri davranışı, aday/fiyat sayma.
        const looksLikeDelivery = /g[öo]nderdim|yollad[ıi]m|att[ıi]m|ilettim|teslim|b[ıi]rakt[ıi]m|kargo/i.test(msg.text || '');
        const debtOrData = /bor[çc]|kdv|beyan|tahakkuk|bakiye|vergi|sgk prim|ne zaman|son g[üu]n/i.test(msg.text || '');
        const explicitPrice = /fiyat|[üu]cret|ka[çc] para|teklif|tarife|maliyet|ne al[ıi]yorsunuz/i.test(msg.text || '');
        const pricePhrase =
          /ne kadar|ayl[ıi]k ka[çc]/i.test(msg.text || '') &&
          /muhasebe|hizmet|defter|m[üu][şs]avir|tut|kurulu[şs]|[şs]irket/i.test(msg.text || '');
        const asksPricing = !actionIntent && !looksLikeDelivery && !debtOrData && (explicitPrice || pricePhrase);
        const looksLikeProspect =
          !actionIntent && !looksLikeDelivery &&
          /mali m[üu][şs]avir|muhasebeci|m[üu][şs]avir ar|m[üu][şs]teri(niz)? olmak|m[üu]kellef(iniz)? olmak|hizmet|ne i[şs] yap|neler yap|[şs]irket kur|[şs]ah[ıi]s (firma|[şs]irket|i[şs]let)|limited|defter tut|muhasebe|kurulu[şs]|ge[çc]mek isti|de[ğg]i[şs]tirmek isti|tan[ıi][şs]|[çc]al[ıi][şs]mak ister|anla[şs]mak ister/i.test(msg.text || '');

        if (asksIdentity) {
          rawReply = `Ben ${OFFICE_NAME} ofisinin WhatsApp asistanıyım; mali müşavirlik işlemlerinizde yardımcı oluyorum. Sizi kayıtlarımızda bulabilmem için adınızı veya firma unvanınızı paylaşır mısınız?`;
        } else if (asksPricing) {
          // Fiyat sorusu (kayıtsız/aday): MESAJLA FİYAT VERME (ne rakam ne aralık ne ima).
          // Nazikçe ofise/görüşmeye davet et + iletişim al. Kullanıcı talimatı 2026-06-23.
          rawReply = `İlginiz için teşekkür ederiz. Ücret bilgimizi mesaj üzerinden paylaşmıyoruz; sizi ofisimizde ağırlamaktan memnuniyet duyarız — uygun bir zamanda buyurun, mali müşavirimiz işinize özel değerlendirmeyi yüz yüze yapsın. Dilerseniz adınızı/firma unvanınızı ve telefon numaranızı bırakın, en kısa sürede sizi arayıp görüşme için uygun bir zaman ayarlayalım.`;
        } else if (looksLikeProspect) {
          // Hizmet/yeni mükellef/tanışma — sıcak karşıla, hizmetleri özetle, lead topla
          rawReply = `Hoş geldiniz, ilginiz için teşekkür ederiz! ${OFFICE_NAME} olarak muhasebe, beyanname ve vergi işlemleri, SGK & bordro, şirket/şahıs kuruluşu ve mali danışmanlık hizmetleri sunuyoruz. Sizi mali müşavirimizle buluşturmaktan memnuniyet duyarız — adınızı/firma unvanınızı ve kısaca faaliyet konunuzu yazarsanız ekibimiz en kısa sürede size dönüş yapar.`;
        } else if (isFirstContact) {
          // İlk temas — kendini tanıt + kim olduğunu sor
          rawReply = `Merhaba, ${OFFICE_NAME} iletişim hattına hoş geldiniz. Size yardımcı olabilmemiz için adınızı veya firma unvanınızı paylaşır mısınız?`;
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
    // Otomasyon event'i: müvekkelden WhatsApp mesajı geldi (dry-run'da tetiklenmez)
    if (this.eventBus && !msg.__dryRun) {
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
    if (!msg.__dryRun) await this.prisma.notification.create({
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

    if (!msg.__dryRun) await this.sendOwnerNotification(
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

    if (!clientAutoReplyEnabled && !msg.__dryRun) {
      this.logger.log(`[Musteri botu kapali] kayitli mesaj kaydedildi, otomatik cevap atlanadi: taxpayer=${taxpayer.id} phone=${this.normalize(msg.from)}`);
      return;
    }

    if (!automationActive && !msg.__dryRun) {
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
    if (rate.limited && !msg.__dryRun) {
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

    // Mükellef KENDİ beyanname/tahakkuk PDF'ini istediyse (çok-belge) gönder — AI sohbetinden önce.
    // Yalnız kendi verisi (tenantId+taxpayerId kilitli). Handle ederse akış burada biter.
    if (await this.maybeHandleTaxpayerDocumentSend(taxpayer, msg).catch((e: any) => {
      this.logger.warn(`[TaxpayerDocSend] hata: ${e?.message || e}`); return false;
    })) {
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

    // ─── HIZLI-YOL (mükellef own-data) ─────────────────────────────
    // Sık sorular (borç/bakiye, son ödeme, KDV durumu, beyanname durumu) agentic+LLM-yargıç+
    // retry zincirini ATLAR → anında + şablonlu + doğru. AKTİF mükellefe kilitli (taxpayer.id),
    // yanlış mükellef imkânsız. Eşleşmezse null → normal akış (cache/agentic) devam eder.
    // 1) Veri sorusu (borç/ödeme/KDV/beyanname) → DB'li hızlı-yol; 2) tutmazsa sabit mevzuat/
    //    selamlama hızlı-yolu (KDV oranı, fatura süresi, izin, SGK, merhaba/teşekkür) → anında.
    const fast = (await buildTaxpayerSelfReply(this.prisma, taxpayer.tenantId, taxpayer.id, msg.text).catch(() => null))
      || buildTaxpayerQuickReply(msg.text);
    if (fast) {
      const fastReply = this.postFilter.filterTaxpayerReply(fast.reply, { recentReplies });
      if (fastReply) {
        // Dry-run: GÖNDERME (müşteriye mesaj gitmesin) ama LOGLA (Mesajlar'da görünsün).
        const sent = msg.__dryRun ? true : await this.whatsapp.sendMessage(this.replyTarget(msg), fastReply, taxpayer.tenantId);
        if (!msg.__dryRun) this.botCache.set(taxpayer.tenantId, taxpayer.id, msg.text, fastReply);
        await this.prisma.communicationLog.create({
          data: {
            taxpayerId: taxpayer.id,
            channel: 'WHATSAPP',
            subject: msg.__dryRun ? 'WhatsApp bot cevabı (TEST · hızlı-yol)' : (sent ? 'WhatsApp bot cevabı (hızlı-yol)' : 'WhatsApp bot cevabı hızlı-yol (gönderilemedi)'),
            content: this.withWhatsAppPhone(fastReply, msg.from),
            occurredAt: new Date(),
          },
        });
        if (msg.__dryRun) { msg.__dryReply = fastReply; msg.__dryKind = 'hizli-yol:' + fast.kind; }
        else this.refreshTaxpayerMemory(taxpayer.tenantId, taxpayer.id);
        return;
      }
    }

    // ─── Cache lookup ──────────────────────────────────────────────
    // Aynı mükelleften son 24 saatte aynı (normalize edilmiş) soru gelmişse
    // AI'ya gitmeden son onaylı cevabı dön. Hata/generic cevaplar shouldNotCache
    // filtresiyle zaten cache'lenmiyor (bkz. bot-cache.service.ts).
    const cachedReply = this.botCache.get(taxpayer.tenantId, taxpayer.id, msg.text);
    if (cachedReply && !msg.__dryRun) {
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
      '• Emoji KULLANMA — sade, profesyonel düz metin (mali müşavirlik ciddiyeti).',
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
      '• Veri yoksa rakam/tarih/durum UYDURMA. "bir bakıp döneyim" deyip ASMA → cevaplayamıyorsan/elinde veri yoksa MÜŞAVİRE ESKALE ET (sistem-prompt\'taki [[ESKALE]] kuralı: işareti koy + "müşavirimiz … Bey\'e iletiyorum, iletişime geçecek").',
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
      '• BEYANNAME TUTARI: ödenecek/tahakkuk tutarını kendin söyleme; verildi/hazır DURUMUNU söyle. Tutar sorulup elinde NET veri yoksa → MÜŞAVİRE ESKALE ET ([[ESKALE]] kuralı), "müşavir kesinleştirince paylaşır" deyip ASMA.',
      '• Tool veri döndürmezse/boşsa rakam UYDURMA → MÜŞAVİRE ESKALE ET ([[ESKALE]] kuralı), "bir bakıp döneyim" deyip bırakma.',
      '',
      '— GENEL MEVZUAT / VERGİ-SGK SORULARI (ÖNEMLİ) —',
      '• Mükellef GENEL bir mevzuat/vergi/SGK sorusu sorarsa (örn. "işe başlama bildirimi kaç günde yapılır, cezası ne", "KDV oranı kaç", "fatura kaç günde kesilmeli", "hangi belge gerekir") → mali müşavir bilgisiyle KISA ve NET cevap ver. ASLA "müşavirinize/müşavirimize sorun", "müşaviriniz daha doğru söyler" gibi topu atan cümle KURMA — amacımız mükellefin işini BURADA çözmek.',
      '• Güncel tutar/oran/ceza/süre/had için sana SİSTEM resmi kaynak özeti sağlar; ona dayanarak söyle. Kaynak yoksa genel kuralı + neyin teyit gerektiğini söyle; sayı UYDURMA.',
      '• SADECE KİŞİYE ÖZEL rakam/karar sorulursa (senin tam cezan, senin tam tutarın, senin özel durumun) → genel kuralı yine açıkla; kesin kişisel rakam/karar elinde yoksa "müşavirimiz netleştirir" deyip asma → MÜŞAVİRE ESKALE ET ([[ESKALE]] kuralı).',
      '• İŞLEM/KARAR gerektiren ağır konular (şirket/şahıs KAPANIŞI, vergi dairesi nezdinde İŞLEM/başvuru, geçici/kurumlar vergisi KİŞİSEL hesabı) → genel bilgiyi ver ama kesin işlem/sonuç/tutar GARANTİ ETME; net cevabın yoksa "kontrol edip döneyim/bakıp döneyim" DEME → MÜŞAVİRE ESKALE ET ([[ESKALE]] kuralı).',
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
    const stopCustTyping = msg.__dryRun ? () => {} : this.startTypingIndicator(taxpayer.tenantId, this.replyTarget(msg));
    let reply = '';
    let needsEscalation = false;
    let answerModel = ''; // degrade fallback (Max/altyapı yanıt vermedi) sinyali — eskalasyon ağı kullanır
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

      answerModel = answer.usage?.model || '';
      let rawAiReply = answer.assistantMessage || '';
      // ESKALE: AI cevaplayamayıp müşavire devrettiğinde yanıtının başına [[ESKALE]] koyar.
      // İşareti yakala (owner'a bildirim + ofis görevi için), MÜŞTERİYE gitmeden TEMİZLE.
      needsEscalation = /\[\[\s*ESKALE\s*\]\]/i.test(rawAiReply);
      rawAiReply = rawAiReply.replace(/\[\[\s*ESKALE\s*\]\]/gi, '').trim();
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
        // HIZ: AKILLI mod (varsayılan) — temiz cevap (yerel skor 8+) anında gider; gri-bölge
        // (6-7) gönderim ÖNCESİ LLM-yargıca sorulur; kötü (<6) retry'a gider. Eskiden HER
        // cevap bloklayıcı LLM-yargıçtan geçiyordu → +10-15sn/cevap + retry'da +30-90sn (canlı
        // bulgu). Veri soruları zaten deterministik hızlı-yolda (hatasız), agentic kalan
        // sohbet/mevzuat cevapları yüksek kaliteli ölçüldü → akıllı mod kalite/hızda en iyi denge.
        // Kalite sorunu olursa geri sıkılaştır: MOREN_AI_TAXPAYER_BLOCKING=1.
        blocking: process.env.MOREN_AI_TAXPAYER_BLOCKING === '1',
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
    // ESKALASYON AĞI (deterministik) — bot cevaplayamadıysa müşteriyi çıkmazda/sızıntıda
    // BIRAKMA, müşavire devret. Üç tetik: (a) Max/altyapı yanıt vermeyince üretilen degrade
    // cevap (usage.model işareti), (b) içi-boş "kontrol edeyim" savsaklaması, (c) yanıta sızan
    // AI-altyapı terimi. Üçünde de owner'a bildirim + müşteriye TEMİZ eskalasyon cümlesi.
    // (Kullanıcı kararı 2026-06-23: cevaplayamayınca eskalasyon GENEL — tek konu değil.)
    if (
      reply &&
      (answerModel === 'claude-max-unavailable' ||
        answerModel === 'anthropic-api-cost-cap' ||
        this.postFilter.isContentFreeStall(reply) ||
        this.postFilter.mentionsAiInfra(reply))
    ) {
      needsEscalation = true;
      reply = this.escalationReply();
    }
    if (reply) {
      // Dry-run: GÖNDERME ama LOGLA (Mesajlar'da görünsün); cache/eskalasyon/owner-bildirim YOK.
      if (!msg.__dryRun) this.botCache.set(taxpayer.tenantId, taxpayer.id, msg.text, reply);

      const sent = msg.__dryRun ? true : await this.whatsapp.sendMessage(this.replyTarget(msg), reply, taxpayer.tenantId);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: taxpayer.id,
          channel: 'WHATSAPP',
          subject: msg.__dryRun ? 'WhatsApp bot cevabı (TEST · MOREN AI)' : (sent ? 'WhatsApp bot cevabı (MOREN AI)' : 'WhatsApp bot cevabı (gönderilemedi - master switch veya hata)'),
          content: this.withWhatsAppPhone(reply, msg.from),
          occurredAt: new Date(),
        },
      });
      if (msg.__dryRun) { msg.__dryReply = reply; msg.__dryKind = needsEscalation ? 'agentic:eskalasyon' : 'agentic'; return; }
      // ESKALE: bot cevaplayamadı → müşavire (owner) bildir + ofis görevi aç.
      if (needsEscalation && sent) {
        await this.escalateToOwner(taxpayer, msg.text, msg.from).catch((e: any) =>
          this.logger.warn(`Eskalasyon bildirimi başarısız: ${e?.message || e}`),
        );
      }
      this.refreshTaxpayerMemory(taxpayer.tenantId, taxpayer.id);
    }
  }

  /** Eskalasyonda müşteriye giden STANDART cümle (çıkmaz "kontrol edeyim" yerine). */
  private escalationReply(): string {
    return `Konuyu müşavirimiz ${this.ownerDisplayName()} Bey'e iletiyorum; en kısa sürede sizinle bu konuda iletişime geçecektir.`;
  }

  /**
   * Bot bir mükellef sorusuna cevap veremeyip müşavire devrettiğinde: owner'a WhatsApp
   * bildirimi gönderir (soru + "yanıt sizden bekleniyor") ve portalda ofis görevi açar.
   */
  private async escalateToOwner(taxpayer: any, question: string, fromPhone?: string) {
    const ad = taxpayer.companyName || `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim() || 'Mükellef';
    const tel = this.normalize(fromPhone || '') || '';
    const owner = this.ownerDisplayName();
    const soru = String(question || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    const bildirim =
      `📩 MÜKELLEF SORUSU — yanıt sizden bekleniyor\n` +
      `Mükellef: ${ad}${tel ? ' (' + tel + ')' : ''}\n` +
      `Soru: "${soru}"\n` +
      `Cevap veremedim; mükellefe "${owner} Bey en kısa sürede iletişime geçecek" dedim. Lütfen siz dönüş yapın.`;
    await this.sendOwnerNotification(taxpayer.tenantId, bildirim).catch(() => {});
    // Portalda iz bırak (ofis görevi)
    const user = await this.prisma.user.findFirst({
      where: { tenantId: taxpayer.tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }).catch(() => null);
    if (user) {
      await (this.prisma as any).task.create({
        data: {
          tenantId: taxpayer.tenantId,
          taxpayerId: taxpayer.id,
          createdById: user.id,
          title: `WhatsApp: müşavir yanıtı bekleniyor — ${ad}`,
          description: soru,
          category: 'MUKELLEF',
          priority: 'HIGH',
          tags: ['whatsapp', 'eskalasyon', 'musavir-yaniti'],
          notifyInApp: true,
          notifyBrowser: true,
        },
      }).catch(() => null);
    }
  }

  /**
   * Müşavir (owner) WhatsApp'tan "<Mükellef>'e ilet: <cevap>" derse, o mükellefe
   * "müşavirimize danıştık" çerçevesiyle owner'ın cevabını iletir + owner'a onay döner.
   * GÜVENLİK: iki nokta ZORUNLU (yanlış-pozitif önler) + isim ≥2 ayırt edici kelimeyle
   * çözülmeli (resolveTaxpayerByText) → yanlış müşteriye gitmez.
   */
  private async maybeHandleOwnerRelayToTaxpayer(ownerTenant: any, msg: any): Promise<boolean> {
    const text = String(msg?.text || '');
    // "<isim>'e/'a/ye/ya  ilet|söyle|yaz|bildir|aktar|cevap|geç  :  <mesaj>"
    const m = text.match(
      /^\s*(.{2,50}?)['’]?\s*(?:e|a|ye|ya|na|ne)\s+(?:ilet|söyle|soyle|yaz|bildir|aktar|ge[çc]|cevap(?:\s*(?:ver|yaz))?|haber\s*ver)\s*:\s*([\s\S]{2,})$/i,
    );
    if (!m) return false;
    const namePart = m[1].trim();
    const messagePart = m[2].trim();
    if (!namePart || messagePart.length < 2) return false;

    const taxpayers = await this.prisma.taxpayer.findMany({
      where: { tenantId: ownerTenant.id, isActive: true },
      select: { id: true, companyName: true, firstName: true, lastName: true, phone: true, phones: true },
    }).catch(() => [] as any[]);
    const target = resolveTaxpayerByText(taxpayers, namePart);
    if (!target) {
      const r = `"${namePart}" için net bir mükellef bulamadım — yanlış kişiye göndermemek için tam unvanı (en az 2 kelime) yazar mısınız? Örn: "Wash Clean'e ilet: ...".`;
      await this.whatsapp.sendMessage(this.replyTarget(msg), r, ownerTenant.id).catch(() => false);
      return true;
    }
    const phone = [target.phone, ...(Array.isArray(target.phones) ? target.phones : [])]
      .map((p: any) => this.normalize(p))
      .filter(Boolean)[0];
    const ad = this.displayName(target);
    if (!phone) {
      await this.whatsapp.sendMessage(this.replyTarget(msg), `${ad} için kayıtlı telefon numarası yok; iletemedim.`, ownerTenant.id).catch(() => false);
      return true;
    }
    const advisor = this.ownerDisplayName();
    const framed =
      `Sayın ${ad}, konuyu müşavirimiz ${advisor} Bey'e ilettik — kendisi sizinle ilgili şu bilgiyi paylaştı:\n\n` +
      `${messagePart}\n\n` +
      `Başka bir sorunuz olursa yardımcı olmaktan memnuniyet duyarız.`;
    const sent = await this.whatsapp.sendMessage(phone, framed, ownerTenant.id).catch(() => false);
    await this.prisma.communicationLog.create({
      data: {
        taxpayerId: target.id,
        channel: 'WHATSAPP',
        subject: sent ? 'WhatsApp müşavir yanıtı iletildi' : 'WhatsApp müşavir yanıtı (gönderilemedi - şalter/hata)',
        content: this.withWhatsAppPhone(framed, phone),
        occurredAt: new Date(),
      },
    }).catch(() => null);
    const confirm = sent
      ? `✓ ${ad} mükellefine iletildi:\n${messagePart}`
      : `⚠️ ${ad} mükellefine iletilemedi (WhatsApp bağlantısı/şalter). Lütfen tekrar deneyin.`;
    await this.whatsapp.sendMessage(this.replyTarget(msg), confirm, ownerTenant.id).catch(() => false);
    return true;
  }

  /**
   * OWNER → SERBEST NUMARAYA MESAJ: owner "0532… numarasına 'merhaba' gönder" / "şu numaraya …
   * mesajını gönder" derse, o numaraya doğrudan WhatsApp mesajı yollar. Owner kendi aracını
   * kullanıyor → komutun kendisi onaydır; gönderim sonrası NE gönderildiği owner'a teyit edilir.
   * TETİK ŞARTI (üçü birden): metinde geçerli telefon + gönderme fiili + (tırnak / "mesaj" / "yaz")
   * → normal sorular ve "X belgesini gönder" / isim-relay komutlarıyla KARIŞMAZ.
   */
  private async maybeHandleOwnerSendToNumber(ownerTenant: any, msg: any): Promise<boolean> {
    const text = String(msg?.text || '').trim();
    if (!text) return false;
    if (!/(g[öo]nder|yolla|at[ıi]ver|mesaj\s*at)/i.test(text)) return false;
    // Serbest-mesaj niyeti: tırnaklı metin VEYA "mesaj"/"yaz" kelimesi olmalı (belge-gönderden ayrışsın).
    const hasMsgIntent = /["'“”‘’«»]/.test(text) || /mesaj/i.test(text) || /yaz[ıi]p?\b/i.test(text);
    if (!hasMsgIntent) return false;
    // Telefon adayı: rakam+ayraç runı (≥10 hane çekirdek). normalize → 90XXXXXXXXXX (11-13 hane).
    const cands = text.match(/\+?\d[\d\s().\-]{8,}\d/g) || [];
    let phone = '';
    let phoneRaw = '';
    for (const c of cands) {
      const n = this.normalize(c);
      if (n.length >= 11 && n.length <= 13) { phone = n; phoneRaw = c; break; }
    }
    if (!phone) return false; // numara yok → bu komut değil, AI'ya bırak

    // Mesaj metni: önce tırnak içi; yoksa numara + komut kelimelerini eleyip kalan.
    let message = '';
    // Tırnaklı mesaj: AYNI tür tırnak çiftiyle eşle (içerideki kesme işareti "10'da" çift tırnağı
    //   erken kapatmasın). Sıra: düz çift → akıllı çift → «» → düz tek → akıllı tek.
    const q = text.match(/"([^"]{2,})"/) || text.match(/[“”]([^“”]{2,})[“”]/) || text.match(/«([^»]{2,})»/) || text.match(/'([^']{2,})'/) || text.match(/[‘’]([^‘’]{2,})[‘’]/);
    if (q) message = q[1].trim();
    if (!message) {
      const TR = 'a-zA-ZçğıöşüÇĞİıÖŞÜ'; // Türkçe harf kuyruğu (\w "ı/ş/ğ…" kapsamaz)
      message = text
        .replace(phoneRaw, ' ')
        .replace(new RegExp(`(şu|bu)\\s+(numara|mesaj|yaz|metn)[${TR}]*`, 'gi'), ' ')
        .replace(new RegExp(`numara[${TR}]*`, 'gi'), ' ')
        .replace(new RegExp(`(mesaj|metn|yaz[ıi]s)[${TR}]*`, 'gi'), ' ')
        .replace(/\b(g[öo]nder\w*|yolla\w*|ilet\w*|at[ıi]ver\w*|yaz[ıi]p)\b/gi, ' ')
        .replace(/[:>«»]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    const disp = phone.replace(/^90/, '0');
    if (message.length < 2) {
      await this.whatsapp.sendMessage(this.replyTarget(msg),
        `Numarayı (${disp}) anladım ama gönderilecek mesajı çıkaramadım. Şu biçimde yazar mısın: «${disp} numarasına: merhaba, …».`,
        ownerTenant.id).catch(() => false);
      return true;
    }
    const sent = await this.whatsapp.sendMessage(phone, message, ownerTenant.id).catch(() => false);
    await this.whatsapp.sendMessage(this.replyTarget(msg),
      sent
        ? `✓ ${disp} numarasına gönderildi:\n${message}`
        : `⚠️ ${disp} numarasına gönderilemedi (WhatsApp bağlantısı/şalter kapalı olabilir). Tekrar dener misin?`,
      ownerTenant.id).catch(() => false);
    return true;
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
    blocking?: boolean;  // true → LLM-yargıç gönderimden ÖNCE (mükellef hattı için)
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
    // Mükellef hattı (input.blocking=true) HER ZAMAN bloklayıcı: müşteriye gidecek cevap
    // gönderilmeden ÖNCE LLM-yargıçtan geçer (Max ücretsiz). "Akıcı ama yanlış" cevap
    // mükellefe ulaşmadan yakalanır. Owner hattı hızlı (FAST) kalır.
    const blockingEval = input.blocking === true || process.env.MOREN_AI_EVAL_BLOCKING === '1';
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
