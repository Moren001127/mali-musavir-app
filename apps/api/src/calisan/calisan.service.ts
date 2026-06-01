import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { logAiUsage } from '../common/ai-usage-logger';
import { MorenAiService } from '../moren-ai/moren-ai.service';

/**
 * Moren Portal Çalışanı — tek AI operasyon ajanı (Müdür yok, öğrenme açık).
 * AI ÇAĞRISI: API key DEĞİL — Max aboneliği (Claude Agent SDK + CLAUDE_CODE_OAUTH_TOKEN).
 * Model yönlendirme: kritik tek-çalışan belge → Opus 4.8, diğer → Sonnet 4.6.
 * Öğrenme: AiMemory tablosu (scope='agent', source='calisan') — migration gerektirmez.
 */

// ESM-only Agent SDK'yı CommonJS NestJS içine güvenli yükle
// (TS, statik import'u require'a çevirip ERR_REQUIRE_ESM atmasın diye Function ile dinamik import).
const _esmImport: (m: string) => Promise<any> = new Function('m', 'return import(m)') as any;
let _queryFn: any = null;
async function loadQuery(): Promise<any> {
  if (!_queryFn) {
    const sdk = await _esmImport('@anthropic-ai/claude-agent-sdk');
    _queryFn = sdk.query;
  }
  return _queryFn;
}

const MODEL_CRITICAL = 'claude-opus-4-8';   // kritik mali/hukuki tek-çalışan belge
const MODEL_DEFAULT = 'claude-sonnet-4-6';  // diğer tüm görevler

// Yanlışı hukuki/mali sonuç doğuran tek-çalışan belge sinyalleri → Opus 4.8
const CRITICAL_PATTERNS: RegExp[] = [
  /beyanname|tahakkuk|muhtasar|muhsgk|geçici vergi|gecici vergi|kurumlar|kdv\s?[12]/i,
  /mizan|bilanço|bilanco|gelir tablosu|e-?defter|yevmiye|denetim/i,
  /tevkifat|mutabakat|matrah|amortisman|tarhiyat/i,
];

const SYSTEM_PROMPT = [
  'Sen Moren Mali Müşavirlik portalının tek AI operasyon çalışanısın (Müdür yok).',
  'Sahip: Muzaffer Ören. Üretim CANLI ve çoklu bilgisayarda — onaysız production değişikliği önermezsin.',
  'Kilitli modüllerin (Mizan, KDV Kontrol, agent-runtime, E-Arşiv) KODUNU değiştirmezsin; sadece çıktısını yorumlarsın.',
  'Kritik mali/hukuki belgelerde (beyanname, tahakkuk, mizan, KDV, e-defter) en yüksek doğrulukla çalış ve sonucu doğrula.',
  'Görmediğini görmüş gibi söyleme; test etmediysen "test edildi" deme.',
  'Mükellef PII (şifre, token, TC, IBAN) sızdırma, loglama, ders olarak saklama.',
  'Cevapların kısa ve öz olsun. Türkçe yaz.',
].join(' ');

interface RunParams {
  tenantId: string;
  task: string;
  critical?: boolean;
  context?: string;
}

@Injectable()
export class CalisanService {
  private readonly logger = new Logger('CalisanService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly morenAi: MorenAiService,
  ) {}

  /**
   * Owner WhatsApp köprüsü: cevabı mevcut TOOL'LU MorenAI beyninden üretir
   * (mizan/KDV/beyan sorgulayabilir), ama model yönlendirme (kritik→Opus 4.8,
   * diğer→Sonnet) + öğrenme katmanını Çalışan ajan uygular.
   */
  async runViaMorenAi(params: {
    tenantId: string;
    conversationId?: string | null;
    message: string;
    source?: string;
  }): Promise<{ assistantMessage: string; model: string }> {
    const critical = this.isCritical(params.message);
    const model = critical ? MODEL_CRITICAL : MODEL_DEFAULT;
    const answer: any = await this.morenAi.chat(params.tenantId, null, {
      conversationId: params.conversationId || undefined,
      message: params.message,
      voiceMode: false,
      toolMode: 'owner',
      source: params.source || 'calisan',
      model, // MorenAI bu override'ı kullanır (moren-ai.service.ts:342)
    } as any);
    const assistantMessage = String(answer?.assistantMessage || '');
    // ÖĞRENME: sadece kritik owner etkileşimini hafif not düş (gürültü olmasın)
    if (critical && assistantMessage) {
      this.recordLesson({
        tenantId: params.tenantId,
        title: 'Owner kritik WhatsApp talebi',
        content: `Soru: ${params.message.slice(0, 160)} | Model: ${model}`,
        importance: 2,
        tags: ['whatsapp', 'owner', 'kritik'],
      }).catch(() => undefined);
    }
    return { assistantMessage, model };
  }

  isCritical(task: string): boolean {
    if (!task) return false;
    return CRITICAL_PATTERNS.some((p) => p.test(task));
  }

  /** Model seçimi: explicit critical öncelikli, yoksa içerik sezgisi. */
  pickModel(task: string, critical?: boolean): string {
    if (critical === true) return MODEL_CRITICAL;
    if (critical === false) return MODEL_DEFAULT;
    return this.isCritical(task) ? MODEL_CRITICAL : MODEL_DEFAULT;
  }

  async run(params: RunParams): Promise<{
    ok: boolean;
    model: string;
    critical?: boolean;
    answer?: string;
    durationMs?: number;
    error?: string;
  }> {
    const tenantId = params.tenantId || 'default';
    const model = this.pickModel(params.task, params.critical);
    const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (!token) {
      return {
        ok: false,
        model,
        error:
          "CLAUDE_CODE_OAUTH_TOKEN yok — ajan Max planına bağlı değil. " +
          "`claude setup-token` ile üret + Railway env'e ekle (API key KULLANILMAZ).",
      };
    }
    if (!params.task) {
      return { ok: false, model, error: 'task boş.' };
    }

    // ÖĞRENME: ilgili geçmiş dersleri çağır
    const lessons = await this.recallLessons(tenantId, params.task);
    const system = lessons ? `${SYSTEM_PROMPT}\n\n## Geçmiş dersler (öğrenilen):\n${lessons}` : SYSTEM_PROMPT;
    const userContent = params.context ? `${params.context}\n\n${params.task}` : params.task;

    // İZOLE AUTH: ajan subprocess'i Max OAuth token'ı kullanır. Daha yüksek öncelikli
    // ANTHROPIC_* değişkenlerini düşürürüz ki portalın geri kalanı API key'de kalsa bile
    // ajan kesinlikle Max aboneliğinden çalışsın.
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') childEnv[k] = v;
    }
    for (const drop of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
      delete childEnv[drop];
    }
    childEnv.CLAUDE_CODE_OAUTH_TOKEN = token;

    const started = Date.now();
    let answer = '';
    let costUsd = 0;
    let isError = false;
    try {
      const query = await loadQuery();
      for await (const m of query({
        prompt: userContent,
        options: {
          model,
          systemPrompt: system,
          allowedTools: [], // saf çıkarım — dosya/bash aracı yok
          maxTurns: 1,
          env: childEnv,
        },
      })) {
        if (m?.type === 'assistant') {
          for (const block of m.message?.content || []) {
            if (block?.type === 'text') answer += block.text;
          }
        } else if (m?.type === 'result') {
          isError = Boolean(m.is_error);
          if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
        }
      }
    } catch (e: any) {
      return { ok: false, model, error: e?.message || 'Agent SDK (Max) çağrısı başarısız.' };
    }

    const durationMs = Date.now() - started;
    // Maliyet Max kotasından düşer (token başına fatura DEĞİL); görünürlük için logla.
    await logAiUsage(this.prisma, {
      tenantId,
      source: 'calisan-max',
      model,
      fixedCostUsd: costUsd,
      karar: isError ? 'error' : 'ok',
      durationMs,
    }).catch(() => undefined);

    answer = answer.trim();
    if (isError && !answer) {
      return { ok: false, model, error: 'Agent SDK (Max) sonucu hata döndü.' };
    }
    return { ok: true, model, critical: model === MODEL_CRITICAL, answer, durationMs };
  }

  /** ÖĞRENME: kalıcı ders kaydet (AiMemory, scope=agent). */
  async recordLesson(params: {
    tenantId: string;
    title: string;
    content: string;
    importance?: number;
    tags?: string[];
  }): Promise<{ ok: boolean; id?: string; error?: string }> {
    if (!params.title || !params.content) {
      return { ok: false, error: 'title ve content zorunlu.' };
    }
    try {
      const m = await this.prisma.aiMemory.create({
        data: {
          tenantId: params.tenantId || 'default',
          scope: 'agent',
          source: 'calisan',
          title: params.title.slice(0, 200),
          content: params.content,
          importance: params.importance ?? 3,
          tags: params.tags ?? [],
        },
      });
      return { ok: true, id: m.id };
    } catch (e: any) {
      this.logger.warn(`recordLesson hata: ${e?.message}`);
      return { ok: false, error: e?.message };
    }
  }

  /** ÖĞRENME: ilgili dersleri çağır (basit alaka sıralaması). */
  async recallLessons(tenantId: string, query: string): Promise<string> {
    try {
      const rows = await this.prisma.aiMemory.findMany({
        where: { tenantId: tenantId || 'default', scope: 'agent', isActive: true },
        orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
        take: 8,
      });
      if (!rows.length) return '';
      const q = (query || '').toLocaleLowerCase('tr-TR');
      const scored = rows
        .map((r) => {
          const hit =
            q && (r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q)) ? 1 : 0;
          return { r, hit };
        })
        .sort((a, b) => b.hit - a.hit)
        .slice(0, 5);
      return scored.map(({ r }) => `- ${r.title}: ${r.content}`.slice(0, 300)).join('\n');
    } catch {
      return '';
    }
  }
}
