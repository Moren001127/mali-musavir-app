/**
 * GERÇEK ARAÇ-YÜRÜTME (Max aboneliği) — Claude Agent SDK'nın in-process MCP araç
 * desteğiyle. claudeTextViaMax "prefetch-only / araçsız" iken bu, modele portal
 * araçlarını GERÇEKTEN çağırma, sonucu görme, ZİNCİRLEME ve ona göre cevap verme
 * yeteneği verir (API'ye düşmeden, CLAUDE_CODE_OAUTH_TOKEN ile).
 *
 * Tasarım: DI gerektirmez; çağıran taraf araç tanımlarını (Anthropic JSON-Schema
 * biçimi) + bir executeTool(name, input) callback'i geçer. Yazma araçları için
 * canWrite(name, input) ile onay kapısı uygulanır (yoksa salt-okunur sayılır).
 *
 * BAYRAK: Bu yol yalnız MOREN_AI_AGENT_TOOLS=1 iken devreye alınır (çağıran tarafta).
 */
import { z } from 'zod';

const _esmImport: (m: string) => Promise<any> = new Function('m', 'return import(m)') as any;
let _sdk: any = null;
async function loadSdk(): Promise<any> {
  if (!_sdk) _sdk = await _esmImport('@anthropic-ai/claude-agent-sdk');
  return _sdk;
}

export interface AgentToolDef {
  name: string;
  description?: string;
  input_schema?: any; // Anthropic JSON-Schema (properties/required/type)
  write?: boolean;    // yazma/işlem aracı mı? (onay kapısına tabi)
}

export interface MaxAgentResult {
  ok: boolean;
  text: string;
  model: string;
  toolCalls: Array<{ name: string; input: any }>;
  costUsd: number;
  error?: string;
}

/** JSON-Schema (tek seviye) → zod raw shape. SDK tool() bir ZodRawShape ister. */
function jsonTypeToZod(def: any): z.ZodTypeAny {
  const t = def?.type;
  if (Array.isArray(def?.enum) && def.enum.length) return z.enum(def.enum as [string, ...string[]]);
  if (t === 'string') return z.string();
  if (t === 'number' || t === 'integer') return z.number();
  if (t === 'boolean') return z.boolean();
  if (t === 'array') return z.array(jsonTypeToZod(def?.items || { type: 'string' }));
  if (t === 'object') return z.object(jsonSchemaToZodShape(def)).passthrough();
  return z.any();
}
function jsonSchemaToZodShape(schema: any): Record<string, z.ZodTypeAny> {
  const props = (schema && schema.properties) || {};
  const required = new Set<string>((schema && schema.required) || []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, def] of Object.entries(props)) {
    let zt = jsonTypeToZod(def);
    if (!required.has(key)) zt = zt.optional();
    shape[key] = zt;
  }
  return shape;
}

/**
 * Modeli portal araçlarıyla gerçek araç-yürütme döngüsünde çalıştırır.
 * Dönen text, model'in (araçları çağırıp sonuçlarını gördükten sonra) ürettiği FINAL cevaptır.
 */
export async function runMaxAgent(params: {
  systemPrompt?: string;
  userMessage: string;
  tools: AgentToolDef[];
  executeTool: (name: string, input: any) => Promise<any>;
  /** Yazma aracı için onay: {allow:true} ya da {allow:false, message}. Yoksa write araç çağrısı reddedilir. */
  canWrite?: (name: string, input: any) => Promise<{ allow: boolean; message?: string }>;
  model?: string;
  maxTurns?: number;
  timeoutMs?: number;
  serverName?: string;
}): Promise<MaxAgentResult> {
  const model = params.model || 'claude-sonnet-4-6';
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) return { ok: false, text: '', model, toolCalls: [], costUsd: 0, error: 'CLAUDE_CODE_OAUTH_TOKEN yok — Max bağlı değil.' };
  if (!params.userMessage || !params.userMessage.trim()) {
    return { ok: false, text: '', model, toolCalls: [], costUsd: 0, error: 'userMessage boş.' };
  }

  const serverName = params.serverName || 'portal';
  const toolCalls: Array<{ name: string; input: any }> = [];
  const writeByName = new Map(params.tools.map((t) => [t.name, !!t.write]));

  const sdk = await loadSdk();
  const { query, createSdkMcpServer, tool } = sdk;

  // Her portal aracını in-process SDK aracına sar; handler executeTool'a köprüler.
  const sdkTools = params.tools.map((t) =>
    tool(
      t.name,
      String(t.description || t.name).slice(0, 1000),
      jsonSchemaToZodShape(t.input_schema),
      async (args: any) => {
        try {
          toolCalls.push({ name: t.name, input: args });
          const result = await params.executeTool(t.name, args || {});
          const text = typeof result === 'string' ? result : JSON.stringify(result);
          return { content: [{ type: 'text', text: text.slice(0, 60000) }] };
        } catch (e: any) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: e?.message || 'arac hatasi' }) }], isError: true };
        }
      },
    ),
  );

  const mcpServer = createSdkMcpServer({ name: serverName, version: '1.0.0', tools: sdkTools });
  const allowedTools = params.tools.map((t) => `mcp__${serverName}__${t.name}`);

  // Yazma araçları için onay kapısı (canUseTool). Salt-okunur araçlar serbest.
  const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    const bare = toolName.replace(`mcp__${serverName}__`, '');
    if (!writeByName.get(bare)) return { behavior: 'allow' as const, updatedInput: input };
    if (!params.canWrite) return { behavior: 'deny' as const, message: 'Bu işlem onay gerektirir; şu an devre dışı.' };
    const verdict = await params.canWrite(bare, input).catch(() => ({ allow: false, message: 'onay hatasi' }));
    return verdict.allow
      ? { behavior: 'allow' as const, updatedInput: input }
      : { behavior: 'deny' as const, message: verdict.message || 'İşlem onaylanmadı.' };
  };

  // İzole Max OAuth env (API key'e düşmesin).
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') childEnv[k] = v;
  for (const drop of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) delete childEnv[drop];
  childEnv.CLAUDE_CODE_OAUTH_TOKEN = token;

  const abort = new AbortController();
  const HARD_MS = Math.max(8000, Number(params.timeoutMs || Number(process.env.MOREN_AI_AGENT_HARD_MS) || 60000));
  let hardTimedOut = false;
  const hardTimer = setTimeout(() => { hardTimedOut = true; try { abort.abort(); } catch {} }, HARD_MS);

  let text = '';
  let costUsd = 0;
  let isError = false;
  let resultError = '';
  try {
    for await (const m of query({
      prompt: params.userMessage,
      options: {
        model,
        systemPrompt: params.systemPrompt,
        mcpServers: { [serverName]: mcpServer },
        allowedTools,
        canUseTool,
        maxTurns: params.maxTurns ?? 8,
        env: childEnv,
        abortController: abort,
      },
    })) {
      if (m?.type === 'assistant') {
        // Her turda metin birikebilir; FINAL text en son assistant bloğudur.
        let turnText = '';
        for (const block of m.message?.content || []) {
          if (block?.type === 'text') turnText += block.text;
        }
        if (turnText.trim()) text = turnText;
      } else if (m?.type === 'result') {
        isError = Boolean(m.is_error);
        if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
        if (isError) {
          resultError = [m?.subtype, m?.error, typeof m?.result === 'string' ? m.result : '']
            .filter(Boolean).join(' | ').slice(0, 500);
        }
        if (typeof m?.result === 'string' && m.result.trim() && !text.trim()) text = m.result;
        break;
      }
    }
  } catch (e: any) {
    clearTimeout(hardTimer);
    return { ok: false, text: '', model, toolCalls, costUsd: 0, error: hardTimedOut ? `Max ${HARD_MS}ms icinde yanit vermedi (arac dongusu takildi)` : (e?.message || 'Agent SDK (Max) arac calismasi basarisiz.') };
  }
  clearTimeout(hardTimer);

  text = String(text || '').trim();
  if (isError && !text) {
    return { ok: false, text: '', model, toolCalls, costUsd, error: resultError ? `Agent SDK (Max) hata: ${resultError}` : 'Agent SDK (Max) hata döndü.' };
  }
  return { ok: true, text, model, toolCalls, costUsd };
}
