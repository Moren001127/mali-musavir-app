import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ToolExecutorService } from '../moren-ai/tool-executor.service';
import { MOREN_AI_TOOLS } from '../moren-ai/tools';
import { logAiUsage } from '../common/ai-usage-logger';

/**
 * LUCA OPERATÖRÜ — Max aboneliği (ücretsiz) + ARAÇLI beyin.
 *
 * Agent SDK (CLAUDE_CODE_OAUTH_TOKEN) üzerinde çalışır → token başına fatura YOK.
 * Mevcut `ToolExecutorService` (47 aracın tek beyni) tek bir "portal" yönlendirici
 * aracı üzerinden Max çağrısına bağlanır — araç beyni ÇOĞALTILMAZ.
 *
 * FAZ 1 GÜVENLİK: sadece OKUMA araçları + onaylı komut açık (ALLOWED_TOOLS).
 * Luca'ya doğrudan yazma YOK. Dosya/bash gibi yerleşik SDK araçları canUseTool ile kapalı.
 */

// ESM-only Agent SDK'yı CommonJS NestJS içine güvenli yükle (calisan.service ile aynı desen).
const _esmImport: (m: string) => Promise<any> = new Function('m', 'return import(m)') as any;
let _sdk: any = null;
async function loadSdk(): Promise<any> {
  if (!_sdk) _sdk = await _esmImport('@anthropic-ai/claude-agent-sdk');
  return _sdk;
}

const MODEL_CRITICAL = 'claude-opus-4-8';
const MODEL_DEFAULT = 'claude-sonnet-4-6';
const CRITICAL_PATTERNS: RegExp[] = [
  /beyanname|tahakkuk|muhtasar|muhsgk|geçici vergi|gecici vergi|kurumlar|kdv\s?[12]/i,
  /mizan|bilanço|bilanco|gelir tablosu|e-?defter|yevmiye|denetim/i,
  /tevkifat|mutabakat|matrah|amortisman|tarhiyat/i,
];

// SDK in-process MCP araç adı: mcp__<server>__<tool>
const PORTAL_TOOL = 'mcp__portal__portal';

// FAZ 1 — operatöre açık araçlar (OKUMA + onaylı komut). Luca'ya yazma yok.
const ALLOWED_TOOLS = new Set<string>([
  'list_taxpayers', 'get_taxpayer', 'list_taxpayers_monthly_status',
  'list_mizan_periods', 'get_mizan', 'get_gelir_tablosu', 'get_bilanco',
  'get_kdv_summary', 'list_invoices', 'get_payroll_summary', 'list_sgk_declarations',
  'list_documents', 'get_tax_calendar', 'compare_periods', 'calculate_financial_ratios',
  'search_all', 'list_beyan_kayitlari', 'get_beyan_ozet', 'get_beyanname_readiness_summary',
  'get_beyanname_config', 'get_agent_status', 'get_luca_agent_jobs', 'get_mihsap_agent_jobs',
  'get_operation_briefing', 'get_taxpayer_work_status', 'get_collection_risk_summary',
  'get_portal_capability_map', 'search_ai_memory',
  'preview_agent_command', 'create_confirmed_agent_command',
]);

interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class LucaOperatorService {
  private readonly logger = new Logger('LucaOperatorService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: ToolExecutorService,
  ) {}

  private pickModel(text: string): string {
    return CRITICAL_PATTERNS.some((p) => p.test(text || '')) ? MODEL_CRITICAL : MODEL_DEFAULT;
  }

  /** Açık araçların kısa kataloğu — sistem promptuna gömülür (MOREN_AI_TOOLS'tan üretilir). */
  private buildToolCatalog(): string {
    return MOREN_AI_TOOLS.filter((t) => ALLOWED_TOOLS.has(t.name))
      .map((t) => {
        const props = t.input_schema?.properties || {};
        const req = t.input_schema?.required || [];
        const params = Object.keys(props);
        const pstr = params.length
          ? ` [param: ${params.map((p) => (req.includes(p) ? `${p}*` : p)).join(', ')}]`
          : '';
        const desc = (t.description || '').split('.')[0].slice(0, 160);
        return `- ${t.name}: ${desc}${pstr}`;
      })
      .join('\n');
  }

  private buildSystemPrompt(): string {
    return [
      'Sen Moren Mali Müşavirlik portalının "Luca Operatörü" adlı AI çalışanısın. Sahip: Muzaffer Ören.',
      'Kullanıcı (mali müşavir veya personel) ile Türkçe konuşur, portal verisini okur ve istenen işleri hazırlarsın.',
      'ŞU AN (Faz 1): Luca\'ya doğrudan YAZMA/işlem yapma yeteneğin YOK. Sadece veri okur, durum analizi yapar,',
      've mevcut Luca veri-çekme işlerini önizleyip (preview_agent_command) onayla tetikleyebilirsin.',
      'Portal verisi için "portal" aracını çağır: name=araç adı, args=parametre nesnesi. Sonucu yorumla.',
      'Emin değilsen veya bilgi eksikse ASLA varsayma — kullanıcıya kısa, net bir soru sor.',
      'Kritik mali/hukuki konularda (beyanname, KDV, mizan, tahakkuk) en yüksek doğrulukla çalış; görmediğini görmüş gibi söyleme.',
      'Mükellef PII (şifre, token, TC, IBAN) sızdırma, loglama. Cevapların kısa ve net olsun.',
      '',
      '## Kullanabileceğin portal araçları',
      this.buildToolCatalog(),
    ].join('\n');
  }

  /**
   * Max + araçlı sohbet. Konuşma geçmişi istekte taşınır (Railway'de kalıcı oturum yok).
   * Başarısızsa ok:false döner; frontend kullanıcıya bildirir (API'ye DÜŞMEZ — ücret çıkmasın).
   */
  async chat(params: {
    tenantId: string;
    userId?: string | null;
    message: string;
    history?: ChatHistoryItem[];
  }): Promise<{
    ok: boolean;
    assistantMessage: string;
    toolUses: Array<{ name: string; args: any }>;
    model: string;
    durationMs?: number;
    error?: string;
  }> {
    const tenantId = params.tenantId || 'default';
    const message = (params.message || '').trim();
    const model = this.pickModel(message);
    const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;

    if (!token) {
      return {
        ok: false,
        assistantMessage: '',
        toolUses: [],
        model,
        error:
          'Max aboneliği bağlı değil (CLAUDE_CODE_OAUTH_TOKEN yok). Operatör beyni Max ile çalışır; ' +
          'Railway env\'inde token tanımlı olmalı.',
      };
    }
    if (!message) {
      return { ok: false, assistantMessage: '', toolUses: [], model, error: 'Mesaj boş olamaz.' };
    }

    // Konuşma geçmişi → prompt (son 12 tur)
    const hist = (params.history || [])
      .filter((h) => h && h.content)
      .slice(-12)
      .map((h) => `${h.role === 'user' ? 'Kullanıcı' : 'Sen (operatör)'}: ${h.content}`)
      .join('\n');
    const prompt = hist
      ? `## Önceki konuşma\n${hist}\n\n## Kullanıcının yeni mesajı\n${message}`
      : message;

    // İZOLE AUTH: subprocess Max OAuth token kullansın; ANTHROPIC_* düşür.
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') childEnv[k] = v;
    }
    for (const drop of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
      delete childEnv[drop];
    }
    childEnv.CLAUDE_CODE_OAUTH_TOKEN = token;

    const ctx = { tenantId, userId: params.userId ?? null };
    const started = Date.now();
    let answer = '';
    const toolUses: Array<{ name: string; args: any }> = [];
    let costUsd = 0;
    let isError = false;

    try {
      const sdk = await loadSdk();

      // Tek "portal" yönlendirici aracı — mevcut ToolExecutorService'e delege eder.
      const portalTool = sdk.tool(
        'portal',
        'Moren portal veri/durum aracı. name=araç adı, args=parametre nesnesi. ' +
          'Yalnızca sistem mesajında listelenen araç adları geçerlidir. ' +
          'Örnek: {"name":"get_mizan","args":{"taxpayerId":"...","period":"2026-05"}}.',
        { name: z.string(), args: z.record(z.any()).optional() },
        async (a: { name: string; args?: any }) => {
          const toolName = String(a?.name || '');
          if (!ALLOWED_TOOLS.has(toolName)) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: `Bu araç operatöre kapalı (Faz 1): ${toolName}` }) }],
            };
          }
          toolUses.push({ name: toolName, args: a?.args || {} });
          const result = await this.tools.execute(toolName, a?.args || {}, ctx);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        },
      );

      const server = sdk.createSdkMcpServer({ name: 'portal', version: '1.0.0', tools: [portalTool] });

      // Güvenlik: yalnızca portal aracı açık; dosya/bash vb. yerleşik araçlar kapalı.
      const canUseTool = async (toolName: string, input: any) => {
        if (toolName === PORTAL_TOOL) return { behavior: 'allow', updatedInput: input };
        return { behavior: 'deny', message: 'Bu araç operatöre kapalı.' };
      };

      const query = sdk.query;
      for await (const m of query({
        prompt,
        options: {
          model,
          systemPrompt: this.buildSystemPrompt(),
          mcpServers: { portal: server },
          allowedTools: [PORTAL_TOOL],
          canUseTool,
          maxTurns: 14,
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
      this.logger.error(`Luca operatör (Max) çağrısı başarısız: ${e?.message || e}`);
      return { ok: false, assistantMessage: '', toolUses, model, error: e?.message || 'Agent SDK (Max) çağrısı başarısız.' };
    }

    const durationMs = Date.now() - started;
    // Maliyet Max kotasından düşer (token başına fatura DEĞİL); görünürlük için logla.
    await logAiUsage(this.prisma, {
      tenantId,
      source: 'luca-operator-max',
      model,
      fixedCostUsd: costUsd,
      karar: isError ? 'error' : 'ok',
      durationMs,
    }).catch(() => undefined);

    answer = answer.trim();
    if (isError && !answer) {
      return { ok: false, assistantMessage: '', toolUses, model, durationMs, error: 'Agent SDK (Max) sonucu hata döndü.' };
    }
    return { ok: true, assistantMessage: answer || '(boş yanıt)', toolUses, model, durationMs };
  }
}
