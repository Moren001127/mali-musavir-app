import { Body, Controller, Get, Logger, Post, Query, Res } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MorenAiService } from '../moren-ai/moren-ai.service';
import { WhatsAppService } from './whatsapp.service';

@Controller('whatsapp/webhook')
export class WhatsAppBotController {
  private readonly logger = new Logger(WhatsAppBotController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly morenAi: MorenAiService,
    private readonly whatsapp: WhatsAppService,
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

    const prompt = [
      'Bu mesaj WhatsApp mükellef botundan geldi.',
      'Cevap mükellefe gidecek; kısa, net ve sadece kendi kayıtlarıyla ilgili konuş.',
      'Beyanname gönderme, ödeme taahhüdü, hukuki/vergisel kesin karar gibi kritik konularda "mali müşaviriniz kontrol edip dönecek" de.',
      `Mükellef mesajı: ${msg.text}`,
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
