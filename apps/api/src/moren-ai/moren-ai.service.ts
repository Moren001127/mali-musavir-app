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
const MAX_TOOL_ITERATIONS = 8;              // Tool döngüsünde en fazla 8 tur

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


interface BrifingPayload {
  summary: string;
  alerts: Array<{ severity: 'high' | 'medium' | 'low'; text: string; href?: string }>;
  suggestions: Array<{ text: string; href: string; icon?: string }>;
  focus: 'calm' | 'busy' | 'critical' | 'review';
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
  workflow: { bekliyorEvrak: number; isleniyor: number; kontrol: number; beyan: number; tamam: number; total: number };
  enUzunBekleyen: { ad: string; gun: number; stage: string; id: string } | null;
  ortalamaBekleme: number;
  eskiBeklemeler: Array<{ ad: string; gun: number; stage: string }>;
  deadlines: Array<{ gun: number; tip: string; gunFark: number }>;
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
      userName: user ? `${user.firstName} ${user.lastName}` : undefined,
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

  async getBrifing(tenantId: string, force = false): Promise<BrifingResponse> {
    const cached = this.brifingCache.get(tenantId);
    if (!force && cached && (Date.now() - cached.generatedAt.getTime()) < this.BRIFING_TTL_MS) {
      return { ...cached.payload, generatedAt: cached.generatedAt.toISOString(), fromCache: true };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    const ctx = await this.buildBrifingContext(tenantId);

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
          metrics: ctx.metrics,
        };
      }

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
      this.brifingCache.set(tenantId, { payload: parsed, generatedAt });
      return { ...parsed, generatedAt: generatedAt.toISOString(), fromCache: false };
    } catch (e: any) {
      this.logger.warn(`Brifing exception: ${e?.message}`);
      const fallback = this.buildFallbackPayload(ctx);
      return { ...fallback, generatedAt: new Date().toISOString(), fromCache: false };
    }
  }

  /** Genişletilmiş bağlam — workflow + deadlines + agents + 7-day trend + last hour activity */
  private async buildBrifingContext(tenantId: string): Promise<BrifingContext> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart.getTime() - 86400000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const sevenDaysOut = new Date(now.getTime() + 7 * 86400000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // --- WORKFLOW DURUMU
    const monthlyStatuses = await this.prisma.taxpayerMonthlyStatus.findMany({
      where: { tenantId, year, month },
      include: { taxpayer: { select: { isActive: true, companyName: true, firstName: true, lastName: true, id: true } } },
    });
    const aktif = monthlyStatuses.filter((s: any) => s.taxpayer?.isActive);
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
    const sonuncuGun = new Date(year, month, 0).getDate();
    const deadlines: Array<{ gun: number; tip: string; gunFark: number }> = [];
    const inWindow = (g: number) => g >= day && (g - day) <= 7;
    if (inWindow(17) && [2, 5, 8, 11].includes(month)) deadlines.push({ gun: 17, tip: 'Geçici Vergi', gunFark: 17 - day });
    if (inWindow(26)) deadlines.push({ gun: 26, tip: 'Muhtasar/Damga', gunFark: 26 - day });
    if (inWindow(28)) deadlines.push({ gun: 28, tip: 'KDV', gunFark: 28 - day });
    if (inWindow(sonuncuGun)) deadlines.push({ gun: sonuncuGun, tip: 'Ay sonu (Ba-Bs vb.)', gunFark: sonuncuGun - day });
    deadlines.sort((a, b) => a.gunFark - b.gunFark);

    // --- GÖREVLER
    let bugunGorev = 0, haftaGorev = 0, geciken = 0;
    try {
      const tasks = await (this.prisma as any).task.findMany({
        where: { tenantId, isCompleted: false, dueDate: { lte: sevenDaysOut } },
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
      saat: now.getHours(),
      tarihUzun: now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
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

  /** Profesyonel sistem prompt — JSON dönüşü ister */
  private buildBrifingPrompt(c: BrifingContext): string {
    const saat = c.saat;
    const moodHint = saat < 6 ? 'gece' : saat < 12 ? 'sabah' : saat < 18 ? 'gündüz' : 'akşam';

    return `Sen Muzaffer Bey'in mali müşavirlik ofisini analiz eden profesyonel bir AI asistanısın. Sayıları okur, anlam çıkarır, AKSİYON ÖNERİSİ sunarsın. Kısa, net, profesyonel Türkçe yazarsın.

# OFİS DURUMU (${c.tarihUzun}, ${moodHint} saat ${saat})

## İş Akışı
- ${c.workflow.total} aktif mükelleften:
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
  "summary": "2-3 cümle profesyonel analiz. Sayıları kullan ama akıcı olsun. Aksiyon belirten cümle bitir. 'Günaydın' deme; doğrudan duruma gir.",
  "alerts": [
    { "severity": "high|medium|low", "text": "Acil dikkat çeken konu (örn: '5 gündür bekleyen Kaya İnşaat var')", "href": "/panel/is-yuku" }
  ],
  "suggestions": [
    { "text": "Aksiyon önerisi (örn: 'Mihsap'tan faturaları işle')", "href": "/panel/ajanlar/mihsap", "icon": "Receipt|FileText|FileCheck|Bell|Sparkles" }
  ],
  "focus": "calm|busy|critical|review",
  "metrics": { "aktifIsYuku": ${c.metrics.aktifIsYuku}, "haftaBasariOrani": ${c.metrics.haftaBasariOrani ?? 'null'}, "geciken": ${c.gorev.geciken} }
}

KURALLAR:
- summary: 200 karakter, 2-3 cümle. Aktör Muzaffer Bey'e doğrudan hitap.
- alerts: 0-3 madde. Sadece gerçekten dikkat gerektiren konular. Boş varsa boş array.
- suggestions: 1-3 madde. Tıklanabilir somut aksiyon. icon Lucide isim.
- focus: tek kelime. calm=her şey iyi, busy=normal yoğun, critical=acil işler var, review=ay sonu/kontrol günü
- Sadece JSON yaz. Başına/sonuna hiçbir metin/markdown ekleme.
- Türkçe, profesyonel ton, samimi ama mesafeli.`;
  }

  /** API anahtarı yoksa veya AI hata verirse — sayılardan deterministic payload */
  private buildFallbackPayload(c: BrifingContext): BrifingPayload {
    const aktifIsYuku = c.workflow.isleniyor + c.workflow.kontrol + c.workflow.beyan;
    const alerts: Array<{ severity: 'high' | 'medium' | 'low'; text: string; href?: string }> = [];
    const suggestions: Array<{ text: string; href: string; icon?: string }> = [];
    let focus: 'calm' | 'busy' | 'critical' | 'review' = 'calm';
    let summary = '';

    // 5+ gün gecikmeler
    if (c.eskiBeklemeler.length > 0) {
      alerts.push({
        severity: 'high',
        text: `${c.eskiBeklemeler.length} mükellef 5+ gündür bekliyor (${c.eskiBeklemeler[0].ad} ${c.eskiBeklemeler[0].gun}g)`,
        href: '/panel/is-yuku',
      });
      focus = 'critical';
    }
    // Bugün/yarın deadline
    const yakin = c.deadlines.find((d) => d.gunFark <= 1);
    if (yakin) {
      alerts.push({
        severity: yakin.gunFark === 0 ? 'high' : 'medium',
        text: `${yakin.gunFark === 0 ? 'BUGÜN' : 'YARIN'}: ${yakin.tip} son tarih`,
        href: '/panel/beyannameler',
      });
      if (focus !== 'critical') focus = 'review';
    }
    // Ajan hatası
    if (c.ajan.bugunHata >= 3) {
      alerts.push({
        severity: 'medium',
        text: `Bugün ${c.ajan.bugunHata} ajan hatası`,
        href: '/panel/ajanlar',
      });
    }

    // Aksiyon önerileri
    if (c.workflow.isleniyor > 0) suggestions.push({ text: `${c.workflow.isleniyor} fatura işle`, href: '/panel/ajanlar/mihsap', icon: 'Receipt' });
    if (c.workflow.kontrol > 0) suggestions.push({ text: `${c.workflow.kontrol} KDV kontrolü`, href: '/panel/kdv-kontrol', icon: 'FileCheck' });
    if (c.workflow.beyan > 0) suggestions.push({ text: `${c.workflow.beyan} beyanname hazırla`, href: '/panel/beyannameler', icon: 'FileText' });
    if (suggestions.length === 0) suggestions.push({ text: 'İş Akışı sayfasına git', href: '/panel/is-yuku', icon: 'Sparkles' });

    // Summary
    if (aktifIsYuku === 0) {
      summary = `Bu sabah aktif iş yükü yok. ${c.workflow.tamam} mükellef tamamlandı, sistem hazır.`;
    } else {
      const parcalar: string[] = [];
      if (c.workflow.kontrol > 0) parcalar.push(`${c.workflow.kontrol} KDV kontrol`);
      if (c.workflow.beyan > 0) parcalar.push(`${c.workflow.beyan} beyanname`);
      if (c.workflow.isleniyor > 0) parcalar.push(`${c.workflow.isleniyor} fatura işleme`);
      summary = `Şu an ${aktifIsYuku} aktif iş var: ${parcalar.join(', ')}.`;
      if (c.eskiBeklemeler.length > 0) summary += ` ${c.eskiBeklemeler.length} mükellef 5+ gündür bekliyor — sıradakini hemen bitirmen önemli.`;
      else summary += ' İş Akışı sayfasından FIFO sırayla devam edebilirsin.';
      if (focus === 'calm') focus = 'busy';
    }

    return {
      summary,
      alerts,
      suggestions: suggestions.slice(0, 3),
      focus,
      metrics: c.metrics,
    };
  }

  /** AI'dan gelen JSON'u doğrula, eksik alanları tamamla */
  private validatePayload(obj: any): BrifingPayload {
    const summary = String(obj?.summary || '').slice(0, 600);
    const alerts = Array.isArray(obj?.alerts)
      ? obj.alerts.slice(0, 3).map((a: any) => ({
          severity: ['high', 'medium', 'low'].includes(a?.severity) ? a.severity : 'low',
          text: String(a?.text || '').slice(0, 200),
          href: a?.href ? String(a.href).slice(0, 200) : undefined,
        })).filter((a: any) => a.text)
      : [];
    const suggestions = Array.isArray(obj?.suggestions)
      ? obj.suggestions.slice(0, 3).map((s: any) => ({
          text: String(s?.text || '').slice(0, 100),
          href: String(s?.href || '/panel').slice(0, 200),
          icon: s?.icon ? String(s.icon).slice(0, 30) : undefined,
        })).filter((s: any) => s.text)
      : [];
    const focus = ['calm', 'busy', 'critical', 'review'].includes(obj?.focus) ? obj.focus : 'busy';
    const metrics = (obj?.metrics && typeof obj.metrics === 'object') ? obj.metrics : {};
    return { summary, alerts, suggestions, focus, metrics };
  }

}
