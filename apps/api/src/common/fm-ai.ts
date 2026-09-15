/**
 * FM AI SAĞLAYICI YÖNLENDİRİCİSİ — Fatura İşleme Merkezi'nin AI çağrıları için TEK KAPI (2026-09-15).
 *
 * CANLI ÖLÇÜM (2026-09-15): entegratör (Paraşüt, UBL XML) faturasının "AI ile okunması" belge başına 220–320 sn;
 *   XML alanları anında çıkıyor, süre Max aboneliği (Claude Agent SDK alt-süreci → claudeTextViaMax) üzerinden
 *   yapılan 2–3 çağrıya gidiyor (kalem tamamlama, sınıflandırma, yorum) — her Max çağrısı 60–150 sn.
 *   Aylık 560 belge; hedef 10.000 belge/ay. Muzaffer Bey'in kararı (D): OpenAI gpt-4o-mini + Max yedek.
 *   Ek (koordinatör, aynı gün): Gemini seçeneği (GEMINI_API_KEY Railway'de mevcut; gemini-2.5-flash bu hesapta 404 → KULLANMA).
 *
 * KURAL: `claudeTextViaMax` ile AYNI girdi/çıktı biçimi (MaxTextResult) — çağıranlar yalnız `amac` ekler.
 *   Deploy sonrası ortam değişkeni verilmeden HİÇBİR ŞEY DEĞİŞMEZ (FM_AI_SAGLAYICI boş → bugünkü Max yolu).
 *
 * ORTAM DEĞİŞKENLERİ (deploy gerektirmez):
 *   FM_AI_SAGLAYICI        = openai | gemini | (boş/başka → max)   okuma/kalem/sinif/yorum çağrılarının sağlayıcısı
 *   FM_AI_GUCLU_SAGLAYICI  = max (varsayılan) | openai | gemini    'sinifGuclu' (Sonnet eskalasyonu) sağlayıcısı
 *   FM_OPENAI_MODEL        = gpt-4o-mini (varsayılan)             OpenAI hızlı model
 *   FM_OPENAI_GUCLU_MODEL  = gpt-4.1-mini (varsayılan)            OpenAI güçlü model (sinifGuclu + Sonnet istenen çağrılar)
 *   FM_GEMINI_MODEL        = gemini-3.1-flash-lite (varsayılan)   Gemini hızlı model
 *   FM_GEMINI_GUCLU_MODEL  = gemini-3-flash-preview (varsayılan)  Gemini güçlü model
 *   FM_AI_YEDEK            = max (varsayılan) | off               sağlayıcı başarısızsa Max'e düş / düşme (ok:false)
 *   FM_AI_ANONIM           = 1 → prompt gönderilmeden VKN/TCKN, belge no, tarih maskelenir (varsayılan kapalı; okuma
 *                            amacında uygulanmaz — okuma bu alanları çıkarır; FM_AI_ANONIM_OKUMA=1 zorlar)
 *   FM_OPENAI_TIMEOUT_MS   = 60000 (varsayılan)                   çağıran timeoutMs vermediyse (Gemini için de)
 *   FM_AI_TEKRAR_BEKLEME_MS= 2000 (varsayılan)                    429/5xx/ağ hatasında tek tekrar öncesi bekleme
 *   MOREN_AI_ALLOW_OPENAI_API=1 + OPENAI_API_KEY                  OpenAI kapısı (voice.service.ts ile aynı) — yoksa Max'e düşer
 *   GEMINI_API_KEY                                                Gemini kapısı — yoksa Max'e düşer
 *
 * Anthropic ücretli API (ANTHROPIC_API_KEY) BURADA DA YASAK — yalnız OpenAI / Gemini (mevcut anahtarlar) ve Max.
 * Model parametresi Max'e özgüdür (`claude-…`); OpenAI/Gemini dalında model adı env'den gelir, parametredeki Claude
 *   modeli YOK SAYILIR; yalnız "güçlü mü" bilgisi çıkarılır (model verilmemiş ya da MAX_MODEL_DEFAULT = Sonnet istenmiş).
 * Prompt'lar zaten "yalnız JSON döndür" der ve çağıranlar `text` içinden `{...}` çeker → OpenAI response_format
 *   KULLANILMAZ (prompt'ta "json" kelimesi olmayan çağrıda hata verir); Gemini'nin ```json çitleri soyulur.
 */
import { Logger } from '@nestjs/common';
import { claudeTextViaMax, MAX_MODEL_DEFAULT, MaxTextResult } from './max-inference';

export type FmAiAmac = 'okuma' | 'kalem' | 'sinif' | 'sinifGuclu' | 'yorum';
export type FmAiSaglayici = 'openai' | 'gemini' | 'max';

type MaxParams = Parameters<typeof claudeTextViaMax>[0];
export type FmAiParams = MaxParams & { amac: FmAiAmac };

export const FM_OPENAI_MODEL_VARSAYILAN = 'gpt-4o-mini';
export const FM_OPENAI_GUCLU_MODEL_VARSAYILAN = 'gpt-4.1-mini';
export const FM_GEMINI_MODEL_VARSAYILAN = 'gemini-3.1-flash-lite';
export const FM_GEMINI_GUCLU_MODEL_VARSAYILAN = 'gemini-3-flash-preview';
export const FM_AI_TIMEOUT_MS_VARSAYILAN = 60000;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_URL = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
/** claudeTextViaMax'in system verilmeyince kullandığı minimal talimat — her sağlayıcıda aynı davranış. */
const VARSAYILAN_SISTEM = 'Sen kısa ve kesin yanıt veren bir çıkarım asistanısın. Yalnız istenen çıktıyı ver, açıklama ekleme.';

const logger = new Logger('FmAi');

/** 1M token başına USD: [giriş, çıkış]. Bilinmeyen model → 0 (görünürlük için; fatura değildir). */
const OPENAI_FIYAT_USD_PER_M: Record<string, [number, number]> = {
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4.1-mini': [0.4, 1.6],
};
const GEMINI_FIYAT_USD_PER_M: { lite: [number, number]; flash: [number, number] } = {
  lite: [0.1, 0.4],   // gemini-*-flash-lite
  flash: [0.3, 2.5],  // gemini-*-flash / flash-preview
};

const r6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

/** Model adından OpenAI fiyat anahtarı (gerçek model adı tarihli dönebilir: gpt-4o-mini-2024-07-18). */
function openAiFiyatAnahtari(model: string): string | null {
  const m = String(model || '').trim().toLowerCase();
  if (!m) return null;
  if (OPENAI_FIYAT_USD_PER_M[m]) return m;
  return Object.keys(OPENAI_FIYAT_USD_PER_M).find((k) => m.startsWith(k + '-')) || null;
}

/** OpenAI kullanım tokenlarından maliyet (USD). */
export function openAiMaliyetUsd(model: string, girisToken: number, cikisToken: number): number {
  const key = openAiFiyatAnahtari(model);
  if (!key) return 0;
  const [giris, cikis] = OPENAI_FIYAT_USD_PER_M[key];
  return r6(((Number(girisToken) || 0) / 1_000_000) * giris + ((Number(cikisToken) || 0) / 1_000_000) * cikis);
}

/** Gemini kullanım tokenlarından maliyet (USD): flash-lite 0.10/0.40, flash 0.30/2.50, bilinmeyen 0. */
export function geminiMaliyetUsd(model: string, girisToken: number, cikisToken: number): number {
  const m = String(model || '').trim().toLowerCase();
  const fiyat = m.includes('flash-lite') ? GEMINI_FIYAT_USD_PER_M.lite : m.includes('flash') ? GEMINI_FIYAT_USD_PER_M.flash : null;
  if (!fiyat) return 0;
  return r6(((Number(girisToken) || 0) / 1_000_000) * fiyat[0] + ((Number(cikisToken) || 0) / 1_000_000) * fiyat[1]);
}

/** OpenAI kapısı açık mı? (MOREN_AI_ALLOW_OPENAI_API=1 + OPENAI_API_KEY — voice.service.ts ile aynı kural) */
export function fmOpenAiAnahtari(env: NodeJS.ProcessEnv = process.env): string | null {
  if (String(env.MOREN_AI_ALLOW_OPENAI_API || '') !== '1') return null;
  return String(env.OPENAI_API_KEY || '').trim() || null;
}

/** Gemini kapısı: GEMINI_API_KEY. */
export function fmGeminiAnahtari(env: NodeJS.ProcessEnv = process.env): string | null {
  return String(env.GEMINI_API_KEY || '').trim() || null;
}

/** Çağrı güçlü model mi istiyor? (model verilmemiş = Max varsayılanı Sonnet; ya da açıkça MAX_MODEL_DEFAULT) */
export function fmGucluIstendiMi(model: string | undefined | null): boolean {
  return !model || model === MAX_MODEL_DEFAULT;
}

function saglayiciAdi(v: string | undefined): FmAiSaglayici {
  const s = String(v || '').trim().toLowerCase();
  return s === 'openai' ? 'openai' : s === 'gemini' ? 'gemini' : 'max';
}

/** Sağlayıcı seçimi — saf (env'den okur). Test edilebilir; fmTextAi bunu kullanır. */
export function fmAiSaglayiciSec(
  amac: FmAiAmac,
  model: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): { saglayici: FmAiSaglayici; model: string; guclu: boolean } {
  const guclu = amac === 'sinifGuclu' || fmGucluIstendiMi(model);
  const saglayici = amac === 'sinifGuclu' ? saglayiciAdi(env.FM_AI_GUCLU_SAGLAYICI) : saglayiciAdi(env.FM_AI_SAGLAYICI);
  if (saglayici === 'openai') {
    const hizli = String(env.FM_OPENAI_MODEL || '').trim() || FM_OPENAI_MODEL_VARSAYILAN;
    const guc = String(env.FM_OPENAI_GUCLU_MODEL || '').trim() || FM_OPENAI_GUCLU_MODEL_VARSAYILAN;
    return { saglayici, model: guclu ? guc : hizli, guclu };
  }
  if (saglayici === 'gemini') {
    const hizli = String(env.FM_GEMINI_MODEL || '').trim() || FM_GEMINI_MODEL_VARSAYILAN;
    const guc = String(env.FM_GEMINI_GUCLU_MODEL || '').trim() || FM_GEMINI_GUCLU_MODEL_VARSAYILAN;
    return { saglayici, model: guclu ? guc : hizli, guclu };
  }
  return { saglayici: 'max', model: model || MAX_MODEL_DEFAULT, guclu };
}

/** FM_AI_YEDEK: 'off' → sağlayıcı başarısızsa ok:false; aksi halde (varsayılan) Max'e düş. */
export function fmAiYedekMax(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.FM_AI_YEDEK || '').trim().toLowerCase() !== 'off';
}

// ─────────────────────────────────────────────────────────────────────────────
// ANONİMLEŞTİRME (FM_AI_ANONIM=1): prompt metninden gönderim ÖNCESİ maskeleme. Satıcı adı / kalemler / tutarlar KALIR.
//   10-11 haneli sayılar (VKN/TCKN) → [VKN]; "fatura no / belge no / fatura numarası …" sonrası kod → [NO];
//   tarihler dd.mm.yyyy, dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd → [TARİH].
// ─────────────────────────────────────────────────────────────────────────────
// 10-11 hane, bitişik rakam yok; "1234567890,50" gibi ayraç+rakamla süren tutarın parçası değil.
const RE_VKN = /(?<!\d)(?<!\d[.,])\d{10,11}(?!\d)(?![.,]\d)/g;
const RE_BELGE_NO = /((?:e-?)?(?:fatura|belge|fi[şs]|invoice)\s*(?:no|numaras[ıi]|number|id)\s*[:：.]?\s*)([A-Za-z]{0,4}\d[A-Za-z0-9\-\/]{2,})/giu;
const RE_TARIH_TR = /\b\d{1,2}[./-]\d{1,2}[./-]\d{4}(?!\d)/g;
const RE_TARIH_ISO = /\b\d{4}-\d{2}-\d{2}(?!\d)/g;

/** Saf yardımcı: prompt metnini maskele (VKN/TCKN → [VKN], belge no → [NO], tarih → [TARİH]). */
export function anonimlestir(metin: string): string {
  return String(metin || '')
    .replace(RE_BELGE_NO, '$1[NO]')
    .replace(RE_TARIH_ISO, '[TARİH]')
    .replace(RE_TARIH_TR, '[TARİH]')
    .replace(RE_VKN, '[VKN]');
}

/** FM_AI_ANONIM=1 ve amaç okuma değilse (ya da FM_AI_ANONIM_OKUMA=1) maskele. */
export function fmAnonimUygulanirMi(amac: FmAiAmac, env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.FM_AI_ANONIM || '').trim() !== '1') return false;
  if (amac === 'okuma' && String(env.FM_AI_ANONIM_OKUMA || '').trim() !== '1') return false; // okuma bu alanları ÇIKARIR
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────

type SaglayiciYaniti = {
  ok: boolean;
  text: string;
  model: string;
  girisToken: number;
  cikisToken: number;
  costUsd: number;
  error?: string;
  /** true → 429/5xx/ağ hatası/zaman aşımı (bir kez tekrar denenebilir). */
  tekrarlanabilir?: boolean;
  httpStatus?: number;
};

type CagriGirdisi = {
  apiKey: string;
  model: string;
  prompt: string;
  system?: string;
  images?: Array<{ base64: string; mediaType?: string }>;
  timeoutMs?: number;
  maxTokens?: number;
  fetchFn?: typeof fetch;
};

function temizGorseller(images: CagriGirdisi['images']) {
  return (images || [])
    .map((im) => ({
      data: String(im?.base64 || '').replace(/^data:[^;]+;base64,/, '').trim(),
      mediaType: im?.mediaType || 'image/jpeg',
    }))
    .filter((im) => im.data.length > 100);
}

/** ```json … ``` çitlerini soy (Gemini sık ekler); çağıranlar zaten {...} regex ile çekiyor, yine de temiz metin. */
export function kodCitiSoy(text: string): string {
  const s = String(text || '').trim();
  const m = s.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  return (m ? m[1] : s).trim();
}

/** Zaman aşımlı fetch — ortak. */
async function zamanAsimliFetch(fetchFn: typeof fetch, url: string, init: RequestInit, hardMs: number): Promise<{ res?: Response; zamanAsimi?: boolean; hata?: string }> {
  const abort = new AbortController();
  let zamanAsimi = false;
  const timer = setTimeout(() => { zamanAsimi = true; try { abort.abort(); } catch { /* yok */ } }, hardMs);
  try {
    const res = await fetchFn(url, { ...init, signal: abort.signal });
    return { res };
  } catch (e: any) {
    if (zamanAsimi) return { zamanAsimi: true };
    return { hata: String(e?.message || e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** OpenAI yanıt içeriğini metne indir (string ya da parça dizisi). */
function openAiIcerikMetni(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p: any) => (typeof p === 'string' ? p : String(p?.text || ''))).join('');
  return '';
}

/**
 * Tek OpenAI chat/completions çağrısı (tekrar/yedek YOK — fmTextAi yönetir).
 * Görseller `data:<mediaType>;base64,<...>` image_url parçası olarak gider (detail: auto).
 */
export async function openAiMetinCagrisi(p: CagriGirdisi): Promise<SaglayiciYaniti> {
  const model = p.model;
  const bos: SaglayiciYaniti = { ok: false, text: '', model, girisToken: 0, cikisToken: 0, costUsd: 0 };
  const gorseller = temizGorseller(p.images);
  const userContent: any = gorseller.length
    ? [
        { type: 'text', text: p.prompt },
        ...gorseller.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mediaType};base64,${im.data}`, detail: 'auto' } })),
      ]
    : p.prompt;
  const body: any = {
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: p.system ?? VARSAYILAN_SISTEM },
      { role: 'user', content: userContent },
    ],
  };
  if (p.maxTokens && p.maxTokens > 0) body.max_tokens = p.maxTokens;
  const hardMs = Math.max(3000, Number(p.timeoutMs) || Number(process.env.FM_OPENAI_TIMEOUT_MS) || FM_AI_TIMEOUT_MS_VARSAYILAN);
  const r = await zamanAsimliFetch(p.fetchFn || fetch, OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, hardMs);
  if (r.zamanAsimi) return { ...bos, error: `OpenAI ${hardMs}ms içinde yanıt vermedi`, tekrarlanabilir: true };
  if (!r.res) return { ...bos, error: `OpenAI ağ hatası: ${r.hata}`, tekrarlanabilir: true };
  const res = r.res;
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const status = Number(res.status) || 0;
    return { ...bos, error: `OpenAI HTTP ${status}: ${String(errText || '').replace(/\s+/g, ' ').slice(0, 300)}`, tekrarlanabilir: status === 429 || status >= 500, httpStatus: status };
  }
  const data: any = await res.json().catch(() => null);
  const text = openAiIcerikMetni(data?.choices?.[0]?.message?.content).trim();
  const gercekModel = String(data?.model || model);
  const girisToken = Number(data?.usage?.prompt_tokens) || 0;
  const cikisToken = Number(data?.usage?.completion_tokens) || 0;
  const costUsd = openAiMaliyetUsd(gercekModel, girisToken, cikisToken);
  if (!text) {
    const finish = String(data?.choices?.[0]?.finish_reason || '');
    return { ...bos, model: gercekModel, girisToken, cikisToken, costUsd, error: `OpenAI boş yanıt döndü${finish ? ` (finish_reason=${finish})` : ''}` };
  }
  if (String(data?.choices?.[0]?.finish_reason || '') === 'length') {
    logger.warn(`[FM-AI] openai model=${gercekModel} yanıt uzunluk sınırında kesildi (finish_reason=length) — JSON eksik olabilir`);
  }
  return { ok: true, text, model: gercekModel, girisToken, cikisToken, costUsd };
}

/**
 * Tek Gemini generateContent çağrısı (tekrar/yedek YOK — fmTextAi yönetir).
 * Anahtar `x-goog-api-key` başlığıyla gider (URL sorgu parametresinde anahtar taşınmaz — log/izleme sızıntısı olmasın;
 * Google REST API her iki yolu da kabul eder). Görseller inline_data (mime_type + base64).
 */
export async function geminiMetinCagrisi(p: CagriGirdisi): Promise<SaglayiciYaniti> {
  const model = p.model;
  const bos: SaglayiciYaniti = { ok: false, text: '', model, girisToken: 0, cikisToken: 0, costUsd: 0 };
  const gorseller = temizGorseller(p.images);
  const body: any = {
    systemInstruction: { parts: [{ text: p.system ?? VARSAYILAN_SISTEM }] },
    contents: [{
      role: 'user',
      parts: [
        { text: p.prompt },
        ...gorseller.map((im) => ({ inline_data: { mime_type: im.mediaType, data: im.data } })),
      ],
    }],
    generationConfig: { temperature: 0, ...(p.maxTokens && p.maxTokens > 0 ? { maxOutputTokens: p.maxTokens } : {}) },
  };
  const hardMs = Math.max(3000, Number(p.timeoutMs) || Number(process.env.FM_OPENAI_TIMEOUT_MS) || FM_AI_TIMEOUT_MS_VARSAYILAN);
  const r = await zamanAsimliFetch(p.fetchFn || fetch, GEMINI_URL(model), {
    method: 'POST',
    headers: { 'x-goog-api-key': p.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, hardMs);
  if (r.zamanAsimi) return { ...bos, error: `Gemini ${hardMs}ms içinde yanıt vermedi`, tekrarlanabilir: true };
  if (!r.res) return { ...bos, error: `Gemini ağ hatası: ${r.hata}`, tekrarlanabilir: true };
  const res = r.res;
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const status = Number(res.status) || 0;
    return { ...bos, error: `Gemini HTTP ${status}: ${String(errText || '').replace(/\s+/g, ' ').slice(0, 300)}`, tekrarlanabilir: status === 429 || status >= 500, httpStatus: status };
  }
  const data: any = await res.json().catch(() => null);
  const parts: any[] = Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : [];
  const text = kodCitiSoy(parts.map((x: any) => String(x?.text || '')).join(''));
  const gercekModel = String(data?.modelVersion || model);
  const girisToken = Number(data?.usageMetadata?.promptTokenCount) || 0;
  const cikisToken = Number(data?.usageMetadata?.candidatesTokenCount) || 0;
  const costUsd = geminiMaliyetUsd(gercekModel, girisToken, cikisToken);
  if (!text) {
    const finish = String(data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || '');
    return { ...bos, model: gercekModel, girisToken, cikisToken, costUsd, error: `Gemini boş yanıt döndü${finish ? ` (${finish})` : ''}` };
  }
  if (String(data?.candidates?.[0]?.finishReason || '') === 'MAX_TOKENS') {
    logger.warn(`[FM-AI] gemini model=${gercekModel} yanıt uzunluk sınırında kesildi (MAX_TOKENS) — JSON eksik olabilir`);
  }
  return { ok: true, text, model: gercekModel, girisToken, cikisToken, costUsd };
}

const kapiUyarisi = new Set<string>();
function kapiUyar(anahtar: string, mesaj: string) {
  if (kapiUyarisi.has(anahtar)) return;
  kapiUyarisi.add(anahtar);
  logger.warn(mesaj);
}

/**
 * FM AI ÇAĞRISI — claudeTextViaMax ile aynı sözleşme + `amac`.
 *  - FM_AI_SAGLAYICI=openai|gemini (sinifGuclu için FM_AI_GUCLU_SAGLAYICI) → o sağlayıcı; kapı/anahtar yoksa Max (bir kez uyarı).
 *  - 429/5xx/ağ hatası/zaman aşımı → FM_AI_TEKRAR_BEKLEME_MS (2 sn) bekleyip 1 kez tekrar; yine olmazsa FM_AI_YEDEK=max
 *    (varsayılan) → Max; off → ok:false. Diğer HTTP hataları (400/401/403…) tekrar edilmez; yedek kuralı aynen uygulanır.
 *  - FM_AI_ANONIM=1 → prompt gönderilmeden maskelenir (okuma amacı hariç).
 *  - Her sağlayıcı çağrısında tek satır log: [FM-AI] <sağlayıcı> model=… amac=… giriş=… çıkış=… süre=…ms maliyet=…$
 */
export async function fmTextAi(params: FmAiParams): Promise<MaxTextResult> {
  const { amac, ...maxParams } = params;
  const secim = fmAiSaglayiciSec(amac, maxParams.model);
  if (secim.saglayici === 'max') return claudeTextViaMax(maxParams);

  const apiKey = secim.saglayici === 'openai' ? fmOpenAiAnahtari() : fmGeminiAnahtari();
  if (!apiKey) {
    kapiUyar(secim.saglayici, secim.saglayici === 'openai'
      ? '[FM-AI] FM_AI_SAGLAYICI=openai ama kapı kapalı (MOREN_AI_ALLOW_OPENAI_API=1 + OPENAI_API_KEY gerekli) → Max yolu kullanılıyor'
      : '[FM-AI] FM_AI_SAGLAYICI=gemini ama GEMINI_API_KEY yok → Max yolu kullanılıyor');
    return claudeTextViaMax(maxParams);
  }
  if (!maxParams.prompt || !maxParams.prompt.trim()) {
    return { ok: false, text: '', model: secim.model, costUsd: 0, error: 'prompt boş.' };
  }

  const prompt = fmAnonimUygulanirMi(amac) ? anonimlestir(maxParams.prompt) : maxParams.prompt;
  const maxTokens = Number(process.env.FM_OPENAI_MAX_TOKENS) || undefined;
  const cagri = secim.saglayici === 'openai' ? openAiMetinCagrisi : geminiMetinCagrisi;
  const girdi: CagriGirdisi = { apiKey, model: secim.model, prompt, system: maxParams.system, images: maxParams.images, timeoutMs: maxParams.timeoutMs, maxTokens };
  const t0 = Date.now();
  let yanit = await cagri(girdi);
  if (!yanit.ok && yanit.tekrarlanabilir) {
    const bekle = Math.max(0, Number(process.env.FM_AI_TEKRAR_BEKLEME_MS ?? 2000));
    logger.warn(`[FM-AI] ${secim.saglayici} model=${secim.model} amac=${amac} geçici hata (${yanit.error}) → ${bekle}ms sonra tekrar`);
    if (bekle > 0) await new Promise((r) => setTimeout(r, bekle));
    yanit = await cagri(girdi);
  }
  const sure = Date.now() - t0;
  if (yanit.ok) {
    logger.log(`[FM-AI] ${secim.saglayici} model=${yanit.model} amac=${amac} giriş=${yanit.girisToken} çıkış=${yanit.cikisToken} süre=${sure}ms maliyet=${yanit.costUsd.toFixed(6)}$`);
    return { ok: true, text: yanit.text, model: yanit.model, costUsd: yanit.costUsd };
  }
  if (fmAiYedekMax()) {
    logger.warn(`[FM-AI] ${secim.saglayici} model=${secim.model} amac=${amac} başarısız (${yanit.error}) süre=${sure}ms → Max yedeğine düşülüyor`);
    return claudeTextViaMax(maxParams);
  }
  logger.error(`[FM-AI] ${secim.saglayici} model=${secim.model} amac=${amac} başarısız (${yanit.error}) süre=${sure}ms — FM_AI_YEDEK=off, Max'e düşülmedi`);
  return { ok: false, text: '', model: yanit.model || secim.model, costUsd: yanit.costUsd || 0, error: yanit.error || `${secim.saglayici} çağrısı başarısız.` };
}
