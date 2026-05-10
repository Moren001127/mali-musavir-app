/**
 * Paylaşılan AI Kullanım Logger
 *
 * Sistemde Claude/Anthropic API çağrısı yapan her yer bu helper'ı kullanmalı.
 * Böylece panel widget'ı tüm modüllerin (Mihsap fatura, fiş yazdırma, vb.)
 * birleşik maliyetini gösterebilir.
 *
 * Kullanım:
 *   await logAiUsage(prisma, {
 *     tenantId, source: 'fis-yazdirma', model, response, karar, sebep, durationMs
 *   });
 */

// Anthropic Haiku 4.5 fiyatları (USD / milyon token)
// https://www.anthropic.com/pricing
const PRICES: Record<string, { in: number; out: number; cacheR: number; cacheW: number }> = {
  'claude-haiku-4-5-20251001': { in: 1.0, out: 5.0, cacheR: 0.1, cacheW: 1.25 },
  'claude-opus-4-6':           { in: 15.0, out: 75.0, cacheR: 1.5, cacheW: 18.75 },
  'claude-sonnet-4-6':         { in: 3.0, out: 15.0, cacheR: 0.3, cacheW: 3.75 },
  // Fallback
  default:                     { in: 3.0, out: 15.0, cacheR: 0.3, cacheW: 3.75 },
};

export function computeCostUsd(
  model: string,
  tokens: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number },
): number {
  const p = PRICES[model] || PRICES.default;
  const inT = tokens.input || 0;
  const outT = tokens.output || 0;
  const cR = tokens.cacheRead || 0;
  const cW = tokens.cacheWrite || 0;
  return (
    (inT / 1_000_000) * p.in +
    (outT / 1_000_000) * p.out +
    (cR / 1_000_000) * p.cacheR +
    (cW / 1_000_000) * p.cacheW
  );
}

export interface AiUsageLogParams {
  tenantId: string;
  source: string; // "mihsap-fatura" | "fis-yazdirma" | vb.
  model: string;
  mukellef?: string | null;
  belgeNo?: string | null;
  karar?: string | null;
  sebep?: string | null;
  taxpayerId?: string | null;
  durationMs?: number;
  cacheHit?: boolean;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    cacheCreationTokens?: number;
  } | null;
}

/**
 * Anthropic API yanıtından usage bilgisini çıkarıp DB'ye yazar.
 * Herhangi bir hata ana akışı bozmaz, sadece sessizce loglar.
 */
export async function logAiUsage(prisma: any, params: AiUsageLogParams): Promise<void> {
  try {
    const u = params.usage || {};
    const num = (...values: Array<number | null | undefined>) => {
      for (const value of values) {
        const n = Number(value || 0);
        if (Number.isFinite(n) && n > 0) return Math.round(n);
      }
      return 0;
    };
    const tokens = {
      input: num(u.input_tokens, u.inputTokens),
      output: num(u.output_tokens, u.outputTokens),
      cacheRead: num(u.cache_read_input_tokens, u.cacheReadTokens),
      cacheWrite: num(u.cache_creation_input_tokens, u.cacheWriteTokens, u.cacheCreationTokens),
    };
    const costUsd = computeCostUsd(params.model, tokens);
    await prisma.aiUsageLog.create({
      data: {
        tenantId: params.tenantId || 'unknown',
        taxpayerId: params.taxpayerId || null,
        source: params.source || 'other',
        mukellef: params.mukellef || null,
        model: params.model,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cacheReadTokens: tokens.cacheRead,
        cacheWriteTokens: tokens.cacheWrite,
        costUsd,
        karar: params.karar || null,
        sebep: (params.sebep || '').slice(0, 200) || null,
        belgeNo: params.belgeNo || null,
        durationMs: params.durationMs ?? null,
        cacheHit: !!params.cacheHit,
      },
    });
  } catch {
    // sessizce geç — log hatası ana akışı bozmasın
  }
}
