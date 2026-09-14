import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BotTestRunnerService } from '../whatsapp/bot-test-runner.service';
import { QualityLogService } from '../whatsapp/quality-log.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class BotQACron {
  private readonly logger = new Logger(BotQACron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: BotTestRunnerService,
    private readonly quality: QualityLogService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 0 3 * * *', { timeZone: 'Europe/Istanbul' })
  async runNightlySyntheticTests() {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true, name: true, email: true } });
    for (const tenant of tenants.filter((t) => t.id && t.name !== 'Bot QA Scratch')) {
      try {
        const result = await this.runner.runNow(tenant.id);
        if (result.failed > 0) {
          // Aynı hata seti için günde 1 bildirim: başarısız test adlarının sıralı birleşiminin kısa özeti
          //   anahtara girer → set değişmedikçe tekrar düşmez, yeni bir test bozulunca yeni bildirim çıkar.
          const basarisizAdlar = (result.results || [])
            .filter((r: any) => !r.pass)
            .map((r: any) => String(r.scenarioKey || r.title || ''))
            .sort();
          const basarisizTestAdlariSha = createHash('sha1').update(basarisizAdlar.join('|')).digest('hex').slice(0, 12);
          await this.notifyTenant(tenant.id, {
            title: 'Bot QA testlerinde hata var',
            body: `${result.failed}/${result.total} sentetik WhatsApp bot testi basarisiz. Bot Kalite panelinden detaylari inceleyin.`,
            dedupeKey: `bot-qa-fail:${tenant.id}:${basarisizTestAdlariSha}`,
            dedupeWindowMin: 60 * 24,
          });
        }
      } catch (err: any) {
        this.logger.warn(`[BotQA] nightly tenant=${tenant.id} hata: ${err?.message || err}`);
      }
    }
  }

  @Cron('0 0 9 * * 1', { timeZone: 'Europe/Istanbul' })
  async sendWeeklyReport() {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true, name: true, email: true } });
    for (const tenant of tenants.filter((t) => t.id && t.name !== 'Bot QA Scratch')) {
      try {
        const summary = await this.quality.summary(tenant.id);
        const report = await this.quality.weeklyImprovementReport(tenant.id);
        const text = [
          `Bu hafta WhatsApp bot kalite ozeti`,
          `Toplam cevap/test: ${summary.count}`,
          `Ortalama skor: ${summary.averageScore}`,
          `Dusuk kalite: ${summary.lowQualityCount}`,
          `Tahmini eval maliyeti: $${summary.costUsd}`,
          '',
          'En sik nedenler:',
          ...(report.topReasons.length ? report.topReasons.map((r: any) => `- ${r.reason}: ${r.count}`) : ['- Belirgin sorun yok']),
          '',
          'Oneriler:',
          ...(report.suggestions || []).map((s: string) => `- ${s}`),
        ].join('\n');

        await this.notifyTenant(tenant.id, {
          title: 'Haftalik Bot Kalite raporu hazir',
          body: `Ortalama skor ${summary.averageScore}, dusuk kalite ${summary.lowQualityCount}. Bot Kalite panelinden inceleyin.`,
        });

        const recipients = await this.adminEmails(tenant.id, tenant.email);
        if (recipients.length) {
          await this.email.send(
            {
              to: recipients,
              subject: 'Moren Portal - Haftalik Bot Kalite Raporu',
              text,
            },
            tenant.id,
          ).catch((err) => {
            this.logger.warn(`[BotQA] weekly email atlandi: ${err?.message || err}`);
            return { sent: false };
          });
        }
      } catch (err: any) {
        this.logger.warn(`[BotQA] weekly tenant=${tenant.id} hata: ${err?.message || err}`);
      }
    }
  }

  @Cron('0 30 4 * * *', { timeZone: 'Europe/Istanbul' })
  async cleanupOldQualityLogs() {
    const result = await this.quality.deleteOlderThan(90);
    if (result.logs || result.feedback) {
      this.logger.log(`[BotQA] retention temizlendi logs=${result.logs} feedback=${result.feedback}`);
    }
  }

  private async notifyTenant(
    tenantId: string,
    input: { title: string; body: string; dedupeKey?: string; dedupeWindowMin?: number },
  ) {
    await this.notifications.create({
      tenantId,
      type: 'AI',
      title: input.title,
      body: input.body,
      metadata: { module: 'bot-quality' },
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey, dedupeWindowMin: input.dedupeWindowMin } : {}),
    }).catch(() => null);
  }

  private async adminEmails(tenantId: string, fallback?: string | null): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, userRoles: { some: { role: { name: 'ADMIN' } } } },
      select: { email: true },
      take: 10,
    }).catch(() => []);
    const emails = users.map((u) => u.email).filter(Boolean);
    if (!emails.length && fallback) emails.push(fallback);
    return Array.from(new Set(emails));
  }
}
