import { Injectable, Logger } from '@nestjs/common';
import { OpenRouterAdapter, ChatMessage } from './providers/openrouter.adapter';
import { PERSONAS, AgentId, suggestAgents } from './agents/personas';
import { PrismaService } from '../prisma/prisma.service';
import { MorenOfisMemoryService } from './memory.service';

export interface OfisMessage {
  agent: AgentId | 'user';
  content: string;
  ts: string;
  // UI animasyonu için
  durationMs?: number;
  // Cost tracking
  usage?: { promptTokens: number; completionTokens: number; costUsd?: number };
}

export interface OfisTurnResponse {
  conversationId: string;
  messages: OfisMessage[];
  active: AgentId[];
  totalCostUsd: number;
}

@Injectable()
export class MorenOfisService {
  private readonly logger = new Logger(MorenOfisService.name);

  constructor(
    private readonly openrouter: OpenRouterAdapter,
    private readonly prisma: PrismaService,
    private readonly memory: MorenOfisMemoryService,
  ) {}

  /**
   * Bir kullanıcı mesajını ekibe gönder. Orkestratör (ARDA) önce hangi
   * ajanları çağıracağına karar verir, sonra paralel sorar, son olarak
   * sentezler. Akış UI'da fade-in animasyonla görünür.
   */
  async sendMessage(params: {
    tenantId: string;
    userId: string;
    conversationId?: string;
    text: string;
  }): Promise<OfisTurnResponse> {
    const { tenantId, userId, text } = params;
    const conv = await this.upsertConversation(tenantId, userId, params.conversationId);
    const history = (conv.messages as OfisMessage[] | null) || [];

    // 0) HAFIZA YÜKLE — geçmiş özetler + ilgili gerçekler
    // Bu metin her ajanın system prompt'una eklenir, "patron'u tanıyor" hissi verir.
    const memoryContext = await this.memory.loadContext(tenantId, text);
    const enhancedSystemPrompt = (base: string) =>
      memoryContext ? `${base}\n\n${memoryContext}` : base;

    const newMessages: OfisMessage[] = [];
    const userMsg: OfisMessage = {
      agent: 'user',
      content: text,
      ts: new Date().toISOString(),
    };
    newMessages.push(userMsg);

    // 1) ARDA — soruyu analiz, hangi ajanlara delege edileceğine karar
    const suggested = suggestAgents(text);
    const delegateTo = suggested.length > 0 ? suggested : ['nevra']; // fallback: vergi uzmanı

    // ARDA delege mesajı (UI animasyonu için, içerik kısa)
    const ardaStart = await this.callAgent('arda', [
      { role: 'system', content: enhancedSystemPrompt(PERSONAS.arda.systemPrompt) },
      ...this.recentHistoryAsMessages(history, 6),
      { role: 'user', content: this.buildArdaTriagePrompt(text, delegateTo) },
    ], history);
    newMessages.push(ardaStart);

    // 2) Delege edilen ajanlar — paralel
    const delegatePromises = delegateTo.map((agentId) =>
      this.callAgent(agentId as AgentId, [
        { role: 'system', content: enhancedSystemPrompt(PERSONAS[agentId as AgentId].systemPrompt) },
        ...this.recentHistoryAsMessages(history, 6),
        { role: 'user', content: this.buildAgentPrompt(text, agentId as AgentId) },
      ], history),
    );
    const delegateResponses = await Promise.all(delegatePromises);
    newMessages.push(...delegateResponses);

    // 3) ARDA — sentez (eğer 2+ ajan cevap verdiyse veya complex query ise)
    if (delegateResponses.length > 1) {
      const synthesis = await this.callAgent('arda', [
        { role: 'system', content: enhancedSystemPrompt(PERSONAS.arda.systemPrompt) },
        { role: 'user', content: this.buildSynthesisPrompt(text, delegateResponses) },
      ], history);
      newMessages.push(synthesis);
    }

    // 4) Persistans
    const allMessages = [...history, ...newMessages];
    await (this.prisma as any).morenOfisConversation.update({
      where: { id: conv.id },
      data: {
        messages: allMessages as any,
        lastActivityAt: new Date(),
      },
    });

    // 5) HAFIZA YAZ — asenkron, kullanıcı beklemez
    // Sohbet 2+ mesaj birikince, ARDA özet + gerçek çıkarır → DB
    if (allMessages.length >= 2) {
      const messagesText = allMessages
        .slice(-12) // Son 12 mesaj yeterli (token bütçesi)
        .map((m) => `[${m.agent.toUpperCase()}]: ${m.content}`)
        .join('\n\n');
      // Bekleme, fire-and-forget
      this.memory
        .extractAndStore({ conversationId: conv.id, tenantId, messagesText })
        .catch((e) => this.logger.warn(`Memory extract: ${e?.message}`));
    }

    const totalCost = newMessages.reduce((s, m) => s + (m.usage?.costUsd || 0), 0);

    return {
      conversationId: conv.id,
      messages: newMessages,
      active: delegateTo as AgentId[],
      totalCostUsd: totalCost,
    };
  }

  private async callAgent(
    agentId: AgentId,
    messages: ChatMessage[],
    _history: OfisMessage[],
  ): Promise<OfisMessage> {
    const persona = PERSONAS[agentId];
    const t0 = Date.now();
    try {
      const res = await this.openrouter.chat({
        model: persona.model,
        messages,
        temperature: 0.3,
        maxTokens: 1200,
        cachePromptPrefix: true,
      });
      return {
        agent: agentId,
        content: res.content,
        ts: new Date().toISOString(),
        durationMs: Date.now() - t0,
        usage: {
          promptTokens: res.usage.promptTokens,
          completionTokens: res.usage.completionTokens,
          costUsd: res.usage.costUsd,
        },
      };
    } catch (err: any) {
      this.logger.error(`Ajan ${agentId} hatasi: ${err.message}`);
      return {
        agent: agentId,
        content: `[Sistem hatası: ${err.message}]`,
        ts: new Date().toISOString(),
        durationMs: Date.now() - t0,
      };
    }
  }

  /**
   * Aynı conversation'ın son N mesajını ChatMessage[] olarak döner.
   * Ajan "bu sohbetin önceki mesajlarını" görsün diye.
   */
  private recentHistoryAsMessages(history: OfisMessage[], limit: number): ChatMessage[] {
    const recent = history.slice(-limit);
    return recent.map((m) => ({
      role: (m.agent === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.agent === 'user'
        ? m.content
        : `[${PERSONAS[m.agent as AgentId]?.displayName || m.agent}]: ${m.content}`,
    }));
  }

  private buildArdaTriagePrompt(query: string, delegateTo: string[]): string {
    return `Patron Muzaffer Bey'den şu komut geldi:
"${query}"

Sen ekip lideri olarak şu ekip üyelerini görevlendirdin: ${delegateTo.join(', ').toUpperCase()}.

Patrona ÇOK KISA (1-2 cümle) hangi ekip üyelerine sorduğunu, neyi araştırdıklarını söyle.
Cevabını şimdi bekleme, sadece "şu adama, şuna sordum, geliyor" gibi.
Örnek: "Tamam Muzaffer Bey, Nevra mevzuata bakıyor, Cem önceki dönemle karşılaştırıyor. Sonuç gelir gelmez özetliyorum."`;
  }

  private buildAgentPrompt(query: string, agentId: AgentId): string {
    return `Patron Muzaffer Bey'den şu komut geldi:
"${query}"

Senden ${PERSONAS[agentId].expertise.join(' / ')} uzmanlığında cevap istiyor. Kendi uzmanlık alanında net, kısa, eylem odaklı cevap ver.`;
  }

  private buildSynthesisPrompt(query: string, responses: OfisMessage[]): string {
    const summary = responses
      .map((r) => `${PERSONAS[r.agent as AgentId].displayName} (${PERSONAS[r.agent as AgentId].role}): ${r.content}`)
      .join('\n\n');
    return `Patronun sorusu: "${query}"

Ekibin cevapları:
${summary}

Şimdi bunları sen (ARDA) sentezle. Tek kısa paragraf + 2-3 maddelik somut adım. Hangi ajan ne dediğini parantez içinde belirt (örn. "(Nevra'ya göre)").`;
  }

  // === Conversation persistence ===

  private async upsertConversation(tenantId: string, userId: string, id?: string) {
    if (id) {
      const existing = await (this.prisma as any).morenOfisConversation.findUnique({ where: { id } });
      if (existing && existing.tenantId === tenantId) return existing;
    }
    return (this.prisma as any).morenOfisConversation.create({
      data: { tenantId, createdBy: userId, messages: [] },
    });
  }

  async listConversations(tenantId: string, limit = 20) {
    return (this.prisma as any).morenOfisConversation.findMany({
      where: { tenantId },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
      select: { id: true, createdAt: true, lastActivityAt: true, title: true, messages: true },
    }).then((rows: any[]) =>
      rows.map((r) => ({
        id: r.id,
        title: r.title || this.deriveTitle(r.messages as OfisMessage[]),
        lastActivityAt: r.lastActivityAt,
        messageCount: Array.isArray(r.messages) ? r.messages.length : 0,
      })),
    );
  }

  async getConversation(tenantId: string, id: string) {
    const c = await (this.prisma as any).morenOfisConversation.findUnique({ where: { id } });
    if (!c || c.tenantId !== tenantId) return null;
    return c;
  }

  private deriveTitle(messages: OfisMessage[]): string {
    const firstUser = messages.find((m) => m.agent === 'user');
    return firstUser ? firstUser.content.slice(0, 50) : 'Yeni sohbet';
  }
}
