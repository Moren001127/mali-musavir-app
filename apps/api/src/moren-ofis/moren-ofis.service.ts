import { Injectable, Logger } from '@nestjs/common';
import { OpenRouterAdapter, ChatMessage } from './providers/openrouter.adapter';
import { PERSONAS, AgentId, suggestAgents } from './agents/personas';
import { PrismaService } from '../prisma/prisma.service';
import { MorenOfisMemoryService } from './memory.service';
import { ToolExecutorService } from '../moren-ai/tool-executor.service';
import { PendingActionsService } from '../pending-actions/pending-actions.service';
import { LucaService } from '../luca/luca.service';
import { GelirTablosuService } from '../mizan/gelir-tablosu.service';

export interface OfisToolCall {
  tool: string;
  input: any;
  ok: boolean;
  durationMs: number;
}

export type MizanGelirWorkflowPhase =
  | 'queued'
  | 'running'
  | 'waiting_mizan'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'needs_clarification';

export interface MizanGelirWorkflowEvent {
  kind: 'mizan_gelir_workflow';
  phase: MizanGelirWorkflowPhase;
  jobId?: string;
  status?: string;
  taxpayerId?: string;
  taxpayerName?: string;
  donem?: string;
  donemTipi?: string;
  mizanId?: string;
  gelirTablosuId?: string;
  error?: string;
  logs?: string[];
  summary?: {
    netSatislar: number;
    brutSatisKari: number;
    faaliyetKari: number;
    donemNetKari: number;
  };
}

export interface OfisMessage {
  agent: AgentId | 'user' | 'system';
  content: string;
  ts: string;
  // UI animasyonu için
  durationMs?: number;
  // Cost tracking
  usage?: { promptTokens: number; completionTokens: number; costUsd?: number };
  // FAZ 1 — Hangi tool'ları kullandı (UI rozet için)
  toolCalls?: OfisToolCall[];
  workflow?: MizanGelirWorkflowEvent;
}

export interface OfisTurnResponse {
  conversationId: string;
  messages: OfisMessage[];
  active: AgentId[];
  totalCostUsd: number;
}

export interface MizanGelirWorkflowStatusResponse {
  workflow: MizanGelirWorkflowEvent;
  job: any;
  messages: OfisMessage[];
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
    private readonly lucaService: LucaService,
    private readonly gelirTablosuService: GelirTablosuService,
  ) {}

  /**
   * Çoklu evrak ile chat — birden fazla dosyayı sırayla extract edip
   * birleştirilmiş prefix olarak gönderir.
   */
  async sendMessageWithFiles(params: {
    tenantId: string;
    userId: string;
    conversationId?: string;
    text: string;
    files: Array<{ originalName: string; mimeType: string; size: number; buffer: Buffer }>;
  }) {
    const parts: string[] = [];
    for (let i = 0; i < params.files.length; i++) {
      const f = params.files[i];
      const { extracted, method } = await this.extractFile(f);
      parts.push(
        `📎 Evrak ${i + 1}/${params.files.length}: **${f.originalName}** (${this.formatBytes(f.size)}, ${method})\n--- İÇERİK ---\n${extracted}\n--- SON ---`,
      );
    }
    const filesSection = parts.join('\n\n');
    const combinedText = params.text
      ? `${filesSection}\n\nSoru: ${params.text}`
      : `${filesSection}\n\nBu evrak${params.files.length > 1 ? 'ları' : 'ı'} değerlendir — önemli bilgiler, dikkat çeken noktalar, varsa eşleşme/tutarsızlık.`;

    return this.sendMessage({
      tenantId: params.tenantId,
      userId: params.userId,
      conversationId: params.conversationId,
      text: combinedText,
    });
  }

  /** Tek dosyalık extract helper — sendMessageWithFile için */
  private async extractFile(file: { originalName: string; mimeType: string; buffer: Buffer }) {
    let extracted = '';
    let method = 'none';
    try {
      if (file.mimeType.startsWith('image/')) {
        const Tesseract = require('tesseract.js');
        const ocr = await Tesseract.recognize(file.buffer, 'tur+eng', { logger: () => {} });
        extracted = ocr?.data?.text?.trim() || '';
        method = 'ocr';
      } else if (
        file.mimeType.startsWith('text/') ||
        file.mimeType === 'application/csv' ||
        /\.(txt|csv|md)$/i.test(file.originalName)
      ) {
        extracted = file.buffer.toString('utf8').slice(0, 50_000);
        method = 'text';
      } else if (file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.originalName)) {
        const pdfParse = require('pdf-parse');
        const result = await pdfParse(file.buffer, { max: 30 });
        extracted = (result?.text || '').trim();
        if (!extracted) {
          extracted = '[PDF metni boş — taranmış görsel PDF olabilir, PNG olarak yükle]';
          method = 'pdf-empty';
        } else {
          method = `pdf (${result?.numpages || '?'} sayfa)`;
        }
      } else {
        extracted = `[Bilinmeyen tip: ${file.mimeType}]`;
        method = 'unknown';
      }
    } catch (e: any) {
      this.logger.error(`Evrak extract: ${e?.message}`);
      extracted = `[Okunamadı: ${e?.message}]`;
      method = 'error';
    }
    const trimmed = extracted.length > 8000 ? extracted.slice(0, 8000) + '\n\n[...kısaltıldı]' : extracted;
    return { extracted: trimmed, method };
  }

  /**
   * Evrak ile chat — yüklenen dosyayı OCR/extract edip user mesajına prefix
   * olarak ekler, sonra normal sendMessage akışını çalıştırır. AYLİN ve ekip
   * evrakın içeriği görür ve değerlendirir.
   */
  async sendMessageWithFile(params: {
    tenantId: string;
    userId: string;
    conversationId?: string;
    text: string;
    file: {
      originalName: string;
      mimeType: string;
      size: number;
      buffer: Buffer;
    };
  }) {
    const { file, text } = params;
    let extracted = '';
    let extractMethod = 'none';

    try {
      if (file.mimeType.startsWith('image/')) {
        // OCR — tesseract Türkçe + İngilizce
        const Tesseract = require('tesseract.js');
        const ocr = await Tesseract.recognize(file.buffer, 'tur+eng', {
          logger: () => {},
        });
        extracted = ocr?.data?.text?.trim() || '';
        extractMethod = 'ocr';
      } else if (
        file.mimeType.startsWith('text/') ||
        file.mimeType === 'application/csv' ||
        /\.(txt|csv|md)$/i.test(file.originalName)
      ) {
        extracted = file.buffer.toString('utf8').slice(0, 50_000);
        extractMethod = 'text';
      } else if (file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.originalName)) {
        // PDF metnini çıkar — pdf-parse text-only layer'ı okuyabilir.
        // Taranmış (resim) PDF'ler boş metin döner — bu durumda kullanıcıya not.
        const pdfParse = require('pdf-parse');
        const result = await pdfParse(file.buffer, { max: 30 }); // max 30 sayfa
        extracted = (result?.text || '').trim();
        if (!extracted) {
          extracted = '[PDF metni boş — muhtemelen taranmış görsel PDF. Sayfayı PNG olarak yükle OCR yapayım.]';
          extractMethod = 'pdf-empty';
        } else {
          extractMethod = `pdf (${result?.numpages || '?'} sayfa)`;
        }
      } else {
        extracted = `[Bilinmeyen dosya tipi: ${file.mimeType}]`;
        extractMethod = 'unknown';
      }
    } catch (e: any) {
      this.logger.error(`Evrak extract hata: ${e?.message}`);
      extracted = `[İçerik okunamadı: ${e?.message}]`;
      extractMethod = 'error';
    }

    // Çıkarılan metni 8000 karakter ile sınırla (token bütçesi)
    const trimmed = extracted.length > 8000
      ? extracted.slice(0, 8000) + '\n\n[...kısaltıldı]'
      : extracted;

    // Kullanıcının asıl mesajı + evrak içeriği birleştirilir
    const fileSummary = `📎 Evrak yüklendi: **${file.originalName}** (${this.formatBytes(file.size)}, ${extractMethod})\n\n--- EVRAK İÇERİĞİ ---\n${trimmed}\n--- EVRAK SONU ---`;
    const combinedText = text
      ? `${fileSummary}\n\nSoru: ${text}`
      : `${fileSummary}\n\nBu evrakı değerlendirin — önemli bilgiler ve dikkat çeken noktalar nedir?`;

    return this.sendMessage({
      tenantId: params.tenantId,
      userId: params.userId,
      conversationId: params.conversationId,
      text: combinedText,
    });
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

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

    const newMessages: OfisMessage[] = [];
    const userMsg: OfisMessage = {
      agent: 'user',
      content: text,
      ts: new Date().toISOString(),
    };
    newMessages.push(userMsg);

    const workflowTurn = await this.tryStartMizanGelirWorkflow({
      tenantId,
      userId,
      conversationId: conv.id,
      history,
      userMsg,
      text,
    });
    if (workflowTurn) return workflowTurn;

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

  private async tryStartMizanGelirWorkflow(params: {
    tenantId: string;
    userId: string;
    conversationId: string;
    history: OfisMessage[];
    userMsg: OfisMessage;
    text: string;
  }): Promise<OfisTurnResponse | null> {
    if (!this.isMizanGelirWorkflowIntent(params.text)) return null;

    const taxpayerResolution = await this.resolveWorkflowTaxpayer(params.tenantId, params.text);
    if (taxpayerResolution.kind !== 'matched') {
      const options =
        taxpayerResolution.kind === 'ambiguous'
          ? ` Şunlardan hangisi: ${taxpayerResolution.options.map((t) => t.name).join(', ')}?`
          : '';
      const aylin: OfisMessage = {
        agent: 'arda',
        content: `Mizan-gelir tablosu akışını başlatacağım ama mükellefi tek eşleştiremedim.${options} Mükellef adını veya VKN'yi net yazar mısın?`,
        ts: new Date().toISOString(),
      };
      const messages = [params.userMsg, aylin];
      await this.persistConversationMessages(params.conversationId, params.history, messages);
      return {
        conversationId: params.conversationId,
        messages,
        active: ['arda'],
        totalCostUsd: 0,
      };
    }

    const period = this.resolveWorkflowPeriod(params.text);
    if (!period) {
      const aylin: OfisMessage = {
        agent: 'arda',
        content: `Tamam, ${taxpayerResolution.taxpayer.name} için gerçek mizan-gelir tablosu akışını açacağım; dönem net değil. "2026 1. dönem", "2026-Q1" veya "2026-03" gibi yazarsan job'u başlatıyorum.`,
        ts: new Date().toISOString(),
      };
      const messages = [params.userMsg, aylin];
      await this.persistConversationMessages(params.conversationId, params.history, messages);
      return {
        conversationId: params.conversationId,
        messages,
        active: ['arda'],
        totalCostUsd: 0,
      };
    }

    const taxpayer = taxpayerResolution.taxpayer;
    const job = await this.lucaService.createFetchJob({
      tenantId: params.tenantId,
      sessionId: undefined as any,
      mukellefId: taxpayer.id,
      donem: period.donem,
      tip: 'MIZAN',
      createdBy: params.userId,
      mukellefAdi: taxpayer.name,
      priority: 2,
    });
    await this.lucaService
      .appendJobLog(job.id, `Moren Ofis mizan-gelir workflow basladi; donemTipi=${period.donemTipi}`)
      .catch((e: any) => this.logger.warn(`Workflow job log yazilamadi: ${e?.message}`));

    const workflow: MizanGelirWorkflowEvent = {
      kind: 'mizan_gelir_workflow',
      phase: 'queued',
      jobId: job.id,
      status: job.status,
      taxpayerId: taxpayer.id,
      taxpayerName: taxpayer.name,
      donem: period.donem,
      donemTipi: period.donemTipi,
      logs: this.parseLucaJobLogs(job.errorMsg),
    };

    const aylin: OfisMessage = {
      agent: 'arda',
      content: `${taxpayer.name} için ${period.label} mizan çekimini gerçek Luca kuyruğuna açtım. Mizan kaydı oluşmadan Cem analiz yazmayacak; job bitince gelir tablosunu gerçek mizan üzerinden üreteceğim.`,
      ts: new Date().toISOString(),
    };
    const system: OfisMessage = {
      agent: 'system',
      content: 'Luca mizan job oluşturuldu.',
      ts: new Date().toISOString(),
      workflow,
    };
    const messages = [params.userMsg, aylin, system];
    await this.persistConversationMessages(params.conversationId, params.history, messages);

    return {
      conversationId: params.conversationId,
      messages,
      active: ['kayra'],
      totalCostUsd: 0,
    };
  }

  async getMizanGelirWorkflowStatus(params: {
    tenantId: string;
    userId: string;
    jobId: string;
    conversationId?: string;
  }): Promise<MizanGelirWorkflowStatusResponse> {
    const job = await this.lucaService.getJob(params.jobId, params.tenantId);
    const taxpayer = await this.getWorkflowTaxpayerById(params.tenantId, job.mukellefId);
    const period = this.periodFromDonem(job.donem);
    const logs = this.parseLucaJobLogs(job.errorMsg);
    const base: Omit<MizanGelirWorkflowEvent, 'phase'> = {
      kind: 'mizan_gelir_workflow',
      jobId: job.id,
      status: job.status,
      taxpayerId: job.mukellefId,
      taxpayerName: taxpayer?.name || this.extractMetaValue(job.errorMsg, 'mukellefAdi') || undefined,
      donem: job.donem,
      donemTipi: period.donemTipi,
      logs,
    };

    if (job.status === 'failed' || job.status === 'cancelled') {
      const workflow: MizanGelirWorkflowEvent = {
        ...base,
        phase: job.status === 'cancelled' ? 'cancelled' : 'failed',
        error: this.extractWorkflowError(job),
      };
      const messages = await this.appendWorkflowMessagesOnce({
        tenantId: params.tenantId,
        conversationId: params.conversationId,
        jobId: job.id,
        phase: workflow.phase,
        messages: [
          {
            agent: 'system',
            content: job.status === 'cancelled' ? 'Luca mizan job iptal edildi.' : 'Luca mizan job hata verdi.',
            ts: new Date().toISOString(),
            workflow,
          },
        ],
      });
      return { workflow, job, messages };
    }

    if (job.status !== 'done') {
      const workflow: MizanGelirWorkflowEvent = {
        ...base,
        phase: job.status === 'running' ? 'running' : 'queued',
      };
      return { workflow, job, messages: [] };
    }

    const mizan = await (this.prisma as any).mizan.findFirst({
      where: {
        tenantId: params.tenantId,
        taxpayerId: job.mukellefId,
        donem: job.donem,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!mizan) {
      const workflow: MizanGelirWorkflowEvent = {
        ...base,
        phase: 'waiting_mizan',
        error: 'Job done görünüyor ama mizan kaydı henüz bulunamadı.',
      };
      return { workflow, job, messages: [] };
    }

    let gelirTablosu = await (this.prisma as any).gelirTablosu.findFirst({
      where: {
        tenantId: params.tenantId,
        mizanId: mizan.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!gelirTablosu) {
      gelirTablosu = await this.gelirTablosuService.generateFromMizan({
        mizanId: mizan.id,
        tenantId: params.tenantId,
        donemTipi: period.donemTipi || mizan.donemTipi,
        createdBy: params.userId,
      });
    }

    const summary = this.summarizeGelirTablosu(gelirTablosu);
    const workflow: MizanGelirWorkflowEvent = {
      ...base,
      phase: 'completed',
      status: 'done',
      mizanId: mizan.id,
      gelirTablosuId: gelirTablosu.id,
      summary,
    };

    const taxpayerName = workflow.taxpayerName || 'Mükellef';
    const messages = await this.appendWorkflowMessagesOnce({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      jobId: job.id,
      phase: 'completed',
      messages: [
        {
          agent: 'system',
          content: 'Mizan kaydı bulundu ve gelir tablosu hazırlandı.',
          ts: new Date().toISOString(),
          workflow,
        },
        {
          agent: 'cem',
          content: this.buildCemGelirTablosuComment(taxpayerName, period.label, workflow),
          ts: new Date().toISOString(),
        },
      ],
    });

    return { workflow, job, messages };
  }

  private async persistConversationMessages(
    conversationId: string,
    history: OfisMessage[],
    messages: OfisMessage[],
  ) {
    await (this.prisma as any).morenOfisConversation.update({
      where: { id: conversationId },
      data: {
        messages: [...history, ...messages] as any,
        lastActivityAt: new Date(),
      },
    });
  }

  private async appendWorkflowMessagesOnce(params: {
    tenantId: string;
    conversationId?: string;
    jobId: string;
    phase: MizanGelirWorkflowPhase;
    messages: OfisMessage[];
  }): Promise<OfisMessage[]> {
    if (!params.conversationId) return [];
    const conv = await (this.prisma as any).morenOfisConversation.findFirst({
      where: { id: params.conversationId, tenantId: params.tenantId },
      select: { messages: true },
    });
    if (!conv) return [];

    const history = (conv.messages as OfisMessage[] | null) || [];
    const alreadyWritten = history.some(
      (m) =>
        m.workflow?.kind === 'mizan_gelir_workflow' &&
        m.workflow.jobId === params.jobId &&
        m.workflow.phase === params.phase,
    );
    if (alreadyWritten) return [];

    await (this.prisma as any).morenOfisConversation.update({
      where: { id: params.conversationId },
      data: {
        messages: [...history, ...params.messages] as any,
        lastActivityAt: new Date(),
      },
    });
    return params.messages;
  }

  private isMizanGelirWorkflowIntent(text: string): boolean {
    const q = this.normalizeWorkflowText(text);
    const hasMizan = /\bmizan\w*/.test(q);
    const hasGelirTablosu =
      /gelir\s+tablo\w*/.test(q) ||
      /kar\s+zarar/.test(q) ||
      /gelir\s+durum/.test(q);
    const hasAction =
      /\b(cek|cekin|hazirla|hazirlar|olustur|cikar|uretil|yap|degerlendir|degerlendirme)\w*/.test(q);
    return hasMizan && hasGelirTablosu && hasAction;
  }

  private async resolveWorkflowTaxpayer(
    tenantId: string,
    text: string,
  ): Promise<
    | { kind: 'matched'; taxpayer: { id: string; name: string; taxNumber?: string | null } }
    | { kind: 'missing' }
    | { kind: 'ambiguous'; options: Array<{ id: string; name: string; taxNumber?: string | null }> }
  > {
    const taxpayers: Array<{
      id: string;
      companyName: string | null;
      firstName: string | null;
      lastName: string | null;
      taxNumber: string | null;
    }> = await (this.prisma as any).taxpayer.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true },
      take: 1000,
    });

    const normalizedText = this.normalizeWorkflowText(text);
    const textDigits = text.replace(/\D/g, '');

    const scored = taxpayers
      .map((tp) => {
        const name = this.taxpayerDisplayName(tp);
        const phrases = [
          tp.companyName || '',
          [tp.firstName, tp.lastName].filter(Boolean).join(' '),
          name,
        ].filter(Boolean);

        let score = 0;
        if (tp.taxNumber) {
          const taxDigits = String(tp.taxNumber).replace(/\D/g, '');
          if (taxDigits && textDigits.includes(taxDigits)) score = Math.max(score, 120);
        }

        for (const phrase of phrases) {
          const normalizedPhrase = this.normalizeWorkflowText(phrase);
          if (!normalizedPhrase) continue;
          if (normalizedText.includes(normalizedPhrase)) {
            score = Math.max(score, 80 + Math.min(normalizedPhrase.length, 30));
          }
          const tokens = normalizedPhrase.split(' ').filter((t) => t.length >= 4);
          if (tokens.length > 0) {
            const hits = tokens.filter((token) => normalizedText.includes(token)).length;
            if (hits > 0) score = Math.max(score, 20 + hits * 15 + Math.round((hits / tokens.length) * 20));
          }
        }

        return {
          taxpayer: { id: tp.id, name, taxNumber: tp.taxNumber },
          score,
        };
      })
      .filter((item) => item.score >= 25)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return { kind: 'missing' };
    const topScore = scored[0].score;
    const top = scored.filter((item) => topScore - item.score <= 5).slice(0, 5);
    if (top.length === 1) return { kind: 'matched', taxpayer: top[0].taxpayer };
    return { kind: 'ambiguous', options: top.map((item) => item.taxpayer) };
  }

  private resolveWorkflowPeriod(text: string): { donem: string; donemTipi: string; label: string } | null {
    const q = this.normalizeWorkflowText(text);
    const raw = text.toLocaleLowerCase('tr-TR');

    const directQuarter =
      raw.match(/\b(20\d{2})\s*[-/]?\s*q\s*([1-4])\b/i) ||
      q.match(/\b(20\d{2})\s+q\s*([1-4])\b/);
    if (directQuarter) return this.quarterPeriod(directQuarter[1], directQuarter[2]);

    const yearThenQuarter = q.match(/\b(20\d{2})\s+([1-4])\s+(?:donem\w*|ceyrek|gecici)\b/);
    if (yearThenQuarter) return this.quarterPeriod(yearThenQuarter[1], yearThenQuarter[2]);

    const quarterThenYear = q.match(/\b([1-4])\s+(?:donem\w*|ceyrek|gecici)\s+(20\d{2})\b/);
    if (quarterThenYear) return this.quarterPeriod(quarterThenYear[2], quarterThenYear[1]);

    const yearly = q.match(/\b(20\d{2})\s+(?:yillik|yilsonu|yil\s+sonu)\b/);
    if (yearly) {
      return { donem: `${yearly[1]}-YILLIK`, donemTipi: 'YILLIK', label: `${yearly[1]} yıllık` };
    }

    const monthly = raw.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/);
    if (monthly) {
      const donem = `${monthly[1]}-${String(Number(monthly[2])).padStart(2, '0')}`;
      return { donem, donemTipi: 'AYLIK', label: this.periodLabel(donem, 'AYLIK') };
    }

    const months: Record<string, number> = {
      ocak: 1,
      subat: 2,
      mart: 3,
      nisan: 4,
      mayis: 5,
      haziran: 6,
      temmuz: 7,
      agustos: 8,
      eylul: 9,
      ekim: 10,
      kasim: 11,
      aralik: 12,
    };
    const year = q.match(/\b(20\d{2})\b/)?.[1];
    if (year) {
      for (const [monthName, monthNo] of Object.entries(months)) {
        if (q.includes(monthName)) {
          const donem = `${year}-${String(monthNo).padStart(2, '0')}`;
          return { donem, donemTipi: 'AYLIK', label: this.periodLabel(donem, 'AYLIK') };
        }
      }
    }

    return null;
  }

  private periodFromDonem(donem: string): { donem: string; donemTipi: string; label: string } {
    const quarter = donem.match(/^(\d{4})-Q([1-4])$/i);
    if (quarter) return this.quarterPeriod(quarter[1], quarter[2]);
    if (/^\d{4}-YILLIK$/i.test(donem)) {
      const year = donem.slice(0, 4);
      return { donem, donemTipi: 'YILLIK', label: `${year} yıllık` };
    }
    const monthly = donem.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (monthly) return { donem, donemTipi: 'AYLIK', label: this.periodLabel(donem, 'AYLIK') };
    return { donem, donemTipi: 'AYLIK', label: donem };
  }

  private quarterPeriod(year: string, quarter: string): { donem: string; donemTipi: string; label: string } {
    const q = Math.min(Math.max(Number(quarter), 1), 4);
    const donem = `${year}-Q${q}`;
    return { donem, donemTipi: `GECICI_Q${q}`, label: `${year} ${q}. dönem` };
  }

  private periodLabel(donem: string, donemTipi: string): string {
    const quarter = donem.match(/^(\d{4})-Q([1-4])$/i);
    if (quarter) return `${quarter[1]} ${quarter[2]}. dönem`;
    if (donemTipi === 'YILLIK') return `${donem.slice(0, 4)} yıllık`;
    const monthly = donem.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (!monthly) return donem;
    const monthNames = [
      'Ocak',
      'Şubat',
      'Mart',
      'Nisan',
      'Mayıs',
      'Haziran',
      'Temmuz',
      'Ağustos',
      'Eylül',
      'Ekim',
      'Kasım',
      'Aralık',
    ];
    return `${monthNames[Number(monthly[2]) - 1]} ${monthly[1]}`;
  }

  private async getWorkflowTaxpayerById(
    tenantId: string,
    taxpayerId: string,
  ): Promise<{ id: string; name: string; taxNumber?: string | null } | null> {
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId },
      select: { id: true, companyName: true, firstName: true, lastName: true, taxNumber: true },
    });
    if (!taxpayer) return null;
    return { id: taxpayer.id, name: this.taxpayerDisplayName(taxpayer), taxNumber: taxpayer.taxNumber };
  }

  private taxpayerDisplayName(taxpayer: {
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }): string {
    return (
      taxpayer.companyName ||
      [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(' ') ||
      'Mükellef'
    ).trim();
  }

  private summarizeGelirTablosu(gt: any) {
    return {
      netSatislar: this.toNumber(gt?.netSatislar),
      brutSatisKari: this.toNumber(gt?.brutSatisKari),
      faaliyetKari: this.toNumber(gt?.faaliyetKari),
      donemNetKari: this.toNumber(gt?.donemNetKari),
    };
  }

  private buildCemGelirTablosuComment(
    taxpayerName: string,
    label: string,
    workflow: MizanGelirWorkflowEvent,
  ): string {
    const s = workflow.summary || { netSatislar: 0, brutSatisKari: 0, faaliyetKari: 0, donemNetKari: 0 };
    const netLabel = s.donemNetKari >= 0 ? 'dönem net kârı' : 'dönem net zararı';
    return `${taxpayerName} için ${label} gelir tablosu gerçek mizan üzerinden oluştu. Net satış ${this.formatTry(s.netSatislar)}, brüt kâr ${this.formatTry(s.brutSatisKari)}, faaliyet kârı ${this.formatTry(s.faaliyetKari)}, ${netLabel} ${this.formatTry(Math.abs(s.donemNetKari))}. mizanId ${workflow.mizanId}, gelirTablosuId ${workflow.gelirTablosuId}.`;
  }

  private parseLucaJobLogs(errorMsg?: string | null): string[] {
    return String(errorMsg || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('[META]'));
  }

  private extractWorkflowError(job: any): string {
    const logs = this.parseLucaJobLogs(job?.errorMsg);
    const last = [...logs].reverse().find((line) => /(^|\]\s*)X\s+/i.test(line)) || logs[logs.length - 1];
    return last || (job?.status === 'cancelled' ? 'Job iptal edildi.' : 'Job hata verdi.');
  }

  private extractMetaValue(errorMsg: string | null | undefined, key: string): string | null {
    const match = String(errorMsg || '').match(new RegExp(`${key}=([^\\n;]+)`));
    return match?.[1]?.trim() || null;
  }

  private normalizeWorkflowText(value: string): string {
    return String(value || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private toNumber(value: any): number {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num : 0;
  }

  private formatTry(value: number): string {
    const num = Number.isFinite(value) ? value : 0;
    return `${num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
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
    return `Muzaffer Bey'den geldi: "${query}"

Sen AYLİN'sin, ekip lideri kadın baş müşavir. Şu ekip üyelerini bu işe sokuyorsun: ${delegateTo.join(', ').toUpperCase()}.

ÖNEMLİ: "Sordum, bana dönecek" gibi içeriksiz CEVAP YASAK. Bunun yerine:
- Eğer basit selamlama/merhaba ise: doğal cevap ver ("Hoş geldin, ne var ne yok bugün?").
- İş ise: kime gönderdiğini SOMUT söyle + neyi araştırdığını anlat
  ("Cem mizan'a bakıyor, son 3 ayı kıyaslayacak. Nevra da KDV durumunu çıkarıyor").
- Bazen şaka: "Off yine mi KDV? Helal olsun sana :)" — ama iş soruşturmayı atlama.

2-3 cümle, sıcak, doğal. Çok kısa, samimi.`;
  }

  private buildAgentPrompt(query: string, agentId: AgentId): string {
    return `Muzaffer Bey: "${query}"

Sen ${PERSONAS[agentId].displayName}'sin. ${PERSONAS[agentId].expertise.join(' / ')} alanında cevap ver.
2-4 cümle, samimi, mesai arkadaşı havası. Tablo/başlık YOK.`;
  }

  private buildSynthesisPrompt(query: string, responses: OfisMessage[]): string {
    const summary = responses
      .map((r) => `${PERSONAS[r.agent as AgentId].displayName}: ${r.content}`)
      .join('\n\n');
    return `Muzaffer Bey'in sorusu: "${query}"

Ekip ne dedi:
${summary}

Şimdi sen AYLİN olarak topla — 2-3 cümle özet, içinden çıkacak SOMUT
sonuç/eylem (madde madde değil cümle içinde). Ajan adlarını geçirebilirsin
("Cem'in baktığı kadarıyla...") ama her cümleye "X'e göre" yapıştırma.
Samimi, mesai arkadaşı havası.`;
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

  async deleteConversation(tenantId: string, id: string) {
    const result = await (this.prisma as any).morenOfisConversation.deleteMany({
      where: { id, tenantId },
    });
    return { deleted: result.count };
  }

  /**
   * Tool call audit — filter destekli. Filtreler:
   *   tool?: string (tek tool için)
   *   from?: ISO date string
   *   to?: ISO date string
   *   onlyFailures?: boolean
   */
  async getToolAudit(tenantId: string, filters?: {
    tool?: string;
    from?: string;
    to?: string;
    onlyFailures?: boolean;
  }) {
    const where: any = { tenantId };
    if (filters?.tool) where.tool = filters.tool;
    if (filters?.onlyFailures) where.ok = false;
    if (filters?.from || filters?.to) {
      where.ts = {};
      if (filters.from) where.ts.gte = new Date(filters.from);
      if (filters.to) where.ts.lte = new Date(filters.to);
    }

    const recent = await (this.prisma as any).toolCallLog.findMany({
      where,
      orderBy: { ts: 'desc' },
      take: 100,
    });
    const stats = await (this.prisma as any).toolCallLog.groupBy({
      by: ['tool'],
      where,
      _count: { _all: true },
      _avg: { durationMs: true },
      _sum: { resultSize: true },
    });
    const failures = await (this.prisma as any).toolCallLog.count({
      where: { ...where, ok: false },
    });
    const total = await (this.prisma as any).toolCallLog.count({ where });

    // Filtre dropdown'u için tüm distinct tool isimleri
    const allTools = await (this.prisma as any).toolCallLog.findMany({
      where: { tenantId },
      distinct: ['tool'],
      select: { tool: true },
    });

    return {
      recent,
      stats: stats.map((s: any) => ({
        tool: s.tool,
        count: s._count._all,
        avgMs: Math.round(s._avg.durationMs || 0),
        totalBytes: s._sum.resultSize || 0,
      })).sort((a: any, b: any) => b.count - a.count),
      total,
      failures,
      failureRate: total > 0 ? failures / total : 0,
      allTools: allTools.map((t: any) => t.tool).sort(),
    };
  }

  /**
   * Tenant'ın AI maliyet özeti — bugün/bu hafta/toplam.
   * Konuşma mesajlarındaki usage.costUsd alanlarını topluyor.
   * Maliyet kaçağı varsa burada erken yakalanır.
   */
  async getCostSummary(tenantId: string) {
    const rows = await (this.prisma as any).morenOfisConversation.findMany({
      where: { tenantId },
      select: { messages: true, lastActivityAt: true, createdAt: true },
    });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let total = 0, today = 0, week = 0, month = 0;
    let msgCount = 0, totalConv = 0;
    const byAgent: Record<string, number> = {};

    for (const conv of rows) {
      totalConv++;
      const msgs = (conv.messages as any[] | null) || [];
      for (const m of msgs) {
        const cost = m?.usage?.costUsd;
        if (!cost || typeof cost !== 'number') continue;
        msgCount++;
        total += cost;
        const ts = m.ts ? new Date(m.ts) : null;
        if (ts && !isNaN(ts.getTime())) {
          if (ts >= todayStart) today += cost;
          if (ts >= weekStart) week += cost;
          if (ts >= monthStart) month += cost;
        }
        const agent = m.agent || 'unknown';
        byAgent[agent] = (byAgent[agent] || 0) + cost;
      }
    }

    return {
      total, today, week, month, msgCount, totalConv,
      byAgent: Object.entries(byAgent)
        .sort(([, a], [, b]) => b - a)
        .map(([agent, cost]) => ({ agent, cost })),
    };
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
      let ok = false;
      let result: any = null;
      let errorMsg: string | undefined;
      let resultSize = 0;
      try {
        result = await this.tools.execute(tool, input, ctx);
        ok = !result?.error;
        if (!ok) errorMsg = String(result?.error || 'unknown');
        try { resultSize = JSON.stringify(result || {}).length; } catch {}
      } catch (e: any) {
        errorMsg = e?.message || String(e);
        this.logger.warn(`prefetch ${tool}: ${errorMsg}`);
      }
      const durationMs = Date.now() - t0;
      calls.push({ tool, input, ok, durationMs });

      // Audit log — fire and forget, kullanıcı bunu beklemez
      (this.prisma as any).toolCallLog.create({
        data: {
          tenantId,
          caller: 'moren_ofis',
          callerRef: null, // conversation id henüz oluşmamış olabilir, bu çağrı pre-conversation
          agent: null, // prefetch'te genel — ajan-spesifik değil
          tool,
          input,
          ok,
          durationMs,
          resultSize,
          errorMsg: errorMsg || null,
        },
      }).catch((e: any) => this.logger.warn(`ToolCallLog yazılamadı: ${e?.message}`));

      return ok ? result : null;
    };

    // 1) Mükellef adı tespiti — önce list_taxpayers ile arama yap.
    // Tool-executor alan isimleri: { id, isim, tip, vkn_tckn, vergiDairesi, ... }
    const candidateNames = this.extractCompanyCandidates(text);
    let matchedTaxpayer: any = null;
    if (candidateNames.length > 0) {
      const searchTerm = candidateNames[0];
      const result = await runTool('list_taxpayers', { search: searchTerm, limit: 3 });
      const list = result?.taxpayers || result?.items || [];
      if (Array.isArray(list) && list.length > 0) {
        matchedTaxpayer = list[0];
        const name = matchedTaxpayer.isim || '—';
        parts.push(`Mükellef bulundu: ${name} (vergi no ${matchedTaxpayer.vkn_tckn || '—'}).`);
      }
    }

    // 2) Dönem tespiti — tool-executor bazı tool'larda 'donem', bazılarında
    //    'period' kullanıyor. Aşağıda her tool için doğru alan adıyla geçiyoruz.
    const donem = this.extractPeriod(text);

    // 3) KDV — donem alanı (KdvControlOutput.donem ile eşleşmesi şart)
    if (matchedTaxpayer && /\bkdv\b/.test(lower)) {
      const result = await runTool('get_kdv_summary', {
        taxpayerId: matchedTaxpayer.id,
        donem,
      });
      if (result && !result.error) {
        parts.push(`KDV özeti (${donem}): ${this.summarizeKdv(result)}`);
      }
    }

    // 4) Mizan dönemleri
    if (matchedTaxpayer && /\bmizan\b/.test(lower)) {
      const result = await runTool('list_mizan_periods', { taxpayerId: matchedTaxpayer.id });
      const periods = result?.periods || result?.donemler || [];
      if (Array.isArray(periods) && periods.length > 0) {
        const labels = periods.slice(0, 3).map((p: any) => p.donem || p);
        parts.push(`Mizan son dönemler: ${labels.join(', ')}.`);
      }
    }

    // 5) Fatura sayısı
    if (matchedTaxpayer && /(fatura|belge)/.test(lower)) {
      const result = await runTool('list_invoices', { taxpayerId: matchedTaxpayer.id, limit: 5 });
      if (result && !result.error) {
        const items = result.invoices || result.faturalar || result.items || [];
        if (Array.isArray(items)) {
          parts.push(`Sistemde ${items.length} son fatura kaydı görünüyor.`);
        }
      }
    }

    // 6) Vergi takvimi — get_tax_calendar input.period kullanıyor
    if (/(takvim|son gün|deadline|beyanname tarihi)/.test(lower)) {
      const result = await runTool('get_tax_calendar', { period: donem });
      if (result && !result.error) {
        const txt = typeof result === 'string' ? result : (result.summary || JSON.stringify(result).slice(0, 200));
        parts.push(`Vergi takvimi (${donem}): ${txt}`);
      }
    }

    return {
      toolContext: parts.length > 0 ? parts.join('\n\n') : '',
      toolCalls: calls,
    };
  }

  /**
   * KDV özetini tek cümleye sıkıştırır. tool-executor get_kdv_summary çıktısı:
   *   { aktifSeanslar: [{donem, tip, status, lucaKayitSayisi, faturaSayisi,
   *     lucaToplamKdv, eslesen, kismiEslesen, eslesmeyen}, ...],
   *     arsivler: [{donem, tip, tamEslesen, ...}] }
   */
  private summarizeKdv(data: any): string {
    if (!data || typeof data !== 'object') return 'veri yok';
    const fmt = (n: any) => {
      const num = Number(n);
      return isFinite(num) ? num.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : '—';
    };
    const sessions = Array.isArray(data.aktifSeanslar) ? data.aktifSeanslar : [];
    const archives = Array.isArray(data.arsivler) ? data.arsivler : [];

    if (sessions.length === 0 && archives.length === 0) return 'kayıt yok';

    if (sessions.length > 0) {
      // En son aktif seans
      const s = sessions[0];
      const parts: string[] = [];
      parts.push(`${s.tip || 'KDV'} seansı ${s.status || ''}`.trim());
      if (s.lucaKayitSayisi !== undefined) parts.push(`Luca ${s.lucaKayitSayisi} kayıt`);
      if (s.faturaSayisi !== undefined) parts.push(`${s.faturaSayisi} fatura`);
      if (s.lucaToplamKdv) parts.push(`KDV ${fmt(s.lucaToplamKdv)} TL`);
      if (s.eslesen !== undefined) parts.push(`${s.eslesen} eşleşen`);
      return parts.join(', ');
    }

    const a = archives[0];
    return `arşivde ${a.tip || ''} kontrol: ${a.tamEslesen || 0} tam, ${a.kismiEslesen || 0} kısmi, ${a.eslesmeyen || 0} eşleşmeyen`;
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
