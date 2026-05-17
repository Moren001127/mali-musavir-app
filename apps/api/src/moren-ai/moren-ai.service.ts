import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ToolExecutorService } from './tool-executor.service';
import { MOREN_AI_TOOLS } from './tools';
import { buildSystemPrompt } from './system-prompt';
import { computeCostUsd } from '../common/ai-usage-logger';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
// Maliyet optimizasyonu: Haiku 4.5 — Sonnet'ten 12x ucuz, mali musavir sohbet kalitesi
// icin yeterli. Istek gelirse body.model ile override edilebilir ('claude-sonnet-4-6').
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const BRIFING_ALLOWED_ROUTES = [
  '/panel/ajanlar/mihsap',
  '/panel/is-yuku',
  '/panel/gorevler',
  '/panel/beyannameler',
  '/panel/kdv-kontrol',
  '/panel/mukellefler',
  '/panel/ajanlar',
];

const TAX_DEADLINE_RULES: Array<{ day: number | 'last'; tip: string; months?: number[] }> = [
  { day: 10, tip: 'e-Defter berat (gelir vergisi mükellefleri)' },
  { day: 14, tip: 'e-Defter berat (kurumlar/diğer mükellefler)' },
  { day: 17, tip: 'Geçici Vergi', months: [2, 5, 8, 11] },
  { day: 26, tip: 'Muhtasar/Damga' },
  { day: 28, tip: 'KDV' },
  { day: 'last', tip: 'Turizm Payı' },
];

// Sabit resmi tatiller; dini bayramlar yıllara göre değiştiği için burada özellikle
// hard-code edilmez. Bu katman en azından hafta sonu ve sabit tatil kaydırmasını sağlar.
const TR_FIXED_HOLIDAYS = new Set(['01-01', '04-23', '05-01', '05-19', '07-15', '08-30', '10-29']);
const MAX_TOOL_ITERATIONS = 8;              // Tool döngüsünde en fazla 8 tur

function cleanFirstName(raw?: string | null): string | undefined {
  const cleaned = String(raw || '')
    .replace(/\b(Bey|Hanım|Hanim|Bay|Bayan)\b/gi, '')
    .trim()
    .split(/\s+/)[0];
  return cleaned || undefined;
}

function turkeyClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { year: pick('year'), month: pick('month'), day: pick('day'), hour: pick('hour') };
}

function utcNoon(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

function utcDateKey(date: Date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function diffDays(from: Date, to: Date) {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86400000);
}

function isTurkeyNonWorkingDay(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6 || TR_FIXED_HOLIDAYS.has(utcDateKey(date));
}

function nextBusinessDate(date: Date) {
  const d = new Date(date);
  while (isTurkeyNonWorkingDay(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function briefingId(prefix: string, text: string) {
  const slug = String(text || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return `${prefix}-${slug || 'item'}`;
}

export interface ChatRequest {
  conversationId?: string;
  message: string;
  taxpayerId?: string;     // Opsiyonel kontekst
  voiceMode?: boolean;
  model?: string;
}

export interface ChatResponse {
  conversationId: string;
  assistantMessage: string;
  toolUses: Array<{ name: string; input: any; result: any }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
    durationMs: number;
    model: string;
  };
}


type BrifingFocus = 'calm' | 'busy' | 'critical' | 'review';
type BrifingSourceKey = 'workflow' | 'calendar' | 'tasks' | 'agents' | 'notifications';
type BrifingSeverity = 'high' | 'medium' | 'low';

interface BrifingSourceTag {
  key: BrifingSourceKey;
  label: string;
  count: number;
}

interface BrifingSection {
  key: 'today' | 'risk' | 'action';
  title: string;
  items: string[];
}

interface BrifingDeadline {
  gun: number;
  tip: string;
  gunFark: number;
  originalGun?: number;
  shifted?: boolean;
  source?: BrifingSourceKey;
}

interface BrifingPayload {
  summary: string;
  alerts: Array<{ id?: string; severity: BrifingSeverity; text: string; href?: string; source?: BrifingSourceKey }>;
  suggestions: Array<{ id?: string; text: string; href: string; icon?: string; source?: BrifingSourceKey }>;
  focus: BrifingFocus;
  sourceTags: BrifingSourceTag[];
  sections: BrifingSection[];
  metrics: Record<string, any>;
}
export interface BrifingResponse extends BrifingPayload {
  generatedAt: string;
  fromCache: boolean;
}
interface BrifingContext {
  now: Date;
  year: number; month: number; day: number; saat: number;
  tarihUzun: string;
  userFirstName: string;
  workflow: { bekliyorEvrak: number; isleniyor: number; kontrol: number; beyan: number; tamam: number; total: number };
  enUzunBekleyen: { ad: string; gun: number; stage: string; id: string } | null;
  ortalamaBekleme: number;
  eskiBeklemeler: Array<{ ad: string; gun: number; stage: string }>;
  deadlines: BrifingDeadline[];
  gorev: { bugun: number; hafta: number; geciken: number };
  ajan: { bugunOlay: number; bugunHata: number; bugunBasariOrani: number | null; haftaOlay: number; haftaHata: number; haftaBasariOrani: number | null; sonSaatOlay: number };
  okunmamisBildirim: number;
  metrics: Record<string, any>;
}

@Injectable()
export class MorenAiService {
  private readonly logger = new Logger(MorenAiService.name);

  constructor(
    private prisma: PrismaService,
    private toolExecutor: ToolExecutorService,
  ) {}

  // ==========================================================
  // KONUŞMA YÖNETİMİ
  // ==========================================================
  async listConversations(tenantId: string, limit = 30) {
    const rows = await this.prisma.aiConversation.findMany({
      where: { tenantId, isArchived: false },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true, title: true, taxpayerId: true, updatedAt: true, createdAt: true,
        totalCostUsd: true, totalInputTokens: true, totalOutputTokens: true,
      },
    });
    return rows;
  }

  async getConversation(id: string, tenantId: string) {
    const conv = await this.prisma.aiConversation.findFirst({
      where: { id, tenantId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!conv) throw new BadRequestException('Konuşma bulunamadı');
    return conv;
  }

  async deleteConversation(id: string, tenantId: string) {
    const conv = await this.prisma.aiConversation.findFirst({ where: { id, tenantId } });
    if (!conv) throw new BadRequestException('Konuşma bulunamadı');
    await this.prisma.aiConversation.delete({ where: { id } });
    return { ok: true };
  }

  async renameConversation(id: string, tenantId: string, title: string) {
    const conv = await this.prisma.aiConversation.findFirst({ where: { id, tenantId } });
    if (!conv) throw new BadRequestException('Konuşma bulunamadı');
    await this.prisma.aiConversation.update({
      where: { id }, data: { title: title.slice(0, 120) },
    });
    return { ok: true };
  }

  // ==========================================================
  // ANA CHAT
  // ==========================================================
  async chat(
    tenantId: string,
    userId: string | null,
    body: ChatRequest,
  ): Promise<ChatResponse> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new BadRequestException(
        'ANTHROPIC_API_KEY environment değişkeni ayarlanmamış. Railway\'de eklenmelidir.',
      );
    }

    const started = Date.now();
    const model = body.model || DEFAULT_MODEL;
    const userMessage = (body.message || '').trim();
    if (!userMessage) throw new BadRequestException('Mesaj boş olamaz');

    // Konuşmayı getir ya da oluştur
    let conversation: any = body.conversationId
      ? await this.prisma.aiConversation.findFirst({
          where: { id: body.conversationId, tenantId },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        })
      : null;

    if (!conversation) {
      conversation = await this.prisma.aiConversation.create({
        data: {
          tenantId,
          userId,
          taxpayerId: body.taxpayerId || null,
          title: this.generateTitle(userMessage),
        },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
    }

    // Kullanıcı mesajını kaydet
    await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: userMessage,
      },
    });

    // Konuşma geçmişini Anthropic formatına çevir
    const messages = this.buildMessages(conversation.messages, userMessage);

    // Tenant + kullanıcı + cari dönem bağlamı
    const today = new Date();
    const currentPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const user = userId
      ? await this.prisma.user.findFirst({ where: { id: userId }, include: { tenant: true } })
      : null;

    const systemPrompt = buildSystemPrompt({
      officeName: user?.tenant?.name,
      userName: cleanFirstName(user?.firstName) || cleanFirstName(user?.lastName),
      tenantId,
      currentDate: today.toISOString().slice(0, 10),
      currentPeriod,
    });

    // Taxpayer kontekst notu (varsa)
    const taxpayerContext = body.taxpayerId
      ? await this.buildTaxpayerContext(body.taxpayerId, tenantId)
      : '';

    const voiceHint = body.voiceMode
      ? '\n\n[SESLİ MOD AKTİF — kısa cümleler, tablo yok, maksimum 200 kelime]'
      : '';

    // ----- Tool-use döngüsü -----
    const toolUsesLog: Array<{ name: string; input: any; result: any }> = [];
    let totalInput = 0, totalOutput = 0, totalCacheR = 0, totalCacheW = 0;

    let currentMessages = [...messages];
    let finalText = '';
    let stopReason = '';

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const payload: any = {
        model,
        // Maliyet optimizasyonu: 4096 -> 1500. Normal sohbet cevabi 500-1000 token.
        // Sesli modda 200 kelime (~300 token) zaten limitli. Cok uzun cevap kullanici
        // icin de zor okunur. Tool cevabi gerekiyorsa model daha cok yazar degilse kisa.
        max_tokens: 1500,
        system: [
          { type: 'text', text: systemPrompt + (taxpayerContext ? '\n\n' + taxpayerContext : '') + voiceHint,
            cache_control: { type: 'ephemeral' } },
        ],
        tools: MOREN_AI_TOOLS,
        messages: currentMessages,
      };

      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text();
        this.logger.error(`Anthropic API hata: ${res.status} — ${errText.slice(0, 500)}`);
        throw new BadRequestException(`AI servisi hatası (${res.status}): ${errText.slice(0, 200)}`);
      }

      const data: any = await res.json();
      totalInput += data?.usage?.input_tokens || 0;
      totalOutput += data?.usage?.output_tokens || 0;
      totalCacheR += data?.usage?.cache_read_input_tokens || 0;
      totalCacheW += data?.usage?.cache_creation_input_tokens || 0;
      stopReason = data?.stop_reason;

      // Yanıt content block'larını işle
      const contentBlocks = data?.content || [];
      const toolUseBlocks = contentBlocks.filter((b: any) => b.type === 'tool_use');
      const textBlocks = contentBlocks.filter((b: any) => b.type === 'text');

      // Düz metin varsa ekle
      const thisText = textBlocks.map((b: any) => b.text).join('\n').trim();
      if (thisText) finalText = thisText; // en son textText cevap olarak kalır

      // Assistant mesajını da currentMessages'a ekle (gelecek turlar için)
      currentMessages.push({
        role: 'assistant',
        content: contentBlocks,
      });

      // Tool çağrısı yoksa döngüden çık
      if (toolUseBlocks.length === 0 || stopReason !== 'tool_use') break;

      // Tool'ları paralel çalıştır
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (tb: any) => {
          const result = await this.toolExecutor.execute(tb.name, tb.input || {}, { tenantId, userId });
          toolUsesLog.push({ name: tb.name, input: tb.input, result });
          return {
            type: 'tool_result',
            tool_use_id: tb.id,
            content: JSON.stringify(result),
          };
        }),
      );

      // Tool sonuçlarını user mesajı olarak ekle
      currentMessages.push({
        role: 'user',
        content: toolResults,
      });
    }

    const durationMs = Date.now() - started;
    const costUsd = computeCostUsd(model, {
      input: totalInput, output: totalOutput, cacheRead: totalCacheR, cacheWrite: totalCacheW,
    });

    // Assistant mesajını kaydet
    const aiMessageData: any = {
      conversationId: conversation.id,
      role: 'assistant',
      content: finalText || '(Cevap boş)',
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheR,
      cacheWriteTokens: totalCacheW,
      costUsd,
      model,
      durationMs,
    };
    if (toolUsesLog.length > 0) {
      aiMessageData.toolCalls = toolUsesLog.map((t) => ({ name: t.name, input: t.input }));
      aiMessageData.toolResults = toolUsesLog;
    }
    await this.prisma.aiMessage.create({ data: aiMessageData });

    // Konuşma totalini güncelle
    await this.prisma.aiConversation.update({
      where: { id: conversation.id },
      data: {
        totalInputTokens: { increment: totalInput },
        totalOutputTokens: { increment: totalOutput },
        totalCacheReadTokens: { increment: totalCacheR },
        totalCostUsd: { increment: costUsd },
        taxpayerId: conversation.taxpayerId || body.taxpayerId || null,
      },
    });

    // AI usage log'una da yaz
    try {
      await this.prisma.aiUsageLog.create({
        data: {
          tenantId,
          source: 'moren-ai',
          model,
          inputTokens: totalInput,
          outputTokens: totalOutput,
          cacheReadTokens: totalCacheR,
          cacheWriteTokens: totalCacheW,
          costUsd,
          karar: 'ok',
          durationMs,
        },
      });
    } catch {}

    return {
      conversationId: conversation.id,
      assistantMessage: finalText || '(Cevap boş)',
      toolUses: toolUsesLog,
      usage: {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        cacheReadTokens: totalCacheR,
        cacheWriteTokens: totalCacheW,
        costUsd,
        durationMs,
        model,
      },
    };
  }

  // ==========================================================
  // YARDIMCILAR
  // ==========================================================
  private generateTitle(msg: string): string {
    const clean = msg.replace(/\s+/g, ' ').trim();
    if (clean.length <= 50) return clean;
    return clean.slice(0, 50) + '…';
  }

  private buildMessages(history: any[], newUserMessage: string): any[] {
    // Her mesaj için Anthropic format'ı:
    //   { role, content }  — content ya string ya block dizisi
    const msgs: any[] = [];
    for (const m of history) {
      if (m.role === 'user' || m.role === 'assistant') {
        msgs.push({ role: m.role, content: m.content });
      }
      // 'tool' rolü burada yok — içerden bir assistant mesajının tool_use/tool_result parçası
    }
    msgs.push({ role: 'user', content: newUserMessage });
    return msgs;
  }

  private async buildTaxpayerContext(taxpayerId: string, tenantId: string): Promise<string> {
    const t = await this.prisma.taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: {
        companyName: true, firstName: true, lastName: true, taxNumber: true,
        taxOffice: true, type: true,
      },
    });
    if (!t) return '';
    const name = t.companyName || `${t.firstName || ''} ${t.lastName || ''}`.trim();
    return `## Aktif Mükellef Kontekst\nSoru özellikle bu mükellefle ilgili:\n- İsim: ${name}\n- VKN/TCKN: ${t.taxNumber}\n- Vergi Dairesi: ${t.taxOffice}\n- Tip: ${t.type}\n- Sistem ID (taxpayerId): ${taxpayerId}\n\nTool çağırırken bu taxpayerId'yi kullan.`;
  }
  // ==========================================================
  // ==========================================================
  // v1.36.82 — PROFESYONEL DASHBOARD BRİFİNGİ
  // 30 dk in-memory cache (tenant başına). JSON çıktı:
  //   { summary: string, alerts: Array<{severity, text, href?}>,
  //     suggestions: Array<{text, href, icon?}>, focus: string, metrics: object }
  // Frontend bu yapıyı render eder. Her 5 dk client refetch — çoğu cache hit.
  // ==========================================================

  private brifingCache = new Map<string, { payload: BrifingPayload; generatedAt: Date }>();
  private readonly BRIFING_TTL_MS = 30 * 60 * 1000; // 30 dk

  async getBrifing(tenantId: string, userId?: string | null, force = false): Promise<BrifingResponse> {
    const cacheKey = `${tenantId}:${userId || 'anonymous'}`;
    const cached = this.brifingCache.get(cacheKey);
    if (!force && cached && (Date.now() - cached.generatedAt.getTime()) < this.BRIFING_TTL_MS) {
      return { ...cached.payload, generatedAt: cached.generatedAt.toISOString(), fromCache: true };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    const ctx = await this.buildBrifingContext(tenantId, userId);

    if (!apiKey) {
      const fallback = this.buildFallbackPayload(ctx);
      return { ...fallback, generatedAt: new Date().toISOString(), fromCache: false };
    }

    const prompt = this.buildBrifingPrompt(ctx);

    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          max_tokens: 700,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Brifing AI failed ${res.status}`);
        const fallback = this.buildFallbackPayload(ctx);
        return { ...fallback, generatedAt: new Date().toISOString(), fromCache: false };
      }
      const data: any = await res.json();
      const rawText = (data?.content?.[0]?.text || '').trim();

      // JSON parse — model bazen markdown code fence ile sarar
      const cleaned = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      let parsed: BrifingPayload;
      try {
        const obj = JSON.parse(cleaned);
        parsed = this.validatePayload(obj);
      } catch {
        // JSON parse fail — düz metni summary olarak kullan
        parsed = {
          summary: rawText.slice(0, 500),
          alerts: [],
          suggestions: [],
          focus: 'busy',
          sourceTags: [],
          sections: [],
          metrics: ctx.metrics,
        };
      }
      parsed = this.applyRuleDecisions(parsed, this.buildFallbackPayload(ctx));
      parsed.metrics = {
        ...ctx.metrics,
        day: ctx.day,
        periodTone: ctx.day <= 12 ? 'early' : ctx.day <= 16 ? 'prepare' : 'firm',
        bekliyorEvrak: ctx.workflow.bekliyorEvrak,
        nextDeadline: ctx.deadlines[0] || null,
        ...(parsed.metrics || {}),
      };

      // Maliyet logu
      try {
        const inT = data?.usage?.input_tokens || 0;
        const outT = data?.usage?.output_tokens || 0;
        await this.prisma.aiUsageLog.create({
          data: {
            tenantId, source: 'brifing', model: DEFAULT_MODEL,
            inputTokens: inT, outputTokens: outT, cacheReadTokens: 0, cacheWriteTokens: 0,
            costUsd: computeCostUsd(DEFAULT_MODEL, { input: inT, output: outT, cacheRead: 0, cacheWrite: 0 }),
            karar: 'ok', durationMs: 0,
          },
        });
      } catch {}

      const generatedAt = new Date();
      this.brifingCache.set(cacheKey, { payload: parsed, generatedAt });
      return { ...parsed, generatedAt: generatedAt.toISOString(), fromCache: false };
    } catch (e: any) {
      this.logger.warn(`Brifing exception: ${e?.message}`);
      const fallback = this.buildFallbackPayload(ctx);
      return { ...fallback, generatedAt: new Date().toISOString(), fromCache: false };
    }
  }

  /** Genişletilmiş bağlam — workflow + deadlines + agents + 7-day trend + last hour activity */
  private async buildBrifingContext(tenantId: string, userId?: string | null): Promise<BrifingContext> {
    const now = new Date();
    const trNow = turkeyClock(now);
    const year = trNow.year;
    const month = trNow.month;
    const day = trNow.day;
    const todayStart = new Date(year, month - 1, day); todayStart.setHours(0, 0, 0, 0);

    // v1.36.83: Kullanıcının adını dinamik çek — hardcoded "Muzaffer Bey" gitmiş olur
    let userFirstName = 'kullanıcı';
    if (userId) {
      try {
        const u = await this.prisma.user.findFirst({ where: { id: userId }, select: { firstName: true } });
        userFirstName = cleanFirstName(u?.firstName) || 'kullanıcı';
      } catch {}
    }
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const sevenDaysOut = new Date(now.getTime() + 7 * 86400000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // --- WORKFLOW DURUMU
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0, 23, 59, 59);
    const taxpayers = await this.prisma.taxpayer.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [{ startDate: null }, { startDate: { lte: lastDay } }],
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: firstDay } }] }],
      },
      select: { id: true, companyName: true, firstName: true, lastName: true, isActive: true, startDate: true },
    });
    const monthlyStatuses = taxpayers.length
      ? await this.prisma.taxpayerMonthlyStatus.findMany({
          where: { tenantId, year, month, taxpayerId: { in: taxpayers.map((t) => t.id) } },
        })
      : [];
    const statusMap = new Map(monthlyStatuses.map((s: any) => [s.taxpayerId, s]));
    const aktif = taxpayers.map((taxpayer: any) => ({
      ...(statusMap.get(taxpayer.id) || {
        id: `virtual-${taxpayer.id}-${year}-${month}`,
        updatedAt: taxpayer.startDate || firstDay,
        evraklarGeldi: false,
        evraklarIslendi: false,
        kontrolEdildi: false,
        beyannameVerildi: false,
        indirilecekKdvKontrol: false,
        hesaplananKdvKontrol: false,
        eArsivKontrol: false,
      }),
      taxpayer,
    }));
    let bekliyorEvrak = 0, isleniyor = 0, kontrol = 0, beyan = 0, tamam = 0;
    let enUzunBekleyen: { ad: string; gun: number; stage: string; id: string } | null = null;
    let toplamBekleyenGun = 0, sayilanBekleyen = 0;
    const eskiBeklemeler: Array<{ ad: string; gun: number; stage: string }> = [];
    for (const s of aktif as any[]) {
      const kdvHepsi = s.indirilecekKdvKontrol && s.hesaplananKdvKontrol && s.eArsivKontrol;
      let stage: string;
      if (s.beyannameVerildi) { stage = 'TAMAM'; tamam++; }
      else if (s.kontrolEdildi || kdvHepsi) { stage = 'BEYAN'; beyan++; }
      else if (s.evraklarIslendi) { stage = 'KONTROL'; kontrol++; }
      else if (s.evraklarGeldi) { stage = 'ISLENIYOR'; isleniyor++; }
      else { stage = 'EVRAK_BEKLIYOR'; bekliyorEvrak++; }
      if (stage !== 'TAMAM' && stage !== 'EVRAK_BEKLIYOR') {
        const gun = Math.floor((now.getTime() - new Date(s.updatedAt).getTime()) / 86400000);
        toplamBekleyenGun += gun;
        sayilanBekleyen++;
        const ad = s.taxpayer?.companyName || `${s.taxpayer?.firstName ?? ''} ${s.taxpayer?.lastName ?? ''}`.trim();
        if (!enUzunBekleyen || gun > enUzunBekleyen.gun) {
          enUzunBekleyen = { ad, gun, stage, id: s.taxpayer.id };
        }
        if (gun >= 5) eskiBeklemeler.push({ ad, gun, stage });
      }
    }
    const ortalamaBekleme = sayilanBekleyen > 0 ? Math.round(toplamBekleyenGun / sayilanBekleyen) : 0;
    eskiBeklemeler.sort((a, b) => b.gun - a.gun);

    // --- BU HAFTA SON TARİHLER
    const deadlines = this.buildTaxDeadlines(year, month, day);

    // --- GÖREVLER
    let bugunGorev = 0, haftaGorev = 0, geciken = 0;
    try {
      const tasks = await (this.prisma as any).task.findMany({
        where: {
          tenantId,
          isTemplate: false,
          status: { in: ['OPEN', 'IN_PROGRESS', 'MISSED'] },
          dueDate: { lte: sevenDaysOut },
        },
        select: { dueDate: true, title: true },
      });
      for (const t of tasks as any[]) {
        const d = new Date(t.dueDate); d.setHours(0, 0, 0, 0);
        haftaGorev++;
        if (d.getTime() === todayStart.getTime()) bugunGorev++;
        if (d.getTime() < todayStart.getTime()) geciken++;
      }
    } catch {}

    // --- AJAN ÖZETİ (bugün ve geçen 7 gün)
    let bugunOlay = 0, bugunHata = 0, bugunBasarili = 0;
    let haftaOlay = 0, haftaHata = 0;
    let sonSaatOlay = 0;
    try {
      const events = await (this.prisma as any).agentEvent.findMany({
        where: { tenantId, ts: { gte: sevenDaysAgo } },
        select: { status: true, ts: true, agent: true },
      });
      for (const e of events as any[]) {
        const status = String(e.status || '').toUpperCase();
        const isHata = ['HATA', 'ERROR', 'FAIL', 'FAILED', 'HATALI'].includes(status);
        const isOk = ['OK', 'KAYDET', 'BASARILI', 'SUCCESS', 'ONAYLANDI', 'ONAY', 'DONE', 'TAMAMLANDI'].includes(status);
        haftaOlay++;
        if (isHata) haftaHata++;
        const eventTs = new Date(e.ts);
        if (eventTs >= todayStart) {
          bugunOlay++;
          if (isHata) bugunHata++;
          if (isOk) bugunBasarili++;
        }
        if (eventTs >= oneHourAgo) sonSaatOlay++;
      }
    } catch {}
    const haftaBasariOrani = haftaOlay > 0 ? Math.round(((haftaOlay - haftaHata) / haftaOlay) * 100) : null;
    const bugunBasariOrani = bugunOlay > 0 ? Math.round((bugunBasarili / bugunOlay) * 100) : null;

    // --- KRİTİK UYARI SAYISI (sistem sağlık + kilitli modül drift'i)
    let okunmamisBildirim = 0;
    try {
      const cnt = await (this.prisma as any).notification.count({
        where: { tenantId, isRead: false },
      });
      okunmamisBildirim = cnt;
    } catch {}

    return {
      now,
      year, month, day,
      saat: trNow.hour,
      tarihUzun: now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      userFirstName,
      workflow: { bekliyorEvrak, isleniyor, kontrol, beyan, tamam, total: aktif.length },
      enUzunBekleyen,
      ortalamaBekleme,
      eskiBeklemeler,
      deadlines,
      gorev: { bugun: bugunGorev, hafta: haftaGorev, geciken },
      ajan: { bugunOlay, bugunHata, bugunBasariOrani, haftaOlay, haftaHata, haftaBasariOrani, sonSaatOlay },
      okunmamisBildirim,
      metrics: {
        aktifMukellef: aktif.length,
        aktifIsYuku: isleniyor + kontrol + beyan,
        bugunHata,
        haftaBasariOrani,
        ortalamaBekleme,
      },
    };
  }

  private buildTaxDeadlines(year: number, month: number, day: number): BrifingDeadline[] {
    const today = utcNoon(year, month, day);
    const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
    const deadlines: BrifingDeadline[] = [];

    for (const rule of TAX_DEADLINE_RULES) {
      if (rule.months && !rule.months.includes(month)) continue;
      const originalDay = rule.day === 'last' ? lastDay : rule.day;
      const nominal = utcNoon(year, month, originalDay);
      const adjusted = nextBusinessDate(nominal);
      const gunFark = diffDays(today, adjusted);
      if (gunFark < 0 || gunFark > 7) continue;

      deadlines.push({
        gun: adjusted.getUTCDate(),
        originalGun: originalDay,
        shifted: adjusted.getUTCDate() !== originalDay,
        tip: rule.tip,
        gunFark,
        source: 'calendar',
      });
    }

    return deadlines.sort((a, b) => a.gunFark - b.gunFark);
  }

  /** Profesyonel sistem prompt — JSON dönüşü ister */
  private buildBrifingPrompt(c: BrifingContext): string {
    const saat = c.saat;
    const moodHint = saat < 6 ? 'gece' : saat < 12 ? 'sabah' : saat < 18 ? 'gündüz' : 'akşam';
    const donemTonu = c.day <= 12
      ? 'erken dönem: evrakların yeni gelmesi normal; evrak bekleyenleri "takılı/gecikti" diye yargılama, nazik takip ve hazırlık öner.'
      : c.day <= 16
        ? 'hazırlık dönemi: takip dili netleşsin ama panik dili kullanma; son tarih yaklaşırken öncelik listesi öner.'
        : 'kritik dönem: son tarih yaklaştı/geçtiyse net uyar; geciken işlerde açık ve doğrudan konuş.';
    const allowedRoutes = ['/panel/is-yuku', '/panel/gorevler', '/panel/beyannameler', '/panel/kdv-kontrol', '/panel/ajanlar/mihsap', '/panel/mukellefler'].join(', ');

    return `Sen ${c.userFirstName}'in mali müşavirlik ofisini analiz eden profesyonel bir AI asistanısın. Sayıları okur, anlam çıkarır, AKSİYON ÖNERİSİ sunarsın. Kısa, net, profesyonel Türkçe yazarsın. Gerektiğinde ofisi nazikçe eleştirirsin; aksayan iş varsa üstünü örtmezsin. Tonun canlıdır: küçük bir espri veya tatlı iğneleme kullanabilirsin ama kritik uyarılarda ciddiyeti bozmazsın.

# OFİS DURUMU (${c.tarihUzun}, ${moodHint} saat ${saat})

## Dil ve Takvim Mantığı
- Bugün ayın ${c.day}'i; dönem tonu: ${donemTonu}
- Brifing takvim bilgisini aşağıdaki "Bu Hafta Son Tarihler" bölümünden alır. Son tarih yoksa son tarih uyarısı üretme.
- Ayın 1-12'sinde evrak bekleyen mükellefler için "takılı", "gecikti", "hemen talep et", "hemen harekete geç", "hızlandırılmalı" gibi sert ifadeler kullanma. "takip listesi hazırla", "nazik hatırlatma planı çıkar", "gelişi izleyelim" gibi öneri dili kullan.
- Ayın 13-16'sında dil hazırlık/önceliklendirme dili olsun.
- Ayın 17'si ve sonrası ya da son tarihe 3 gün kaldıysa net uyarı dili kullanabilirsin.
- suggestions.href sadece şu rotalardan biri olabilir: ${allowedRoutes}
- "yapı taşla" gibi anlamsız ifade kullanma; "planla", "önceliklendir", "listeyi aç" gibi açık fiil kullan.

## İş Akışı
- Bu ay iş akışına alınmış ${c.workflow.total} aktif mükellef:
  - ${c.workflow.bekliyorEvrak} mükellef evrak bekliyor
  - ${c.workflow.isleniyor} mükellef evrakları işlenmeyi bekliyor
  - ${c.workflow.kontrol} mükellef KDV kontrol bekliyor
  - ${c.workflow.beyan} mükellef beyanname hazırlanacak
  - ${c.workflow.tamam} mükellef tamamlandı
${c.enUzunBekleyen ? `- En uzun bekleyen: "${c.enUzunBekleyen.ad}" ${c.enUzunBekleyen.gun} gündür ${c.enUzunBekleyen.stage} aşamasında` : '- Aktif iş yok'}
- Ortalama bekleme süresi: ${c.ortalamaBekleme} gün
- 5+ gün geciken: ${c.eskiBeklemeler.length} mükellef${c.eskiBeklemeler.length > 0 ? ` (örn: ${c.eskiBeklemeler.slice(0, 3).map((e) => `${e.ad} ${e.gun}gün`).join(', ')})` : ''}

## Bu Hafta Son Tarihler
${c.deadlines.length === 0 ? '- Bu hafta yaklaşan beyanname yok' : c.deadlines.map((d) => `- ${d.gunFark === 0 ? 'BUGÜN' : d.gunFark === 1 ? 'YARIN' : `${d.gunFark} gün sonra`} (${d.gun}'i): ${d.tip}`).join('\n')}

## Görevler
- Bugün ${c.gorev.bugun} görev
- Bu hafta ${c.gorev.hafta} görev
- Geciken: ${c.gorev.geciken}

## Ajanlar
- Bugün ${c.ajan.bugunOlay} olay (${c.ajan.bugunHata} hata${c.ajan.bugunBasariOrani != null ? `, başarı %${c.ajan.bugunBasariOrani}` : ''})
- Son saatte ${c.ajan.sonSaatOlay} olay
- 7 günlük başarı oranı: ${c.ajan.haftaBasariOrani != null ? '%' + c.ajan.haftaBasariOrani : 'veri yok'}

## Diğer
- ${c.okunmamisBildirim} okunmamış bildirim

# ÇIKTI FORMATI

SADECE aşağıdaki JSON formatında cevap ver, başka hiçbir şey yazma (markdown code fence dahi):

{
  "summary": "Tek kısa cümle; en fazla 150 karakter. Firma/mükellef adı yazma. Sayı + aksiyon ver, uzun açıklama yapma.",
  "alerts": [
    { "severity": "high|medium|low", "text": "Acil dikkat çeken konu; firma/mükellef adı yazma", "href": "/panel/is-yuku" }
  ],
  "suggestions": [
    { "text": "Aksiyon önerisi (örn: 'Mihsap'tan faturaları işle')", "href": "/panel/ajanlar/mihsap", "icon": "Receipt|FileText|FileCheck|Bell|Sparkles" }
  ],
  "focus": "calm|busy|critical|review",
  "metrics": { "aktifIsYuku": ${c.metrics.aktifIsYuku}, "haftaBasariOrani": ${c.metrics.haftaBasariOrani ?? 'null'}, "geciken": ${c.gorev.geciken} }
}

KURALLAR:
- summary: 150 karakteri geçmesin, tek cümle. Firma/mükellef adı yazma; kullanıcıya doğal ve kısa hitap et — adını söyleyebilirsin ("${c.userFirstName}") ama "Bey/Hanım" eki ekleme, sade kullan.
- alerts: 0-3 madde. Sadece gerçekten dikkat gerektiren konular. Firma/mükellef adı yazma. Boş varsa boş array.
- suggestions: 1-3 madde. Tıklanabilir somut aksiyon. icon Lucide isim.
- focus: tek kelime. calm=her şey iyi, busy=normal yoğun, critical=acil işler var, review=ay sonu/kontrol günü
- Eleştiri varsa net ve çözüm odaklı olsun; mizah varsa tek cümleyi geçmesin.
- Sadece JSON yaz. Başına/sonuna hiçbir metin/markdown ekleme.
- Türkçe, profesyonel ton, samimi ama mesafeli.`;
  }

  /** API anahtarı yoksa veya AI hata verirse — sayılardan deterministic payload */
  private buildFallbackPayload(c: BrifingContext): BrifingPayload {
    const aktifIsYuku = c.workflow.isleniyor + c.workflow.kontrol + c.workflow.beyan;
    const erkenDonem = c.day <= 12;
    const hazirlikDonemi = c.day > 12 && c.day <= 16;
    const netUyariDonemi = c.day >= 17;
    const alerts: BrifingPayload['alerts'] = [];
    const suggestions: BrifingPayload['suggestions'] = [];
    let focus: BrifingFocus = aktifIsYuku > 0 ? 'busy' : 'calm';
    let summary = '';

    if (c.eskiBeklemeler.length > 0 && !erkenDonem) {
      const text = `${c.eskiBeklemeler.length} iş 5+ gündür aynı aşamada; en eski kayıt ${c.eskiBeklemeler[0].gun} gündür bekliyor`;
      alerts.push({
        id: briefingId('workflow-late', text),
        severity: netUyariDonemi ? 'high' : 'medium',
        text,
        href: '/panel/is-yuku?late=1',
        source: 'workflow',
      });
      focus = netUyariDonemi ? 'critical' : 'review';
    }

    const yakin = c.deadlines.find((d) => d.gunFark <= 1);
    if (yakin) {
      const shifted = yakin.shifted && yakin.originalGun ? ` (${yakin.originalGun}'den iş gününe kaydı)` : '';
      const text = `${yakin.gunFark === 0 ? 'Bugün' : 'Yarın'}: ${yakin.tip} son tarih${shifted}`;
      alerts.push({
        id: briefingId('calendar', text),
        severity: yakin.gunFark === 0 ? 'high' : 'medium',
        text,
        href: '/panel/beyannameler',
        source: 'calendar',
      });
      focus = yakin.gunFark === 0 || focus === 'critical' ? 'critical' : 'review';
    }

    if (c.gorev.geciken > 0) {
      const text = `${c.gorev.geciken} görev son tarihini geçmiş`;
      alerts.push({
        id: briefingId('tasks-late', text),
        severity: c.gorev.geciken >= 3 ? 'high' : 'medium',
        text,
        href: '/panel/gorevler',
        source: 'tasks',
      });
      if (focus !== 'critical') focus = c.gorev.geciken >= 3 ? 'critical' : 'review';
    }

    if (c.ajan.bugunHata >= 3) {
      const text = `Bugün ${c.ajan.bugunHata} ajan hatası var; logları kontrol et`;
      alerts.push({
        id: briefingId('agents-error', text),
        severity: c.ajan.bugunHata >= 5 ? 'high' : 'medium',
        text,
        href: '/panel/ajanlar',
        source: 'agents',
      });
      if (focus !== 'critical') focus = 'review';
    }

    if (c.workflow.bekliyorEvrak > 0 && erkenDonem) suggestions.push({ id: 'action-evrak-early', text: 'Evrak takip listesini hazırla', href: '/panel/mukellefler?filter=evrak-gelmedi', icon: 'FileText', source: 'workflow' });
    if (c.workflow.bekliyorEvrak > 0 && hazirlikDonemi) suggestions.push({ id: 'action-evrak-prepare', text: `${c.workflow.bekliyorEvrak} evrak bekleyen için takip planı aç`, href: '/panel/mukellefler?filter=evrak-gelmedi', icon: 'FileText', source: 'workflow' });
    if (c.workflow.bekliyorEvrak > 0 && netUyariDonemi) suggestions.push({ id: 'action-evrak-firm', text: `${c.workflow.bekliyorEvrak} evrak bekleyen kaydı sırala`, href: '/panel/mukellefler?filter=evrak-gelmedi', icon: 'FileText', source: 'workflow' });
    if (c.workflow.isleniyor > 0) suggestions.push({ id: 'action-isleniyor', text: `${c.workflow.isleniyor} işleme bekleyen kaydı aç`, href: '/panel/is-yuku?stage=ISLENMEYI_BEKLIYOR', icon: 'Receipt', source: 'workflow' });
    if (c.workflow.kontrol > 0) suggestions.push({ id: 'action-kdv', text: `${c.workflow.kontrol} KDV kontrolünü sıraya al`, href: '/panel/kdv-kontrol', icon: 'FileCheck', source: 'workflow' });
    if (c.workflow.beyan > 0) suggestions.push({ id: 'action-beyan', text: `${c.workflow.beyan} beyanname hazırlığını aç`, href: '/panel/beyannameler', icon: 'FileText', source: 'workflow' });
    if (suggestions.length === 0) suggestions.push({ id: 'action-flow', text: 'İş Akışı sayfasına git', href: '/panel/is-yuku', icon: 'Sparkles', source: 'workflow' });

    if (aktifIsYuku === 0) {
      summary = c.workflow.total === 0
        ? `${c.userFirstName}, bu ay iş akışında kayıt yok; liste doluysa veri akışını kontrol edelim.`
        : erkenDonem
          ? `${c.userFirstName}, ayın ilk akışındayız; evrak gelişini izleyip takip listesini hazırlamak iyi olur.`
          : `${c.userFirstName}, aktif iş yükü yok; bekleyen evrak varsa kısa bir kontrol iyi olur.`;
    } else {
      const parcalar: string[] = [];
      if (c.workflow.kontrol > 0) parcalar.push(`${c.workflow.kontrol} KDV kontrol`);
      if (c.workflow.beyan > 0) parcalar.push(`${c.workflow.beyan} beyanname`);
      if (c.workflow.isleniyor > 0) parcalar.push(`${c.workflow.isleniyor} işlem`);
      summary = `${c.userFirstName}, ${aktifIsYuku} aktif iş var: ${parcalar.join(', ')}.`;
      summary += c.eskiBeklemeler.length > 0
        ? ` ${c.eskiBeklemeler.length} kayıt 5+ gündür aynı aşamada bekliyor.`
        : ' Sırayı bozmadan ilerlersek tablo temiz kalır.';
    }

    const sourceTags: BrifingSourceTag[] = [
      { key: 'workflow', label: 'İş Akışı', count: c.workflow.total },
      ...(c.deadlines.length ? [{ key: 'calendar' as const, label: 'Takvim', count: c.deadlines.length }] : []),
      ...(c.gorev.bugun + c.gorev.geciken > 0 ? [{ key: 'tasks' as const, label: 'Görev', count: c.gorev.bugun + c.gorev.geciken }] : []),
      ...(c.ajan.bugunHata > 0 ? [{ key: 'agents' as const, label: 'Ajan', count: c.ajan.bugunHata }] : []),
      ...(c.okunmamisBildirim > 0 ? [{ key: 'notifications' as const, label: 'Bildirim', count: c.okunmamisBildirim }] : []),
    ];

    const todayItems = [
      `${c.workflow.total} aktif mükellef, ${aktifIsYuku} aktif iş`,
      c.gorev.bugun > 0 ? `${c.gorev.bugun} görev bugün tarihli` : 'Bugün tarihli açık görev yok',
      c.deadlines[0]
        ? `${c.deadlines[0].gunFark === 0 ? 'Bugün' : `${c.deadlines[0].gunFark} gün sonra`}: ${c.deadlines[0].tip}`
        : 'Bu hafta görünen son tarih yok',
    ];
    const riskItems = [
      c.eskiBeklemeler.length > 0 ? `${c.eskiBeklemeler.length} iş 5+ gündür aynı aşamada` : '5+ gün bekleyen kritik akış yok',
      c.gorev.geciken > 0 ? `${c.gorev.geciken} görev gecikmiş` : 'Geciken görev görünmüyor',
      c.ajan.bugunHata > 0 ? `${c.ajan.bugunHata} ajan hatası izlenmeli` : 'Bugün ajan hatası yok',
    ];

    return {
      summary: this.cleanBrifingActionText(summary),
      alerts: alerts.slice(0, 3).map((a) => ({ ...a, text: this.cleanBrifingActionText(a.text), href: a.href ? this.normalizeBrifingHref(a.href) : undefined })),
      suggestions: suggestions.slice(0, 3).map((s) => ({ ...s, href: this.normalizeBrifingHref(s.href), text: this.cleanBrifingActionText(s.text) })),
      focus,
      sourceTags,
      sections: [
        { key: 'today', title: 'Bugün', items: todayItems.slice(0, 3).map((t) => this.cleanBrifingActionText(t)) },
        { key: 'risk', title: 'Risk', items: riskItems.slice(0, 3).map((t) => this.cleanBrifingActionText(t)) },
        { key: 'action', title: 'Aksiyon', items: suggestions.slice(0, 3).map((s) => this.cleanBrifingActionText(s.text)) },
      ],
      metrics: {
        ...c.metrics,
        day: c.day,
        periodTone: erkenDonem ? 'early' : hazirlikDonemi ? 'prepare' : 'firm',
        bekliyorEvrak: c.workflow.bekliyorEvrak,
        nextDeadline: c.deadlines[0] || null,
      },
    };
  }

  private applyRuleDecisions(aiPayload: BrifingPayload, rulePayload: BrifingPayload): BrifingPayload {
    const aiSummary = this.cleanBrifingActionText(aiPayload.summary || '');
    return {
      ...rulePayload,
      summary: aiSummary.length >= 20 ? aiSummary.slice(0, 180) : rulePayload.summary,
      metrics: {
        ...rulePayload.metrics,
        ...(aiPayload.metrics || {}),
      },
    };
  }

  /** AI'dan gelen JSON'u doğrula, eksik alanları tamamla */
  private validatePayload(obj: any): BrifingPayload {
    const summary = this.cleanBrifingActionText(String(obj?.summary || '')).slice(0, 180);
    const alerts = Array.isArray(obj?.alerts)
      ? obj.alerts.slice(0, 3).map((a: any) => ({
          severity: ['high', 'medium', 'low'].includes(a?.severity) ? a.severity : 'low',
          text: this.cleanBrifingActionText(String(a?.text || '')).slice(0, 200),
          href: a?.href ? this.normalizeBrifingHref(String(a.href)) : undefined,
        })).filter((a: any) => a.text)
      : [];
    const suggestions = Array.isArray(obj?.suggestions)
      ? obj.suggestions.slice(0, 3).map((s: any) => ({
          text: this.cleanBrifingActionText(String(s?.text || '')).slice(0, 100),
          href: this.normalizeBrifingHref(String(s?.href || '/panel')),
          icon: s?.icon ? String(s.icon).slice(0, 30) : undefined,
        })).filter((s: any) => s.text)
      : [];
    const focus = ['calm', 'busy', 'critical', 'review'].includes(obj?.focus) ? obj.focus : 'busy';
    const metrics = (obj?.metrics && typeof obj.metrics === 'object') ? obj.metrics : {};
    const sourceTags = Array.isArray(obj?.sourceTags)
      ? obj.sourceTags.slice(0, 5).map((s: any) => ({
          key: ['workflow', 'calendar', 'tasks', 'agents', 'notifications'].includes(s?.key) ? s.key : 'workflow',
          label: String(s?.label || 'Kaynak').slice(0, 24),
          count: Number(s?.count || 0),
        }))
      : [];
    const sections = Array.isArray(obj?.sections)
      ? obj.sections.slice(0, 3).map((s: any) => ({
          key: ['today', 'risk', 'action'].includes(s?.key) ? s.key : 'today',
          title: String(s?.title || 'Bölüm').slice(0, 24),
          items: Array.isArray(s?.items)
            ? s.items.slice(0, 3).map((item: any) => this.cleanBrifingActionText(String(item || '')).slice(0, 110)).filter(Boolean)
            : [],
        })).filter((s: any) => s.items.length > 0)
      : [];
    return { summary, alerts, suggestions, focus, sourceTags, sections, metrics };
  }

  private normalizeBrifingHref(href: string): string {
    const value = String(href || '').trim();
    const [path, query = ''] = value.split('?');
    const routes = [
      '/panel/ajanlar/mihsap',
      '/panel/is-yuku',
      '/panel/gorevler',
      '/panel/beyannameler',
      '/panel/kdv-kontrol',
      '/panel/mukellefler',
      '/panel/ajanlar',
    ];
    for (const route of routes) {
      if (path === route || path.startsWith(`${route}/`)) return query ? `${route}?${query}` : route;
    }
    return '/panel';
  }

  private cleanBrifingActionText(text: string): string {
    return String(text || '')
      .replace(/\b(?!KDV\b|SGK\b|GIB\b|GİB\b|LUCA\b|MIHSAP\b|MİHSAP\b)([A-ZÇĞİÖŞÜ]{2,})(?:\s+[A-ZÇĞİÖŞÜ]{2,}){1,3}\b/g, 'ilgili mükellef')
      .replace(/\byapı\s*taşla\b/gi, 'planla')
      .replace(/\byapi\s*tasla\b/gi, 'planla')
      .replace(/\btakılı\b/gi, 'beklemede')
      .replace(/\btakildi\b/gi, 'beklemede')
      .replace(/\bhemen harekete geç\b/gi, 'öncelik listesine al')
      .replace(/\bhız ver ya da engel varsa çöz\b/gi, 'engeli kontrol edip sıraya al')
      .replace(/\bhızlandırılmalı\b/gi, 'takip edilmeli')
      .replace(/\bhizlandirilmali\b/gi, 'takip edilmeli')
      .replace(/\bhemen talep et\b/gi, 'talep planı çıkar')
      .replace(/\s+/g, ' ')
      .trim();
  }

}
