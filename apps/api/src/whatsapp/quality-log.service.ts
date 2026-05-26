import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type QualityLogInput = {
  tenantId: string;
  taxpayerId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  source: 'ONLINE_EVAL' | 'SYNTHETIC_TEST';
  status: string;
  score: number;
  intent?: string | null;
  reasons?: string[];
  originalReply?: string | null;
  finalReply?: string | null;
  retryCount?: number;
  fallbackUsed?: boolean;
  evalModel?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  scenarioKey?: string | null;
  metadata?: any;
};

@Injectable()
export class QualityLogService {
  constructor(private readonly prisma: PrismaService) {}

  async createLog(input: QualityLogInput) {
    return (this.prisma as any).botQualityLog.create({
      data: {
        tenantId: input.tenantId,
        taxpayerId: input.taxpayerId || null,
        conversationId: input.conversationId || null,
        messageId: input.messageId || null,
        source: input.source,
        status: input.status,
        score: Math.max(0, Math.min(10, Math.round(input.score || 0))),
        intent: input.intent || null,
        reasons: input.reasons || [],
        originalReply: input.originalReply || null,
        finalReply: input.finalReply || null,
        retryCount: input.retryCount || 0,
        fallbackUsed: !!input.fallbackUsed,
        evalModel: input.evalModel || null,
        inputTokens: Math.max(0, Math.round(input.inputTokens || 0)),
        outputTokens: Math.max(0, Math.round(input.outputTokens || 0)),
        costUsd: Math.max(0, Number(input.costUsd || 0)),
        scenarioKey: input.scenarioKey || null,
        metadata: input.metadata || undefined,
      },
    });
  }

  async summary(tenantId: string) {
    const since = this.startOfWeek();
    const rows = await (this.prisma as any).botQualityLog.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: { score: true, status: true, source: true, inputTokens: true, outputTokens: true, costUsd: true, createdAt: true },
    });
    const count = rows.length;
    const onlineCount = rows.filter((r: any) => r.source === 'ONLINE_EVAL').length;
    const syntheticCount = rows.filter((r: any) => r.source === 'SYNTHETIC_TEST').length;
    const lowQualityCount = rows.filter((r: any) => Number(r.score) < 6 || ['LOW_SCORE', 'FALLBACK_USED', 'SYNTHETIC_FAIL'].includes(r.status)).length;
    const retryCount = rows.filter((r: any) => r.status === 'RETRY_USED').length;
    const fallbackCount = rows.filter((r: any) => r.status === 'FALLBACK_USED').length;
    const averageScore = count ? rows.reduce((sum: number, r: any) => sum + Number(r.score || 0), 0) / count : 0;
    const inputTokens = rows.reduce((sum: number, r: any) => sum + Number(r.inputTokens || 0), 0);
    const outputTokens = rows.reduce((sum: number, r: any) => sum + Number(r.outputTokens || 0), 0);
    const costUsd = rows.reduce((sum: number, r: any) => sum + Number(r.costUsd || 0), 0);
    const statusCounts = rows.reduce((acc: Record<string, number>, row: any) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});

    return {
      since,
      count,
      onlineCount,
      syntheticCount,
      averageScore: Number(averageScore.toFixed(2)),
      lowQualityCount,
      retryCount,
      fallbackCount,
      inputTokens,
      outputTokens,
      costUsd: Number(costUsd.toFixed(6)),
      estimatedTry: Number((costUsd * Number(process.env.USD_TRY || 32)).toFixed(2)),
      statusCounts,
    };
  }

  async logs(tenantId: string, status?: string, limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    return (this.prisma as any).botQualityLog.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });
  }

  async feedback(tenantId: string, userId: string | null, body: any) {
    const rating = String(body?.rating || '').toUpperCase();
    if (!['UP', 'DOWN'].includes(rating)) throw new BadRequestException('rating UP veya DOWN olmalidir');
    return (this.prisma as any).botQualityFeedback.create({
      data: {
        tenantId,
        qualityLogId: body?.logId || body?.qualityLogId || null,
        conversationId: body?.conversationId || null,
        messageId: body?.messageId || null,
        rating,
        reason: String(body?.reason || '').trim().slice(0, 300) || null,
        createdBy: userId || null,
      },
    });
  }

  async lastTestResults(tenantId: string, limit = 60) {
    const rows = await (this.prisma as any).botQualityLog.findMany({
      where: { tenantId, source: 'SYNTHETIC_TEST' },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(200, Number(limit) || 60)),
    });
    const latestBatch = rows.find((row: any) => row?.metadata?.batchId)?.metadata?.batchId || null;
    return {
      latestBatch,
      results: latestBatch ? rows.filter((row: any) => row?.metadata?.batchId === latestBatch) : rows,
    };
  }

  async weeklyImprovementReport(tenantId: string) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [logs, feedback] = await Promise.all([
      (this.prisma as any).botQualityLog.findMany({
        where: { tenantId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      (this.prisma as any).botQualityFeedback.findMany({
        where: { tenantId, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    const reasonCounts = new Map<string, number>();
    for (const log of logs) {
      for (const reason of Array.isArray(log.reasons) ? log.reasons : []) {
        const key = String(reason).split(':')[0];
        reasonCounts.set(key, (reasonCounts.get(key) || 0) + 1);
      }
    }
    const topReasons = Array.from(reasonCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));

    return {
      since,
      totalLogs: logs.length,
      lowScore: logs.filter((log: any) => Number(log.score) < 6).length,
      negativeFeedback: feedback.filter((f: any) => f.rating === 'DOWN').length,
      topReasons,
      suggestions: this.suggestions(topReasons),
    };
  }

  async deleteOlderThan(days = 90) {
    const before = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
    const [logs, feedback] = await Promise.all([
      (this.prisma as any).botQualityLog.deleteMany({ where: { createdAt: { lt: before } } }),
      (this.prisma as any).botQualityFeedback.deleteMany({ where: { createdAt: { lt: before } } }),
    ]);
    return { before, logs: logs.count, feedback: feedback.count };
  }

  private startOfWeek() {
    const now = new Date();
    const local = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
    const day = local.getDay() || 7;
    local.setDate(local.getDate() - day + 1);
    local.setHours(0, 0, 0, 0);
    return local;
  }

  private suggestions(topReasons: Array<{ reason: string; count: number }>) {
    if (!topReasons.length) return ['Bu hafta belirgin bir kalite paterni yok.'];
    return topReasons.map((item) => {
      if (item.reason === 'DUPLICATE_REPLY') return 'Cevap havuzlarinda daha fazla varyasyon ekle ve son cevap benzerligini sertlestir.';
      if (item.reason === 'INTENT_MISMATCH') return 'Intent classifier tetikleyicilerini ve test senaryolarini genislet.';
      if (item.reason === 'FORBIDDEN_WORD') return 'Taahhut ifade filtresini prompt ve post-filter katmaninda guclendir.';
      if (item.reason === 'TOO_LONG' || item.reason === 'TOO_MANY_SENTENCES') return 'WhatsApp cevap limitini daha kisa tut ve tek cumle hedefini koru.';
      return `${item.reason} icin ornekleri inceleyip prompt/classifier duzeltmesi yap.`;
    });
  }
}
