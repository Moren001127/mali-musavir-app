import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeCostUsd, logAiUsage, canSpendOnApi } from '../common/ai-usage-logger';
import { claudeTextViaMax, isMaxAvailable, MAX_MODEL_CHEAP } from '../common/max-inference';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = process.env.BOT_EVAL_MODEL || 'claude-haiku-4-5-20251001';
const SAFE_FALLBACK =
  'Hemen bir bak\u0131p size d\u00f6neyim.';

export type BotEvalContext = {
  tenantId?: string;
  taxpayerId?: string | null;
  intent?: string | null;
  message?: string | null;
  contextBlock?: string | null;
  source?: string;
};

export type BotEvalResult = {
  score: number;
  reasons: string[];
  shouldRetry: boolean;
  fallback: string | null;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  warning?: string | null;
};

@Injectable()
export class BotEvalService {
  private readonly logger = new Logger(BotEvalService.name);

  constructor(private readonly prisma: PrismaService) {}

  async evaluateReply(
    reply: string,
    context: BotEvalContext,
    lastOutgoing: string[] = [],
    options?: { allowLlm?: boolean },
  ): Promise<BotEvalResult> {
    const local = this.localEval(reply, context, lastOutgoing);
    const allowLlm = options?.allowLlm ?? process.env.BOT_EVAL_DISABLE_LLM !== '1';
    // Max aboneliği varsa LLM eval'i onunla yap; ücretli API yalnızca açık env izniyle fallback olur.
    const maxOk = isMaxAvailable();
    const apiAllowed = process.env.MOREN_AI_ALLOW_ANTHROPIC_API === '1' || process.env.BOT_EVAL_ALLOW_ANTHROPIC_API === '1';
    const apiKey = apiAllowed ? process.env.ANTHROPIC_API_KEY : '';
    // Aylık ücretli API tavanı dolduysa ücretli LLM eval atlanır.
    const budgetOk = await canSpendOnApi(this.prisma, context.tenantId || 'default', context.source || 'whatsapp-bot-eval');

    // LLM eval ancak: izinli VE (Max var YA DA ücretli API anahtarı + tavan müsait).
    if (!allowLlm || (!maxOk && (!apiKey || !budgetOk))) {
      const note = !allowLlm
        ? null
          : !budgetOk
            ? 'AI maliyet tavani doldu; lokal eval kullanildi'
            : (apiAllowed ? 'ANTHROPIC_API_KEY yok; lokal eval kullanildi' : 'Claude Max yok; ucretli API kapali, lokal eval kullanildi');
      return this.toResult(local.score, local.reasons, null, 0, 0, 0, note);
    }

    try {
      const judged = maxOk
        ? await this.judgeViaMax(reply, context, lastOutgoing)
        : await this.judgeWithHaiku(reply, context, lastOutgoing, apiKey as string);
      const reasons = Array.from(new Set([...local.reasons, ...judged.reasons]));
      const score = Math.max(0, Math.min(10, Math.min(local.score, judged.score)));
      return this.toResult(score, reasons, judged.model, judged.inputTokens, judged.outputTokens, judged.costUsd, null);
    } catch (err: any) {
      const warning = `Eval LLM hatasi: ${err?.message || err}`;
      this.logger.warn(warning);
      return this.toResult(local.score, [...local.reasons, 'EVAL_LLM_WARN'], DEFAULT_MODEL, 0, 0, 0, warning);
    }
  }

  buildRetryPrompt(originalReply: string, reasons: string[], context: BotEvalContext, lastOutgoing: string[]): string {
    return [
      'Onceki WhatsApp cevabin kalite kontrolunden gecemedi.',
      'Sadece mukellefe gidecek nihai cevabi yeniden yaz.',
      'GERCEK BIR INSAN gibi, dogal ve sicak yaz; musterinin tonuna uy. Robotik/kurumsal kalip ("ilgili kisiye aktarildi", "kayda alindi") KULLANMA.',
      'En fazla 2-3 kisa cumle, markdown yok, kesin tarih/garanti taahhudu verme. Bot/yapay zeka oldugunu ima etme.',
      'Son cevaplari tekrar etme; ayni kaliplari kullanma.',
      `Intent: ${context.intent || 'GENEL'}`,
      `Sorunlar: ${reasons.join(', ') || 'belirsiz'}`,
      `Son ofis cevaplari: ${lastOutgoing.slice(0, 3).join(' | ') || '(yok)'}`,
      `Mukellef mesaji: ${context.message || ''}`,
      `Onceki cevap: ${originalReply}`,
    ].join('\n');
  }

  safeFallback(): string {
    return SAFE_FALLBACK;
  }

  private localEval(reply: string, context: BotEvalContext, lastOutgoing: string[]) {
    const reasons: string[] = [];
    const text = String(reply || '').trim();
    let score = 10;

    if (!text) {
      return { score: 0, reasons: ['EMPTY_REPLY'] };
    }

    const maxSimilarity = Math.max(0, ...lastOutgoing.map((old) => this.similarity(text, old)));
    if (maxSimilarity > 0.7) {
      reasons.push(`DUPLICATE_REPLY:${maxSimilarity.toFixed(2)}`);
      score -= 4;
    }

    // Sadece somut taahh\u00fct s\u00f6zleri yasak \u2014 "hemen bak\u0131yorum" gibi do\u011fal ifadeler serbest.
    const forbidden = text.match(/\b(kesin biter|kesinlikle biter|garanti|yar\u0131na kadar|yarina kadar|bug\u00fcn kesin|bugun kesin)\b/i);
    if (forbidden) {
      reasons.push(`FORBIDDEN_WORD:${forbidden[1]}`);
      score -= 3;
    }

    const sentenceCount = this.sentenceCount(text);
    if (sentenceCount > 3 || text.length > 340) {
      reasons.push(sentenceCount > 3 ? `TOO_MANY_SENTENCES:${sentenceCount}` : `TOO_LONG:${text.length}`);
      score -= 2;
    }

    const intentReason = this.intentMismatch(text, context.intent || undefined, context.message || '');
    if (intentReason) {
      reasons.push(intentReason);
      score -= 3;
    }

    if (/[*_`>#]/.test(text)) {
      reasons.push('MARKDOWN_LEAK');
      score -= 2;
    }

    const emojiCount = Array.from(text).filter((char) => /\p{Extended_Pictographic}/u.test(char)).length;
    if (emojiCount > 1) {
      reasons.push(`TOO_MANY_EMOJI:${emojiCount}`);
      score -= 1;
    }

    // BOZUK METİN sezgileri — saçma/bozuk cevap GÖNDERİLMEDEN yakalansın.
    // 1) Mojibake / çift kodlanmış Türkçe (Ä±, ÄŸ, Ã¼, â€ ...).
    if (/Ã[-ÿ]|Ä[-ÿ]|Å[-ÿ]|â€/.test(text)) {
      reasons.push('BROKEN_ENCODING');
      score -= 5;
    }
    // 2) Yarıda kesilmiş cümle: virgül/bağlaçla bitiyor ya da uzun metin
    //    noktalamasız harf ile bitiyor (kesilmiş üretim).
    if (/[,;:]$/.test(text) || (text.length > 60 && /[a-zçğıöşü]$/i.test(text) && !/[.!?…]$/.test(text))) {
      reasons.push('TRUNCATED_SENTENCE');
      score -= 3;
    }
    // 3) Aynı kelimenin art arda 3+ tekrarı (takılma / kelime salatası).
    if (/\b(\S{2,})(\s+\1){2,}\b/i.test(text)) {
      reasons.push('REPEATED_TOKENS');
      score -= 4;
    }

    return { score: Math.max(0, Math.min(10, score)), reasons };
  }

  private buildJudgePrompt(reply: string, context: BotEvalContext, lastOutgoing: string[]): string {
    return [
      'You are a Turkish WhatsApp QA judge for an accounting office assistant that MUST sound like a real human, not an AI.',
      'Return ONLY JSON: {"score":0-10,"reasons":["..."]}.',
      'REWARD (high score): natural, warm, fluent human Turkish that mirrors the customer tone; concise; directly answers what was asked.',
      'PENALIZE (low score): grammatically broken, scrambled or truncated Turkish (devrik/bozuk/yarim cumle, word salad, cut mid-sentence, missing verb); robotic/corporate template phrases ("ilgili kisiye aktarildi", "kayda alindi", "talebiniz isleme alinmistir", "donus yapilacaktir"); revealing or implying it is a bot/AI/yapay zeka; contradicting earlier messages; fabricated numbers/dates; volunteering status nobody asked about; duplicate wording vs last replies; privacy leaks.',
      'Forbidden = concrete deadline/guarantee promises (kesin biter, garanti, yarina kadar hazir). Ordinary natural phrases like "hemen bakiyorum" / "bir bakayim" are FINE, do not penalize them.',
      'Length: at most 2-3 short sentences. Plain text, no markdown.',
      `Intent: ${context.intent || 'GENEL'}`,
      `Customer message: ${context.message || ''}`,
      `Last outgoing replies: ${JSON.stringify(lastOutgoing.slice(0, 3))}`,
      `Context: ${String(context.contextBlock || '').slice(0, 1800)}`,
      `Reply: ${reply}`,
    ].join('\n');
  }

  /** LLM jüri — Max aboneliği üzerinden (ücretsiz, saf metin JSON). */
  private async judgeViaMax(reply: string, context: BotEvalContext, lastOutgoing: string[]) {
    const model = MAX_MODEL_CHEAP;
    const prompt = this.buildJudgePrompt(reply, context, lastOutgoing);
    const started = Date.now();
    const max = await claudeTextViaMax({ prompt, model, maxTurns: 1 });
    if (!max.ok || !max.text) throw new Error(max.error || 'Max eval boş cevap');
    const parsed = this.parseJudgeJson(max.text);

    if (context.tenantId) {
      await logAiUsage(this.prisma, {
        tenantId: context.tenantId,
        taxpayerId: context.taxpayerId || null,
        source: 'whatsapp-bot-eval-max',
        model,
        fixedCostUsd: 0,
        karar: parsed.score >= 6 ? 'ok' : 'low_score',
        sebep: (parsed.reasons || []).join(', ').slice(0, 200),
        durationMs: Date.now() - started,
      });
    }

    return { score: parsed.score, reasons: parsed.reasons, model, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  private async judgeWithHaiku(reply: string, context: BotEvalContext, lastOutgoing: string[], apiKey: string) {
    const model = DEFAULT_MODEL;
    const prompt = this.buildJudgePrompt(reply, context, lastOutgoing);

    const started = Date.now();
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 180,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 220)}`);
    }

    const data = await res.json();
    const content = Array.isArray(data?.content)
      ? data.content.map((part: any) => part?.text || '').join('\n')
      : '';
    const parsed = this.parseJudgeJson(content);
    const inputTokens = Number(data?.usage?.input_tokens || 0);
    const outputTokens = Number(data?.usage?.output_tokens || 0);
    const costUsd = computeCostUsd(model, { input: inputTokens, output: outputTokens });

    if (context.tenantId) {
      await logAiUsage(this.prisma, {
        tenantId: context.tenantId,
        taxpayerId: context.taxpayerId || null,
        source: 'whatsapp-bot-eval',
        model,
        karar: parsed.score >= 6 ? 'ok' : 'low_score',
        sebep: (parsed.reasons || []).join(', ').slice(0, 200),
        durationMs: Date.now() - started,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      });
    }

    return {
      score: parsed.score,
      reasons: parsed.reasons,
      model,
      inputTokens,
      outputTokens,
      costUsd,
    };
  }

  private parseJudgeJson(raw: string): { score: number; reasons: string[] } {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    const score = Math.max(0, Math.min(10, Number(parsed.score ?? 10)));
    const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.map((r: any) => String(r).slice(0, 80)) : [];
    return { score, reasons };
  }

  private toResult(
    score: number,
    reasons: string[],
    model: string | null,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    warning: string | null,
  ): BotEvalResult {
    const safeScore = Math.max(0, Math.min(10, Math.round(score)));
    return {
      score: safeScore,
      reasons,
      shouldRetry: safeScore < 6,
      fallback: safeScore < 6 ? SAFE_FALLBACK : null,
      model,
      inputTokens,
      outputTokens,
      costUsd,
      warning,
    };
  }

  private intentMismatch(reply: string, intent?: string, message?: string): string | null {
    const r = this.normalize(reply);
    const m = this.normalize(message || '');
    switch (intent) {
      case 'SIKAYET':
        return /(kusura bakmayin|anliyoruz|oncelik|dogrudan|iletildi|ulasti|dönecek|donecek)/.test(r)
          ? null
          : 'INTENT_MISMATCH:SIKAYET';
      case 'BEYANNAME_ONAY_TALEBI':
        return /(gonderildi|gonderiyoruz|tamam gonder|isleme alindi)/.test(r)
          ? 'INTENT_MISMATCH:BEYANNAME_COMMIT'
          : null;
      case 'TARIH_TALEBI':
        return /\b(olur|uygundur|bekleriz|gelin)\b/.test(r) && /\b(yarin|bugun|saat|randevu|gelsem)\b/.test(m)
          ? 'INTENT_MISMATCH:DATE_COMMIT'
          : null;
      default:
        return null;
    }
  }

  private sentenceCount(text: string): number {
    const parts = text.match(/[^.!?]+[.!?]?/g)?.map((part) => part.trim()).filter(Boolean) || [];
    return Math.max(1, parts.length);
  }

  private similarity(a: string, b: string): number {
    const aw = new Set(this.normalize(a).split(/\s+/).filter(Boolean));
    const bw = new Set(this.normalize(b).split(/\s+/).filter(Boolean));
    if (!aw.size || !bw.size) return 0;
    let common = 0;
    for (const word of aw) if (bw.has(word)) common++;
    return common / Math.max(aw.size, bw.size);
  }

  private normalize(raw: string): string {
    return String(raw || '')
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
