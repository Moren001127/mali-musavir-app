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
  'claude-opus-4-8':           { in: 15.0, out: 75.0, cacheR: 1.5, cacheW: 18.75 },
  'claude-sonnet-4-6':         { in: 3.0, out: 15.0, cacheR: 0.3, cacheW: 3.75 },
  'gpt-realtime-mini':         { in: 0.6, out: 2.4, cacheR: 0.06, cacheW: 0 },
  'gemini-2.5-flash-lite':     { in: 0.1, out: 0.4, cacheR: 0, cacheW: 0 },
  'gpt-5.4-nano':              { in: 0.2, out: 1.25, cacheR: 0, cacheW: 0 },
  'gpt-5.4-mini':              { in: 0.75, out: 4.5, cacheR: 0, cacheW: 0 },
  // Fallback
  default:                     { in: 3.0, out: 15.0, cacheR: 0.3, cacheW: 3.75 },
};

// Realtime ses modellerinde audio token fiyatı text token fiyatından farklıdır.
// Değerler USD / milyon token.
const REALTIME_PRICES: Record<string, {
  textIn: number;
  textOut: number;
  textCached: number;
  audioIn: number;
  audioOut: number;
  audioCached: number;
}> = {
  'gpt-realtime-mini': {
    textIn: 0.6,
    textOut: 2.4,
    textCached: 0.06,
    audioIn: 10,
    audioOut: 20,
    audioCached: 0.3,
  },
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

export function computeRealtimeCostUsd(model: string, usage: any): number {
  const p = REALTIME_PRICES[model] || REALTIME_PRICES['gpt-realtime-mini'];
  const inputDetails = usage?.input_token_details || usage?.inputTokenDetails || {};
  const outputDetails = usage?.output_token_details || usage?.outputTokenDetails || {};
  const cachedDetails = inputDetails?.cached_tokens_details || inputDetails?.cachedTokenDetails || {};
  const num = (value: any) => {
    const n = Number(value || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const textInput = num(inputDetails.text_tokens ?? inputDetails.textTokens);
  const audioInput = num(inputDetails.audio_tokens ?? inputDetails.audioTokens);
  const cachedText = num(cachedDetails.text_tokens ?? cachedDetails.textTokens);
  const cachedAudio = num(cachedDetails.audio_tokens ?? cachedDetails.audioTokens);
  const textOutput = num(outputDetails.text_tokens ?? outputDetails.textTokens);
  const audioOutput = num(outputDetails.audio_tokens ?? outputDetails.audioTokens);

  if (textInput || audioInput || cachedText || cachedAudio || textOutput || audioOutput) {
    return (
      (Math.max(0, textInput - cachedText) / 1_000_000) * p.textIn +
      (cachedText / 1_000_000) * p.textCached +
      (Math.max(0, audioInput - cachedAudio) / 1_000_000) * p.audioIn +
      (cachedAudio / 1_000_000) * p.audioCached +
      (textOutput / 1_000_000) * p.textOut +
      (audioOutput / 1_000_000) * p.audioOut
    );
  }

  // Detay gelmezse ses oturumu için güvenli tahmin: tokenların audio olduğunu varsay.
  return (
    (num(usage?.input_tokens ?? usage?.inputTokens) / 1_000_000) * p.audioIn +
    (num(usage?.output_tokens ?? usage?.outputTokens) / 1_000_000) * p.audioOut
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
  fixedCostUsd?: number;
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
    const costUsd =
      typeof params.fixedCostUsd === 'number' && Number.isFinite(params.fixedCostUsd)
        ? Math.max(0, params.fixedCostUsd)
        : computeCostUsd(params.model, tokens);
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

// ───────────────────────────────────────────────────────────────────────────
// AYLIK ÜCRETLİ API MALİYET TAVANI (sürpriz fatura koruması)
//
// Amaç: Max aboneliğine taşınamayan (OCR/ses/Gemini/araçlı sohbet) ücretli API
// çağrıları için aylık bir tavan koymak. Tavan aşılınca ücretli çağrı ENGELLENİR
// ve çağıran taraf güvenli fallback'e düşer; owner'a tek seferlik bildirim atılır.
//
// Max (abonelik) kaynakları tavandan HARİÇtir — onlar token başına faturalanmaz.
// Env: AI_MONTHLY_COST_CAP_USD (boş/0 ise koddaki varsayılan kullanılır).
// ───────────────────────────────────────────────────────────────────────────

const DEFAULT_MONTHLY_CAP_USD = 50; // ~1750 TL; normal kullanımda asla çarpmaz, sadece kaçak/döngü harcamayı keser

/** Max abonelik (ücretsiz) kaynaklarını API tavanından ayır. */
function isSubscriptionSource(source?: string | null): boolean {
  return /max/i.test(String(source || ''));
}

/** Bu ay (UTC) ücretli API harcaması — Max kaynakları hariç. */
export async function getMonthlyApiCostUsd(prisma: any, tenantId: string): Promise<number> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  try {
    const rows = await prisma.aiUsageLog.groupBy({
      by: ['source'],
      where: { tenantId, createdAt: { gte: start } },
      _sum: { costUsd: true },
    });
    let total = 0;
    for (const r of rows as any[]) {
      if (isSubscriptionSource(r.source)) continue;
      total += Number(r?._sum?.costUsd || 0);
    }
    return Number(total.toFixed(4));
  } catch {
    return 0;
  }
}

export interface AiBudgetStatus {
  enabled: boolean;
  capUsd: number;
  spentUsd: number;
  remainingUsd: number;
  ratio: number;
  overCap: boolean;
}

export async function getAiBudgetStatus(prisma: any, tenantId: string): Promise<AiBudgetStatus> {
  const raw = process.env.AI_MONTHLY_COST_CAP_USD;
  const capUsd = raw != null && String(raw).trim() !== '' ? Number(raw) : DEFAULT_MONTHLY_CAP_USD;
  const enabled = Number.isFinite(capUsd) && capUsd > 0;
  if (!enabled) {
    return { enabled: false, capUsd: 0, spentUsd: 0, remainingUsd: 0, ratio: 0, overCap: false };
  }
  const spentUsd = await getMonthlyApiCostUsd(prisma, tenantId);
  return {
    enabled: true,
    capUsd,
    spentUsd,
    remainingUsd: Math.max(0, Number((capUsd - spentUsd).toFixed(4))),
    ratio: capUsd > 0 ? spentUsd / capUsd : 0,
    overCap: spentUsd >= capUsd,
  };
}

// Owner bildirimini ayda bir kez at (in-memory; tek Railway process için yeterli).
const _capNotified = new Set<string>();

/**
 * ÜCRETLİ API çağrısından ÖNCE çağır. Tavan aşıldıysa false döner →
 * çağıran taraf ucuz fallback / atlama yapar. Tavan aşıldığında owner'a
 * ayda bir kez bildirim oluşturur (debounce).
 */
export async function canSpendOnApi(prisma: any, tenantId: string, source?: string): Promise<boolean> {
  // Max kaynağı zaten ücretsiz → tavan kontrolüne takılmasın.
  if (isSubscriptionSource(source)) return true;
  const status = await getAiBudgetStatus(prisma, tenantId);
  if (!status.enabled || !status.overCap) return true;

  const monthKey = new Date().toISOString().slice(0, 7);
  const dedupeKey = `${tenantId}:${monthKey}`;
  if (!_capNotified.has(dedupeKey)) {
    _capNotified.add(dedupeKey);
    try {
      await prisma.notification.create({
        data: {
          tenantId,
          type: 'AI_COST_LIMIT',
          title: '⚠️ AI maliyet tavanı doldu',
          body:
            `Bu ay ücretli AI harcaması tavana ulaştı ` +
            `(${status.spentUsd.toFixed(2)}$ / ${status.capUsd.toFixed(2)}$). ` +
            `Yeni ücretli AI çağrıları ay sonuna kadar durduruldu. ` +
            `Tavanı Railway env AI_MONTHLY_COST_CAP_USD ile değiştirebilirsin.`,
          metadata: { spentUsd: status.spentUsd, capUsd: status.capUsd, monthKey },
        },
      });
    } catch {
      // bildirim hatası akışı bozmasın
    }
  }
  return false;
}

/**
 * Tüm tenant'lar genelinde bu ayki ücretli API harcaması (Max kaynakları hariç).
 * Tenant bağlamı olmayan noktalar (örn. OCR servisi) için kullanılır.
 */
export async function getGlobalMonthlyApiCostUsd(prisma: any): Promise<number> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  try {
    const rows = await prisma.aiUsageLog.groupBy({
      by: ['source'],
      where: { createdAt: { gte: start } },
      _sum: { costUsd: true },
    });
    let total = 0;
    for (const r of rows as any[]) {
      if (isSubscriptionSource(r.source)) continue;
      total += Number(r?._sum?.costUsd || 0);
    }
    return Number(total.toFixed(4));
  } catch {
    return 0;
  }
}

/**
 * Tenant bağlamı olmayan ücretli çağrılar için global tavan kontrolü (örn. OCR).
 * Tavan aşıldıysa false döner ve owner'a ayda bir kez bildirim oluşturur.
 */
export async function canSpendOnApiGlobal(prisma: any, source?: string): Promise<boolean> {
  if (isSubscriptionSource(source)) return true;
  const raw = process.env.AI_MONTHLY_COST_CAP_USD;
  const capUsd = raw != null && String(raw).trim() !== '' ? Number(raw) : DEFAULT_MONTHLY_CAP_USD;
  if (!(Number.isFinite(capUsd) && capUsd > 0)) return true;

  const spentUsd = await getGlobalMonthlyApiCostUsd(prisma);
  if (spentUsd < capUsd) return true;

  const monthKey = new Date().toISOString().slice(0, 7);
  const dedupeKey = `global:${monthKey}`;
  if (!_capNotified.has(dedupeKey)) {
    _capNotified.add(dedupeKey);
    try {
      await prisma.notification.create({
        data: {
          tenantId: process.env.MOREN_OWNER_TENANT_SLUG || 'default',
          type: 'AI_COST_LIMIT',
          title: '⚠️ AI maliyet tavanı doldu',
          body:
            `Bu ay ücretli AI harcaması tavana ulaştı ` +
            `(${spentUsd.toFixed(2)}$ / ${capUsd.toFixed(2)}$). ` +
            `Yeni ücretli AI çağrıları ay sonuna kadar durduruldu.`,
          metadata: { spentUsd, capUsd, monthKey, scope: 'global' },
        },
      });
    } catch {
      // bildirim hatası akışı bozmasın
    }
  }
  return false;
}
