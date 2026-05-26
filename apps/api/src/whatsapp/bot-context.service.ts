import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WhatsAppBotContextService {
  constructor(private readonly prisma: PrismaService) {}

  async buildTaxpayerContextBlock(tenantId: string, taxpayerId: string): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const [taxpayer, status, openTasks, recentMessages, cariRows] = await Promise.all([
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
    ]);

    if (!taxpayer) return '';

    const outstandingBalance = (cariRows || []).reduce((sum: number, row: any) => {
      const amount = this.toNumber(row.tutar);
      if (row.tip === 'TAHAKKUK') return sum + amount;
      if (row.tip === 'TAHSILAT') return sum - amount;
      return sum;
    }, 0);

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
      recentMessages: recentMessages.reverse().map((log: any) => ({
        direction: /gelen/i.test(log.subject || '') ? 'incoming' : 'outgoing',
        text: this.cleanMessage(log.content),
        occurredAt: log.occurredAt,
      })),
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
      rows.join('\n'),
    ].join('\n');
  }

  private cleanMessage(content?: string | null): string {
    return String(content || '')
      .replace(/\[\[document:([^|\]]+)\|([^\]]+)\]\]/g, '[dosya: $2]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
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
