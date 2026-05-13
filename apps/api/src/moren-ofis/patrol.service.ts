import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { OpenRouterAdapter } from './providers/openrouter.adapter';
import { PERSONAS } from './agents/personas';

/**
 * DENİZ'in devriye servisi — sistem sağlığını sürekli izler,
 * stuck job'ları temizler, hata kalıplarını analiz eder, fikir üretir.
 *
 * Çalışma sıklığı:
 *   - Otomatik müdahale (light patrol): her 15 dakikada (cron)
 *   - Derin analiz + fikir üretimi: her sabah 06:00 (cron) — Gece raporu
 *   - Manuel tetikleme: POST /moren-ofis/patrol/run endpoint
 */
@Injectable()
export class MorenOfisPatrolService {
  private readonly logger = new Logger(MorenOfisPatrolService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openrouter: OpenRouterAdapter,
  ) {}

  /**
   * Hızlı patrol — her 15 dakikada bir, tüm tenantlar için.
   * Sadece YETKİLİ otomatik müdahaleler:
   *  - 60dk+ pending job'lar → failed işaretle
   *  - 2sa+ stale running job'lar → failed işaretle
   *  - Çok offline agent varsa kayıt
   */
  @Cron(CronExpression.EVERY_30_MINUTES, { timeZone: 'Europe/Istanbul' })
  async lightPatrol() {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // 1) Stuck pending Luca jobs (60dk+ hala pending)
      const stuckPending = await (this.prisma as any).lucaFetchJob.updateMany({
        where: {
          status: 'pending',
          createdAt: { lt: oneHourAgo },
        },
        data: {
          status: 'failed',
          errorMsg: 'DENIZ patrol: 1 saatten fazla pending kaldı, otomatik iptal edildi',
          finishedAt: now,
        },
      });

      // 2) Stale running Luca jobs (2sa+ running)
      const staleRunning = await (this.prisma as any).lucaFetchJob.updateMany({
        where: {
          status: 'running',
          startedAt: { lt: twoHoursAgo },
        },
        data: {
          status: 'failed',
          errorMsg: 'DENIZ patrol: 2 saatten fazla running kaldı, zaman aşımı',
          finishedAt: now,
        },
      });

      // 3) Stuck Mihsap commands
      const stuckCommands = await (this.prisma as any).agentCommand.updateMany({
        where: {
          status: { in: ['pending', 'running'] },
          createdAt: { lt: oneHourAgo },
        },
        data: {
          status: 'failed',
          result: { error: 'DENIZ patrol: 1 saatten fazla işlenmedi, otomatik iptal' },
          finishedAt: now,
        },
      });

      const total = (stuckPending?.count || 0) + (staleRunning?.count || 0) + (stuckCommands?.count || 0);
      if (total > 0) {
        this.logger.log(
          `DENIZ devriye: ${stuckPending?.count || 0} pending Luca, ${staleRunning?.count || 0} stale Luca, ${stuckCommands?.count || 0} Mihsap komut temizlendi`,
        );
        await this.recordInterventions(total, {
          stuckPendingLuca: stuckPending?.count || 0,
          staleRunningLuca: staleRunning?.count || 0,
          stuckCommands: stuckCommands?.count || 0,
        });
      }
    } catch (err: any) {
      this.logger.error(`Patrol hatası: ${err?.message}`);
    }
  }

  /**
   * Derin analiz — her gün 06:00, DENİZ "gece raporunu" hazırlar.
   * Önceki 24 saatin verilerini Sonnet'e yollar, öneri çıkartır.
   */
  @Cron('0 6 * * *', { timeZone: 'Europe/Istanbul' })
  async dailyAnalysis() {
    try {
      // Tüm tenant'lar için
      const tenants = await this.prisma.tenant.findMany({ select: { id: true, slug: true } });
      for (const tenant of tenants) {
        await this.runDeepAnalysisForTenant(tenant.id).catch((e) => {
          this.logger.warn(`Tenant ${tenant.id} derin analiz hatasi: ${e?.message}`);
        });
      }
    } catch (err: any) {
      this.logger.error(`Daily analysis hata: ${err?.message}`);
    }
  }

  /**
   * Belirli bir tenant için DENİZ derin analiz yapar:
   *  - Son 24 saatin metriklerini topla
   *  - Sonnet'e ver → analiz + öneri JSON üret
   *  - MorenOfisProposal tablosuna kaydet
   */
  async runDeepAnalysisForTenant(tenantId: string) {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [lucaJobs, commands, events, agentStatuses] = await Promise.all([
      (this.prisma as any).lucaFetchJob.findMany({
        where: { tenantId, createdAt: { gte: last24h } },
        select: { tip: true, status: true, errorMsg: true, startedAt: true, finishedAt: true },
      }),
      (this.prisma as any).agentCommand.findMany({
        where: { tenantId, createdAt: { gte: last24h } },
        select: { agent: true, action: true, status: true, result: true },
      }),
      (this.prisma as any).agentEvent.findMany({
        where: { tenantId, ts: { gte: last24h }, status: 'hata' },
        select: { agent: true, message: true, ts: true },
        take: 50,
      }),
      this.prisma.agentStatus.findMany({
        where: { tenantId },
        select: { agent: true, running: true, lastPing: true, meta: true },
      }),
    ]);

    const stats = {
      luca: {
        total: lucaJobs.length,
        done: lucaJobs.filter((j: any) => j.status === 'done').length,
        failed: lucaJobs.filter((j: any) => j.status === 'failed').length,
        avgDurationMs:
          lucaJobs
            .filter((j: any) => j.startedAt && j.finishedAt)
            .map((j: any) => new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime())
            .reduce((s: number, n: number, _i: number, arr: number[]) => s + n / arr.length, 0) || 0,
        topErrors: this.topErrors(lucaJobs.map((j: any) => j.errorMsg).filter(Boolean)),
      },
      mihsap: {
        total: commands.length,
        done: commands.filter((c: any) => c.status === 'done').length,
        failed: commands.filter((c: any) => c.status === 'failed').length,
      },
      errors: events.length,
      topErrors: this.topErrors(events.map((e: any) => e.message).filter(Boolean)),
      agents: agentStatuses.map((a: any) => ({
        agent: a.agent,
        running: a.running,
        lastPingMin: Math.round((Date.now() - new Date(a.lastPing).getTime()) / 60000),
        deviceId: a.meta?.deviceId,
      })),
    };

    const prompt = `Sen DENİZ — Moren Ofis'in yazılım uzmanısın. Aşağıdaki son 24 saatlik sistem metriklerini analiz et:

${JSON.stringify(stats, null, 2)}

JSON formatında 3 bölüm üret:

1. **summary**: 1-2 cümle sistem durumu özet (sade Türkçe)
2. **interventions**: Gece otomatik yaptıklarının özeti (varsa)
3. **proposals**: 0-5 madde öneri. Her madde: { "title": "...", "priority": "high|medium|low", "category": "bug|perf|feature|maintenance", "description": "Sorun + çözüm önerisi" }

Patron sabah okuyacak — kısa, eylem odaklı, yapılacak işler listesi gibi.

Sadece JSON, başka açıklama yok.`;

    const res = await this.openrouter.chat({
      model: PERSONAS.deniz.model,
      messages: [
        { role: 'system', content: PERSONAS.deniz.systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      maxTokens: 2000,
    });

    let parsed: any;
    try {
      const cleaned = res.content.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      this.logger.warn(`Tenant ${tenantId} DENIZ analiz JSON parse fail`);
      return;
    }

    // Önerileri DB'ye yaz
    if (Array.isArray(parsed.proposals)) {
      for (const p of parsed.proposals) {
        await (this.prisma as any).morenOfisProposal.create({
          data: {
            tenantId,
            title: String(p.title || '').slice(0, 200),
            description: String(p.description || '').slice(0, 2000),
            priority: ['high', 'medium', 'low'].includes(p.priority) ? p.priority : 'medium',
            category: ['bug', 'perf', 'feature', 'maintenance'].includes(p.category) ? p.category : 'feature',
            status: 'open',
          },
        }).catch(() => {});
      }
    }

    // Gece raporu kaydet (DENİZ'in özel kanalı)
    await (this.prisma as any).morenOfisProposal.create({
      data: {
        tenantId,
        title: `🌙 Gece Raporu — ${new Date().toLocaleDateString('tr-TR')}`,
        description: [
          parsed.summary || '',
          '',
          parsed.interventions ? `Müdahaleler: ${parsed.interventions}` : '',
          '',
          'Metrikler: ' + JSON.stringify({
            luca: `${stats.luca.done}/${stats.luca.total} done`,
            mihsap: `${stats.mihsap.done}/${stats.mihsap.total} done`,
            errors: stats.errors,
          }),
        ].join('\n').slice(0, 2000),
        priority: 'low',
        category: 'maintenance',
        status: 'info',
      },
    }).catch(() => {});

    return parsed;
  }

  /**
   * Manuel tetikleme — patron istediğinde DENİZ'i çalıştırır.
   */
  async manualPatrol(tenantId: string) {
    await this.lightPatrol(); // light cleanup
    const analysis = await this.runDeepAnalysisForTenant(tenantId);
    return analysis;
  }

  // === Helper'lar ===

  private topErrors(messages: string[]): Array<{ message: string; count: number }> {
    const buckets = new Map<string, number>();
    for (const m of messages) {
      // İlk 80 char'ı key kullan — benzer hataları gruplandır
      const key = String(m).split('\n').pop()?.slice(0, 80).trim() || '';
      if (!key) continue;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return [...buckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([message, count]) => ({ message, count }));
  }

  private async recordInterventions(total: number, breakdown: any) {
    // İleride MorenOfisIntervention tablosu eklenebilir.
    // Şimdilik sadece log yeterli.
    this.logger.log(`DENIZ otomatik mudahale: total=${total}, breakdown=${JSON.stringify(breakdown)}`);
  }

  // === Proposals API ===

  async listProposals(tenantId: string, opts: { status?: string; limit?: number } = {}) {
    return (this.prisma as any).morenOfisProposal.findMany({
      where: {
        tenantId,
        ...(opts.status ? { status: opts.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }],
      take: Math.min(opts.limit || 50, 200),
    });
  }

  async updateProposalStatus(tenantId: string, id: string, status: string) {
    return (this.prisma as any).morenOfisProposal.updateMany({
      where: { id, tenantId },
      data: { status, updatedAt: new Date() },
    });
  }
}
