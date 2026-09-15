/**
 * fm-ai.ts — FM AI sağlayıcı yönlendiricisi (2026-09-15): sağlayıcı seçimi, OpenAI/Gemini çağrısı (fetch SAHTE — gerçek
 * ağ çağrısı YOK), tekrar + Max yedeği, maliyet hesabı, anonimleştirme. claudeTextViaMax sahte (Max alt-süreci açılmaz).
 */
jest.mock('./max-inference', () => ({
  MAX_MODEL_DEFAULT: 'claude-sonnet-4-6',
  MAX_MODEL_CHEAP: 'claude-haiku-4-5-20251001',
  claudeTextViaMax: jest.fn(async (p: any) => ({ ok: true, text: `MAX:${String(p.prompt).slice(0, 20)}`, model: p.model || 'claude-sonnet-4-6', costUsd: 0 })),
}));

import { claudeTextViaMax } from './max-inference';
import {
  fmTextAi, fmAiSaglayiciSec, openAiMaliyetUsd, geminiMaliyetUsd, anonimlestir, fmAnonimUygulanirMi, kodCitiSoy,
  FM_OPENAI_MODEL_VARSAYILAN, FM_OPENAI_GUCLU_MODEL_VARSAYILAN, FM_GEMINI_MODEL_VARSAYILAN, FM_GEMINI_GUCLU_MODEL_VARSAYILAN,
} from './fm-ai';

const ENV_ANAHTARLARI = [
  'FM_AI_SAGLAYICI', 'FM_AI_GUCLU_SAGLAYICI', 'FM_OPENAI_MODEL', 'FM_OPENAI_GUCLU_MODEL', 'FM_GEMINI_MODEL', 'FM_GEMINI_GUCLU_MODEL',
  'FM_AI_YEDEK', 'FM_AI_ANONIM', 'FM_AI_ANONIM_OKUMA', 'FM_AI_TEKRAR_BEKLEME_MS', 'MOREN_AI_ALLOW_OPENAI_API', 'OPENAI_API_KEY', 'GEMINI_API_KEY',
];
const eskiEnv: Record<string, string | undefined> = {};
const gercekFetch = (globalThis as any).fetch;

function jsonYanit(status: number, body: any): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}
const openAiGovde = (text: string, model = 'gpt-4o-mini-2024-07-18', giris = 1000, cikis = 200) => ({
  model, choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: giris, completion_tokens: cikis },
});
const geminiGovde = (text: string, model = 'gemini-3.1-flash-lite', giris = 1000, cikis = 200) => ({
  modelVersion: model, candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: giris, candidatesTokenCount: cikis },
});

beforeEach(() => {
  for (const k of ENV_ANAHTARLARI) { eskiEnv[k] = process.env[k]; delete process.env[k]; }
  process.env.FM_AI_TEKRAR_BEKLEME_MS = '0';
  (claudeTextViaMax as jest.Mock).mockClear();
});
afterEach(() => {
  for (const k of ENV_ANAHTARLARI) { if (eskiEnv[k] === undefined) delete process.env[k]; else process.env[k] = eskiEnv[k]; }
  (globalThis as any).fetch = gercekFetch;
});

describe('fm-ai — sağlayıcı seçimi', () => {
  it('env boş → max (bugünkü davranış); model parametresi Max modeli', () => {
    expect(fmAiSaglayiciSec('sinif', 'claude-haiku-4-5-20251001', {} as any)).toEqual({ saglayici: 'max', model: 'claude-haiku-4-5-20251001', guclu: false });
    expect(fmAiSaglayiciSec('okuma', undefined, {} as any).saglayici).toBe('max');
  });
  it('FM_AI_SAGLAYICI=openai → hızlı/güçlü OpenAI modeli (Claude modeli yok sayılır; undefined/Sonnet = güçlü)', () => {
    const env: any = { FM_AI_SAGLAYICI: 'openai' };
    expect(fmAiSaglayiciSec('sinif', 'claude-haiku-4-5-20251001', env)).toEqual({ saglayici: 'openai', model: FM_OPENAI_MODEL_VARSAYILAN, guclu: false });
    expect(fmAiSaglayiciSec('okuma', undefined, env)).toEqual({ saglayici: 'openai', model: FM_OPENAI_GUCLU_MODEL_VARSAYILAN, guclu: true });
    expect(fmAiSaglayiciSec('kalem', 'claude-sonnet-4-6', env).model).toBe(FM_OPENAI_GUCLU_MODEL_VARSAYILAN);
    expect(fmAiSaglayiciSec('yorum', 'claude-haiku-4-5-20251001', { ...env, FM_OPENAI_MODEL: 'gpt-4o-mini-2024-07-18' }).model).toBe('gpt-4o-mini-2024-07-18');
  });
  it('sinifGuclu ayrı kapı: FM_AI_GUCLU_SAGLAYICI (varsayılan max), openai/gemini verilirse güçlü model', () => {
    expect(fmAiSaglayiciSec('sinifGuclu', 'claude-sonnet-4-6', { FM_AI_SAGLAYICI: 'openai' } as any).saglayici).toBe('max');
    expect(fmAiSaglayiciSec('sinifGuclu', 'claude-sonnet-4-6', { FM_AI_GUCLU_SAGLAYICI: 'openai' } as any)).toEqual({ saglayici: 'openai', model: FM_OPENAI_GUCLU_MODEL_VARSAYILAN, guclu: true });
    expect(fmAiSaglayiciSec('sinifGuclu', 'claude-sonnet-4-6', { FM_AI_GUCLU_SAGLAYICI: 'gemini', FM_GEMINI_GUCLU_MODEL: 'gemini-3-flash-preview' } as any)).toEqual({ saglayici: 'gemini', model: 'gemini-3-flash-preview', guclu: true });
  });
  it('FM_AI_SAGLAYICI=gemini → gemini-3.1-flash-lite (hızlı) / gemini-3-flash-preview (güçlü)', () => {
    const env: any = { FM_AI_SAGLAYICI: 'gemini' };
    expect(fmAiSaglayiciSec('sinif', 'claude-haiku-4-5-20251001', env)).toEqual({ saglayici: 'gemini', model: FM_GEMINI_MODEL_VARSAYILAN, guclu: false });
    expect(fmAiSaglayiciSec('okuma', undefined, env).model).toBe(FM_GEMINI_GUCLU_MODEL_VARSAYILAN);
    expect(fmAiSaglayiciSec('sinif', 'claude-haiku-4-5-20251001', { ...env, FM_GEMINI_MODEL: 'gemini-2.5-flash-lite' }).model).toBe('gemini-2.5-flash-lite');
  });
});

describe('fm-ai — maliyet', () => {
  it('OpenAI: gpt-4o-mini 0.15/0.60, gpt-4.1-mini 0.40/1.60 (tarihli ad da tanınır), bilinmeyen 0', () => {
    expect(openAiMaliyetUsd('gpt-4o-mini', 1_000_000, 1_000_000)).toBeCloseTo(0.75, 6);
    expect(openAiMaliyetUsd('gpt-4o-mini-2024-07-18', 2000, 500)).toBeCloseTo(0.0006, 6);
    expect(openAiMaliyetUsd('gpt-4.1-mini', 1_000_000, 0)).toBeCloseTo(0.4, 6);
    expect(openAiMaliyetUsd('gpt-5-super', 1_000_000, 1_000_000)).toBe(0);
  });
  it('Gemini: flash-lite 0.10/0.40, flash 0.30/2.50, bilinmeyen 0', () => {
    expect(geminiMaliyetUsd('gemini-3.1-flash-lite', 1_000_000, 1_000_000)).toBeCloseTo(0.5, 6);
    expect(geminiMaliyetUsd('gemini-2.5-flash-lite', 1000, 1000)).toBeCloseTo(0.0005, 6);
    expect(geminiMaliyetUsd('gemini-3-flash-preview', 1_000_000, 1_000_000)).toBeCloseTo(2.8, 6);
    expect(geminiMaliyetUsd('gemini-3-pro', 1_000_000, 1_000_000)).toBe(0);
  });
});

describe('fm-ai — anonimleştirme', () => {
  it('10-11 haneli VKN/TCKN → [VKN]; tutarlar ve kısa sayılar kalır', () => {
    expect(anonimlestir('Satıcı VKN 1234567890, alıcı TCKN 12345678901, tutar 1.234,56 TL, oran 20')).toBe('Satıcı VKN [VKN], alıcı TCKN [VKN], tutar 1.234,56 TL, oran 20');
    expect(anonimlestir('GIB2026000000137')).toBe('GIB2026000000137'); // 13 haneli belge kodu VKN sayılmaz
  });
  it('fatura no / belge no sonrası kod → [NO]', () => {
    expect(anonimlestir('Belge no: ABC2026000000123 ve Fatura No GIB2026000000137')).toBe('Belge no: [NO] ve Fatura No [NO]');
    expect(anonimlestir('fatura numarası: EF12026000001')).toBe('fatura numarası: [NO]');
  });
  it('tarihler (dd.mm.yyyy, dd/mm/yyyy, yyyy-mm-dd) → [TARİH]; tutar ayracı bozulmaz', () => {
    expect(anonimlestir('Tarih 15.09.2026, vade 30/09/2026, ISO 2026-09-15T10:00, tutar 1.234.567,89')).toBe('Tarih [TARİH], vade [TARİH], ISO [TARİH]T10:00, tutar 1.234.567,89');
  });
  it('satıcı adı ve kalemler KALIR', () => {
    const m = 'Satıcı: TURKCELL İLETİŞİM HİZMETLERİ A.Ş. (VKN 8770016380) Fatura kalemleri: Mobil hat ücreti 1.250,00; Tarife bedeli 95,50 — 01.09.2026';
    expect(anonimlestir(m)).toBe('Satıcı: TURKCELL İLETİŞİM HİZMETLERİ A.Ş. (VKN [VKN]) Fatura kalemleri: Mobil hat ücreti 1.250,00; Tarife bedeli 95,50 — [TARİH]');
  });
  it('kapı: FM_AI_ANONIM=1 → sinif/yorum/kalem/sinifGuclu maskelenir; okuma yalnız FM_AI_ANONIM_OKUMA=1 ile', () => {
    expect(fmAnonimUygulanirMi('sinif', {} as any)).toBe(false);
    expect(fmAnonimUygulanirMi('sinif', { FM_AI_ANONIM: '1' } as any)).toBe(true);
    expect(fmAnonimUygulanirMi('yorum', { FM_AI_ANONIM: '1' } as any)).toBe(true);
    expect(fmAnonimUygulanirMi('okuma', { FM_AI_ANONIM: '1' } as any)).toBe(false);
    expect(fmAnonimUygulanirMi('okuma', { FM_AI_ANONIM: '1', FM_AI_ANONIM_OKUMA: '1' } as any)).toBe(true);
  });
  it('kod çiti soyma: ```json … ``` → iç metin', () => {
    expect(kodCitiSoy('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(kodCitiSoy('{"a":1}')).toBe('{"a":1}');
  });
});

describe('fm-ai — fmTextAi (fetch sahte)', () => {
  it('env boş → doğrudan Max; fetch hiç çağrılmaz', async () => {
    const f = jest.fn(); (globalThis as any).fetch = f;
    const r = await fmTextAi({ prompt: 'merhaba', amac: 'sinif' });
    expect(r.ok).toBe(true);
    expect(r.text.startsWith('MAX:')).toBe(true);
    expect(f).not.toHaveBeenCalled();
    expect(claudeTextViaMax).toHaveBeenCalledTimes(1);
    // amac Max'e geçmez (aynı parametreler)
    expect((claudeTextViaMax as jest.Mock).mock.calls[0][0]).toEqual({ prompt: 'merhaba' });
  });

  it('openai: kapı kapalıysa (MOREN_AI_ALLOW_OPENAI_API yok) Max', async () => {
    process.env.FM_AI_SAGLAYICI = 'openai'; process.env.OPENAI_API_KEY = 'sk-test';
    const f = jest.fn(); (globalThis as any).fetch = f;
    const r = await fmTextAi({ prompt: 'x', amac: 'sinif' });
    expect(r.text.startsWith('MAX:')).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it('openai: başarılı çağrı → gövde (temperature 0, system + user, görsel image_url), model/maliyet yanıttan', async () => {
    process.env.FM_AI_SAGLAYICI = 'openai'; process.env.MOREN_AI_ALLOW_OPENAI_API = '1'; process.env.OPENAI_API_KEY = 'sk-test';
    // gpt-4o-mini canlıda ```json çiti ekledi (2026-09-15) → soyulur.
    const f = jest.fn(async () => jsonYanit(200, openAiGovde('```json\n{"kategori":"genel_gider"}\n```')));
    (globalThis as any).fetch = f;
    const r = await fmTextAi({ prompt: 'sınıfla', system: 'SYS', model: 'claude-haiku-4-5-20251001', timeoutMs: 5000, amac: 'sinif', images: [{ base64: 'data:image/png;base64,' + 'A'.repeat(200), mediaType: 'image/png' }] });
    expect(r).toEqual({ ok: true, text: '{"kategori":"genel_gider"}', model: 'gpt-4o-mini-2024-07-18', costUsd: openAiMaliyetUsd('gpt-4o-mini-2024-07-18', 1000, 200) });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = (f as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.temperature).toBe(0);
    expect(body.response_format).toBeUndefined();
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content[0]).toEqual({ type: 'text', text: 'sınıfla' });
    expect(body.messages[1].content[1].type).toBe('image_url');
    expect(body.messages[1].content[1].image_url.url.startsWith('data:image/png;base64,AAAA')).toBe(true);
    expect(body.messages[1].content[1].image_url.detail).toBe('auto');
    expect(claudeTextViaMax).not.toHaveBeenCalled();
  });

  it('openai: görselsiz çağrıda user içeriği düz metin; sinifGuclu FM_AI_GUCLU_SAGLAYICI=openai ile güçlü model', async () => {
    process.env.FM_AI_GUCLU_SAGLAYICI = 'openai'; process.env.MOREN_AI_ALLOW_OPENAI_API = '1'; process.env.OPENAI_API_KEY = 'sk-test';
    const f = jest.fn(async () => jsonYanit(200, openAiGovde('[{"no":1}]', 'gpt-4.1-mini')));
    (globalThis as any).fetch = f;
    const r = await fmTextAi({ prompt: 'toplu', model: 'claude-sonnet-4-6', amac: 'sinifGuclu' });
    expect(r.ok).toBe(true);
    const body = JSON.parse((f as jest.Mock).mock.calls[0][1].body);
    expect(body.model).toBe('gpt-4.1-mini');
    expect(body.messages[1].content).toBe('toplu');
    // aynı env'de 'sinif' (güçlü değil) → FM_AI_SAGLAYICI boş → Max
    const r2 = await fmTextAi({ prompt: 'tekil', model: 'claude-haiku-4-5-20251001', amac: 'sinif' });
    expect(r2.text.startsWith('MAX:')).toBe(true);
  });

  it('openai: 429 → 1 tekrar → başarı (2 fetch, Max yok)', async () => {
    process.env.FM_AI_SAGLAYICI = 'openai'; process.env.MOREN_AI_ALLOW_OPENAI_API = '1'; process.env.OPENAI_API_KEY = 'sk-test';
    const f = jest.fn()
      .mockResolvedValueOnce(jsonYanit(429, { error: { message: 'rate limit' } }))
      .mockResolvedValueOnce(jsonYanit(200, openAiGovde('{"ok":1}')));
    (globalThis as any).fetch = f;
    const r = await fmTextAi({ prompt: 'x', amac: 'yorum' });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('{"ok":1}');
    expect(f).toHaveBeenCalledTimes(2);
    expect(claudeTextViaMax).not.toHaveBeenCalled();
  });

  it('openai: 500 ×2 → FM_AI_YEDEK varsayılan max → claudeTextViaMax sonucu döner', async () => {
    process.env.FM_AI_SAGLAYICI = 'openai'; process.env.MOREN_AI_ALLOW_OPENAI_API = '1'; process.env.OPENAI_API_KEY = 'sk-test';
    const f = jest.fn(async () => jsonYanit(500, 'sunucu hatası'));
    (globalThis as any).fetch = f;
    const r = await fmTextAi({ prompt: 'x', amac: 'kalem', model: 'claude-haiku-4-5-20251001' });
    expect(f).toHaveBeenCalledTimes(2);
    expect(claudeTextViaMax).toHaveBeenCalledTimes(1);
    expect(r.text.startsWith('MAX:')).toBe(true);
    expect(r.model).toBe('claude-haiku-4-5-20251001');
  });

  it('openai: ağ hatası + FM_AI_YEDEK=off → ok:false, Max çağrılmaz', async () => {
    process.env.FM_AI_SAGLAYICI = 'openai'; process.env.MOREN_AI_ALLOW_OPENAI_API = '1'; process.env.OPENAI_API_KEY = 'sk-test'; process.env.FM_AI_YEDEK = 'off';
    const f = jest.fn(async () => { throw new Error('ECONNRESET'); });
    (globalThis as any).fetch = f;
    const r = await fmTextAi({ prompt: 'x', amac: 'sinif' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ağ hatası: ECONNRESET/);
    expect(f).toHaveBeenCalledTimes(2);
    expect(claudeTextViaMax).not.toHaveBeenCalled();
  });

  it('openai: 401 tekrar edilmez, doğrudan Max yedeği', async () => {
    process.env.FM_AI_SAGLAYICI = 'openai'; process.env.MOREN_AI_ALLOW_OPENAI_API = '1'; process.env.OPENAI_API_KEY = 'sk-bad';
    const f = jest.fn(async () => jsonYanit(401, { error: { message: 'invalid key' } }));
    (globalThis as any).fetch = f;
    const r = await fmTextAi({ prompt: 'x', amac: 'sinif' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(claudeTextViaMax).toHaveBeenCalledTimes(1);
    expect(r.text.startsWith('MAX:')).toBe(true);
  });

  it('openai: boş yanıt (content "") → Max yedeği', async () => {
    process.env.FM_AI_SAGLAYICI = 'openai'; process.env.MOREN_AI_ALLOW_OPENAI_API = '1'; process.env.OPENAI_API_KEY = 'sk-test';
    const f = jest.fn(async () => jsonYanit(200, openAiGovde('')));
    (globalThis as any).fetch = f;
    const r = await fmTextAi({ prompt: 'x', amac: 'sinif' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(r.text.startsWith('MAX:')).toBe(true);
  });

  it('gemini: anahtar yoksa Max; anahtar varsa generateContent gövdesi (systemInstruction, contents, inline_data), başlıkta anahtar, çit soyulur, maliyet', async () => {
    process.env.FM_AI_SAGLAYICI = 'gemini';
    const f0 = jest.fn(); (globalThis as any).fetch = f0;
    const r0 = await fmTextAi({ prompt: 'x', amac: 'sinif' });
    expect(r0.text.startsWith('MAX:')).toBe(true);
    expect(f0).not.toHaveBeenCalled();

    process.env.GEMINI_API_KEY = 'gm-test';
    (claudeTextViaMax as jest.Mock).mockClear();
    const f = jest.fn(async () => jsonYanit(200, geminiGovde('```json\n{"kategori":"pazarlama"}\n```')));
    (globalThis as any).fetch = f;
    const r = await fmTextAi({ prompt: 'sınıfla', system: 'SYS', model: 'claude-haiku-4-5-20251001', amac: 'sinif', images: [{ base64: 'B'.repeat(200), mediaType: 'image/jpeg' }] });
    expect(r).toEqual({ ok: true, text: '{"kategori":"pazarlama"}', model: 'gemini-3.1-flash-lite', costUsd: geminiMaliyetUsd('gemini-3.1-flash-lite', 1000, 200) });
    const [url, init] = (f as jest.Mock).mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent');
    expect(url).not.toContain('gm-test'); // anahtar URL'de taşınmaz
    expect(init.headers['x-goog-api-key']).toBe('gm-test');
    const body = JSON.parse(init.body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'SYS' }] });
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0]).toEqual({ text: 'sınıfla' });
    expect(body.contents[0].parts[1]).toEqual({ inline_data: { mime_type: 'image/jpeg', data: 'B'.repeat(200) } });
    expect(body.generationConfig.temperature).toBe(0);
    expect(claudeTextViaMax).not.toHaveBeenCalled();
  });

  it('gemini: 503 → tekrar → yine 503 → Max yedeği; güçlü tur (okuma, model undefined) gemini-3-flash-preview', async () => {
    process.env.FM_AI_SAGLAYICI = 'gemini'; process.env.GEMINI_API_KEY = 'gm-test';
    const f = jest.fn(async () => jsonYanit(503, { error: { message: 'overloaded' } }));
    (globalThis as any).fetch = f;
    const r = await fmTextAi({ prompt: 'oku', amac: 'okuma', model: undefined });
    expect(f).toHaveBeenCalledTimes(2);
    expect((f as jest.Mock).mock.calls[0][0]).toContain('gemini-3-flash-preview');
    expect(claudeTextViaMax).toHaveBeenCalledTimes(1);
    expect(r.text.startsWith('MAX:')).toBe(true);
  });

  it('FM_AI_ANONIM=1: sinif prompt\'u maskelenerek gider; okuma prompt\'u olduğu gibi', async () => {
    process.env.FM_AI_SAGLAYICI = 'openai'; process.env.MOREN_AI_ALLOW_OPENAI_API = '1'; process.env.OPENAI_API_KEY = 'sk-test'; process.env.FM_AI_ANONIM = '1';
    const f = jest.fn(async () => jsonYanit(200, openAiGovde('{}')));
    (globalThis as any).fetch = f;
    const prompt = 'Satıcı VKN 1234567890, Belge no: ABC2026000000123, tarih 15.09.2026, kalem: Mobil hat 1.250,00';
    await fmTextAi({ prompt, amac: 'sinif', model: 'claude-haiku-4-5-20251001' });
    await fmTextAi({ prompt, amac: 'okuma', model: 'claude-haiku-4-5-20251001' });
    const b1 = JSON.parse((f as jest.Mock).mock.calls[0][1].body);
    const b2 = JSON.parse((f as jest.Mock).mock.calls[1][1].body);
    expect(b1.messages[1].content).toBe('Satıcı VKN [VKN], Belge no: [NO], tarih [TARİH], kalem: Mobil hat 1.250,00');
    expect(b2.messages[1].content).toBe(prompt);
  });

  it('boş prompt → ok:false (sağlayıcıya gidilmez)', async () => {
    process.env.FM_AI_SAGLAYICI = 'openai'; process.env.MOREN_AI_ALLOW_OPENAI_API = '1'; process.env.OPENAI_API_KEY = 'sk-test';
    const f = jest.fn(); (globalThis as any).fetch = f;
    const r = await fmTextAi({ prompt: '   ', amac: 'sinif' });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
