import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { OpenRouterAdapter } from './providers/openrouter.adapter';
import { PERSONAS } from './agents/personas';

export interface WeeklyPatrolReport {
  periodFrom: string;
  periodTo: string;
  tenantName: string | null;
  // Sistem temizliği
  interventions: { date: string; total: number; meta: any }[];
  totalInterventions: number;
  // Öneriler
  proposals: { id: string; title: string; description: string; priority: string; category: string; status: string; createdAt: string }[];
  proposalsByStatus: Record<string, number>;
  // AI maliyeti
  aiCost: { total: number; week: number; msgCount: number };
  // Tool kullanımı
  toolStats: { tool: string; count: number; failureRate: number }[];
  totalToolCalls: number;
  toolFailures: number;
  // Pending actions
  pendingActions: { total: number; approved: number; rejected: number; applied: number };
}

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

      // 1) Stuck pending Luca jobs — exponential backoff retry
      // retry sayısı < 2 ise: backoff sürelerine göre nextRetryAt set + retry
      // retry sayısı >= 2 ise: failed işaretle (gerçek arıza muhtemelen)
      // Backoff: 1. retry 5dk sonra, 2. retry 15dk sonra (üst sınır 45dk)
      const stuckCandidates = await (this.prisma as any).lucaFetchJob.findMany({
        where: {
          status: 'pending',
          createdAt: { lt: oneHourAgo },
          OR: [
            { nextRetryAt: null },
            { nextRetryAt: { lt: now } },
          ],
        },
        select: { id: true, retryCount: true },
      });

      let retried = 0;
      let stuckPendingCount = 0;
      for (const job of stuckCandidates) {
        if (job.retryCount >= 2) {
          // 2 retry sonrası failed — gerçek arıza
          await (this.prisma as any).lucaFetchJob.update({
            where: { id: job.id },
            data: {
              status: 'failed',
              errorMsg: `DENIZ patrol: ${job.retryCount} retry sonrası başarısız, iptal`,
              finishedAt: now,
            },
          });
          stuckPendingCount++;
        } else {
          // Retry — backoff: retry 0 → 5dk, retry 1 → 15dk
          const backoffMin = job.retryCount === 0 ? 5 : 15;
          const nextRetry = new Date(now.getTime() + backoffMin * 60 * 1000);
          await (this.prisma as any).lucaFetchJob.update({
            where: { id: job.id },
            data: {
              retryCount: { increment: 1 },
              nextRetryAt: nextRetry,
              // pending'de kalır, agent tekrar alır
            },
          });
          retried++;
        }
      }
      const stuckPending = { count: stuckPendingCount };

      // 2) Stale running Luca jobs (2sa+ running) — direkt failed, retry burada anlamsız
      // (zaten bir agent başlatmış ama bitirememiş, exit yapmamış olabilir)
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

      if (retried > 0) {
        this.logger.log(`DENIZ retry: ${retried} job exponential backoff ile yeniden kuyrukta`);
      }

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

    // Önerileri DB'ye yaz + high priority olanlar için bildirim
    if (Array.isArray(parsed.proposals)) {
      for (const p of parsed.proposals) {
        const priority = ['high', 'medium', 'low'].includes(p.priority) ? p.priority : 'medium';
        const title = String(p.title || '').slice(0, 200);
        const description = String(p.description || '').slice(0, 2000);
        const created = await (this.prisma as any).morenOfisProposal.create({
          data: {
            tenantId,
            title,
            description,
            priority,
            category: ['bug', 'perf', 'feature', 'maintenance'].includes(p.category) ? p.category : 'feature',
            status: 'open',
          },
        }).catch(() => null);

        // Yüksek öncelikli ise kullanıcıya in-app bildirim at — Bell badge'de görünür
        if (created && priority === 'high') {
          await this.notifyDenizProposal(tenantId, title, description, created.id).catch(() => {});
        }
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

  /**
   * DENİZ'in high priority önerisi için tenant kullanıcılarına in-app
   * bildirim atar — Bell badge'de görünür. Tüm tenant adminleri görür.
   */
  private async notifyDenizProposal(
    tenantId: string,
    title: string,
    description: string,
    proposalId: string,
  ) {
    // Tenant aktif kullanıcılarına bildirim — role yapısı UserRole üzerinden,
    // basitleştirme: tüm aktif kullanıcılar (genelde 1-3 personel)
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: { id: true },
    });
    for (const u of users) {
      await (this.prisma as any).notification.create({
        data: {
          tenantId,
          userId: u.id,
          title: `🔔 DENİZ: ${title}`,
          body: description.slice(0, 500),
          type: 'AI_PROPOSAL',
          metadata: { proposalId, source: 'moren_ofis_patrol' },
        },
      }).catch(() => {});
    }
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

  // === Haftalık Rapor ===

  /**
   * Son 7 gün için DENİZ patrol özeti — sistem temizliği, öneriler,
   * AI maliyeti, tool kullanımı, onay kuyruğu. HTML rapor sayfasından
   * tüketilir (kullanıcı Ctrl+P ile PDF'e basabilir).
   */
  async getWeeklyReport(tenantId: string): Promise<WeeklyPatrolReport> {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    // 1) Proposals (DENİZ önerileri)
    const proposals = await (this.prisma as any).morenOfisProposal.findMany({
      where: { tenantId, createdAt: { gte: from } },
      orderBy: { createdAt: 'desc' },
    });
    const proposalsByStatus: Record<string, number> = {};
    for (const p of proposals) {
      proposalsByStatus[p.status] = (proposalsByStatus[p.status] || 0) + 1;
    }

    // 2) AI maliyeti
    const convs = await (this.prisma as any).morenOfisConversation.findMany({
      where: { tenantId },
      select: { messages: true },
    });
    let totalCost = 0;
    let weekCost = 0;
    let msgCount = 0;
    for (const c of convs) {
      const msgs = (c.messages as any[] | null) || [];
      for (const m of msgs) {
        const cost = m?.usage?.costUsd;
        if (typeof cost !== 'number') continue;
        msgCount++;
        totalCost += cost;
        const ts = m.ts ? new Date(m.ts) : null;
        if (ts && ts >= from) weekCost += cost;
      }
    }

    // 3) Tool çağrı istatistik (son 7 gün)
    const toolStats = await (this.prisma as any).toolCallLog.groupBy({
      by: ['tool'],
      where: { tenantId, ts: { gte: from } },
      _count: { _all: true },
    });
    const toolFailures = await (this.prisma as any).toolCallLog.count({
      where: { tenantId, ts: { gte: from }, ok: false },
    });
    const totalToolCalls = await (this.prisma as any).toolCallLog.count({
      where: { tenantId, ts: { gte: from } },
    });
    const toolStatsWithFailure = await Promise.all(
      toolStats.map(async (s: any) => {
        const failures = await (this.prisma as any).toolCallLog.count({
          where: { tenantId, ts: { gte: from }, tool: s.tool, ok: false },
        });
        return {
          tool: s.tool,
          count: s._count._all,
          failureRate: s._count._all > 0 ? failures / s._count._all : 0,
        };
      }),
    );
    toolStatsWithFailure.sort((a, b) => b.count - a.count);

    // 4) Pending actions
    const allPending = await (this.prisma as any).pendingAction.findMany({
      where: { tenantId, requestedAt: { gte: from } },
      select: { status: true },
    });
    const pa = { total: allPending.length, approved: 0, rejected: 0, applied: 0 };
    for (const p of allPending) {
      if (p.status === 'approved') pa.approved++;
      else if (p.status === 'rejected') pa.rejected++;
      else if (p.status === 'applied') pa.applied++;
    }

    return {
      periodFrom: from.toISOString(),
      periodTo: to.toISOString(),
      tenantName: tenant?.name || null,
      interventions: [], // ileride MorenOfisIntervention tablosu eklenince
      totalInterventions: 0,
      proposals: proposals.map((p: any) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        priority: p.priority,
        category: p.category,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
      proposalsByStatus,
      aiCost: { total: totalCost, week: weekCost, msgCount },
      toolStats: toolStatsWithFailure,
      totalToolCalls,
      toolFailures,
      pendingActions: pa,
    };
  }
}
