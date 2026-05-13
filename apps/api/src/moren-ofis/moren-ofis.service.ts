import { Injectable, Logger } from '@nestjs/common';
import { OpenRouterAdapter, ChatMessage } from './providers/openrouter.adapter';
import { PERSONAS, AgentId, suggestAgents } from './agents/personas';
import { PrismaService } from '../prisma/prisma.service';
import { MorenOfisMemoryService } from './memory.service';
import { ToolExecutorService } from '../moren-ai/tool-executor.service';
import { PendingActionsService } from '../pending-actions/pending-actions.service';

export interface OfisToolCall {
  tool: string;
  input: any;
  ok: boolean;
  durationMs: number;
}

export interface OfisMessage {
  agent: AgentId | 'user';
  content: string;
  ts: string;
  // UI animasyonu için
  durationMs?: number;
  // Cost tracking
  usage?: { promptTokens: number; completionTokens: number; costUsd?: number };
  // FAZ 1 — Hangi tool'ları kullandı (UI rozet için)
  toolCalls?: OfisToolCall[];
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
    // FAZ 1 — Ortak tool beyni (moren-ai modülünden paylaşılıyor)
    private readonly tools: ToolExecutorService,
    // FAZ 3 — Yazma niyetleri buradan onay kuyruğuna düşer
    private readonly pendingActions: PendingActionsService,
  ) {}

  /**
   * FAZ 3 — Ajan mesajının içeriğini hatırlatma önerisi olarak onay
   * kuyruğuna düşür. Henüz kalıcı Task oluşturmaz, sadece insanın
   * görüp Approve veya Reject yapacağı bir PendingAction üretir.
   *
   * Onaylanırsa Faz 3b'de eklenecek worker `applyReminderProposal` ile
   * gerçek Task kaydını açar. Şimdilik insan onayı + audit yeterli.
   */
  async proposeReminderFromAgent(params: {
    tenantId: string;
    userId: string;
    agent: string;
    title: string;
    content: string;
    dueDate?: string;
    taxpayerHint?: string;
  }) {
    const { tenantId, userId, agent, title, content, dueDate, taxpayerHint } = params;
    return this.pendingActions.create({
      tenantId,
      source: 'moren_ofis',
      type: 'create_reminder',
      title: title.slice(0, 200),
      summary: content.slice(0, 2000),
      payload: {
        agent,
        proposedTitle: title,
        proposedContent: content,
        dueDate: dueDate || null,
        taxpayerHint: taxpayerHint || null,
      },
      riskLevel: 'low',
      requestedByAgent: agent,
      requestedByUserId: userId,
      expiresInMinutes: 60 * 24 * 7, // 7 gün
    });
  }

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

    // FAZ 1 — TOOL PREFETCH: kullanıcı mesajında mükellef adı/KDV/mizan
    // anahtar kelime varsa ortak tool beynini önceden çağır, sonucu metin
    // olarak ajan prompt'una enjekte et. Ajanlar gerçek veriyi yorumlar.
    const { toolContext, toolCalls } = await this.prefetchToolContext(text, tenantId, userId);

    const enhancedSystemPrompt = (base: string) => {
      let prompt = base;
      if (memoryContext) prompt += `\n\n${memoryContext}`;
      if (toolContext) {
        prompt += `\n\nCanlı veri (yorumla, kopyalama — kısa cümle ile geç): ${toolContext}`;
      }
      // Son katmanda kısa cevap reminder — modeller çok seviyor uzun rapor yazmayı
      prompt += `\n\nÖNEMLİ: Cevabın doğal sohbet havası olmalı — başlık/tablo/checkbox yasak. 2-4 cümle, max 80 kelime.`;
      return prompt;
    };

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

    // FAZ 1 — Tool çağrılarını ilk delege ajanın mesajına ilişti (UI rozet için)
    if (toolCalls.length > 0 && newMessages.length > 1) {
      // ARDA'dan sonraki ilk ajan delegasyonuna ekle
      const firstAgentMsg = newMessages.find(
        (m) => m.agent !== 'user' && m.agent !== 'arda',
      );
      if (firstAgentMsg) firstAgentMsg.toolCalls = toolCalls;
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
        temperature: 0.4,
        // Ekip cevapları kısa olmalı — ChatGPT raporu değil, meslektaş konuşması.
        // ARDA daha da kısa (delege mesajları), uzmanlar biraz daha alan.
        maxTokens: agentId === 'arda' ? 250 : 400,
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

  // ============================================================
  // FAZ 1 — TOOL PREFETCH
  // ============================================================
  // Kullanıcı mesajında anahtar kelime/firma adı varsa ortak tool beynini
  // önceden çağırır, sonucu kısa Markdown bloğu olarak döner. Ajan bu metni
  // system prompt'unda görür ve gerçek veriyi yorumlar.
  //
  // Yalnızca READ tool'ları çağrılır — yazma yapmaz. Faz 3'te write tool'lar
  // PendingAction üzerinden onay ister.
  //
  // Hata olursa kullanıcıya görünür mesaj DÖNMEZ — sadece log + boş context.
  // Ajanlar yine de cevap verir, sadece canlı veri olmaz.
  // ------------------------------------------------------------
  private async prefetchToolContext(
    text: string,
    tenantId: string,
    userId: string,
  ): Promise<{ toolContext: string; toolCalls: OfisToolCall[] }> {
    const calls: OfisToolCall[] = [];
    const parts: string[] = [];
    const ctx = { tenantId, userId };
    const lower = text.toLocaleLowerCase('tr');

    const runTool = async (tool: string, input: any) => {
      const t0 = Date.now();
      try {
        const result = await this.tools.execute(tool, input, ctx);
        const ok = !result?.error;
        calls.push({ tool, input, ok, durationMs: Date.now() - t0 });
        return ok ? result : null;
      } catch (e: any) {
        calls.push({ tool, input, ok: false, durationMs: Date.now() - t0 });
        this.logger.warn(`prefetch ${tool}: ${e?.message}`);
        return null;
      }
    };

    // 1) Mükellef adı tespiti — önce list_taxpayers ile arama yap.
    const candidateNames = this.extractCompanyCandidates(text);
    let matchedTaxpayer: any = null;
    if (candidateNames.length > 0) {
      const searchTerm = candidateNames[0];
      const result = await runTool('list_taxpayers', { search: searchTerm, limit: 3 });
      const list = result?.taxpayers || result?.items || [];
      if (Array.isArray(list) && list.length > 0) {
        matchedTaxpayer = list[0];
        const name = matchedTaxpayer.companyName || `${matchedTaxpayer.firstName || ''} ${matchedTaxpayer.lastName || ''}`.trim();
        parts.push(`Mükellef bulundu: ${name} (vergi no ${matchedTaxpayer.taxNumber || '—'}).`);
      }
    }

    // 2) Dönem tespiti
    const period = this.extractPeriod(text);

    // 3) KDV — tek cümle özet
    if (matchedTaxpayer && /\bkdv\b/.test(lower)) {
      const result = await runTool('get_kdv_summary', {
        taxpayerId: matchedTaxpayer.id,
        period,
      });
      if (result && !result.error) {
        parts.push(`KDV özeti (${period}): ${this.summarizeKdv(result)}`);
      }
    }

    // 4) Mizan dönemleri
    if (matchedTaxpayer && /\bmizan\b/.test(lower)) {
      const result = await runTool('list_mizan_periods', { taxpayerId: matchedTaxpayer.id });
      if (result && Array.isArray(result.periods) && result.periods.length > 0) {
        parts.push(`Mizan son dönemler: ${result.periods.slice(0, 3).join(', ')}.`);
      }
    }

    // 5) Fatura sayısı
    if (matchedTaxpayer && /(fatura|belge)/.test(lower)) {
      const result = await runTool('list_invoices', { taxpayerId: matchedTaxpayer.id, limit: 5 });
      if (result && !result.error) {
        const items = result.invoices || result.items || [];
        if (Array.isArray(items)) {
          parts.push(`Sistemde ${items.length} son fatura kaydı görünüyor.`);
        }
      }
    }

    // 6) Vergi takvimi
    if (/(takvim|son gün|deadline|beyanname tarihi)/.test(lower)) {
      const result = await runTool('get_tax_calendar', { period });
      if (result && !result.error) {
        const txt = typeof result === 'string' ? result : (result.summary || JSON.stringify(result).slice(0, 200));
        parts.push(`Vergi takvimi (${period}): ${txt}`);
      }
    }

    return {
      toolContext: parts.length > 0 ? parts.join('\n\n') : '',
      toolCalls: calls,
    };
  }

  /**
   * KDV özetini insan okunaklı tek satır metne dönüştürür.
   * JSON dump yerine ajan rapor yapma dürtüsünü tetiklemesin diye.
   */
  private summarizeKdv(data: any): string {
    if (!data || typeof data !== 'object') return 'veri yok';
    const parts: string[] = [];
    const fmt = (n: any) => {
      const num = Number(n);
      return isFinite(num) ? num.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : '—';
    };
    if (data.totalSales !== undefined) parts.push(`satış ${fmt(data.totalSales)} TL`);
    if (data.totalPurchases !== undefined) parts.push(`alış ${fmt(data.totalPurchases)} TL`);
    if (data.netVat !== undefined) parts.push(`net KDV ${fmt(data.netVat)} TL`);
    if (data.status) parts.push(`durum ${data.status}`);
    if (data.invoiceCount !== undefined) parts.push(`${data.invoiceCount} fatura`);
    return parts.length > 0 ? parts.join(', ') : 'veri var ama özetlenemedi';
  }

  /**
   * Mesajdan firma adı adayları çıkarır. Basit heuristic:
   * - 3+ karakterli kelimeler
   * - Türkçe büyük harfle başlayan (büyük harf I, İ dahil)
   * - Yaygın kelimeler ("Mayıs", "Mizan" vb.) hariç
   */
  private extractCompanyCandidates(text: string): string[] {
    const STOPWORDS = new Set([
      'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz',
      'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
      'Mizan', 'KDV', 'Bilanço', 'Beyanname', 'Fatura', 'Belge',
      'Petek', 'Ben', 'Sen', 'Bu', 'Şu', 'Bugün', 'Yarın',
      'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar',
    ]);
    const matches = text.match(/[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}/gu) || [];
    const unique = Array.from(new Set(matches));
    return unique.filter((w) => !STOPWORDS.has(w));
  }

  /**
   * Mesajdan dönem (YYYY-MM) çıkarır. Türkçe ay adı, YYYY-MM, "geçen ay" vb.
   */
  private extractPeriod(text: string): string {
    // Doğrudan YYYY-MM
    const m1 = text.match(/(\d{4})[-/](\d{1,2})/);
    if (m1) return `${m1[1]}-${String(m1[2]).padStart(2, '0')}`;

    const months: Record<string, number> = {
      ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5,
      haziran: 6, temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9,
      ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12,
    };
    const lower = text.toLocaleLowerCase('tr');
    for (const [name, num] of Object.entries(months)) {
      if (lower.includes(name)) {
        const yearMatch = text.match(/\b(20\d{2})\b/);
        const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
        return `${year}-${String(num).padStart(2, '0')}`;
      }
    }

    // Default — şu anki ay
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
