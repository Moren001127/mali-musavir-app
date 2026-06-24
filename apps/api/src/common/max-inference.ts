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
  /** Hata, OAuth token süresi/yetkisi kaynaklıysa true — çağıran owner'ı uyarmalı. */
  authExpired?: boolean;
}

/** Max aboneliği bağlı mı (OAuth token var mı)? */
export function isMaxAvailable(): boolean {
  return !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
}

/**
 * Max token sağlık durumu. Token bayatlayınca bot sessizce generic fallback'e
 * düşüyordu; bu izleyici sayesinde sağlık taraması/owner-bildirimi "token süresi
 * doldu, yenile" diye NET uyarı verebilir.
 */
let _lastAuthFailureAt = 0;
let _lastAuthFailureMsg = '';
export function getMaxTokenHealth(): { authExpired: boolean; at: number; message: string } {
  // Son 10 dakikada kimlik hatası olduysa "expired" say.
  const fresh = _lastAuthFailureAt > 0 && Date.now() - _lastAuthFailureAt < 10 * 60 * 1000;
  return { authExpired: fresh, at: _lastAuthFailureAt, message: fresh ? _lastAuthFailureMsg : '' };
}

/** Hata metni OAuth token süresi/yetkisi kaynaklı mı? */
function looksLikeAuthError(msg: string): boolean {
  const s = String(msg || '').toLowerCase();
  return /oauth|unauthorized|401|403|forbidden|expired|invalid[_ ]?(token|api[_ ]?key|grant)|authentication|auth(?:enticate)?[ _]?fail|token.*(expired|invalid|revoked)|please run .*login|not logged in/.test(s);
}

function noteAuthFailure(msg: string) {
  _lastAuthFailureAt = Date.now();
  _lastAuthFailureMsg = String(msg || '').slice(0, 300);
  // Railway loglarında aranabilir NET işaret — sessiz degrade etme.
  console.error(`[MAX-TOKEN-EXPIRED] Max OAuth token süresi/yetkisi sorunlu — yenilenmeli. Detay: ${_lastAuthFailureMsg}`);
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
  timeoutMs?: number;
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

  // HANG KORUMASI: streaming-input (görsel) modunda SDK oturumu sonuç sonrası açık kalıp
  // for-await'i sonsuz bekletebiliyordu → backend kilitleniyor, runner timeout'a düşüp her
  // faturayı "okunamadı" atıyordu. (1) sonuç gelince break, (2) AbortController + sıkı süre
  // sınırı ile ASLA kilitlenme, (3) başarısızsa NET hata (ekrana yansısın, kör kalmayalım).
  const abort = new AbortController();
  const defaultHardMs = cleanImages.length > 0
    ? (Number(process.env.MIHSAP_MAX_HARD_MS) || 11000)
    : (Number(process.env.MAX_TEXT_HARD_MS || process.env.CALISAN_MAX_HARD_MS) || 30000);
  const HARD_MS = Math.max(3000, Number(params.timeoutMs || defaultHardMs) || defaultHardMs);
  let hardTimedOut = false;
  const hardTimer = setTimeout(() => { hardTimedOut = true; try { abort.abort(); } catch {} }, HARD_MS);

  let text = '';
  let costUsd = 0;
  let isError = false;
  let resultError = '';
  try {
    const query = await loadQuery();
    for await (const m of query({
      prompt: queryPrompt as any,
      options: ({
        model,
        // Claude Code'un kocaman varsayılan "kodlama asistanı" promptunu kullanma — saf çıkarımda
        //   gereksiz, model'i yavaşlatır + odağı dağıtır. Çağıran system verirse o, vermezse minimal.
        systemPrompt: params.system ?? 'Sen kısa ve kesin yanıt veren bir çıkarım asistanısın. Yalnız istenen çıktıyı ver, açıklama ekleme.',
        allowedTools: [], // saf çıkarım — dosya/bash/araç yok
        maxTurns: params.maxTurns ?? 1,
        env: childEnv,
        abortController: abort,
        // HIZ: her çağrıda CLAUDE.md/settings dosyalarını OKUMA (saf çıkarımda gereksiz; subprocess'i
        //   yavaşlatıp prompt'u şişiriyordu). Boş kaynak → ayar yükleme yok.
        settingSources: [],
        // SUBPROCESS BAŞLANGIÇ HIZI (OCR kök yavaşlık): her query() yeni Claude Code subprocess'i
        //   açıyor (~soğuk başlangıç). Saf metin/görüntü çıkarımı MCP/plugin/skill KULLANMAZ ama
        //   subprocess açılışta bunları tarayıp yüklüyordu (yavaşlatan asıl yük). Hepsini kapat →
        //   subprocess HAFİF + HIZLI başlar. İZOLASYON KORUNUR: her belge yine AYRI/temiz subprocess
        //   (context karışmaz, muhasebe verisi güvende) — yalnızca başlangıç hızlanır.
        mcpServers: {}, // MCP server bağlantısı kurma (yoksa zaten kullanılmıyor)
        plugins: [], // plugin yükleme yok
        skills: [], // skill tarama/yükleme yok (default 'all' tüm skill'leri tarar = yavaş)
      } as any),
    })) {
      if (m?.type === 'assistant') {
        for (const block of m.message?.content || []) {
          if (block?.type === 'text') text += block.text;
        }
      } else if (m?.type === 'result') {
        isError = Boolean(m.is_error);
        if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
        if (isError) {
          resultError = [
            m?.subtype,
            m?.error,
            typeof m?.result === 'string' ? m.result : '',
            typeof m?.message === 'string' ? m.message : '',
          ].filter(Boolean).join(' | ').slice(0, 500);
        }
        break; // sonuç geldi → streaming oturumu açık kalsa bile bekleme
      }
    }
  } catch (e: any) {
    clearTimeout(hardTimer);
    if (hardTimedOut) {
      return { ok: false, text: '', model, costUsd: 0, error: `Max ${HARD_MS}ms icinde yanit vermedi (gorsel/oturum takildi)` };
    }
    const err = e?.message || 'Agent SDK (Max) çağrısı başarısız.';
    const authExpired = looksLikeAuthError(err);
    if (authExpired) noteAuthFailure(err);
    return { ok: false, text: '', model, costUsd: 0, error: err, authExpired };
  }
  clearTimeout(hardTimer);
  if (hardTimedOut && !text.trim()) {
    return { ok: false, text: '', model, costUsd: 0, error: `Max ${HARD_MS}ms icinde yanit vermedi (gorsel/oturum takildi)` };
  }

  text = text.trim();
  if (isError && !text) {
    const err = resultError ? `Agent SDK (Max) sonucu hata dondu: ${resultError}` : 'Agent SDK (Max) sonucu hata döndü.';
    const authExpired = looksLikeAuthError(err);
    if (authExpired) noteAuthFailure(err);
    return { ok: false, text: '', model, costUsd, error: err, authExpired };
  }
  return { ok: true, text, model, costUsd };
}
