import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ToolExecutorService } from './tool-executor.service';
import { MOREN_AI_TOOLS } from './tools';
import { buildSystemPrompt } from './system-prompt';
import { computeCostUsd } from '../common/ai-usage-logger';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6'; // Mali müşavir için akıllı model
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
        max_tokens: 4096,
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
          const result = await this.toolExecutor.execute(tb.name, tb.input || {}, { tenantId });
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
}
