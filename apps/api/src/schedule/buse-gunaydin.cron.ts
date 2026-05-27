import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { MorenAiService } from '../moren-ai/moren-ai.service';

/**
 * Buse'ye her sabah 09:15 (Europe/Istanbul) yaratıcı/farklı bir günaydın mesajı
 * gönderir. "Günaydın" yazmaz — AI ile her gün farklı, samimi, sevgili tonunda
 * mesaj üretir. Aynı kalıbın tekrarlanmaması için son 7 mesajı history olarak verir.
 *
 * Telefon ve isim, controller'daki personal contact mantığı ile aynı kaynaktan gelir:
 *   process.env.MOREN_PERSONAL_CONTACT_PHONES  (örn. "905363048246:Buse")
 *   Yoksa default: "905363048246:Buse"
 *
 * Manuel test için: POST /whatsapp/internal/test-buse-gunaydin
 * (whatsapp-bot.controller.ts'e endpoint eklenecek; bu service'i çağırır.)
 */
@Injectable()
export class BuseGunaydinCron {
  private readonly logger = new Logger(BuseGunaydinCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly morenAi: MorenAiService,
  ) {}

  /** Her gün İstanbul saati 09:15. */
  @Cron('15 9 * * *', { timeZone: 'Europe/Istanbul' })
  async dailyMorningMessage() {
    await this.send('cron');
  }

  /**
   * GEÇİCİ TEST CRON — İstanbul 04:15.
   * Test sonrası bu metodu silebilirsin (production'da 09:15 cron'u zaten var).
   * Üretilen mesaj normal günaydın mesajı ile aynı — "test" damgası yok.
   */
  @Cron('15 4 * * *', { timeZone: 'Europe/Istanbul' })
  async testMorningMessage_0415() {
    await this.send('cron');
  }

  /**
   * Tekrar kullanılabilir gönderim fonksiyonu — hem cron hem manuel endpoint
   * tarafından çağrılır.
   */
  async send(trigger: 'cron' | 'manual'): Promise<{ ok: boolean; reason?: string; reply?: string }> {
    // 1) Buse'nin telefon + adı
    const raw = (String(process.env.MOREN_PERSONAL_CONTACT_PHONES || '').trim()) || '905363048246:Buse';
    const firstEntry = raw.split(',')[0] || '';
    const [phonePart, namePart] = firstEntry.split(':').map((s) => (s || '').trim());
    const phone = this.normalizePhone(phonePart);
    const her = (namePart || 'Buse').trim();
    if (!phone) {
      this.logger.warn(`[BuseGunaydin] phone yok, trigger=${trigger}`);
      return { ok: false, reason: 'phone-yok' };
    }

    // 2) Tenant
    const tenantId = await this.resolveTenantId();
    if (!tenantId) {
      this.logger.warn(`[BuseGunaydin] tenant yok, trigger=${trigger}`);
      return { ok: false, reason: 'tenant-yok' };
    }

    // 3) Buse için contact kaydı (controller'daki ile aynı yapı)
    const contact = await this.ensurePersonalContact(tenantId, phone, her);

    // 4) Son 7 günaydın mesajını al — aynı kalıp tekrarlanmasın
    const recent = await this.prisma.communicationLog.findMany({
      where: {
        taxpayerId: contact.id,
        channel: 'WHATSAPP',
        subject: { contains: 'gunaydin' },
      },
      orderBy: { occurredAt: 'desc' },
      take: 7,
      select: { content: true },
    }).catch(() => []);
    const lastMornings = recent
      .map((r) => String(r.content || '').replace(/\[\[wa_phone:[^\]]+\]\]\n?/g, '').trim())
      .filter(Boolean)
      .slice(0, 7);

    // 5) AI ile yaratıcı günaydın üret
    const ownerName = String(process.env.MOREN_OWNER_DISPLAY_NAME || 'Muzaffer').trim() || 'Muzaffer';
    const prompt = [
      `Sen ${ownerName}'in (mali müşavir) yapay zeka asistanısın. Karşındaki kişi ${ownerName}'in SEVGİLİSİ ${her}.`,
      `Şu anda sabah, ${her}'ye günaydın mesajı yazıyorsun — ama AMA "günaydın canım" gibi KURU bir mesaj DEĞİL. Yaratıcı, samimi, dokunaklı, kalpli, sevgili tonunda yeni bir mesaj.`,
      '',
      'KURALLAR:',
      `- 1-3 cümle, gerçek WhatsApp mesajı uzunluğunda.`,
      `- "Günaydın" kelimesi tek başına olmasın — bambaşka bir giriş yap. ("Sabah açıldı ve ilk aklıma sen geldin", "Uyandın mı tatlım", "Güneşten önce sen doğdun bugün de" gibi).`,
      `- ${ownerName}'in sana (asistana) ${her}'yi nasıl anlattığını yansıt. Onun sevgisini ve hayranlığını taşı.`,
      `- Övgü/somut iltifat olabilir (gülüşü, sesi, varlığı). Ama her sabah aynı kalıbı tekrar ETME.`,
      `- Emoji BOL — özellikle kalp ve sabah temalı: ❤️ 🩷 💕 💖 💘 ☀️ 🌅 🌷 🌹 ✨ 🥹 😘 🤍`,
      `- 2-4 emoji rahatlıkla.`,
      `- Markdown yok, "Cevap:" gibi etiket yok, doğrudan mesaj.`,
      `- İş/evrak/fatura/ofis konularına ASLA değinme.`,
      `- ${ownerName} adına KESİN söz verme.`,
      '',
      lastMornings.length
        ? `═══ SON GÖNDERİLEN GÜNAYDIN MESAJLARI (tekrarlama, BAMBAŞKA bir cümle kur) ═══\n${lastMornings.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n═══════════════════════════════════════════`
        : '',
      '',
      `SADECE ${her}'ye gönderilecek mesaj metnini yaz — başka hiçbir şey yazma.`,
    ].filter(Boolean).join('\n');

    let aiText = '';
    try {
      const answer = await this.morenAi.chat(tenantId, null, {
        message: prompt,
        voiceMode: false,
        toolMode: 'none',
      } as any);
      aiText = (answer.assistantMessage || '').slice(0, 600);
    } catch (err: any) {
      this.logger.warn(`[BuseGunaydin] AI hatasi: ${err?.message || err}`);
      return { ok: false, reason: 'ai-hata' };
    }

    const reply = this.lightCleanup(aiText);
    if (!reply) {
      this.logger.warn(`[BuseGunaydin] bos cevap`);
      return { ok: false, reason: 'bos-cevap' };
    }

    // 6) Gönder + log
    let sent = false;
    try {
      sent = !!(await this.whatsapp.sendMessage(phone, reply, tenantId));
    } catch (err: any) {
      this.logger.warn(`[BuseGunaydin] gonderim hatasi: ${err?.message || err}`);
    }

    await this.prisma.communicationLog.create({
      data: {
        taxpayerId: contact.id,
        channel: 'WHATSAPP',
        subject: sent
          ? `WhatsApp ${her} (kisisel) gunaydin (${trigger})`
          : `WhatsApp ${her} (kisisel) gunaydin gonderilemedi (${trigger})`,
        content: `[[wa_phone:${phone}]]\n${reply}`,
        occurredAt: new Date(),
      },
    }).catch(() => null);

    this.logger.log(`[BuseGunaydin] trigger=${trigger} sent=${sent} len=${reply.length}`);
    return { ok: sent, reply };
  }

  private normalizePhone(raw?: string | null): string {
    if (!raw) return '';
    let digits = String(raw).replace(/[^\d]/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) digits = '90' + digits.slice(1);
    if (digits.length === 10 && digits.startsWith('5')) digits = '90' + digits;
    return digits;
  }

  private async resolveTenantId(): Promise<string | null> {
    const envId = process.env.MOREN_OWNER_TENANT_ID;
    if (envId) {
      const t = await this.prisma.tenant.findUnique({
        where: { id: envId },
        select: { id: true },
      }).catch(() => null);
      if (t) return t.id;
    }
    const slug = process.env.MOREN_OWNER_TENANT_SLUG || process.env.DEFAULT_TENANT_SLUG || 'moren';
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug },
      select: { id: true },
    }).catch(() => null);
    if (tenant) return tenant.id;
    // Son fallback: tek tenant varsa
    const all = await this.prisma.tenant.findMany({ select: { id: true }, take: 2 }).catch(() => []);
    if (all.length === 1) return all[0].id;
    return null;
  }

  private async ensurePersonalContact(tenantId: string, phone: string, name: string) {
    const taxNumber = `WHATSAPP-PERSONAL-${phone}`;
    const existing = await this.prisma.taxpayer.findFirst({
      where: {
        tenantId,
        OR: [{ taxNumber }, { phone }, { phones: { has: phone } }],
      },
      select: { id: true, tenantId: true, companyName: true, taxNumber: true, phone: true, phones: true },
    });
    if (existing) return existing;
    return this.prisma.taxpayer.create({
      data: {
        tenantId,
        type: 'GERCEK_KISI',
        companyName: name,
        taxNumber,
        taxOffice: 'WHATSAPP',
        phone,
        phones: [phone],
        emails: [],
        notes: 'Ofis sahibi tarafindan tanimlanmis kisisel kontak (WhatsApp gunaydin cron).',
        isActive: true,
        whatsappEvrakTalep: false,
        whatsappEvrakGeldi: false,
      },
      select: { id: true, tenantId: true, companyName: true, taxNumber: true, phone: true, phones: true },
    });
  }

  /** Markdown ayraçlarını ve AI iç-monolog prefix'lerini sil. */
  private lightCleanup(raw: string): string {
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
    if (text.length > 500) text = text.slice(0, 500).replace(/\s+\S*$/, '').trim();
    return text;
  }
}
