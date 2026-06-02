import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ToolExecutorService } from '../moren-ai/tool-executor.service';
import { MOREN_AI_TOOLS } from '../moren-ai/tools';
import { logAiUsage } from '../common/ai-usage-logger';
import { MAX_MODEL_CHEAP } from '../common/max-inference';
import { LucaService } from '../luca/luca.service';

/**
 * LUCA OPERATÖRÜ — Max aboneliği (ücretsiz) + ARAÇLI beyin, AKIŞLI (streaming) cevap.
 *
 * Agent SDK (CLAUDE_CODE_OAUTH_TOKEN) üzerinde çalışır → token başına fatura YOK.
 * Mevcut `ToolExecutorService` (47 aracın tek beyni) tek "portal" yönlendirici aracı
 * üzerinden Max çağrısına bağlanır — araç beyni ÇOĞALTILMAZ.
 *
 * FAZ 1 GÜVENLİK: sadece OKUMA + onaylı komut (ALLOWED_TOOLS). Luca'ya yazma YOK.
 * Dosya/bash gibi yerleşik SDK araçları canUseTool ile kapalı.
 *
 * AKIŞ: includePartialMessages ile token token metin + araç adımları emit edilir
 * (frontend canlı gösterir; bekleme hissi azalır).
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
const MODEL_CHEAP = MAX_MODEL_CHEAP; // claude-haiku-4-5 — kısa/basit sorular (hız)
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

/** Akış olayı — frontend'e SSE ile gider. */
export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'done'; model: string; toolUses: Array<{ name: string; args: any }>; durationMs: number }
  | { type: 'error'; error: string };

@Injectable()
export class LucaOperatorService {
  private readonly logger = new Logger('LucaOperatorService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: ToolExecutorService,
    private readonly luca: LucaService,
  ) {}

  /** LUCA OPERATÖRÜ — o an açık Luca ekranını oku (EKRAN_OKU işi + sonucu yokla). */
  private async readLucaScreen(ctx: { tenantId: string; userId?: string | null }): Promise<any> {
    let job: any;
    try {
      job = await this.luca.createScreenReadJob(ctx.tenantId, { createdBy: ctx.userId || undefined });
    } catch (e: any) {
      return { ok: false, error: 'Ekran okuma işi oluşturulamadı: ' + (e?.message || e) };
    }
    const jobId = job?.id;
    if (!jobId) return { ok: false, error: 'Ekran okuma işi oluşturulamadı.' };
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const r = await this.luca.getScreenSnapshot(jobId, ctx.tenantId).catch(() => null);
      if (r && r.status === 'done' && r.snapshot) return { ok: true, ekran: r.snapshot };
      if (r && r.status === 'failed') return { ok: false, error: r.errorMsg || 'ekran okunamadı' };
    }
    return {
      ok: false,
      error: 'Ekran okunamadı (zaman aşımı). Chrome\'da Luca açık ve Moren Agent çalışıyor mu? Tekrar dener misin?',
    };
  }

  private pickModel(text: string): string {
    const t = text || '';
    if (CRITICAL_PATTERNS.some((p) => p.test(t))) return MODEL_CRITICAL;
    // Çok kısa / selamlama / sohbet → hızlı model (Haiku)
    if (t.trim().length <= 40 && !/(mizan|kdv|beyan|fatura|defter|sgk|m[uü]kellef|cari|bilan[cç]o|tahsilat|ajan)/i.test(t)) {
      return MODEL_CHEAP;
    }
    return MODEL_DEFAULT;
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

  private buildSystemPrompt(voiceMode?: boolean): string {
    const base = [
      'Sen Moren Mali Müşavirlik portalının "Luca Operatörü" adlı AI çalışanısın. Sahip: Muzaffer Ören.',
      'Kullanıcı (mali müşavir veya personel) ile Türkçe konuşur, portal verisini okur ve istenen işleri hazırlarsın.',
      'ŞU AN (Faz 1): Luca\'ya doğrudan YAZMA/işlem yapma yeteneğin YOK. Sadece veri okur, durum analizi yapar,',
      've mevcut Luca veri-çekme işlerini önizleyip (preview_agent_command) onayla tetikleyebilirsin.',
      'Portal verisi için "portal" aracını çağır: name=araç adı, args=parametre nesnesi. Sonucu yorumla.',
      'Luca\'da O AN AÇIK ekranı görmek için: portal({ name: "luca_ekran_oku" }) — mükellef/dönem gerekmez; kullanıcının Chrome\'undaki açık Luca ekranını okur (0-15 sn sürebilir). Dönen "ekran" (frames/fields/buttons/text) verisini yorumla. Kullanıcı "Luca\'da ne görüyorsun / ekrana bak" derse bunu kullan.',
      'Cevabını GEREKSİZ uzatma; net ve kısa tut. Emin değilsen veya bilgi eksikse ASLA varsayma — kullanıcıya kısa bir soru sor.',
      'Kritik mali/hukuki konularda (beyanname, KDV, mizan, tahakkuk) en yüksek doğrulukla çalış; görmediğini görmüş gibi söyleme.',
      'Mükellef PII (şifre, token, TC, IBAN) sızdırma, loglama.',
      '',
      '## Kullanabileceğin portal araçları',
      this.buildToolCatalog(),
    ].join('\n');
    if (!voiceMode) return base;
    // Sesli sohbet: kısa, doğal konuşma; ekranda okunup seslendirilecek.
    return (
      base +
      '\n\n## SESLİ MOD (karşılıklı konuşma)\n' +
      'Cevabın ÇOK KISA olsun (en fazla 1-3 cümle), doğal konuşma dilinde. ' +
      'Madde işareti, başlık, markdown ve EMOJİ KULLANMA — düz cümle yaz (sesli okunacak). ' +
      'Uzun liste/açıklama verme; gerekirse "detayını ekranda göstereyim mi?" diye kısaca sor.'
    );
  }

  /**
   * Max + araçlı AKIŞLI sohbet. Her metin parçası/araç adımı `emit` ile gönderilir.
   * Konuşma geçmişi istekte taşınır (Railway'de kalıcı oturum yok).
   */
  async chatStream(
    params: { tenantId: string; userId?: string | null; message: string; history?: ChatHistoryItem[]; voiceMode?: boolean },
    emit: (e: StreamEvent) => void,
  ): Promise<void> {
    const tenantId = params.tenantId || 'default';
    const message = (params.message || '').trim();
    const model = this.pickModel(message);
    const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;

    if (!token) {
      emit({ type: 'error', error: 'Max aboneliği bağlı değil (CLAUDE_CODE_OAUTH_TOKEN yok).' });
      return;
    }
    if (!message) {
      emit({ type: 'error', error: 'Mesaj boş olamaz.' });
      return;
    }

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

      const portalTool = sdk.tool(
        'portal',
        'Moren portal veri/durum aracı. name=araç adı, args=parametre nesnesi. ' +
          'Yalnızca sistem mesajında listelenen araç adları geçerlidir. ' +
          'Örnek: {"name":"get_mizan","args":{"taxpayerId":"...","period":"2026-05"}}.',
        { name: z.string(), args: z.record(z.any()).optional() },
        async (a: { name: string; args?: any }) => {
          const toolName = String(a?.name || '');
          // Özel: Luca'da o an açık ekranı oku (EKRAN_OKU işi → snapshot)
          if (toolName === 'luca_ekran_oku') {
            toolUses.push({ name: toolName, args: {} });
            emit({ type: 'tool', name: toolName });
            const r = await this.readLucaScreen(ctx);
            return { content: [{ type: 'text', text: JSON.stringify(r) }] };
          }
          if (!ALLOWED_TOOLS.has(toolName)) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Bu araç operatöre kapalı (Faz 1): ${toolName}` }) }] };
          }
          toolUses.push({ name: toolName, args: a?.args || {} });
          emit({ type: 'tool', name: toolName });
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
          systemPrompt: this.buildSystemPrompt(params.voiceMode),
          mcpServers: { portal: server },
          allowedTools: [PORTAL_TOOL],
          canUseTool,
          maxTurns: 12,
          includePartialMessages: true,
          env: childEnv,
        },
      })) {
        if (m?.type === 'stream_event') {
          const ev = m.event;
          if (ev?.type === 'content_block_delta' && ev?.delta?.type === 'text_delta') {
            const t = ev.delta.text || '';
            if (t) {
              answer += t;
              emit({ type: 'text', delta: t });
            }
          }
        } else if (m?.type === 'result') {
          isError = Boolean(m.is_error);
          if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
        }
      }
    } catch (e: any) {
      this.logger.error(`Luca operatör (Max) akış hatası: ${e?.message || e}`);
      emit({ type: 'error', error: e?.message || 'Agent SDK (Max) çağrısı başarısız.' });
      return;
    }

    const durationMs = Date.now() - started;
    await logAiUsage(this.prisma, {
      tenantId,
      source: 'luca-operator-max',
      model,
      fixedCostUsd: costUsd,
      karar: isError ? 'error' : 'ok',
      durationMs,
    }).catch(() => undefined);

    if (isError && !answer.trim()) {
      emit({ type: 'error', error: 'Agent SDK (Max) sonucu hata döndü.' });
      return;
    }
    emit({ type: 'done', model, toolUses, durationMs });
  }
}
