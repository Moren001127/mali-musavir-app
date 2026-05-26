import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WhatsAppBotContextService {
  constructor(private readonly prisma: PrismaService) {}

  async buildTaxpayerContextBlock(tenantId: string, taxpayerId: string): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const [taxpayer, status, openTasks, recentMessages, cariRows, learnedMemories] = await Promise.all([
      this.prisma.taxpayer.findFirst({
        where: { id: taxpayerId, tenantId },
        select: {
          id: true,
          companyName: true,
          firstName: true,
          lastName: true,
          taxNumber: true,
          type: true,
          startDate: true,
          endDate: true,
        },
      }),
      (this.prisma as any).taxpayerMonthlyStatus.findFirst({
        where: { tenantId, taxpayerId, year, month },
      }).catch(() => null),
      this.prisma.taskReminder.findMany({
        where: { taxpayerId, isCompleted: false },
        orderBy: { dueDate: 'asc' },
        take: 8,
        select: { title: true, description: true, dueDate: true },
      }).catch(() => []),
      this.prisma.communicationLog.findMany({
        where: { taxpayerId, channel: 'WHATSAPP' },
        orderBy: { occurredAt: 'desc' },
        take: 10,
        select: { subject: true, content: true, occurredAt: true },
      }).catch(() => []),
      (this.prisma as any).cariHareket.findMany({
        where: { tenantId, taxpayerId },
        select: { tip: true, tutar: true },
      }).catch(() => []),
      this.loadTaxpayerMemories(tenantId, taxpayerId),
    ]);

    if (!taxpayer) return '';

    const outstandingBalance = (cariRows || []).reduce((sum: number, row: any) => {
      const amount = this.toNumber(row.tutar);
      if (row.tip === 'TAHAKKUK') return sum + amount;
      if (row.tip === 'TAHSILAT') return sum - amount;
      return sum;
    }, 0);

    const chronologicalMessages = recentMessages.reverse().map((log: any) => ({
      direction: /gelen/i.test(log.subject || '') ? 'incoming' : 'outgoing',
      text: this.cleanMessage(log.content),
      occurredAt: log.occurredAt,
    }));
    const lastOutgoingReplies = chronologicalMessages
      .filter((message) => message.direction === 'outgoing')
      .slice(-3)
      .map((message) => message.text)
      .filter(Boolean);

    const payload = {
      taxpayer: {
        id: taxpayer.id,
        name: this.displayName(taxpayer),
        vkn: taxpayer.taxNumber,
        type: taxpayer.type,
        startDate: taxpayer.startDate,
        endDate: taxpayer.endDate,
      },
      currentMonth: {
        year,
        month,
        evraklarGeldi: Boolean(status?.evraklarGeldi),
        evraklarIslendi: Boolean(status?.evraklarIslendi),
        kontrolEdildi: Boolean(status?.kontrolEdildi),
        beyannameVerildi: Boolean(status?.beyannameVerildi),
        kdvKontrolEdildi: Boolean(status?.kdvKontrolEdildi),
      },
      openTasks: openTasks.map((task: any) => ({
        title: task.title,
        dueAt: task.dueDate,
      })),
      recentMessages: chronologicalMessages,
      learnedMemory: learnedMemories.map((memory: any) => ({
        title: String(memory.title || '').slice(0, 120),
        content: this.cleanMemoryContent(memory.content),
        tags: Array.isArray(memory.tags) ? memory.tags.slice(0, 8) : [],
        updatedAt: memory.updatedAt,
      })),
      lastOutgoingReplies,
      outstandingBalance: outstandingBalance > 0 ? outstandingBalance : null,
    };

    return [
      '## WhatsApp Mükellef Context',
      'Bu veri sadece aktif konuşmanın mükellefine aittir. Başka mükellef verisi kullanma.',
      JSON.stringify(payload, null, 2),
    ].join('\n');
  }

  async buildRecentWhatsAppContext(taxpayerId: string): Promise<string> {
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
      const at = log.occurredAt.toISOString().slice(0, 16).replace('T', ' ');
      return `- ${at} ${speaker}: ${this.cleanMessage(log.content) || '(bos)'}`;
    });

    return [
      '## Bu kisiyle son WhatsApp konusmalari',
      'Cevabi bu gecmise gore baglamli ver; ayni bilgiyi gereksiz tekrar etme. Gecmisteki belirsiz bilgileri kesin bilgi gibi sunma.',
      'Son cevaplarini tekrar etme, varyasyon kullan. Art arda "ofise iletildi", "kontrol edilecek", "donus yapacak" kaliplarini kullanma; daha dogal ve kisa soyle.',
      rows.join('\n'),
    ].join('\n');
  }

  async refreshConversationMemory(tenantId: string, taxpayerId: string): Promise<void> {
    const aiMemory = (this.prisma as any).aiMemory;
    if (!aiMemory?.findFirst || !aiMemory?.create || !aiMemory?.update) return;

    const [taxpayer, logs, totalLogs, existing] = await Promise.all([
      this.prisma.taxpayer.findFirst({
        where: { id: taxpayerId, tenantId },
        select: {
          id: true,
          companyName: true,
          firstName: true,
          lastName: true,
        },
      }).catch(() => null),
      this.prisma.communicationLog.findMany({
        where: { taxpayerId, channel: 'WHATSAPP' },
        orderBy: { occurredAt: 'desc' },
        take: 80,
        select: { subject: true, content: true, occurredAt: true },
      }).catch(() => []),
      this.prisma.communicationLog.count({
        where: { taxpayerId, channel: 'WHATSAPP' },
      }).catch(() => 0),
      aiMemory.findFirst({
        where: {
          tenantId,
          taxpayerId,
          scope: 'taxpayer',
          source: 'whatsapp-auto-memory',
          isActive: true,
        },
        orderBy: { updatedAt: 'desc' },
      }).catch(() => null),
    ]);

    if (!taxpayer || !logs.length) return;

    const chronological = logs.reverse().map((log: any) => ({
      direction: this.isOutgoingSubject(log.subject) ? 'outgoing' : 'incoming',
      text: this.cleanMessage(log.content),
      occurredAt: log.occurredAt instanceof Date ? log.occurredAt : new Date(log.occurredAt),
    })).filter((message: any) => message.text);

    const incomingMessages = chronological.filter((message: any) => message.direction === 'incoming');
    const outgoingMessages = chronological.filter((message: any) => message.direction === 'outgoing');
    const explicitNotes = this.extractExplicitMemoryNotes(incomingMessages);
    const previousNotes = this.extractPreviousDurableNotes(existing?.content);
    const durableNotes = this.dedupeStrings([...explicitNotes, ...previousNotes]).slice(0, 12);
    const topics = this.topicLabels(chronological.map((message: any) => message.text));
    const lastIncoming = incomingMessages.length ? incomingMessages[incomingMessages.length - 1].text : null;
    const lastOutgoing = outgoingMessages.length ? outgoingMessages[outgoingMessages.length - 1].text : null;
    const today = new Date().toISOString().slice(0, 10);

    const content = [
      'Mukellefle WhatsApp konusmalarindan otomatik ogrenilen hafiza.',
      `Mukellef: ${this.displayName(taxpayer)}.`,
      `Toplam WhatsApp kaydi: ${totalLogs}. Son guncelleme: ${today}.`,
      'Kalici notlar:',
      durableNotes.length ? durableNotes.map((note) => `- ${note}`).join('\n') : '- Henuz belirgin kalici tercih veya aliskanlik yok.',
      `Son konular: ${topics.length ? topics.join(', ') : 'belirgin konu yok'}.`,
      lastIncoming ? `Son gelen: ${this.maskSensitive(lastIncoming).slice(0, 260)}` : null,
      lastOutgoing ? `Son ofis cevabi: ${this.maskSensitive(lastOutgoing).slice(0, 260)}` : null,
      'Cevap uretirken bu hafizayi sessizce kullan; eski konusmalarla celisme ve kesin olmayan bilgiyi kesin bilgi gibi sunma.',
    ].filter(Boolean).join('\n').slice(0, 3000);

    const data = {
      title: 'WhatsApp konusma hafizasi',
      content,
      importance: 4,
      tags: ['whatsapp', 'conversation-summary', 'auto-memory'],
    };

    if (existing?.id) {
      await aiMemory.update({
        where: { id: existing.id },
        data,
      }).catch(() => null);
      return;
    }

    await aiMemory.create({
      data: {
        tenantId,
        taxpayerId,
        scope: 'taxpayer',
        title: data.title,
        content: data.content,
        source: 'whatsapp-auto-memory',
        importance: data.importance,
        tags: data.tags,
        createdBy: 'whatsapp-bot',
      },
    }).catch(() => null);
  }

  async getRecentOutgoingReplies(taxpayerId: string, limit = 3): Promise<string[]> {
    const logs: Array<{ subject: string | null; content: string | null }> = await this.prisma.communicationLog.findMany({
      where: { taxpayerId, channel: 'WHATSAPP' },
      orderBy: { occurredAt: 'desc' },
      take: 20,
      select: { subject: true, content: true },
    }).catch(() => [] as Array<{ subject: string | null; content: string | null }>);

    return logs
      .filter((log) => this.isOutgoingSubject(log.subject))
      .slice(0, limit)
      .map((log) => this.cleanMessage(log.content))
      .filter(Boolean);
  }

  private isOutgoingSubject(subject?: string | null): boolean {
    const s = String(subject || '').toLocaleLowerCase('tr-TR');
    if (/gelen|mukellef sorusu|müvekkelden|kayitsiz numara|kayıtsız numara|owner gelen/.test(s)) return false;
    return /bot|cevab|cevap|portal|sablon|medya|gonder|gönder|rate limit/.test(s);
  }

  private async loadTaxpayerMemories(tenantId: string, taxpayerId: string, limit = 8): Promise<any[]> {
    const aiMemory = (this.prisma as any).aiMemory;
    if (!aiMemory?.findMany) return [];
    return aiMemory.findMany({
      where: { tenantId, taxpayerId, scope: 'taxpayer', isActive: true },
      orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    }).catch(() => []);
  }

  private extractExplicitMemoryNotes(messages: Array<{ text: string; occurredAt: Date }>): string[] {
    const durablePattern = /(bundan sonra|lutfen|lütfen|tercih|istemiyorum|istiyorum|mail|e-?posta|dekont|evrak|belge|fatura|beyanname|odeme|ödeme|randevu|gelemem|getirecegim|getireceğim|gonderecegim|göndereceğim|adres|telefon|iban)/i;
    const sensitivePattern = /(sifre|şifre|parola|password|token|api\s*key|gizli anahtar)/i;
    const notes: string[] = [];

    for (const message of [...messages].reverse()) {
      const cleaned = this.maskSensitive(message.text);
      if (!cleaned || sensitivePattern.test(cleaned) || !durablePattern.test(cleaned)) continue;
      const date = message.occurredAt?.toISOString?.().slice(0, 10) || new Date().toISOString().slice(0, 10);
      notes.push(`${date}: ${cleaned.slice(0, 220)}`);
      if (notes.length >= 12) break;
    }

    return this.dedupeStrings(notes);
  }

  private extractPreviousDurableNotes(content?: string | null): string[] {
    return String(content || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- ') && !/Henuz belirgin/i.test(line))
      .map((line) => line.replace(/^-+\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  private topicLabels(messages: string[]): string[] {
    const text = this.normalizeForSearch(messages.join(' '));
    const topics: string[] = [];
    if (/(evrak|belge|fis|fatura|makbuz|dekont)/.test(text)) topics.push('evrak/belge');
    if (/(odeme|tahsilat|borc|bakiye|dekont)/.test(text)) topics.push('odeme/cari');
    if (/(beyanname|beyan|kdv|muhtasar|sgk|tahakkuk)/.test(text)) topics.push('beyanname/vergi');
    if (/(randevu|tarih|bugun|yarin|hafta|gelemem|getirecegim|ugrayacagim)/.test(text)) topics.push('takvim/randevu');
    if (/(mail|eposta|e posta|telefon|adres|whatsapp)/.test(text)) topics.push('iletisim tercihi');
    if (/(sikayet|memnun|kizgin|acil|gecikti|donmediniz)/.test(text)) topics.push('memnuniyet/aciliyet');
    return topics.slice(0, 6);
  }

  private normalizeForSearch(raw: string): string {
    return String(raw || '')
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i');
  }

  private dedupeStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
      const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
      if (!cleaned) continue;
      const key = this.normalizeForSearch(cleaned).replace(/[^a-z0-9]+/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cleaned);
    }
    return out;
  }

  private cleanMessage(content?: string | null): string {
    return String(content || '')
      .replace(/\[\[wa_phone:[^\]]+\]\]/g, '')
      .replace(/\[\[document:([^|\]]+)\|([^\]]+)\]\]/g, '[dosya: $2]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  }

  private cleanMemoryContent(content?: string | null): string {
    return this.maskSensitive(String(content || '').replace(/\s+/g, ' ').trim()).slice(0, 1200);
  }

  private maskSensitive(value: string): string {
    return String(value || '')
      .replace(/\[\[wa_phone:[^\]]+\]\]/g, '')
      .replace(/\bTR\d{2}\s?(?:\d{4}\s?){5}\d{2}\b/gi, 'TR** **** **** **** **** **** **')
      .replace(/\b(?:\d[\s-]?){10,16}\b/g, (match) => {
        const digits = match.replace(/\D/g, '');
        return digits.length >= 10 ? `${digits.slice(0, 2)}***${digits.slice(-2)}` : match;
      })
      .replace(/\b(sifre|şifre|parola|password|token|api\s*key|gizli anahtar)[^.!?\n]{0,120}/gi, '[gizli bilgi maskelendi]')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private displayName(t: { companyName?: string | null; firstName?: string | null; lastName?: string | null }) {
    return t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'Mukellef';
  }

  private toNumber(value: any): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number(value) || 0;
    if (value && typeof value.toNumber === 'function') return value.toNumber();
    if (value && typeof value.toString === 'function') return Number(value.toString()) || 0;
    return 0;
  }
}
