import { Body, Controller, Get, Logger, Optional, Post, Query, Res } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MorenAiService } from '../moren-ai/moren-ai.service';
import { WhatsAppService } from './whatsapp.service';
import { AutomationEventBus } from '../automations/automation-event-bus.service';

@Controller('whatsapp/webhook')
export class WhatsAppBotController {
  private readonly logger = new Logger(WhatsAppBotController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly morenAi: MorenAiService,
    private readonly whatsapp: WhatsAppService,
    @Optional() private readonly eventBus?: AutomationEventBus,
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

  private extractMessages(body: any): Array<{ from: string; text: string; id?: string }> {
    const out: Array<{ from: string; text: string; id?: string }> = [];
    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        for (const m of change?.value?.messages || []) {
          const text = m?.text?.body || m?.button?.text || '';
          if (m?.from && text) out.push({ from: m.from, text, id: m.id });
        }
      }
    }
    return out;
  }

  private normalize(raw?: string | null): string {
    if (!raw) return '';
    let digits = String(raw).replace(/[^\d]/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) digits = '90' + digits.slice(1);
    if (digits.length === 10 && digits.startsWith('5')) digits = '90' + digits;
    return digits;
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

    const tenants = await this.prisma.tenant.findMany({
      where: { phone: { not: null } },
      select: { id: true, name: true, slug: true, phone: true },
      take: 200,
    });
    return tenants.find((t) => this.normalize(t.phone) === normalized) || null;
  }

  private async handleMessage(msg: { from: string; text: string; id?: string }) {
    const ownerTenant = await this.findOwnerTenantByPhone(msg.from);
    if (ownerTenant) {
      const prompt = [
        'Bu mesaj ofis sahibinden WhatsApp uzerinden geldi.',
        'Cevap kisa ve is odakli olsun. Portal verilerini kullan, gerekirse tool calistir.',
        'Kritik islemlerde komutu dogrudan calistirma; once onizleme ve ONAYLIYORUM iste.',
        'Agent yonlendirme gerekiyorsa hangi agent/action/payload olacagini net soyle.',
        `Ofis sahibi mesaji: ${msg.text}`,
      ].join('\n');

      const answer = await this.morenAi.chat(ownerTenant.id, null, {
        message: prompt,
        voiceMode: true,
      });
      const reply = (answer.assistantMessage || '').slice(0, 1400);
      if (reply) await this.whatsapp.sendMessage(msg.from, reply);
      return;
    }

    const taxpayer: any = await this.findTaxpayerByPhone(msg.from);
    if (!taxpayer) {
      this.logger.warn(`WhatsApp bot: telefon eşleşmedi ${msg.from}`);
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
        content: msg.text,
        occurredAt: new Date(),
      },
    });

    const taxpayerName =
      taxpayer.companyName ||
      `${taxpayer.firstName || ''} ${taxpayer.lastName || ''}`.trim() ||
      'Mukellef';
    await this.prisma.notification.create({
      data: {
        tenantId: taxpayer.tenantId,
        type: 'WHATSAPP',
        title: `WhatsApp mesaji: ${taxpayerName}`,
        body: msg.text.slice(0, 240),
        metadata: {
          taxpayerId: taxpayer.id,
          phone: msg.from,
          messageId: msg.id || null,
        },
      },
    }).catch(() => null);

    await this.maybeCreateDocumentRequestTask(taxpayer, msg.text);

    const guardedReply = this.buildGuardedTaxpayerReply(msg.text);
    if (guardedReply) {
      await this.whatsapp.sendMessage(msg.from, guardedReply);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: taxpayer.id,
          channel: 'WHATSAPP',
          subject: 'WhatsApp bot cevabi',
          content: guardedReply,
          occurredAt: new Date(),
        },
      });
      return;
    }

    const prompt = [
      'Bu mesaj WhatsApp mukellef botundan geldi.',
      'KURAL USTUNLUGU: Bu WhatsApp mukellef cevabi kurallari genel Moren AI ton kurallarinin ustundedir.',
      'SADECE mukellefe gidecek nihai WhatsApp cevabini yaz.',
      'Baslik, markdown, madde isareti, emoji, ic not, ofis notu, neden bu cevap, test modu, arac/tool aciklamasi YAZMA.',
      'Kendine Moren AI deme; "ofisimiz" veya "Moren Mali Musavirlik" gibi konus.',
      'Cevap 1-3 kisa cumle olsun; sicak, net, profesyonel ve taahhut vermeyen bir dil kullan.',
      'Sadece kendi kayitlariyla ilgili konus. Portal verisi yoksa rakam veya durum uydurma; "kontrol edip size donus yapacagiz" de.',
      'Tool/veri sonucu yoksa evrak listesi, KDV tutari, odeme tarihi, beyanname durumu, tahsilat ve cari bakiye konularinda sadece kontrol edip donus yapilacagini soyle.',
      'Evrak listesi, donem, tutar, mail gonderimi, isleme alma, eksik var/yok gibi bilgileri tool/veri sonucu olmadan ASLA uydurma.',
      'Beyanname gonderme, odeme taahhudu, hukuki/vergisel kesin karar gibi kritik konularda "mali musaviriniz kontrol edip size donus yapacak" de.',
      'Dekont/evrak/belge bildirimi varsa alindigini soyle, kontrol icin ofise iletildigini belirt; tarih/saat taahhudu verme.',
      'Kendi kendine gun, tarih, saat, sure, "hemen", "bugun", "yarin", "haftaya kadar" gibi taahhut ekleme.',
      'Mukellef tarih onerirse kabul/ret verme; "Notunuzu aldik, ofis takvimine gore kontrol edecegiz." de.',
      `Mukellef mesaji: ${msg.text}`,
    ].join('\n');

    const answer = await this.morenAi.chat(taxpayer.tenantId, null, {
      taxpayerId: taxpayer.id,
      message: prompt,
      voiceMode: true,
    });

    const reply = (answer.assistantMessage || '').slice(0, 1200);
    if (reply) {
      await this.whatsapp.sendMessage(msg.from, reply);
      await this.prisma.communicationLog.create({
        data: {
          taxpayerId: taxpayer.id,
          channel: 'WHATSAPP',
          subject: 'WhatsApp bot cevabı',
          content: reply,
          occurredAt: new Date(),
        },
      });
    }
  }

  private buildGuardedTaxpayerReply(text: string): string | null {
    const t = this.normalizeText(text);

    if (/(beyanname|beyan|tahakkuk)/i.test(t) && /(ver|gonder|gonderin|onay|imza|imzala)/i.test(t)) {
      return 'Beyanname islemi mali musavir kontrolunden gecmeden yapilmaz. Kontrol sonrasi size net bilgi verilecek.';
    }

    if (/(kdv|borc|borcu|odeme|tutar|ne kadar)/i.test(t)) {
      return 'KDV tutari ve odeme tarihi kayitlarinizdan kontrol edilecek. Kesin bilgiyle size donus yapilacak.';
    }

    if (/(dekont|makbuz)/i.test(t)) {
      return 'Dekont ofise iletildi. Kontrol sonrasi size bilgi verilecek.';
    }

    if (/(bugun|yarin|gelemeyecegim|gelemem|getirsem|ugrasam|biraksam)/i.test(t)) {
      return 'Ofis takvimine gore kontrol edilecek. Uygunluk durumuna gore size donus yapilacak.';
    }

    if (/(evrak|belge|fis|fatura)/i.test(t) && /(hangi|ne|gerek|eksik|getir|gonder|ilettim|gonderdim)/i.test(t)) {
      return 'Evrak durumunuz ve donem takviminiz kontrol edilecek. Gerekli belge listesi size bildirilecek.';
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
}
