import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(QualityLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createLog(input: QualityLogInput) {
    const log = await (this.prisma as any).botQualityLog.create({
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
    if (this.shouldRecordLearning(input)) {
      this.recordQualityLearning(input, log.id).catch((err) => {
        this.logger.warn(`Kalite ders kaydi yazilamadi: ${err?.message || err}`);
      });
    }
    return log;
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
    const feedback = await (this.prisma as any).botQualityFeedback.create({
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
    if (rating === 'DOWN') {
      this.recordFeedbackLearning(tenantId, userId, body, feedback.id).catch((err) => {
        this.logger.warn(`Feedback ders kaydi yazilamadi: ${err?.message || err}`);
      });
    }
    return feedback;
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

  private shouldRecordLearning(input: QualityLogInput) {
    if (input.source !== 'ONLINE_EVAL') return false;
    if (input.fallbackUsed) return true;
    if (Number(input.score || 0) < 7) return true;
    return ['LOW_SCORE', 'FALLBACK_USED', 'RETRY_USED'].includes(String(input.status || ''));
  }

  private async recordQualityLearning(input: QualityLogInput, logId: string) {
    const aiMemory = (this.prisma as any).aiMemory;
    if (!aiMemory?.findFirst || !aiMemory?.create || !aiMemory?.update) return;
    const reasons = (input.reasons || []).map((item) => String(item)).filter(Boolean);
    const mainReason = reasons[0]?.split(':')[0] || input.status || 'QUALITY';
    const intent = String(input.intent || 'genel').slice(0, 40);
    const title = `WhatsApp kalite dersi: ${mainReason} / ${intent}`;
    const customerMessage = this.maskSensitive(input.metadata?.customerMessage || '');
    const content = [
      `Kaynak: online WhatsApp kalite kontrol (${new Date().toISOString().slice(0, 10)}).`,
      `Durum: ${input.status}, skor: ${input.score}/10, logId: ${logId}.`,
      reasons.length ? `Sebep: ${reasons.join(', ')}` : null,
      customerMessage ? `Kullanici mesaji: ${customerMessage.slice(0, 500)}` : null,
      input.originalReply ? `Ilk cevap: ${this.maskSensitive(input.originalReply).slice(0, 600)}` : null,
      input.finalReply ? `Son cevap: ${this.maskSensitive(input.finalReply).slice(0, 600)}` : null,
      `Bir dahaki sefere: ${this.learningInstruction(mainReason, input.status)}`,
    ].filter(Boolean).join('\n');
    await this.upsertMemory({
      tenantId: input.tenantId,
      taxpayerId: input.taxpayerId || null,
      title,
      content,
      tags: ['self-improvement', 'whatsapp', 'quality', input.status, mainReason, intent].filter(Boolean),
      importance: input.fallbackUsed || Number(input.score || 0) < 5 ? 5 : 4,
    });
  }

  private async recordFeedbackLearning(tenantId: string, userId: string | null, body: any, feedbackId: string) {
    const qualityLogId = body?.logId || body?.qualityLogId || null;
    const qualityLog = qualityLogId
      ? await (this.prisma as any).botQualityLog.findFirst({ where: { id: qualityLogId, tenantId } }).catch(() => null)
      : null;
    const reason = String(body?.reason || '').trim();
    const title = `WhatsApp kullanici feedback dersi: ${reason ? reason.slice(0, 60) : 'olumsuz geri bildirim'}`;
    const content = [
      `Kaynak: kullanici DOWN feedback (${new Date().toISOString().slice(0, 10)}), feedbackId: ${feedbackId}.`,
      reason ? `Kullanici notu: ${this.maskSensitive(reason).slice(0, 500)}` : null,
      qualityLog?.status ? `Ilgili kalite durumu: ${qualityLog.status}, skor: ${qualityLog.score}/10.` : null,
      qualityLog?.metadata?.customerMessage ? `Kullanici mesaji: ${this.maskSensitive(qualityLog.metadata.customerMessage).slice(0, 500)}` : null,
      qualityLog?.originalReply ? `Hatalı cevap: ${this.maskSensitive(qualityLog.originalReply).slice(0, 600)}` : null,
      qualityLog?.finalReply ? `Duzeltilen/final cevap: ${this.maskSensitive(qualityLog.finalReply).slice(0, 600)}` : null,
      'Bir dahaki sefere: Bu örnekteki hatayı tekrar etme; kullanıcının feedback notunu cevap üretiminde öncelikli kural gibi uygula.',
    ].filter(Boolean).join('\n');
    await this.upsertMemory({
      tenantId,
      taxpayerId: qualityLog?.taxpayerId || null,
      title,
      content,
      tags: ['self-improvement', 'whatsapp', 'feedback', 'negative'],
      importance: 5,
      createdBy: userId || null,
    });
  }

  private async upsertMemory(input: {
    tenantId: string;
    taxpayerId?: string | null;
    title: string;
    content: string;
    tags: string[];
    importance: number;
    createdBy?: string | null;
  }) {
    const aiMemory = (this.prisma as any).aiMemory;
    const existing = await aiMemory.findFirst({
      where: {
        tenantId: input.tenantId,
        taxpayerId: input.taxpayerId || null,
        scope: input.taxpayerId ? 'taxpayer' : 'agent',
        source: 'bot-self-improvement',
        title: input.title,
        isActive: true,
      },
    }).catch(() => null);
    const data = {
      content: input.content.slice(0, 4000),
      importance: input.importance,
      tags: Array.from(new Set(input.tags)).slice(0, 12),
    };
    if (existing?.id) {
      await aiMemory.update({ where: { id: existing.id }, data }).catch(() => null);
      return;
    }
    await aiMemory.create({
      data: {
        tenantId: input.tenantId,
        taxpayerId: input.taxpayerId || null,
        scope: input.taxpayerId ? 'taxpayer' : 'agent',
        title: input.title.slice(0, 200),
        content: data.content,
        source: 'bot-self-improvement',
        importance: data.importance,
        tags: data.tags,
        createdBy: input.createdBy || null,
      },
    }).catch(() => null);
  }

  private learningInstruction(reason: string, status: string) {
    if (reason === 'DUPLICATE_REPLY') return 'Son 3 cevaba benzer kalıp kullanma; aynı anlamı daha doğal ve kısa varyasyonla yaz.';
    if (reason === 'INTENT_MISMATCH') return 'Önce kullanıcının asıl isteğini sınıflandır; selamlaşma, belge, veri sorgusu ve işlem komutunu karıştırma.';
    if (reason === 'FORBIDDEN_WORD') return 'Bot/AI kimliği, kesin taahhüt ve yasaklı kurumsal kalıpları cevapta kullanma.';
    if (reason === 'TOO_LONG' || reason === 'TOO_MANY_SENTENCES') return 'WhatsApp cevabını 1-2 kısa cümleye indir; gerekirse detay için ek soru sor.';
    if (status === 'FALLBACK_USED') return 'Fallback gerektiren cevap üretme; veri yoksa açıkça neyin eksik olduğunu söyle, varsa portal tool sonucuna dayan.';
    return 'Bu hata paternini görünce cevap öncesi daha kısa, doğrudan ve bağlama uygun alternatif üret.';
  }

  private maskSensitive(value: string) {
    return String(value || '')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replace(/\b(?:\+?90)?5\d{9}\b/g, '[telefon]')
      .replace(/\b\d{10,11}\b/g, '[kimlik-no]')
      .replace(/\b(token|api\s*key|password|parola|sifre|şifre)\s*[:=]\s*\S+/gi, '$1=[gizli]')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
