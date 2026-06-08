/**
 * Max aboneliği üzerinden saf METİN Claude çıkarımı (ücretsiz — token başına faturalanmaz).
 *
 * Claude Agent SDK (@anthropic-ai/claude-agent-sdk) + CLAUDE_CODE_OAUTH_TOKEN kullanır.
 * DI gerektirmez; herhangi bir servisten doğrudan çağrılabilir. Araçsız (allowedTools: [])
 * ve görsel/ses YOK — sadece metin. Görsel/araç gereken işler bunu KULLANAMAZ (API'de kalır).
 *
 * Tasarım: apps/api/src/calisan/calisan.service.ts içindeki run() çekirdeğinin paylaşılabilir hâli.
 */

const _esmImport: (m: string) => Promise<any> = new Function('m', 'return import(m)') as any;
let _queryFn: any = null;
async function loadQuery(): Promise<any> {
  if (!_queryFn) {
    const sdk = await _esmImport('@anthropic-ai/claude-agent-sdk');
    _queryFn = sdk.query;
  }
  return _queryFn;
}

export const MAX_MODEL_DEFAULT = 'claude-sonnet-4-6';
export const MAX_MODEL_CHEAP = 'claude-haiku-4-5-20251001';

export interface MaxTextResult {
  ok: boolean;
  text: string;
  model: string;
  costUsd: number; // Max kotasından düşer — token başına fatura DEĞİL; görünürlük için
  error?: string;
}

/** Max aboneliği bağlı mı (OAuth token var mı)? */
export function isMaxAvailable(): boolean {
  return !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
}

/**
 * Tek seferlik saf-metin Claude çağrısı (Max). Başarısızsa ok:false döner;
 * çağıran taraf ucuz fallback / atlama yapar (API'ye düşmemek için).
 */
export async function claudeTextViaMax(params: {
  prompt: string;
  system?: string;
  model?: string;
  maxTurns?: number;
  /**
   * Görsel (fatura) okumak için base64 görüntü listesi. Verilirse çağrı, Agent SDK'nın
   * akış-girdi (AsyncIterable<SDKUserMessage>) biçimiyle yapılır ve görüntü doğrudan Max
   * aboneliğine (görsel/vision) iletilir — OCR'a gerek kalmaz, ücretli API çağrılmaz.
   * Görüntü yoksa eski davranış (saf metin) aynen korunur.
   */
  images?: Array<{ base64: string; mediaType?: string }>;
}): Promise<MaxTextResult> {
  const model = params.model || MAX_MODEL_DEFAULT;
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) {
    return { ok: false, text: '', model, costUsd: 0, error: 'CLAUDE_CODE_OAUTH_TOKEN yok — Max bağlı değil.' };
  }
  if (!params.prompt || !params.prompt.trim()) {
    return { ok: false, text: '', model, costUsd: 0, error: 'prompt boş.' };
  }

  // Görüntüleri temizle (data-url önekini at, çok küçük/boş olanları ele).
  const cleanImages = (params.images || [])
    .map((im) => ({
      data: String(im?.base64 || '').replace(/^data:[^;]+;base64,/, '').trim(),
      media_type: im?.mediaType || 'image/jpeg',
    }))
    .filter((im) => im.data.length > 100);

  // İZOLE AUTH: subprocess Max OAuth token'ı kullansın; daha yüksek öncelikli
  // ANTHROPIC_* değişkenlerini düşür ki kesinlikle abonelikten çalışsın (API key'e düşmesin).
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') childEnv[k] = v;
  }
  for (const drop of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
    delete childEnv[drop];
  }
  childEnv.CLAUDE_CODE_OAUTH_TOKEN = token;

  // Görüntü varsa: akış-girdi biçiminde tek bir kullanıcı mesajı (metin + görsel blokları).
  // Görüntü yoksa: eski davranış — düz metin prompt.
  const promptText = params.prompt;
  const queryPrompt =
    cleanImages.length > 0
      ? (async function* () {
          yield {
            type: 'user',
            message: {
              role: 'user',
              content: [
                { type: 'text', text: promptText },
                ...cleanImages.map((im) => ({
                  type: 'image',
                  source: { type: 'base64', media_type: im.media_type, data: im.data },
                })),
              ],
            },
            parent_tool_use_id: null,
          };
        })()
      : promptText;

  let text = '';
  let costUsd = 0;
  let isError = false;
  try {
    const query = await loadQuery();
    for await (const m of query({
      prompt: queryPrompt as any,
      options: {
        model,
        systemPrompt: params.system,
        allowedTools: [], // saf çıkarım — dosya/bash/araç yok
        maxTurns: params.maxTurns ?? 1,
        env: childEnv,
      },
    })) {
      if (m?.type === 'assistant') {
        for (const block of m.message?.content || []) {
          if (block?.type === 'text') text += block.text;
        }
      } else if (m?.type === 'result') {
        isError = Boolean(m.is_error);
        if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
      }
    }
  } catch (e: any) {
    return { ok: false, text: '', model, costUsd: 0, error: e?.message || 'Agent SDK (Max) çağrısı başarısız.' };
  }

  text = text.trim();
  if (isError && !text) {
    return { ok: false, text: '', model, costUsd, error: 'Agent SDK (Max) sonucu hata döndü.' };
  }
  return { ok: true, text, model, costUsd };
}
