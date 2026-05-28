import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

/**
 * Gorev (Task) mail hatirlatma cron'u.
 *
 * Her sabah 07:00 Europe/Istanbul calisir.
 * Kurallar:
 *   1) Task aktif olmali (status != COMPLETED, != CANCELLED)
 *   2) Task.notifyEmail = true olmali (kullanici e-posta bildirim istemis)
 *   3) Task.dueDate bugun veya yarin (Istanbul TZ)
 *   4) TaskReminderLog'da bugun icin EMAIL channel + SENT durumu olmamali (duplicate koruma)
 *
 * Mail alicilari:
 *   - Task.createdBy.email (gorevi olusturan)
 *   - Tenant.email (ofis ana adresi, varsa)
 *   - Duplicate adresler tekillestirilir
 *
 * Mail icerigi:
 *   - Subject: "Gorev Hatirlatma — [bugun|yarin]: [title]"
 *   - Body: title, vade tarihi/saati, oncelik, kategori, aciklama
 *
 * Loglama:
 *   - Her gonderim (basarili veya basarisiz) TaskReminderLog'a yazilir
 *   - scheduledFor = bugunun gunu (00:00 Istanbul)
 *   - channel = "EMAIL", status = "SENT" | "FAILED"
 */
@Injectable()
export class TaskReminderCron {
  private readonly logger = new Logger(TaskReminderCron.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  /** Her sabah 07:00 Europe/Istanbul */
  @Cron('0 7 * * *', { timeZone: 'Europe/Istanbul' })
  async run() {
    this.logger.log('[TaskReminderCron] Tarama basliyor');
    try {
      const tenants = await (this.prisma as any).tenant.findMany({
        select: { id: true, name: true, email: true },
      });

      let total = 0;
      let sent = 0;
      let skipped = 0;
      let failed = 0;

      for (const tenant of tenants) {
        const result = await this.runForTenant(tenant).catch((err) => {
          this.logger.warn(`[TaskReminderCron] tenant=${tenant.id} hata: ${err?.message || err}`);
          return { total: 0, sent: 0, skipped: 0, failed: 0 };
        });
        total += result.total;
        sent += result.sent;
        skipped += result.skipped;
        failed += result.failed;
      }

      this.logger.log(
        `[TaskReminderCron] Tamam: tenant=${tenants.length} task=${total} sent=${sent} skipped=${skipped} failed=${failed}`,
      );
    } catch (err: any) {
      this.logger.error(`[TaskReminderCron] Genel hata: ${err?.message || err}`);
    }
  }

  private async runForTenant(tenant: { id: string; name: string | null; email: string | null }) {
    const { todayStart, todayEnd, tomorrowStart, tomorrowEnd, todayKey } = this.istanbulWindow();

    // Hedef: dueDate bugun veya yarin olan, aktif, notifyEmail=true gorevler
    const tasks = await (this.prisma as any).task.findMany({
      where: {
        tenantId: tenant.id,
        notifyEmail: true,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        dueDate: { gte: todayStart, lt: tomorrowEnd },
      },
      include: {
        createdBy: { select: { id: true, email: true, firstName: true, lastName: true } },
        taxpayer: { select: { id: true, companyName: true, firstName: true, lastName: true } },
      },
    });

    if (!tasks.length) {
      return { total: 0, sent: 0, skipped: 0, failed: 0 };
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const task of tasks) {
      // Duplicate koruma: bugun icin EMAIL/SENT log var mi?
      const existing = await (this.prisma as any).taskReminderLog.findFirst({
        where: {
          taskId: task.id,
          channel: 'EMAIL',
          status: 'SENT',
          scheduledFor: { gte: todayStart, lt: tomorrowStart },
        },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      // Alicilari topla: olusturan + ofis ana adresi
      const recipients = new Set<string>();
      if (task.createdBy?.email) recipients.add(task.createdBy.email.trim().toLowerCase());
      if (tenant.email) recipients.add(tenant.email.trim().toLowerCase());

      if (!recipients.size) {
        skipped++;
        // Yine de log birakalim ki hangi gorev icin alici olmadigini bilelim
        await this.writeLog(task.id, todayStart, 'SKIPPED', 'Alici e-postasi yok').catch(() => {});
        continue;
      }

      const dueWindow = task.dueDate && new Date(task.dueDate) >= tomorrowStart ? 'yarin' : 'bugun';
      const subject = this.buildSubject(task, dueWindow);
      const { text, html } = this.buildBody(task, dueWindow, tenant);

      try {
        const res = await this.email.send(
          { to: Array.from(recipients), subject, text, html },
          tenant.id,
        );
        if (res.sent) {
          sent++;
          await this.writeLog(task.id, todayStart, 'SENT', null).catch(() => {});
        } else {
          failed++;
          await this.writeLog(task.id, todayStart, 'FAILED', 'EmailService.send sent=false').catch(() => {});
        }
      } catch (err: any) {
        failed++;
        await this.writeLog(task.id, todayStart, 'FAILED', String(err?.message || err).slice(0, 500)).catch(() => {});
      }
    }

    if (tasks.length) {
      this.logger.log(
        `[TaskReminderCron] tenant=${tenant.id} (${tenant.name || '-'}) gun=${todayKey} task=${tasks.length} sent=${sent} skipped=${skipped} failed=${failed}`,
      );
    }

    return { total: tasks.length, sent, skipped, failed };
  }

  /** Istanbul TZ icin bugun ve yarin pencerelerini hesapla (UTC instant'lari) */
  private istanbulWindow() {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayKey = fmt.format(new Date()); // "YYYY-MM-DD" Istanbul

    // Istanbul yerel saatiyle 00:00 -> UTC instant
    // Istanbul UTC+3 (yaz/kis ayni)
    const todayStart = new Date(`${todayKey}T00:00:00+03:00`);
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 3600 * 1000);
    const tomorrowEnd = new Date(todayStart.getTime() + 48 * 3600 * 1000);
    const todayEnd = tomorrowStart;
    return { todayStart, todayEnd, tomorrowStart, tomorrowEnd, todayKey };
  }

  private buildSubject(task: any, dueWindow: 'bugun' | 'yarin'): string {
    const prefix = dueWindow === 'bugun' ? 'Bugun vadesi' : 'Yarin vadesi';
    const title = String(task.title || 'Isimsiz gorev').slice(0, 80);
    return `Gorev Hatirlatma — ${prefix}: ${title}`;
  }

  private buildBody(
    task: any,
    dueWindow: 'bugun' | 'yarin',
    tenant: { name: string | null },
  ): { text: string; html: string } {
    const dueDateStr = this.formatTr(task.dueDate);
    const dueTimeStr = task.dueTime || (task.allDay ? 'Tum gun' : '-');
    const priority = this.priorityLabel(task.priority);
    const taxpayerName = task.taxpayer
      ? (task.taxpayer.companyName || [task.taxpayer.firstName, task.taxpayer.lastName].filter(Boolean).join(' '))
      : null;
    const dueWindowLabel = dueWindow === 'bugun' ? 'BUGUN' : 'YARIN';

    const lines: string[] = [];
    lines.push(`${dueWindowLabel} vadesi olan gorev hatirlatmasi`);
    lines.push('');
    lines.push(`Baslik: ${task.title || '-'}`);
    lines.push(`Vade: ${dueDateStr}  Saat: ${dueTimeStr}`);
    lines.push(`Oncelik: ${priority}`);
    if (task.category) lines.push(`Kategori: ${task.category}`);
    if (taxpayerName) lines.push(`Mukellef: ${taxpayerName}`);
    if (task.description) {
      lines.push('');
      lines.push('Aciklama:');
      lines.push(String(task.description).slice(0, 2000));
    }
    lines.push('');
    lines.push(`-- ${tenant.name || 'Moren Musavirlik'} Portal otomatik hatirlatma`);
    const text = lines.join('\n');

    const safe = (s: string | null | undefined) =>
      String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const html = `
<!doctype html>
<html lang="tr"><body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#f5f5f7; padding:24px; margin:0;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <tr><td style="background:linear-gradient(135deg,#d4b876,#a08649); padding:16px 24px; color:#0f0d0b;">
      <div style="font-size:12px; letter-spacing:1px; opacity:0.85;">GOREV HATIRLATMA</div>
      <div style="font-size:18px; font-weight:700; margin-top:2px;">${dueWindowLabel} vadesi olan gorev</div>
    </td></tr>
    <tr><td style="padding:20px 24px;">
      <h2 style="font-size:18px; margin:0 0 12px; color:#111;">${safe(task.title)}</h2>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%; font-size:13.5px; color:#333;">
        <tr><td style="padding:4px 0; color:#666; width:90px;">Vade</td><td style="padding:4px 0;"><strong>${safe(dueDateStr)}</strong></td></tr>
        <tr><td style="padding:4px 0; color:#666;">Saat</td><td style="padding:4px 0;">${safe(dueTimeStr)}</td></tr>
        <tr><td style="padding:4px 0; color:#666;">Oncelik</td><td style="padding:4px 0;">${safe(priority)}</td></tr>
        ${task.category ? `<tr><td style="padding:4px 0; color:#666;">Kategori</td><td style="padding:4px 0;">${safe(task.category)}</td></tr>` : ''}
        ${taxpayerName ? `<tr><td style="padding:4px 0; color:#666;">Mukellef</td><td style="padding:4px 0;">${safe(taxpayerName)}</td></tr>` : ''}
      </table>
      ${task.description ? `<div style="margin-top:14px; padding:12px 14px; background:#f7f5ef; border-left:3px solid #d4b876; border-radius:4px; font-size:13.5px; line-height:1.5; color:#222; white-space:pre-wrap;">${safe(String(task.description).slice(0, 2000))}</div>` : ''}
    </td></tr>
    <tr><td style="padding:12px 24px 20px; font-size:11px; color:#999; border-top:1px solid #eee;">
      ${safe(tenant.name || 'Moren Musavirlik')} Portal otomatik hatirlatma
    </td></tr>
  </table>
</body></html>`.trim();

    return { text, html };
  }

  private formatTr(value: Date | string | null | undefined): string {
    if (!value) return '-';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  }

  private priorityLabel(p: string | null | undefined): string {
    switch ((p || '').toUpperCase()) {
      case 'LOW': return 'Dusuk';
      case 'MEDIUM': return 'Orta';
      case 'HIGH': return 'Yuksek';
      case 'URGENT': return 'Acil';
      default: return p || 'Orta';
    }
  }

  private async writeLog(
    taskId: string,
    scheduledFor: Date,
    status: 'SENT' | 'FAILED' | 'SKIPPED',
    errorMsg: string | null,
  ) {
    await (this.prisma as any).taskReminderLog.create({
      data: {
        taskId,
        scheduledFor,
        sentAt: status === 'SENT' ? new Date() : null,
        channel: 'EMAIL',
        status,
        errorMsg: errorMsg || null,
      },
    });
  }
}
