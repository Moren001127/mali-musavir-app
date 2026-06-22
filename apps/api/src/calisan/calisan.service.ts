import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { logAiUsage } from '../common/ai-usage-logger';
import { MorenAiService } from '../moren-ai/moren-ai.service';
import { claudeTextViaMax, isMaxAvailable, MAX_MODEL_CHEAP } from '../common/max-inference';

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
  'Muhasebe, finans, mali müşavirlik, SGK, vergi kanunları, planlama ve şirket yönetimi konularında kıdemli SMMM/finans danışmanı gibi konuş.',
  'Güncel oran, süre, ceza, had, teşvik veya mevzuat değişikliği varsa tool destekli Moren AI hattını kullan; resmi kaynağa dayanmayan rakam uydurma.',
  'Portal verisi istenirse önce gerçek kayıtları ara; mizan, gelir tablosu, bilanço, beyanname, evrak, WhatsApp ve ajan durumunu bağlama göre kullan.',
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
    originalMessage?: string | null;
    source?: string;
  }): Promise<{ assistantMessage: string; model: string }> {
    const ownerMessage = String(params.originalMessage || params.message || '').trim();
    const critical = this.isCritical(ownerMessage || params.message);
    const model = critical ? MODEL_CRITICAL : MODEL_DEFAULT;
    if (this.shouldTryPortalTools(ownerMessage) && process.env.CALISAN_OWNER_TOOL_FALLBACK !== '0') {
      try {
        const toolAnswer = await this.morenAi.chat(params.tenantId, null, {
          conversationId: params.conversationId || undefined,
          message: ownerMessage,
          toolMode: 'owner',
          source: params.source || 'calisan-whatsapp',
          currentPath: '/panel/mesajlar',
          // userId=null olduğundan owner adını AÇIKÇA geçir → bot "Karşındaki kişi Muzaffer"
          // bilir, "sen kimsin"de kimlik tahmin etmez (önceki "Sen Buse'sin?" hatasının kökü).
          userName: process.env.MOREN_OWNER_DISPLAY_NAME || 'Muzaffer',
        } as any);
        const assistantMessage = String(toolAnswer?.assistantMessage || '').trim();
        if (this.isUsableOwnerAnswer(assistantMessage)) {
          return {
            assistantMessage,
            model: toolAnswer?.usage?.model || 'moren-ai-tools',
          };
        }
        this.logger.warn(`runViaMorenAi tool fallback kullanilamadi: ${assistantMessage.slice(0, 160) || 'bos cevap'}`);
        await this.recordSelfImprovementLesson({
          tenantId: params.tenantId,
          title: 'Owner WhatsApp tool fallback kullanilamadi',
          content: `Owner mesajı: ${this.maskSensitive(ownerMessage).slice(0, 500)}\nMorenAI cevabı yetersiz görüldü: ${this.maskSensitive(assistantMessage).slice(0, 600)}\nBir dahaki sefere: veri isteyen owner mesajlarında portal tool cevabı boş/generic ise Max yedeğine düş ve kullanıcıya teknik hata gösterme.`,
          tags: ['self-improvement', 'whatsapp', 'owner', 'tool-fallback'],
          importance: 4,
        });
      } catch (err: any) {
        this.logger.warn(`runViaMorenAi tool fallback hatasi: ${err?.message || err}`);
        await this.recordSelfImprovementLesson({
          tenantId: params.tenantId,
          title: 'Owner WhatsApp tool fallback hatasi',
          content: `Owner mesajı: ${this.maskSensitive(ownerMessage).slice(0, 500)}\nHata: ${this.maskSensitive(err?.message || String(err)).slice(0, 800)}\nBir dahaki sefere: tool katmanı düşerse Max yedek model döngüsüne geç; kullanıcıya teknik hata basma.`,
          tags: ['self-improvement', 'whatsapp', 'owner', 'tool-error'],
          importance: 4,
        });
      }
    }
    // Realtime owner WhatsApp fallback: Max text inference, with fast model retries.
    if (!isMaxAvailable()) {
      await this.recordSelfImprovementLesson({
        tenantId: params.tenantId,
        title: 'Owner WhatsApp Max token yok',
        content: `Owner mesajı: ${this.maskSensitive(ownerMessage).slice(0, 500)}\nSorun: CLAUDE_CODE_OAUTH_TOKEN yok.\nBir dahaki sefere: Max bağlı değilse teknik token metni gönderme; düzgün geçici cevap ver ve operatöre env uyarısı üret.`,
        tags: ['self-improvement', 'whatsapp', 'owner', 'max-token'],
        importance: 5,
      });
      this.logger.warn('runViaMorenAi: Max bağlı değil (CLAUDE_CODE_OAUTH_TOKEN yok).');
      return {
        assistantMessage: this.ownerTemporaryFallback(ownerMessage),
        model,
      };
    }
    // YEDEK (araçsız Max-metin) — agentic başarısız/timeout olunca devreye girer. Veri sorusunu
    // zaten cevaplayamaz (araç yok), o yüzden GECİKMEYİ büyütmesin: kritik-değilde TEK model,
    // kısa timeout. (Eskiden 2-3 model × 35sn = +105sn → toplam 155sn; artık +22sn.)
    const maxModels = critical
      ? Array.from(new Set([
          String(process.env.CALISAN_OWNER_MAX_MODEL || '').trim(),
          MODEL_DEFAULT,
          MAX_MODEL_CHEAP,
        ].filter(Boolean)))
      : [String(process.env.CALISAN_OWNER_MAX_MODEL || '').trim() || MAX_MODEL_CHEAP];
    const timeoutMs = Math.max(12000, Number(process.env.CALISAN_OWNER_MAX_HARD_MS || process.env.MAX_TEXT_HARD_MS) || (critical ? 35000 : 22000));
    const maxErrors: string[] = [];
    let assistantMessage = '';
    let usedModel = model;
    for (const candidate of maxModels) {
      const r = await claudeTextViaMax({ prompt: params.message, model: candidate, maxTurns: 1, timeoutMs });
      if (r.ok && String(r.text || '').trim()) {
        assistantMessage = String(r.text || '').trim();
        usedModel = candidate;
        break;
      }
      maxErrors.push(`${candidate}: ${r.error || 'bos cevap'}`);
    }
    if (!assistantMessage) {
      this.logger.warn(`runViaMorenAi Max hatalari: ${maxErrors.join(' || ')}`);
      await this.recordSelfImprovementLesson({
        tenantId: params.tenantId,
        title: 'Owner WhatsApp Max model hatasi',
        content: `Owner mesajı: ${this.maskSensitive(ownerMessage).slice(0, 500)}\nDenenen modeller: ${maxModels.join(', ')}\nHatalar: ${this.maskSensitive(maxErrors.join(' || ')).slice(0, 1500)}\nBir dahaki sefere: kritik owner WhatsApp akışında Opus'a takılı kalma; Sonnet/Haiku yedekli devam et ve timeout değerini canlı sohbet için makul tut.`,
        tags: ['self-improvement', 'whatsapp', 'owner', 'max-error'],
        importance: 5,
      });
      assistantMessage = this.ownerTemporaryFallback(ownerMessage);
    }
    // ÖĞRENME: sadece kritik owner etkileşimini hafif not düş (gürültü olmasın)
    if (critical && assistantMessage) {
      this.recordLesson({
        tenantId: params.tenantId,
        title: 'Owner kritik WhatsApp talebi',
        content: `Soru: ${(ownerMessage || params.message).slice(0, 160)} | Model: ${usedModel}`,
        importance: 2,
        tags: ['whatsapp', 'owner', 'kritik'],
      }).catch(() => undefined);
    }
    return { assistantMessage, model: usedModel };
  }

  private shouldTryPortalTools(message: string): boolean {
    const text = this.normalizeForIntent(message).trim();
    if (!text || text.length < 2) return false;
    // AGENTIC yol artık ANA beyin: tüm portal verisi + KOMUT/İŞLEM çalıştırma + hafıza +
    // mevzuat araştırma orada. Owner'ın NEREDEYSE HER mesajı buraya gitmeli. Eskiden bu
    // kapı bir kelime-allowlist'iydi → "e-defter kontrolünü başlat", "fişini yazdır" gibi
    // KOMUTLAR listede olmadığı için araçsız Max'a düşüp "portaldan yap" diyordu (kök bug).
    // Artık: yalnız SAF selamlama/çok kısa teşekkür araçsız hızlı yola; gerisi (veri sorusu,
    // KOMUT, işlem, mevzuat) TOOL'lu agentic yola.
    const pureGreeting = /^(merhaba|selam(un aleykum)?|aleykum selam|gunaydin|iyi (gunler|aksamlar|geceler|calismalar)|hayirli (gunler|isler|aksamlar|sabahlar)|nasilsin(iz)?|naber|ne haber|tesekkur(ler| ederim)?|sag ?ol(un)?|eyvallah|kolay gelsin|eline saglik|ok(ey)?|tamam(dir)?|peki|anladim|super|harika|👍|🙏|❤️|😊)[\s!.,:)]*$/i.test(text);
    return !pureGreeting;
  }

  private isUsableOwnerAnswer(answer: string): boolean {
    if (!answer) return false;
    const text = this.normalizeForIntent(answer);
    if (/en kisa surede ofisimiz size donus yapacak/.test(text)) return false;
    if (/ai aylik maliyet tavani doldu/.test(text)) return false;
    if (/su an net bir cevap uretemedim/.test(text)) return false;
    if (/su an.*cevap.*uretemedim/.test(text)) return false;
    if (/birazdan tekrar.*dener/.test(text)) return false;
    if (/claude max|agent sdk|max baglanti|max yanit|ucretli api|api hatti kapali/.test(text)) return false;
    if (/sistemde henuz tanimli degilsiniz|sizi taniyabilmem|adinizi.*vergi numaranizi/.test(text)) return false;
    // YARIM / ARA-ANLATIM cevabı (veri yok, sadece "çekiyorum/getiriyorum/bulayım/bir dakika"
    // gibi planı/eylemi anlatıp veriyi VERMEYEN) → kullanma, Max-metin yedeğine düş.
    if (/tamamlayamad/.test(text)) return false;
    if (/birazdan.*(dene|don|yaz|ilet|paylas)/.test(text)) return false;
    if (/\bbir (dakika|saniye)\b/.test(text)) return false;
    // "…getiriyorum / bulayım / kontrol edeyim / erişimim var / çalıştırmam gerek" gibi
    // EYLEM-ANLATIMI içeren cevaplar: rakam yoksa ya da kısaysa = eksik, reddet.
    const aboutToAct = /(cekiyorum|cagiriyorum|sorguluyorum|bakiyorum|ariyorum|getiriyorum|getireyim|getirecegim|buluyorum|bulay[iı]m|bulayim|kontrol ediyorum|kontrol edeyim|hesapliyorum|arastiriyorum|baslayacagim|deneyecegim|denecegim|denemeliyim|cekecegim|calistir(mam|acagim|iyorum)|erisim(im)? var|sorgu(lar[iı]n[iı])? (calistir|cek|getir)|hemen (cevab|getir|bul|bak|kontrol))/.test(text);
    if (aboutToAct && (!/\d/.test(answer) || answer.trim().length < 180)) return false;
    // PLAN/NİYET ANLATIMI: "veri çekmem gerekiyor", "kontrol etmeliyim", "sorgulamalıyım",
    // "kayıtları getirmem lazım" gibi YAPACAĞINI anlatıp veriyi VERMEYEN cevaplar.
    // (Canlı bug: "beyannamesi verilmiş olanlar kimler" → "Veri çekmem gerekiyor… kontrol
    //  etmeliyim" diye yarım cevap geçiyordu; aboveki kalıba takılmıyordu.)
    const planNarration = /(cek|getir|bak|al|kontrol et|sorgula|hesapla|arastir|incele|cagir|listele|tara)\w*(meli|mali)y[iı]m|(cekmem|getirmem|bakmam|almam|sorgulamam|hesaplamam|kontrol etmem|cagirmam|listelemem|taramam)\s*(gerek|laz[iı]m)|veri\w*\s*(cek|getir|al|sorgula|kontrol)\w*\s*(gerek|laz[iı]m)/.test(text);
    if (planNarration && (!/\d/.test(answer) || answer.trim().length < 200)) return false;
    // Çok kısa + iki nokta ile biten ("Şimdi araçları çağırıyorum:") = eksik
    if (answer.trim().length < 110 && /[:：]\s*$/.test(answer.trim())) return false;
    return true;
  }

  private ownerTemporaryFallback(message: string): string {
    const text = this.normalizeForIntent(message);
    if (/\b(kdv|beyan|beyanname|tahakkuk|gelir tablosu|mizan|bilanco|fatura|evrak|belge|pdf|gonder|yorumla|analiz)\b/.test(text)) {
      return 'Mesajını aldım. AI tarafında anlık gecikme var; veri/belge işini boş bırakmadım. Birazdan tekrar denersen portal verisiyle yanıtlayacağım.';
    }
    return 'Mesajını aldım. AI tarafında anlık gecikme var; birazdan tekrar yazarsan cevaplamayı yeniden deneyeceğim.';
  }

  private normalizeForIntent(value: string): string {
    return String(value || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  // Public: WhatsApp kalite kapısı da (müşteri-cevabı düşük kalite/fallback)
  // buraya ders yazar; agent-scope recall ile bir sonraki cevap iyileşir.
  async recordSelfImprovementLesson(input: {
    tenantId: string;
    title: string;
    content: string;
    tags?: string[];
    importance?: number;
  }): Promise<void> {
    try {
      const aiMemory = (this.prisma as any).aiMemory;
      if (!aiMemory?.findFirst || !aiMemory?.create || !aiMemory?.update) return;
      const existing = await aiMemory.findFirst({
        where: {
          tenantId: input.tenantId || 'default',
          scope: 'agent',
          source: 'bot-self-improvement',
          title: input.title,
          isActive: true,
        },
      }).catch(() => null);
      const data = {
        content: input.content.slice(0, 4000),
        importance: Math.max(1, Math.min(Number(input.importance || 4), 5)),
        tags: Array.from(new Set([...(input.tags || []), 'self-improvement'])).slice(0, 12),
      };
      if (existing?.id) {
        await aiMemory.update({ where: { id: existing.id }, data }).catch(() => null);
        return;
      }
      await aiMemory.create({
        data: {
          tenantId: input.tenantId || 'default',
          scope: 'agent',
          title: input.title.slice(0, 200),
          content: data.content,
          source: 'bot-self-improvement',
          importance: data.importance,
          tags: data.tags,
        },
      }).catch(() => null);
    } catch {}
  }

  private maskSensitive(value: string): string {
    return String(value || '')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replace(/\b(?:\+?90)?5\d{9}\b/g, '[telefon]')
      .replace(/\b\d{10,11}\b/g, '[kimlik-no]')
      .replace(/\b(token|api\s*key|password|parola|sifre|şifre)\s*[:=]\s*\S+/gi, '$1=[gizli]')
      .replace(/\s+/g, ' ')
      .trim();
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
