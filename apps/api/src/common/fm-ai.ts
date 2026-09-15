/**
 * FM AI SAĞLAYICI YÖNLENDİRİCİSİ — Fatura İşleme Merkezi'nin AI çağrıları için TEK KAPI (2026-09-15).
 *
 * CANLI ÖLÇÜM (2026-09-15): entegratör (Paraşüt, UBL XML) faturasının "AI ile okunması" belge başına 220–320 sn;
 *   XML alanları anında çıkıyor, süre Max aboneliği (Claude Agent SDK alt-süreci → claudeTextViaMax) üzerinden
 *   yapılan 2–3 çağrıya gidiyor (kalem tamamlama, sınıflandırma, yorum) — her Max çağrısı 60–150 sn.
 *   Aylık 560 belge; hedef 10.000 belge/ay. Muzaffer Bey'in kararı (D): OpenAI gpt-4o-mini + Max yedek.
 *   Ek (koordinatör, aynı gün): Gemini seçeneği (GEMINI_API_KEY Railway'de mevcut; gemini-2.5-flash "yeni kullanıcılara kapalı" 404 → KULLANMA).
 *   CANLI KARŞILAŞTIRMA (2026-09-15, 30 belge, Max Haiku ile hesap kodu uyumu): gpt-4o-mini 16/20 (2 bariz hata), gemini-3.1-flash-lite
 *   18/20 (~1 sn/çağrı), gemini-3-flash-preview 19/20 (yavaş, 75 sn zaman aşımı gördü), gemini-3.8-flash 19/20 (~3,7 sn/çağrı,
 *   30 belge $0,08) → o gün varsayılan gemini-3.8-flash yapıldı; 2026-09-15 maliyet incelemesiyle (331 TL'lik gece) varsayılan
 *   gemini-3.1-flash-lite'a çekildi, güçlü tur gemini-3.8-flash; Railway'de FM_AI_SAGLAYICI=gemini.
 *
 * KURAL: `claudeTextViaMax` ile AYNI girdi/çıktı biçimi (MaxTextResult) — çağıranlar yalnız `amac` ekler.
 *   Deploy sonrası ortam değişkeni verilmeden HİÇBİR ŞEY DEĞİŞMEZ (FM_AI_SAGLAYICI boş → bugünkü Max yolu).
 *
 * ORTAM DEĞİŞKENLERİ (deploy gerektirmez):
 *   FM_AI_SAGLAYICI        = openai | gemini | (boş/başka → max)   okuma/kalem/sinif/yorum çağrılarının sağlayıcısı
 *   FM_AI_GUCLU_SAGLAYICI  = max (varsayılan) | openai | gemini    'sinifGuclu' (Sonnet eskalasyonu) sağlayıcısı
 *   FM_OPENAI_MODEL        = gpt-4o-mini (varsayılan)             OpenAI hızlı model
 *   FM_OPENAI_GUCLU_MODEL  = gpt-4.1-mini (varsayılan)            OpenAI güçlü model (sinifGuclu + Sonnet istenen çağrılar)
 *   FM_GEMINI_MODEL        = gemini-3.1-flash-lite (varsayılan)   Gemini hızlı model (2026-09-15: ucuz model koda sabitlendi)
 *   FM_GEMINI_GUCLU_MODEL  = gemini-3.8-flash (varsayılan)        Gemini güçlü model
 *   FM_GEMINI_FIYAT_LITE / FM_GEMINI_FIYAT_FLASH = "giriş,çıkış" $/M (fiyat değişince deploy'suz düzelt)
 *   FM_AI_ONBELLEK_SN      = 900 (0 = kapalı)                     birebir aynı çağrının yanıtı bu süre saklanır
 *   FM_AI_BEKCI            = on | off  · FM_AI_BEKCI_KAT=4 · FM_AI_BEKCI_DURAKLAT_DK=60 · FM_AI_BEKCI_TEK_TOKEN=40000
 *                            birim maliyet bekçisi (toplam harcamaya DEĞİL, belge/çağrı başı anormalliğe bakar)
 *   FM_AI_YEDEK            = max (varsayılan) | off               sağlayıcı başarısızsa Max'e düş / düşme (ok:false)
 *   FM_AI_ANONIM           = 1 → prompt gönderilmeden VKN/TCKN, belge no, tarih maskelenir (varsayılan kapalı; okuma
 *                            amacında uygulanmaz — okuma bu alanları çıkarır; FM_AI_ANONIM_OKUMA=1 zorlar)
 *   FM_GEMINI_DUSUNME      = 0 (varsayılan) | low | medium | high | auto   Gemini "düşünme" (thinking) bütçesi. CANLI BULGU (2026-09-15):
 *                            3.x flash modelleri varsayılan olarak DÜŞÜNÜR; düşünme token'ları çıktı fiyatından faturalanır ve
 *                            candidatesTokenCount'ta GÖRÜNMEZ (thoughtsTokenCount) → AI Studio 175 TL gösterirken log 30 TL diyordu.
 *                            Sınıflandırma/kalem/yorum için düşünme gereksiz (aynı cevap, daha hızlı) → thinkingBudget 0.
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
import { AsyncLocalStorage } from 'async_hooks';
import { createHash } from 'crypto';
import { claudeTextViaMax, MAX_MODEL_DEFAULT, MaxTextResult } from './max-inference';
import { logAiUsage, sahipTenantIdBul } from './ai-usage-logger';

export type FmAiAmac = 'okuma' | 'kalem' | 'sinif' | 'sinifGuclu' | 'yorum';
export type FmAiSaglayici = 'openai' | 'gemini' | 'max';

type MaxParams = Parameters<typeof claudeTextViaMax>[0];
export type FmAiParams = MaxParams & {
  amac: FmAiAmac;
  /** Bu çağrı kaç belge için? (parti sınıflandırması n belge) — bekçi birim maliyeti belge başına ölçer. Varsayılan 1. */
  bekciBirim?: number;
  /** false → bu çağrı önbelleğe bakmaz/yazmaz (okuma tekrar denemesi: aynı cevabı tekrar almak istemeyiz). Varsayılan true. */
  onbellek?: boolean;
};

export const FM_OPENAI_MODEL_VARSAYILAN = 'gpt-4o-mini';
export const FM_OPENAI_GUCLU_MODEL_VARSAYILAN = 'gpt-4.1-mini';
// 2026-09-15 (Gemini maliyet incelemesi): ucuz model KODA sabit — Railway'de FM_GEMINI_MODEL silinirse pahalı model
//   (3.8-flash, 3-5 kat) sessizce geri gelmesin. Güçlü tur = 3.8-flash (preview değil).
export const FM_GEMINI_MODEL_VARSAYILAN = 'gemini-3.1-flash-lite';
export const FM_GEMINI_GUCLU_MODEL_VARSAYILAN = 'gemini-3.8-flash';
export const FM_AI_TIMEOUT_MS_VARSAYILAN = 60000;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_URL = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
/** claudeTextViaMax'in system verilmeyince kullandığı minimal talimat — her sağlayıcıda aynı davranış. */
const VARSAYILAN_SISTEM = 'Sen kısa ve kesin yanıt veren bir çıkarım asistanısın. Yalnız istenen çıktıyı ver, açıklama ekleme.';

const logger = new Logger('FmAi');

/** 1M token başına USD: [giriş, çıkış]. Bilinmeyen model → 0 (görünürlük için; fatura değildir). Gemini: lite 0,25/1,50 · flash 0,75/3,75 (2026-09-15). */
const OPENAI_FIYAT_USD_PER_M: Record<string, [number, number]> = {
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4.1-mini': [0.4, 1.6],
};
/** "giriş,çıkış" biçimindeki env değerini çifte çevirir; bozuksa varsayılan. */
function fiyatCifti(env: string | undefined, varsayilan: [number, number]): [number, number] {
  const m = String(env || '').split(/[,;]/).map((x) => Number(String(x).trim()));
  return m.length === 2 && m.every((x) => Number.isFinite(x) && x >= 0) ? [m[0], m[1]] : varsayilan;
}
// Google resmî fiyat sayfası (2026-09-15 okundu): 3.1-flash-lite 0,25 / 1,50 $; 3.8-flash 0,75 / 3,75 $ (1 Ocak 2027'den itibaren
//   iki katı). Eski tablo (0,10/0,40 · 0,30/2,50) gerçeğin ~2,8'de birini gösteriyordu → AI Studio faturasıyla tutmuyordu.
//   Env: FM_GEMINI_FIYAT_LITE="0.25,1.5"  FM_GEMINI_FIYAT_FLASH="0.75,3.75" (deploy gerektirmez).
const GEMINI_FIYAT_USD_PER_M: { lite: [number, number]; flash: [number, number] } = {
  lite: fiyatCifti(process.env.FM_GEMINI_FIYAT_LITE, [0.25, 1.5]),   // gemini-*-flash-lite
  flash: fiyatCifti(process.env.FM_GEMINI_FIYAT_FLASH, [0.75, 3.75]), // gemini-*-flash / flash-preview
};

// ─── ÇAĞRI BAĞLAMI (kimlik) — defter ve log satırı için; giriş noktaları fmAiBaglamIle ile sarar ───
export type FmAiBaglam = { tenantId?: string; taxpayerId?: string; belgeNo?: string; kaynak?: string };
const fmAiAls = new AsyncLocalStorage<FmAiBaglam>();
/** Bu çağrı zinciri boyunca kimlik bilgisi (tenant/mükellef/belge/kaynak) taşınır; iç içe çağrıda alanlar birleşir. */
export function fmAiBaglamIle<T>(baglam: FmAiBaglam, fn: () => Promise<T>): Promise<T> {
  return fmAiAls.run({ ...(fmAiAls.getStore() || {}), ...baglam }, fn);
}
/** Zincir içinde sonradan öğrenilen alanları (belge no vb.) mevcut bağlama yazar. */
export function fmAiBaglamGuncelle(baglam: FmAiBaglam): void {
  const s = fmAiAls.getStore();
  if (s) Object.assign(s, baglam);
}
export function fmAiBaglamOku(): FmAiBaglam {
  return { ...(fmAiAls.getStore() || {}) };
}

// ─── KALICI DEFTER (ai_usage_logs) — FM servisi açılışta Prisma'yı bağlar ───
let defterPrisma: any = null;
export function fmAiDefterBagla(prisma: any): void { defterPrisma = prisma; }
function defterKaynak(amac: FmAiAmac) { return `fm-${amac}`; }
function defterYaz(p: { amac: FmAiAmac; saglayici: string; model: string; giris: number; cikis: number; costUsd: number; sure: number; ok: boolean; hata?: string; onbellek?: boolean }) {
  if (!defterPrisma) return;
  const b = fmAiBaglamOku();
  void (async () => {
    const tenantId = b.tenantId || (await sahipTenantIdBul(defterPrisma)) || 'unknown';
    await logAiUsage(defterPrisma, {
    tenantId,
    taxpayerId: b.taxpayerId || null,
    source: defterKaynak(p.amac),
    model: `${p.saglayici}:${p.model}`,
    usage: { inputTokens: p.giris, outputTokens: p.cikis },
    fixedCostUsd: p.onbellek ? 0 : p.costUsd,
    karar: p.ok ? 'ok' : 'error',
    sebep: p.onbellek ? 'önbellek isabeti' : (p.hata ? String(p.hata).slice(0, 200) : (b.kaynak || undefined)),
    belgeNo: b.belgeNo || null,
    durationMs: p.sure,
    cacheHit: !!p.onbellek,
    } as any);
  })().catch(() => null);
}

// ─── BİREBİR AYNI ÇAĞRI ÖNBELLEĞİ (ısı 0 → aynı girdi aynı yanıt; AYNI SÜREÇTE kısa aralıkla tekrar eden çağrılar için) ───
//   Not: yayın örtüşmesinde (eski+yeni süreç) süreç-içi önbellek yardım etmez — o durum belge-kuyruk acilisKurtar taze-kilit ile çözülür.
//   Anahtar: sağlayıcı + model + amaç + sistem + talimat + görsel özeti. Yalnız başarılı yanıt saklanır. FM_AI_ONBELLEK_SN
//   (varsayılan 900; 0 = kapalı). En çok 500 kayıt (en eski düşer). Kuyruk/iş mantığına DOKUNMAZ, yalnız sağlayıcıya gitmez.
const onbellek = new Map<string, { zaman: number; yanit: MaxTextResult }>();
function onbellekSuresiMs(): number {
  const raw = String(process.env.FM_AI_ONBELLEK_SN ?? '').trim();
  const v = raw === '' ? 900 : Number(raw);
  return Number.isFinite(v) && v > 0 ? v * 1000 : 0;
}
function onbellekAnahtari(saglayici: string, model: string, amac: string, g: CagriGirdisi): string {
  const h = createHash('sha1');
  h.update([saglayici, model, amac, g.system || '', g.prompt].join('\u0001'));
  for (const im of temizGorseller(g.images)) { h.update('\u0002' + (im.mediaType || '') + '\u0003'); h.update(im.data.length > 64 ? createHash('sha1').update(im.data).digest('hex') : im.data); }
  return h.digest('hex');
}
function onbellekOku(anahtar: string): MaxTextResult | null {
  const sure = onbellekSuresiMs(); if (!sure) return null;
  const k = onbellek.get(anahtar); if (!k) return null;
  if (Date.now() - k.zaman > sure) { onbellek.delete(anahtar); return null; }
  return k.yanit;
}
function onbellekYaz(anahtar: string, yanit: MaxTextResult): void {
  if (!onbellekSuresiMs()) return;
  onbellek.set(anahtar, { zaman: Date.now(), yanit });
  while (onbellek.size > 500) { const ilk = onbellek.keys().next().value; if (ilk === undefined) break; onbellek.delete(ilk); }
}
/** Test/teşhis: önbelleği boşalt. */
export function fmAiOnbellekTemizle(): void { onbellek.clear(); }

// ─── BİRİM MALİYET BEKÇİSİ (2026-09-15, Muzaffer Bey kararı: hacme göre durdurma YOK — 1 günde 3.000 belge meşru) ───
//   331 TL'lik gece "çok belge" değil "belge başı 4-5 kat pahalı" bir geceydi (pahalı model + düşünme + 45k tokenlik metin).
//   Bekçi TOPLAMA bakmaz; amaç başına son 30 çağrının ORTALAMA maliyeti normalin FM_AI_BEKCI_KAT (4) katını aşarsa,
//   ya da ucuz-model amaçlarında pahalı model toplu kullanılırsa (>%80), ya da düşünme toplu açıksa (>%50) →
//   otomatik kuyruk FM_AI_BEKCI_DURAKLAT_DK (60) dakika DURAKLAR (belgeler kaybolmaz, bekler), sahibe AI_COST_LIMIT
//   bildirimi (gece de anında). Tek büyük çağrı (>FM_AI_BEKCI_TEK_TOKEN=40000 giriş) yalnız uyarı loglar. FM_AI_BEKCI=off kapatır.
type BekciKayit = { zaman: number; model: string; costUsd: number; giris: number; dusunme: number };
const bekciPencere = new Map<FmAiAmac, BekciKayit[]>();
const BEKCI_PENCERE = 30;
/** Amaç başına NORMAL maliyet (USD, BELGE BAŞINA; lite fiyatıyla 2026-09-15 canlı ortalamalarından: okuma 3.5k+0.3k, parti sınıf
 *  belge başı ≈1.8k+0.4k, yorum 1.7k+0.13k, kalem 1.4k+0.07k; sinifGuclu flash fiyatıyla) — env FM_AI_BEKCI_NORMAL_USD="okuma=0.0013,..." ile ezilebilir. */
const BEKCI_NORMAL_USD: Record<FmAiAmac, number> = { okuma: 0.0013, kalem: 0.0006, sinif: 0.0012, sinifGuclu: 0.004, yorum: 0.0007 };
function bekciNormal(amac: FmAiAmac): number {
  const env = String(process.env.FM_AI_BEKCI_NORMAL_USD || '');
  const m = env.match(new RegExp(`(?:^|[,; ])${amac}\\s*=\\s*([0-9.]+)`));
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : BEKCI_NORMAL_USD[amac];
}
let bekciDurum: { durduruldu: boolean; neden?: string; zaman?: number; bitis?: number; sayac: number } = { durduruldu: false, sayac: 0 };
const bekciBildirimZamani = new Map<string, number>();
/** FM_AI_BEKCI: on (varsayılan, duraklatır) | log (yalnız loglar+bildirir, duraklatmaz) | off */
export function fmAiBekciModu(): 'on' | 'log' | 'off' {
  const v = String(process.env.FM_AI_BEKCI ?? 'on').trim().toLowerCase();
  return v === 'off' ? 'off' : v === 'log' ? 'log' : 'on';
}
export function fmAiBekciAcikMi(): boolean { return fmAiBekciModu() !== 'off'; }
/** Sahip Railway'de bilerek pahalı hızlı model seçtiyse (FM_GEMINI_MODEL=3.8-flash gibi) normal maliyet o modele göre ölçeklenir
 *  ve "pahalı model toplu" kuralı uygulanmaz — bekçi ayarla kavga etmez, yalnız ayar DIŞI sapmayı yakalar. */
function bekciHizliModelUcuzMu(): boolean {
  const saglayici = String(process.env.FM_AI_SAGLAYICI || '').trim().toLowerCase();
  const hizli = saglayici === 'openai' ? (process.env.FM_OPENAI_MODEL || FM_OPENAI_MODEL_VARSAYILAN) : (process.env.FM_GEMINI_MODEL || FM_GEMINI_MODEL_VARSAYILAN);
  return ucuzModelMi(String(hizli));
}

/** Otomatik kuyruk/süpürme bu duruma bakar: durduruldu=true iken yeni iş ALMAZ (belgeler PENDING kalır). */
export function fmAiBekciDurumu(): { durduruldu: boolean; neden?: string; zaman?: number; bitis?: number; sayac: number } {
  if (!fmAiBekciAcikMi()) return { durduruldu: false, sayac: bekciDurum.sayac };
  if (bekciDurum.durduruldu && bekciDurum.bitis && Date.now() >= bekciDurum.bitis) {
    logger.warn(`[FM-AI][BEKÇİ] duraklatma süresi doldu → otomatik kuyruk yeniden açıldı (neden: ${bekciDurum.neden})`);
    bekciDurum = { ...bekciDurum, durduruldu: false };
  }
  return { ...bekciDurum };
}
/** Sahip "devam et" dedi → duraklatmayı kaldır, pencereyi sıfırla (30 yeni çağrı gerekmeden tekrar durmasın). */
export function fmAiBekciDevam(): void {
  bekciDurum = { durduruldu: false, sayac: bekciDurum.sayac };
  bekciPencere.clear();
  bekciBildirimZamani.clear(); // sahip elle devam ettirdiyse sonraki tetik yeni bilgidir → yeniden bildirilir
  logger.warn('[FM-AI][BEKÇİ] elle devam ettirildi');
}
const ucuzModelMi = (model: string) => /flash-lite|mini|nano|haiku/i.test(String(model || ''));
function bekciKaydet(amac: FmAiAmac, k: BekciKayit): void {
  if (!fmAiBekciAcikMi()) return;
  const tekTavan = Number(process.env.FM_AI_BEKCI_TEK_TOKEN ?? 40000);
  if (tekTavan > 0 && k.giris > tekTavan) logger.warn(`[FM-AI][BEKÇİ] tek çağrı anormal büyük: amac=${amac} giriş=${k.giris} token (tavan ${tekTavan}) model=${k.model}`);
  const p = bekciPencere.get(amac) || [];
  p.push(k); while (p.length > BEKCI_PENCERE) p.shift();
  bekciPencere.set(amac, p);
  if (p.length < BEKCI_PENCERE || bekciDurum.durduruldu) return;
  const kat = Math.max(1.5, Number(process.env.FM_AI_BEKCI_KAT ?? 4) || 4);
  const ort = p.reduce((s2, x) => s2 + x.costUsd, 0) / p.length; // costUsd zaten belge başına (bekciBirim'e bölünmüş)
  const hizliUcuz = bekciHizliModelUcuzMu();
  // Sahip bilerek pahalı hızlı model seçtiyse normal ≈ 3× (flash/lite giriş fiyat oranı) — ayarın kendisi anormallik sayılmaz.
  const normal = bekciNormal(amac) * (hizliUcuz ? 1 : 3);
  const pahaliPay = p.filter((x) => !ucuzModelMi(x.model)).length / p.length;
  const dusunmePay = p.filter((x) => x.dusunme > 0).length / p.length;
  let neden = ''; let tur = '';
  if (ort > normal * kat) { tur = 'maliyet'; neden = `birim maliyet anormal: ${amac} son ${p.length} çağrı belge başına ort. ${ort.toFixed(5)}$ (normal ≈ ${normal.toFixed(4)}$, tavan ${kat}×)`; }
  else if (hizliUcuz && amac !== 'sinifGuclu' && pahaliPay > 0.8) { tur = 'model'; neden = `pahalı model toplu kullanımda: ${amac} son ${p.length} çağrının %${Math.round(pahaliPay * 100)}'i ${p[p.length - 1].model} (ayar: ucuz model)`; }
  else if (dusunmePay > 0.5) { tur = 'dusunme'; neden = `düşünme (thinking) toplu açık: ${amac} son ${p.length} çağrının %${Math.round(dusunmePay * 100)}'inde düşünme token'ı (FM_GEMINI_DUSUNME=${String(process.env.FM_GEMINI_DUSUNME ?? '0')})`; }
  if (!neden) return;
  const dk = Math.max(5, Number(process.env.FM_AI_BEKCI_DURAKLAT_DK ?? 60) || 60);
  const mod = fmAiBekciModu();
  if (mod === 'on') bekciDurum = { durduruldu: true, neden, zaman: Date.now(), bitis: Date.now() + dk * 60000, sayac: bekciDurum.sayac + 1 };
  else bekciDurum = { ...bekciDurum, sayac: bekciDurum.sayac + 1 };
  bekciPencere.clear();
  const eylem = mod === 'on' ? `otomatik AI kuyruğu ${dk} dk duraklatıldı (tekil istekler sürer; Fatura Merkezi bandındaki "Devam et" ya da POST fatura-muhasebelestirme/ai-bekci/devam ile açılır)` : 'yalnız LOG kipi (FM_AI_BEKCI=log) — duraklatma yok';
  logger.error(`[FM-AI][BEKÇİ] ${neden} → ${eylem}`);
  // Bildirim tekilleştirme: aynı türde tetik 6 saat içinde bir kez (yanlış ayar sürerse her saat WhatsApp gitmesin).
  const dedupeAnahtari = `${amac}|${tur}`;
  const sonBildirim = bekciBildirimZamani.get(dedupeAnahtari) || 0;
  if (!defterPrisma || Date.now() - sonBildirim < 6 * 3600000) return;
  bekciBildirimZamani.set(dedupeAnahtari, Date.now());
  const b = fmAiBaglamOku();
  void (async () => {
    try {
      const tenantId = b.tenantId || (await sahipTenantIdBul(defterPrisma));
      if (!tenantId) return;
      await defterPrisma.notification.create({
        data: {
          tenantId,
          type: 'AI_COST_LIMIT',
          title: mod === 'on' ? '⚠️ Fatura Merkezi AI bekçisi: harcama anormal, kuyruk duraklatıldı' : '⚠️ Fatura Merkezi AI bekçisi: harcama anormal (yalnız uyarı)',
          body: `${neden}. ${mod === 'on' ? `Otomatik okuma/sınıflandırma/yorum kuyruğu ${dk} dakika duraklatıldı (seçtiğiniz belgelerin toplu okuması da bekler; tek belge okuması ve "Kodları düzelt" sürer); belgeler kaybolmadı, bekliyor. Devam için Fatura Merkezi'nin üstündeki "AI bekçisi" bandında "Devam et".` : 'Kuyruk durdurulmadı (LOG kipi).'} Model/düşünme ayarını kontrol edin (Railway FM_GEMINI_MODEL=${String(process.env.FM_GEMINI_MODEL || FM_GEMINI_MODEL_VARSAYILAN)}, FM_GEMINI_DUSUNME=${String(process.env.FM_GEMINI_DUSUNME ?? '0')}).`,
          metadata: { amac, tur, ortalamaUsd: Number(ort.toFixed(6)), normalUsd: Number(normal.toFixed(6)), pahaliPay, dusunmePay, durakDk: dk, mod, sayac: bekciDurum.sayac },
        },
      });
    } catch (e: any) {
      logger.warn(`[FM-AI][BEKÇİ] bildirim yazılamadı: ${e?.message || e}`);
    }
  })();
}

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
  /** Gemini düşünme (thinking) token'ı — bekçi ve log için (çıkış sayısına zaten dahil). */
  dusunmeToken?: number;
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
  // CANLI DOĞRULAMA (2026-09-15): gpt-4o-mini de ```json çiti ekleyebiliyor → Gemini ile aynı soyma.
  const text = kodCitiSoy(openAiIcerikMetni(data?.choices?.[0]?.message?.content));
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
/** FM_GEMINI_DUSUNME → generationConfig.thinkingConfig (0 = düşünme kapalı; low/medium/high = seviye; auto = model varsayılanı). */
export function geminiDusunmeAyari(env: NodeJS.ProcessEnv = process.env): Record<string, any> {
  const v = String(env.FM_GEMINI_DUSUNME ?? '0').trim().toLowerCase();
  if (v === 'auto' || v === 'model') return {};
  if (v === 'low' || v === 'medium' || v === 'high') return { thinkingConfig: { thinkingLevel: v.toUpperCase() } };
  return { thinkingConfig: { thinkingBudget: 0 } };
}

export async function geminiMetinCagrisi(p: CagriGirdisi, dusunmeAyari?: Record<string, any>): Promise<SaglayiciYaniti> {
  const model = p.model;
  const bos: SaglayiciYaniti = { ok: false, text: '', model, girisToken: 0, cikisToken: 0, costUsd: 0 };
  const gorseller = temizGorseller(p.images);
  const dusunme = dusunmeAyari ?? geminiDusunmeAyari();
  const body: any = {
    systemInstruction: { parts: [{ text: p.system ?? VARSAYILAN_SISTEM }] },
    contents: [{
      role: 'user',
      parts: [
        { text: p.prompt },
        ...gorseller.map((im) => ({ inline_data: { mime_type: im.mediaType, data: im.data } })),
      ],
    }],
    generationConfig: { temperature: 0, ...(p.maxTokens && p.maxTokens > 0 ? { maxOutputTokens: p.maxTokens } : {}), ...dusunme },
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
    // Model düşünme ayarını kabul etmiyorsa (400 "thinking …") aynı çağrıyı ayarsız bir kez tekrarla (Max'e düşme).
    if (status === 400 && Object.keys(dusunme).length && /thinking/i.test(errText)) {
      logger.warn(`[FM-AI] gemini model=${model} düşünme ayarını kabul etmedi (${String(errText).replace(/\s+/g, ' ').slice(0, 120)}) → ayarsız tekrar`);
      return geminiMetinCagrisi(p, {});
    }
    return { ...bos, error: `Gemini HTTP ${status}: ${String(errText || '').replace(/\s+/g, ' ').slice(0, 300)}`, tekrarlanabilir: status === 429 || status >= 500, httpStatus: status };
  }
  const data: any = await res.json().catch(() => null);
  const parts: any[] = Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : [];
  const text = kodCitiSoy(parts.map((x: any) => String(x?.text || '')).join(''));
  const gercekModel = String(data?.modelVersion || model);
  const girisToken = Number(data?.usageMetadata?.promptTokenCount) || 0;
  // DÜŞÜNME token'ları (thoughtsTokenCount) çıktı fiyatından faturalanır → maliyete ve çıkış sayısına dahil (2026-09-15).
  const dusunmeToken = Number(data?.usageMetadata?.thoughtsTokenCount) || 0;
  const cikisToken = (Number(data?.usageMetadata?.candidatesTokenCount) || 0) + dusunmeToken;
  const costUsd = geminiMaliyetUsd(gercekModel, girisToken, cikisToken);
  if (dusunmeToken > 0) logger.log(`[FM-AI] gemini model=${gercekModel} düşünme=${dusunmeToken} token (FM_GEMINI_DUSUNME=${String(process.env.FM_GEMINI_DUSUNME ?? '0')})`);
  if (!text) {
    const finish = String(data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || '');
    return { ...bos, model: gercekModel, girisToken, cikisToken, costUsd, dusunmeToken, error: `Gemini boş yanıt döndü${finish ? ` (${finish})` : ''}` };
  }
  if (String(data?.candidates?.[0]?.finishReason || '') === 'MAX_TOKENS') {
    logger.warn(`[FM-AI] gemini model=${gercekModel} yanıt uzunluk sınırında kesildi (MAX_TOKENS) — JSON eksik olabilir`);
  }
  return { ok: true, text, model: gercekModel, girisToken, cikisToken, costUsd, dusunmeToken };
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
  const { amac, bekciBirim, onbellek: onbellekIstek, ...maxParams } = params;
  const birim = Math.max(1, Number(bekciBirim) || 1);
  const onbellekKullan = onbellekIstek !== false;
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
  const baglam = fmAiBaglamOku();
  const kimlik = `${baglam.taxpayerId ? ` tp=${baglam.taxpayerId}` : ''}${baglam.belgeNo ? ` belge=${baglam.belgeNo}` : ''}${baglam.kaynak ? ` kaynak=${baglam.kaynak}` : ''}`;
  // BİREBİR AYNI ÇAĞRI → önceki başarılı yanıt (sağlayıcıya gidilmez, maliyet 0)
  const anahtar = onbellekAnahtari(secim.saglayici, secim.model, amac, girdi);
  const hazir = onbellekKullan ? onbellekOku(anahtar) : null;
  if (hazir) {
    logger.log(`[FM-AI] ${secim.saglayici} model=${hazir.model} amac=${amac} önbellek=isabet maliyet=0$${kimlik}`);
    defterYaz({ amac, saglayici: secim.saglayici, model: hazir.model, giris: 0, cikis: 0, costUsd: 0, sure: 0, ok: true, onbellek: true });
    return { ...hazir, costUsd: 0 };
  }
  const t0 = Date.now();
  let yanit = await cagri(girdi);
  if (!yanit.ok && yanit.tekrarlanabilir) {
    const bekle = Math.max(0, Number(process.env.FM_AI_TEKRAR_BEKLEME_MS ?? 2000));
    logger.warn(`[FM-AI] ${secim.saglayici} model=${secim.model} amac=${amac} geçici hata (${yanit.error}) → ${bekle}ms sonra tekrar`);
    if (bekle > 0) await new Promise((r) => setTimeout(r, bekle));
    yanit = await cagri(girdi);
  }
  const sure = Date.now() - t0;
  // Başarısız/boş yanıt da token harcamış olabilir (Google faturalar) → deftere yazılır (karar=error).
  if (yanit.girisToken > 0 || yanit.cikisToken > 0) {
    defterYaz({ amac, saglayici: secim.saglayici, model: yanit.model || secim.model, giris: yanit.girisToken, cikis: yanit.cikisToken, costUsd: yanit.costUsd, sure, ok: yanit.ok, hata: yanit.ok ? undefined : yanit.error });
    bekciKaydet(amac, { zaman: Date.now(), model: yanit.model || secim.model, costUsd: yanit.costUsd / birim, giris: yanit.girisToken, dusunme: yanit.dusunmeToken || 0 });
  }
  if (yanit.ok) {
    logger.log(`[FM-AI] ${secim.saglayici} model=${yanit.model} amac=${amac} giriş=${yanit.girisToken} çıkış=${yanit.cikisToken}${yanit.dusunmeToken ? ` düşünme=${yanit.dusunmeToken}` : ''} süre=${sure}ms maliyet=${yanit.costUsd.toFixed(6)}$${kimlik}`);
    const sonuc: MaxTextResult = { ok: true, text: yanit.text, model: yanit.model, costUsd: yanit.costUsd };
    if (onbellekKullan) onbellekYaz(anahtar, { ...sonuc });
    return sonuc;
  }
  if (fmAiYedekMax()) {
    logger.warn(`[FM-AI] ${secim.saglayici} model=${secim.model} amac=${amac} başarısız (${yanit.error}) süre=${sure}ms → Max yedeğine düşülüyor`);
    return claudeTextViaMax(maxParams);
  }
  logger.error(`[FM-AI] ${secim.saglayici} model=${secim.model} amac=${amac} başarısız (${yanit.error}) süre=${sure}ms — FM_AI_YEDEK=off, Max'e düşülmedi`);
  return { ok: false, text: '', model: yanit.model || secim.model, costUsd: yanit.costUsd || 0, error: yanit.error || `${secim.saglayici} çağrısı başarısız.` };
}
