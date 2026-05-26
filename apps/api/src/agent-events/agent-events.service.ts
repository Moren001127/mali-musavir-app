import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { logAiUsage } from '../common/ai-usage-logger';
import { profileToPromptText } from '../common/profile-prompt';
import { SISTEM_KURALLARI } from '../common/sistem-kurallari';
import { VendorMemoryService } from '../vendor-memory/vendor-memory.service';
import { PendingDecisionsService } from '../pending-decisions/pending-decisions.service';
import { WhatsAppQrService } from '../whatsapp-qr/whatsapp-qr.service';
import {
  commandClaimAgentsForRunner,
  commandListAgentsForFilter,
  getAgentRegistry,
} from './agent-registry';

type MihsapDecisionMode = 'shadow' | 'balanced' | 'claude_only';
type MihsapOcrProvider = 'auto' | 'azure' | 'mistral' | 'none';
type MihsapCheapModelProvider = 'auto' | 'gemini' | 'openai';

interface MihsapOcrTextResult {
  provider: string;
  text: string;
  fallbackReason?: string;
}

interface MihsapCheapDecisionResult {
  provider: string;
  model: string;
  ocrProvider: string;
  confidence: number | null;
  parsed: any | null;
  rawText?: string;
  fallbackReason?: string;
}

export interface AgentEventInput {
  agent: string;
  action?: string;
  status: string;
  message?: string;
  mukellef?: string;
  firma?: string;
  fisNo?: string;
  tutar?: number;
  hesapKodu?: string;
  kdv?: string;
  meta?: any;
  ts?: string | Date;
}

@Injectable()
export class AgentEventsService {
  private readonly faturaDecisionCache = new Map<string, { expiresAt: number; value: any }>();
  private readonly largeMetaKeyRe =
    /base64|image|gorsel|screenshot|html|pdf|buffer|raw|content|icerik|ocr|runtime/i;

  private readonly logger = new Logger(AgentEventsService.name);

  constructor(
    private prisma: PrismaService,
    private vendorMemory: VendorMemoryService,
    private pendingDecisions: PendingDecisionsService,
    private whatsappQr: WhatsAppQrService,  // @Global module — circular dep yaratmaz
  ) {}

  private getMihsapDecisionMode(): MihsapDecisionMode {
    const value = String(process.env.MIHSAP_DECISION_MODE || 'balanced').toLowerCase();
    if (value === 'balanced' || value === 'claude_only' || value === 'shadow') return value;
    return 'balanced';
  }

  private getMihsapOcrProvider(): MihsapOcrProvider {
    const value = String(process.env.MIHSAP_OCR_PROVIDER || 'auto').toLowerCase();
    if (value === 'azure' || value === 'mistral' || value === 'none' || value === 'auto') return value;
    return 'auto';
  }

  private getMihsapCheapModelProvider(): MihsapCheapModelProvider {
    const value = String(process.env.MIHSAP_CHEAP_MODEL_PROVIDER || 'auto').toLowerCase();
    if (value === 'gemini' || value === 'openai' || value === 'auto') return value;
    return 'auto';
  }

  private hasMihsapCheapModelKey(): boolean {
    const provider = this.getMihsapCheapModelProvider();
    return (
      (provider !== 'openai' && !!process.env.GEMINI_API_KEY) ||
      (provider !== 'gemini' && !!process.env.OPENAI_API_KEY)
    );
  }

  private getMihsapMinConfidence(): number {
    const parsed = Number(process.env.MIHSAP_MIN_CONFIDENCE || 0.82);
    if (!Number.isFinite(parsed)) return 0.82;
    return Math.min(0.98, Math.max(0.5, parsed));
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private stripDataUrlBase64(value: string): string {
    return String(value || '').replace(/^data:[^;]+;base64,/i, '').trim();
  }

  private extractJsonCandidates(text: string): string[] {
    const candidates: string[] = [];
    const codeBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlock) candidates.push(codeBlock[1]);
    const greedy = text.match(/\{[\s\S]*\}/);
    if (greedy) candidates.push(greedy[0]);
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'));
    candidates.push(...lines);
    return [...new Set(candidates)];
  }

  private parseFirstJsonObject(text: string): any | null {
    for (const candidate of this.extractJsonCandidates(text || '')) {
      try {
        return JSON.parse(candidate);
      } catch {}
    }
    return null;
  }

  private normalizeDecisionDate(value: any): string {
    const raw = String(value || '').trim();
    const m = raw.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
    if (!m) return '';
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${dd}.${mm}.${yyyy}`;
  }

  private normalizeDecisionNo(value: any): string {
    return String(value || '')
      .toLocaleUpperCase('tr-TR')
      .replace(/[^A-Z0-9]/g, '')
      .trim();
  }

  private normalizeDecisionBelgeTuru(value: any): string {
    const raw = String(value || '')
      .toLocaleUpperCase('tr-TR')
      .replace(/[İI]/g, 'I')
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!raw) return '';
    if (raw.includes('E_ARSIV') || raw.includes('EARSIV') || raw.includes('ARSIV')) return 'E_ARSIV';
    if (raw.includes('E_FATURA') || raw.includes('EFATURA')) return 'E_FATURA';
    if (raw.includes('YAZARKASA') || raw.includes('OKC') || raw === 'FIS' || raw.includes('_FIS')) return 'FIS';
    if (raw.includes('IRSALIYE')) return 'IRSALIYE';
    if (raw.includes('FATURA') || raw === 'FAT') return 'FATURA';
    return raw;
  }

  private decisionBelgeTuruMatches(actual: any, expected: any): boolean {
    const a = this.normalizeDecisionBelgeTuru(actual);
    const e = this.normalizeDecisionBelgeTuru(expected);
    if (!a || !e) return false;
    if (a === e) return true;
    const faturaSet = new Set(['FATURA', 'E_FATURA', 'E_ARSIV']);
    return faturaSet.has(a) && faturaSet.has(e);
  }

  private getMihsapVendorRuleMinOnay(): number {
    const parsed = Number(process.env.MIHSAP_VENDOR_RULE_MIN_ONAY || 5);
    if (!Number.isFinite(parsed)) return 5;
    return Math.min(50, Math.max(3, Math.floor(parsed)));
  }

  private extractAccountCode(value: any): string {
    const match = String(value || '').match(/\b\d{3}(?:\.\d{1,3}){1,4}\b/);
    return match?.[0] || '';
  }

  private pickPrimaryFaturaAccount(codes: string[]): string {
    const values = (codes || []).map((code) => String(code || '').trim()).filter(Boolean);
    const isAccount = (code: string) => !!this.extractAccountCode(code);
    const isAuxiliary = (code: string) => /^(191|391|120|320|100|101|102|103|108|121|321|309|329|331|335|336)\./.test(
      this.extractAccountCode(code),
    );
    return values.find((code) => isAccount(code) && !isAuxiliary(code)) || values.find(isAccount) || values[0] || '';
  }

  private normalizeRuleText(value: any): string {
    return String(value || '')
      .slice(0, 24000)
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i')
      .replace(/[^a-z0-9%.,\s/-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private parseRuleMoney(value: any): number {
    if (typeof value === 'number') return value;
    const raw = String(value || '').replace(/[^\d,.-]/g, '').trim();
    if (!raw) return NaN;
    const comma = raw.lastIndexOf(',');
    const dot = raw.lastIndexOf('.');
    if (comma > dot) return Number(raw.replace(/\./g, '').replace(',', '.'));
    return Number(raw.replace(/,/g, ''));
  }

  private hasStrongVehiclePurchaseText(text: any): boolean {
    const normalized = this.normalizeRuleText(text);
    if (normalized.length < 20) return false;
    return [
      /sasi\s*(no|numara|numarasi)?/,
      /sase\s*(no|numara|numarasi)?/,
      /motor\s*(no|numara|numarasi)/,
      /model\s*yili/,
      /otv\s+matrah/,
      /hesaplanan\s+otv/,
      /gumruk\s+(beyanname|makbuz|idare)/,
      /sap\s+fatura/,
      /tescil|ruhsat/,
      /arac\s+(satis|alim|teslim|bedel)/,
      /tasit\s+(satis|alim|teslim|bedel)/,
      /binek\s+oto|otomobil|kamyonet|minibus|motosiklet|traktor/,
      /\b(peugeot|rifter|bluehdi|hdi|renault|toyota|hyundai|volkswagen|mercedes|bmw|audi|fiat|citroen|opel|nissan)\b/,
    ].some((re) => re.test(normalized));
  }

  private detectProfileFirmaManualRule(profile: any, firma: any): string | null {
    const firmaNorm = this.normalizeRuleText(firma);
    if (!firmaNorm || firmaNorm.length < 4) return null;
    const raw = String(profile?.firmaOzelTalimatlar || '');
    if (!raw.trim()) return null;
    const firmWords = firmaNorm.split(' ').filter((w) => w.length >= 4).slice(0, 4);
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = this.normalizeRuleText(rawLine);
      if (line.length < 8) continue;
      const firmMatch = firmWords.some((word) => line.includes(word)) || line.includes(firmaNorm.slice(0, 18));
      if (!firmMatch) continue;
      if (/otomatik\s+(onaylama|f2\s*yapma)|manuel|elle\s+isle|onay\s+bekliyor|atla|beklet/.test(line)) {
        return `Profil firma ozel kurali: ${rawLine.trim().slice(0, 160)}`;
      }
    }
    return null;
  }

  private detectFaturaVehiclePurchaseRisk(input: {
    action?: string;
    firma?: any;
    tutar?: any;
    primaryAccount?: any;
    faturaText?: any;
  }): string | null {
    const isAlis = ['isle_alis', 'isle_alis_isletme'].includes(String(input.action || ''));
    if (!isAlis) return null;

    const account = this.extractAccountCode(input.primaryAccount);
    const amount = this.parseRuleMoney(input.tutar);
    const sellerText = this.normalizeRuleText(input.firma);
    const invoiceText = this.normalizeRuleText(input.faturaText);
    const sellerOrText = `${sellerText} ${invoiceText}`;
    const automotiveSeller = /otomotiv|motorlu|oto\s|cetas|peugeot|renault|toyota|hyundai|volkswagen|honda|mercedes|bmw|audi|fiat|citroen|opel|nissan|ford/.test(sellerOrText);
    const suspiciousExpenseAccount = !account || /^(740|760|770|150|153|157)\./.test(account);

    if (this.hasStrongVehiclePurchaseText(input.faturaText)) {
      return 'Kural tabanli risk: tasit/otomobil alimi sinyali var; amortisman gerektirebilir, otomatik F2 yapilmaz';
    }
    if (automotiveSeller && Number.isFinite(amount) && amount >= 200000 && suspiciousExpenseAccount) {
      return `Kural tabanli risk: otomotiv tedarikcisi + yuksek tutar (${Math.round(amount).toLocaleString('tr-TR')} TL); ${account || 'hesap kodu yok'} ile otomatik gider yazilmaz`;
    }
    return null;
  }

  private analyzeFreeFaturaContent(text: any): { available: boolean; risk: boolean; sebep?: string } {
    if (this.hasStrongVehiclePurchaseText(text)) {
      return {
        available: true,
        risk: true,
        sebep: 'Kural tabanli icerik riski: tasit/demirbas/sabit kiymet ifadesi gorundu; otomatik F2 yapilmaz',
      };
    }
    const raw = String(text || '').slice(0, 20000);
    const normalized = raw
      .toLocaleLowerCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ı/g, 'i')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized.length < 40) return { available: false, risk: false };

    const allowedVehicleExpense = [
      /arac\s+bakim/,
      /bakim\s+onarim/,
      /servis\s+hizmeti/,
      /motor\s+yag/,
      /akaryakit|motorin|benzin|yakit/,
      /nakliye|tasima|lojistik|sefer\s+bedeli/,
      /otopark|hgs|ogs|lastik/,
    ].some((re) => re.test(normalized));

    const riskyAsset = [
      /arac\s+(satis|alim|bedel|teslim)/,
      /tasit\s+(satis|alim|bedel|teslim)/,
      /binek\s+oto|otomobil|kamyon|kamyonet|minibus|motosiklet|traktor/,
      /sifir\s+arac|ikinci\s+el\s+arac|2\.?\s*el\s+arac/,
      /bilgisayar|laptop|notebook|telefon|yazici|printer|tablet/,
      /mobilya|masa|sandalye|koltuk|dolap/,
      /klima|kombi|televizyon|buzdolabi/,
      /makine|tezgah|kompresor|jenerator|ekipman|cihaz/,
    ].some((re) => re.test(normalized));

    if (riskyAsset && !allowedVehicleExpense) {
      return {
        available: true,
        risk: true,
        sebep: 'Kural tabanli icerik riski: tasit/demirbas/sabit kiymet ifadesi gorundu; otomatik F2 yapilmaz',
      };
    }
    return { available: true, risk: false };
  }

  private classifyClaudeApiError(status: number, body: string) {
    const text = String(body || '').replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    const isBilling =
      status === 402 ||
      lower.includes('credit') ||
      lower.includes('billing') ||
      lower.includes('balance') ||
      lower.includes('quota');
    const isRateLimit = status === 429 || lower.includes('rate limit') || lower.includes('too many requests');
    const code = isBilling ? 'claude_billing_or_quota' : isRateLimit ? 'claude_rate_limit' : `claude_api_${status}`;
    const prefix = isBilling
      ? 'Claude API kredi/kota hatasi'
      : isRateLimit
        ? 'Claude API rate limit hatasi'
        : 'Claude API hatasi';
    return {
      code,
      userMessage: `${prefix} (${status}): ${text.slice(0, 120)}`,
      logMessage: `${prefix} (${status})`,
    };
  }

  private decisionValuesDiffer(a: any, b: any): boolean {
    const av = a == null ? '' : JSON.stringify(a);
    const bv = b == null ? '' : JSON.stringify(b);
    return av !== bv;
  }

  private buildMihsapShadowDiff(kind: 'fatura' | 'isletme', cheap: any, claude: any): any | null {
    if (!cheap || !claude) return null;
    const fields =
      kind === 'fatura'
        ? ['karar', 'onerilenler', 'belgeNo', 'tarih', 'kdvOrani', 'ocrToplam', 'ocrMatrah', 'ocrKdvTutari']
        : ['emin', 'kayitTuru', 'altTuru', 'belgeNo', 'tarih', 'kdvOrani', 'ocrToplam', 'ocrMatrah', 'ocrKdvTutari'];
    const changed = fields.filter((field) => this.decisionValuesDiffer(cheap[field], claude[field]));
    if (changed.length === 0) return null;
    return {
      changed,
      cheap: Object.fromEntries(fields.map((field) => [field, cheap[field] ?? null])),
      claude: Object.fromEntries(fields.map((field) => [field, claude[field] ?? null])),
    };
  }

  private async logMihsapShadowDiff(
    source: string,
    input: { tenantId?: string; mukellefId?: string; mukellef?: string; belgeNo?: string },
    diff: any,
    cheap?: MihsapCheapDecisionResult | null,
  ) {
    if (!diff) return;
    await logAiUsage(this.prisma, {
      tenantId: input.tenantId || 'unknown',
      taxpayerId: input.mukellefId || null,
      source,
      model: cheap?.model || 'shadow',
      mukellef: input.mukellef,
      belgeNo: input.belgeNo,
      karar: 'shadow_diff',
      sebep: `changed=${(diff.changed || []).join(',').slice(0, 120)}`,
      cacheHit: true,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  }

  private async runMihsapImageOcr(
    input: {
      faturaImageBase64: string;
      faturaImageMediaType?: string;
      tenantId?: string;
      mukellefId?: string;
      mukellef?: string;
      belgeNo?: string;
    },
    source: string,
  ): Promise<MihsapOcrTextResult | null> {
    const provider = this.getMihsapOcrProvider();
    if (provider === 'none') return null;

    const failures: string[] = [];
    const tryMistral = provider === 'auto' || provider === 'mistral';
    const tryAzure = provider === 'auto' || provider === 'azure';

    if (tryMistral && process.env.MISTRAL_API_KEY) {
      try {
        const started = Date.now();
        const text = await this.runMistralOcr(input.faturaImageBase64, input.faturaImageMediaType);
        if (text.trim().length >= 30) {
          await logAiUsage(this.prisma, {
            tenantId: input.tenantId || 'unknown',
            taxpayerId: input.mukellefId || null,
            source,
            model: 'mistral-ocr-latest',
            mukellef: input.mukellef,
            belgeNo: input.belgeNo,
            karar: 'ocr_ok',
            sebep: 'mihsap OCR text extracted',
            durationMs: Date.now() - started,
            fixedCostUsd: 0.002,
            usage: { input_tokens: 0, output_tokens: 0 },
          });
          return { provider: 'mistral-ocr', text };
        }
        failures.push('mistral_empty');
      } catch (e: any) {
        failures.push(`mistral:${e?.message || 'error'}`);
      }
    }

    if (tryAzure && process.env.AZURE_VISION_KEY && process.env.AZURE_VISION_ENDPOINT) {
      try {
        const started = Date.now();
        const text = await this.runAzureReadOcr(input.faturaImageBase64, input.faturaImageMediaType);
        if (text.trim().length >= 30) {
          await logAiUsage(this.prisma, {
            tenantId: input.tenantId || 'unknown',
            taxpayerId: input.mukellefId || null,
            source,
            model: 'azure-read',
            mukellef: input.mukellef,
            belgeNo: input.belgeNo,
            karar: 'ocr_ok',
            sebep: 'mihsap OCR text extracted',
            durationMs: Date.now() - started,
            fixedCostUsd: 0.0015,
            usage: { input_tokens: 0, output_tokens: 0 },
          });
          return { provider: 'azure-read', text, fallbackReason: failures.join('; ') || undefined };
        }
        failures.push('azure_empty');
      } catch (e: any) {
        failures.push(`azure:${e?.message || 'error'}`);
      }
    }

    return failures.length ? { provider: 'none', text: '', fallbackReason: failures.join('; ') } : null;
  }

  private async runMistralOcr(base64: string, mediaType = 'image/jpeg'): Promise<string> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error('MISTRAL_API_KEY yok');
    const clean = this.stripDataUrlBase64(base64);
    const dataUrl = `data:${mediaType || 'image/jpeg'};base64,${clean}`;
    const res = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mistral-ocr-latest',
        document: { type: 'image_url', image_url: dataUrl },
        include_image_base64: false,
      }),
    });
    if (!res.ok) throw new Error(`Mistral OCR ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const json = await res.json();
    const pages = Array.isArray(json?.pages) ? json.pages : [];
    const text = pages
      .map((page: any) => page?.markdown || page?.text || '')
      .filter(Boolean)
      .join('\n\n');
    return text || json?.text || '';
  }

  private async runAzureReadOcr(base64: string, mediaType = 'image/jpeg'): Promise<string> {
    const key = process.env.AZURE_VISION_KEY;
    const endpoint = String(process.env.AZURE_VISION_ENDPOINT || '').replace(/\/+$/, '');
    if (!key || !endpoint) throw new Error('Azure Vision env yok');
    const buffer = Buffer.from(this.stripDataUrlBase64(base64), 'base64');
    const analyze = await fetch(`${endpoint}/vision/v3.2/read/analyze`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': mediaType || 'application/octet-stream',
      },
      body: buffer as any,
    });
    if (!analyze.ok) throw new Error(`Azure Read ${analyze.status}: ${(await analyze.text()).slice(0, 120)}`);
    const operationLocation = analyze.headers.get('operation-location');
    if (!operationLocation) throw new Error('Azure operation-location yok');

    for (let i = 0; i < 18; i += 1) {
      await this.sleep(650);
      const poll = await fetch(operationLocation, {
        headers: { 'Ocp-Apim-Subscription-Key': key },
      });
      if (!poll.ok) throw new Error(`Azure poll ${poll.status}`);
      const json = await poll.json();
      const status = String(json?.status || '').toLowerCase();
      if (status === 'succeeded') {
        const pages = json?.analyzeResult?.readResults || [];
        return pages
          .flatMap((page: any) => (page?.lines || []).map((line: any) => line?.text || ''))
          .filter(Boolean)
          .join('\n');
      }
      if (status === 'failed') throw new Error('Azure Read failed');
    }
    throw new Error('Azure Read timeout');
  }

  private async callMihsapCheapModel(
    kind: 'fatura' | 'isletme',
    input: { tenantId?: string; mukellefId?: string; mukellef?: string; belgeNo?: string },
    system: string,
    userText: string,
    ocr: MihsapOcrTextResult,
    maxTokens: number,
  ): Promise<MihsapCheapDecisionResult | null> {
    if (!ocr.text || ocr.text.trim().length < 80) {
      return {
        provider: 'none',
        model: 'none',
        ocrProvider: ocr.provider,
        confidence: null,
        parsed: null,
        fallbackReason: ocr.fallbackReason || 'ocr_text_short',
      };
    }

    const provider = this.getMihsapCheapModelProvider();
    const failures: string[] = [];
    const prompt = `${userText}

Ucuz karar modu: goruntu yerine asagidaki OCR metnini kullan. Emin degilsen guveni dusuk ver ve tahmin etme.
JSON'a mutlaka "confidence": 0-1 ekle.

OCR METNI:
${ocr.text.slice(0, 14000)}`;

    const tryGemini = provider === 'auto' || provider === 'gemini';
    const tryOpenAi = provider === 'auto' || provider === 'openai';

    if (tryGemini && process.env.GEMINI_API_KEY) {
      try {
        const started = Date.now();
        const model = process.env.MIHSAP_GEMINI_MODEL || 'gemini-2.5-flash-lite';
        const result = await this.callGeminiJson(model, system, prompt, maxTokens);
        await logAiUsage(this.prisma, {
          tenantId: input.tenantId || 'unknown',
          taxpayerId: input.mukellefId || null,
          source: kind === 'fatura' ? 'mihsap-fatura-cheap' : 'mihsap-isletme-cheap',
          model,
          mukellef: input.mukellef,
          belgeNo: input.belgeNo,
          karar: result.parsed?.karar || (result.parsed?.emin === true ? 'onay' : 'emin_degil'),
          sebep: `[ocr=${ocr.provider}] ${result.parsed?.sebep || 'cheap decision'}`.slice(0, 200),
          durationMs: Date.now() - started,
          usage: result.usage,
        });
        return {
          provider: 'gemini',
          model,
          ocrProvider: ocr.provider,
          confidence: this.extractCheapConfidence(result.parsed),
          parsed: result.parsed,
          rawText: result.rawText,
          fallbackReason: ocr.fallbackReason,
        };
      } catch (e: any) {
        failures.push(`gemini:${e?.message || 'error'}`);
      }
    }

    if (tryOpenAi && process.env.OPENAI_API_KEY) {
      try {
        const started = Date.now();
        const model = process.env.MIHSAP_OPENAI_MODEL || 'gpt-5.4-nano';
        const result = await this.callOpenAiJson(model, system, prompt, maxTokens);
        await logAiUsage(this.prisma, {
          tenantId: input.tenantId || 'unknown',
          taxpayerId: input.mukellefId || null,
          source: kind === 'fatura' ? 'mihsap-fatura-cheap' : 'mihsap-isletme-cheap',
          model,
          mukellef: input.mukellef,
          belgeNo: input.belgeNo,
          karar: result.parsed?.karar || (result.parsed?.emin === true ? 'onay' : 'emin_degil'),
          sebep: `[ocr=${ocr.provider}] ${result.parsed?.sebep || 'cheap decision'}`.slice(0, 200),
          durationMs: Date.now() - started,
          usage: result.usage,
        });
        return {
          provider: 'openai',
          model,
          ocrProvider: ocr.provider,
          confidence: this.extractCheapConfidence(result.parsed),
          parsed: result.parsed,
          rawText: result.rawText,
          fallbackReason: ocr.fallbackReason,
        };
      } catch (e: any) {
        failures.push(`openai:${e?.message || 'error'}`);
      }
    }

    return {
      provider: 'none',
      model: 'none',
      ocrProvider: ocr.provider,
      confidence: null,
      parsed: null,
      fallbackReason: [...failures, ocr.fallbackReason].filter(Boolean).join('; ') || 'cheap_model_unavailable',
    };
  }

  private async callGeminiJson(
    model: string,
    system: string,
    prompt: string,
    maxTokens: number,
  ): Promise<{ parsed: any | null; rawText: string; usage: any }> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY yok');
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0,
            maxOutputTokens: maxTokens,
          },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const json = await res.json();
    const rawText = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '';
    const parsed = this.parseFirstJsonObject(rawText);
    return {
      parsed,
      rawText,
      usage: {
        input_tokens: json?.usageMetadata?.promptTokenCount || 0,
        output_tokens: json?.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  }

  private async callOpenAiJson(
    model: string,
    system: string,
    prompt: string,
    maxTokens: number,
  ): Promise<{ parsed: any | null; rawText: string; usage: any }> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY yok');
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        max_output_tokens: maxTokens,
        text: { format: { type: 'json_object' } },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const json = await res.json();
    const rawText =
      json?.output_text ||
      (Array.isArray(json?.output)
        ? json.output
            .flatMap((item: any) => item?.content || [])
            .map((item: any) => item?.text || '')
            .join('')
        : '');
    return {
      parsed: this.parseFirstJsonObject(rawText),
      rawText,
      usage: {
        input_tokens: json?.usage?.input_tokens || 0,
        output_tokens: json?.usage?.output_tokens || 0,
      },
    };
  }

  private extractCheapConfidence(parsed: any): number | null {
    const direct = Number(parsed?.confidence);
    if (Number.isFinite(direct)) return Math.max(0, Math.min(1, direct));
    const nested = Number(parsed?.confidence?.overall || parsed?.confidence?.genel);
    if (Number.isFinite(nested)) return Math.max(0, Math.min(1, nested));
    return null;
  }

  private async tryMihsapCheapFaturaDecision(
    input: {
      faturaImageBase64: string;
      faturaImageMediaType?: string;
      tenantId?: string;
      mukellefId?: string;
      mukellef?: string;
      belgeNo?: string;
      faturaTarihi?: string;
      bosAlanSecenekleri?: { matrahKodlari?: string[]; kdvKodlari?: string[]; cariKodlari?: string[] };
      firma?: string;
      action?: string;
    },
    system: string,
    userText: string,
    rule: any,
    allowClaudeOnlyFallback = false,
  ): Promise<MihsapCheapDecisionResult | null> {
    if (!allowClaudeOnlyFallback && this.getMihsapDecisionMode() === 'claude_only') return null;
    if (!this.hasMihsapCheapModelKey()) return null;
    const ocr = await this.runMihsapImageOcr(input, 'mihsap-fatura-ocr');
    if (!ocr) return null;
    const cheap = await this.callMihsapCheapModel('fatura', input, system, userText, ocr, input.bosAlanSecenekleri ? 900 : 650);
    if (cheap?.parsed?.onerilenler && input.bosAlanSecenekleri) {
      cheap.parsed.onerilenler = this.applyCariPolicyToOneriler(cheap.parsed.onerilenler, input, rule?.profile);
      cheap.parsed.onerilenler = this.sanitizeHesapKoduOnerileri(cheap.parsed.onerilenler, input.bosAlanSecenekleri);
    }
    return cheap;
  }

  private isCheapFaturaAcceptable(
    cheap: MihsapCheapDecisionResult | null | undefined,
    input: { belgeNo?: string; faturaTarihi?: string; belgeTuru?: string; bosAlanSecenekleri?: any },
    vendorHint: any,
  ): boolean {
    if (!cheap?.parsed) return false;
    if ((cheap.confidence ?? 0) < this.getMihsapMinConfidence()) return false;
    if (input.bosAlanSecenekleri) return false;
    if (vendorHint) return false;
    if (cheap.parsed.karar !== 'onay') return false;
    const expectedNo = this.normalizeDecisionNo(input.belgeNo);
    const actualNo = this.normalizeDecisionNo(cheap.parsed.belgeNo);
    if (expectedNo && !actualNo) return false;
    if (expectedNo && actualNo && expectedNo !== actualNo) return false;
    const expectedDate = this.normalizeDecisionDate(input.faturaTarihi);
    const actualDate = this.normalizeDecisionDate(cheap.parsed.tarih);
    if (expectedDate && !actualDate) return false;
    if (expectedDate && actualDate && expectedDate !== actualDate) return false;
    const expectedBelgeTuru = this.normalizeDecisionBelgeTuru(input.belgeTuru);
    const actualBelgeTuru = this.normalizeDecisionBelgeTuru(cheap.parsed.belgeTuru);
    if (expectedBelgeTuru && !actualBelgeTuru) return false;
    if (expectedBelgeTuru && actualBelgeTuru && !this.decisionBelgeTuruMatches(actualBelgeTuru, expectedBelgeTuru)) return false;
    return true;
  }

  private finalizeCheapFaturaDecision(
    cheap: MihsapCheapDecisionResult,
    input: {
      faturaTarihi?: string;
      belgeNo?: string;
      belgeTuru?: string;
      faturaTuru?: string;
      tutar?: number | string;
      hesapKodlari: string[];
      firmaKimlikNo?: string;
      firma?: string;
      mukellefId?: string;
    },
    decisionCacheKey: string,
    ekranKategoriAdayi: string,
  ) {
    const parsed = { ...(cheap.parsed || {}) };
    const memoryCategory = this.resolveFaturaMemoryCategory(parsed, ekranKategoriAdayi);
    parsed.decisionProvider = cheap.provider;
    parsed.ocrProvider = cheap.ocrProvider;
    parsed.fallbackReason = cheap.fallbackReason || null;
    parsed.cheapConfidence = cheap.confidence;
    parsed.aiCallReason = 'cheap_model';
    parsed.decisionTrace = {
      belge: {
        tarih: parsed.tarih || null,
        belgeNo: parsed.belgeNo || null,
        cari: parsed.cari || null,
        belgeTuru: parsed.belgeTuru || null,
        kdvOrani: parsed.kdvOrani ?? null,
        ocrToplam: parsed.ocrToplam ?? null,
        ocrMatrah: parsed.ocrMatrah ?? null,
        ocrKdvTutari: parsed.ocrKdvTutari ?? null,
      },
      ekran: {
        tarih: input.faturaTarihi || null,
        belgeNo: input.belgeNo || null,
        belgeTuru: input.belgeTuru || null,
        faturaTuru: input.faturaTuru || null,
        tutar: input.tutar ?? null,
        hesapKodlari: input.hesapKodlari || [],
      },
      karar: {
        sonuc: parsed.karar,
        sebep: parsed.sebep || null,
        icerikSinifi: parsed.icerikSinifi || null,
        memoryCategory: memoryCategory || null,
        vendorHintUsed: false,
      },
    };
    if (parsed.karar === 'onay' && memoryCategory) {
      parsed.faturaDecisionCandidate = {
        kararTipi: 'fatura',
        hesapKodu: memoryCategory,
        firmaKimlikNo: input.firmaKimlikNo || null,
        firmaUnvan: input.firma || null,
        taxpayerId: input.mukellefId || null,
      };
    }
    this.faturaDecisionCache.set(decisionCacheKey, {
      expiresAt: Date.now() + 6 * 60 * 60 * 1000,
      value: parsed,
    });
    return parsed;
  }

  private async tryMihsapCheapIsletmeDecision(
    input: {
      faturaImageBase64: string;
      faturaImageMediaType?: string;
      tenantId?: string;
      mukellefId?: string;
      mukellef?: string;
      belgeNo?: string;
    },
    system: string,
    userText: string,
    allowClaudeOnlyFallback = false,
  ): Promise<MihsapCheapDecisionResult | null> {
    if (!allowClaudeOnlyFallback && this.getMihsapDecisionMode() === 'claude_only') return null;
    if (!this.hasMihsapCheapModelKey()) return null;
    const ocr = await this.runMihsapImageOcr(input, 'mihsap-isletme-ocr');
    if (!ocr) return null;
    return this.callMihsapCheapModel('isletme', input, system, userText, ocr, 700);
  }

  private isCheapIsletmeAcceptable(
    cheap: MihsapCheapDecisionResult | null | undefined,
    input: { kayitTuruOptions: string[]; altTuruOptions: string[] },
    vendorHint: any,
  ): boolean {
    const parsed = cheap?.parsed;
    if (!parsed) return false;
    if ((cheap.confidence ?? 0) < this.getMihsapMinConfidence()) return false;
    if (vendorHint) return false;
    if (parsed.emin !== true) return false;
    if (/diger|diğer/i.test(String(parsed.kayitTuru || ''))) return false;
    if (/diger|diğer/i.test(String(parsed.altTuru || ''))) return false;
    const inKayit = input.kayitTuruOptions.length === 0 || input.kayitTuruOptions.includes(parsed.kayitTuru);
    const altListeVar = input.altTuruOptions && input.altTuruOptions.length > 0;
    const inAlt = !altListeVar || input.altTuruOptions.includes(parsed.altTuru);
    return inKayit && inAlt;
  }

  private sanitizeMetaForStorage(value: any, depth = 0, key = ''): any {
    if (value == null) return value;
    if (depth > 4) return '[truncated-depth]';

    if (typeof value === 'string') {
      const limit = this.largeMetaKeyRe.test(key) ? 500 : 1200;
      if (value.length <= limit) return value;
      return `${value.slice(0, limit)}...[truncated ${value.length - limit} chars]`;
    }

    if (typeof value === 'number' || typeof value === 'boolean') return value;

    if (Array.isArray(value)) {
      const max = 30;
      const arr = value
        .slice(0, max)
        .map((item, index) => this.sanitizeMetaForStorage(item, depth + 1, `${key}.${index}`));
      if (value.length > max) arr.push(`[truncated ${value.length - max} items]`);
      return arr;
    }

    if (typeof value === 'object') {
      const out: Record<string, any> = {};
      const entries = Object.entries(value).slice(0, 50);
      for (const [childKey, childValue] of entries) {
        if (this.largeMetaKeyRe.test(childKey) && typeof childValue === 'string') {
          out[childKey] = this.sanitizeMetaForStorage(childValue, depth + 1, childKey);
        } else {
          out[childKey] = this.sanitizeMetaForStorage(childValue, depth + 1, childKey);
        }
      }
      const extra = Object.keys(value).length - entries.length;
      if (extra > 0) out.__truncatedKeys = extra;
      return out;
    }

    return String(value).slice(0, 500);
  }

  private lightEventSelect() {
    return {
      id: true,
      tenantId: true,
      agent: true,
      action: true,
      status: true,
      message: true,
      mukellef: true,
      firma: true,
      fisNo: true,
      tutar: true,
      hesapKodu: true,
      kdv: true,
      meta: true,
      ts: true,
    } as const;
  }

  private publicEventMeta(meta: any) {
    if (!meta || typeof meta !== 'object') return null;
    return this.sanitizeMetaForStorage(meta);
  }

  async createEvent(tenantId: string, input: AgentEventInput) {
    // Status normalizasyonu — ajan tarafı eski sürümlerde 'ok'/'skip'/'error' gönderiyordu.
    // DB şeması ve UI filter 'onaylandi'/'atlandi'/'hata' değerlerini bekliyor.
    // Hem eski hem yeni ajanlardan gelen kayıtlar aynı kanonik değere map edilsin ki
    // "Yapılan İşlemler" sayfasındaki filtreler ve sayaçlar doğru çalışsın.
    const STATUS_MAP: Record<string, string> = {
      ok: 'onaylandi',
      onay: 'onaylandi',
      onaylandi: 'onaylandi',
      basarili: 'basarili',
      skip: 'atlandi',
      atla: 'atlandi',
      atlandi: 'atlandi',
      error: 'hata',
      hata: 'hata',
      info: 'bilgi',
      bilgi: 'bilgi',
    };
    const rawStatus = String(input.status || '').toLowerCase();
    const normalizedStatus = STATUS_MAP[rawStatus] || input.status;

    // tutar boş string veya NaN gelirse null yap
    let normalizedTutar: number | null = null;
    if (input.tutar != null && input.tutar !== ('' as any)) {
      const n = Number(input.tutar);
      if (Number.isFinite(n)) normalizedTutar = n;
    }

    const safeMeta = this.sanitizeMetaForStorage(input.meta);

    const event = await this.prisma.agentEvent.create({
      data: {
        tenantId,
        agent: input.agent,
        action: input.action,
        status: normalizedStatus,
        message: input.message,
        mukellef: input.mukellef,
        firma: input.firma,
        fisNo: input.fisNo,
        tutar: normalizedTutar,
        hesapKodu: input.hesapKodu,
        kdv: input.kdv,
        meta: safeMeta ?? undefined,
        ts: input.ts ? new Date(input.ts) : new Date(),
      },
    });
    if (input.agent === 'mihsap' && normalizedStatus === 'onaylandi') {
      const recorded = await this.recordFaturaMemoryAfterSuccessfulSave(tenantId, { ...input, meta: safeMeta }).catch(() => false);
      if (recorded) {
        await this.prisma.agentEvent.update({
          where: { id: event.id },
          data: { memoryImportedAt: new Date() },
        }).catch(() => {});
      }
    }
    return event;
  }

  private async recordFaturaMemoryAfterSuccessfulSave(tenantId: string, input: AgentEventInput) {
    const meta = input.meta || {};
    const rawCandidates = Array.isArray(meta.memoryCandidates)
      ? meta.memoryCandidates
      : [meta.faturaDecisionCandidate || meta.memoryCandidate || { kararTipi: meta.kararTipi || 'fatura' }];
    let recorded = false;
    for (const candidate of rawCandidates.filter(Boolean)) {
      const kararTipi = candidate?.kararTipi || meta.kararTipi || 'fatura';
      if (kararTipi !== 'fatura' && kararTipi !== 'isletme') continue;

      const firmaKimlikNo = meta.firmaKimlikNo || candidate?.firmaKimlikNo || null;
      const firmaUnvan = input.firma || meta.firma || candidate?.firmaUnvan || null;
      const kategori =
        candidate?.hesapKodu ||
        candidate?.kategori ||
        meta.finalHesapKodu ||
        input.hesapKodu ||
        null;
      if (!firmaKimlikNo || !kategori) continue;

      await this.vendorMemory.recordDecision({
        tenantId,
        firmaKimlikNo,
        firmaUnvan,
        kararTipi,
        kategori,
        altKategori: candidate?.altKategori || null,
        taxpayerId: meta.mukellefId || candidate?.taxpayerId || null,
      });
      recorded = true;
    }
    return recorded;
  }

  async listEvents(
    tenantId: string,
    opts: { agent?: string; mukellef?: string; status?: string; limit?: number; since?: string } = {},
  ) {
    const { agent, mukellef, status, limit = 200, since } = opts;
    const where: any = { tenantId };
    if (agent) where.agent = agent;
    if (mukellef) where.mukellef = { contains: mukellef, mode: 'insensitive' };
    if (status) {
      // Eski ajan kayıtlarıyla uyum için status alternatiflerini de kapsa
      const STATUS_ALIAS: Record<string, string[]> = {
        onaylandi: ['onaylandi', 'ok', 'basarili'],
        atlandi: ['atlandi', 'skip'],
        hata: ['hata', 'error'],
        basarili: ['basarili', 'onaylandi', 'ok'],
        bilgi: ['bilgi', 'info'],
      };
      const aliases = STATUS_ALIAS[status.toLowerCase()];
      if (aliases && aliases.length > 1) where.status = { in: aliases };
      else where.status = status;
    }
    if (since) where.ts = { gte: new Date(since) };
    const events = await this.prisma.agentEvent.findMany({
      where,
      orderBy: { ts: 'desc' },
      take: Math.min(limit, 1000),
      select: this.lightEventSelect(),
    });
    return events.map((event) => ({ ...event, meta: this.publicEventMeta((event as any).meta) }));
  }

  async stats(tenantId: string) {
    const now = new Date();
    const bugun = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const ayBas = new Date(now.getFullYear(), now.getMonth(), 1);

    const [toplam, buGun, buAy, hata] = await Promise.all([
      this.prisma.agentEvent.count({ where: { tenantId } }),
      this.prisma.agentEvent.count({ where: { tenantId, ts: { gte: bugun } } }),
      // Eski ajan 'ok' gönderdiği için 'onaylandi' ve 'ok' ikisi de onay sayılsın
      this.prisma.agentEvent.count({
        where: { tenantId, status: { in: ['onaylandi', 'basarili', 'ok'] }, ts: { gte: ayBas } },
      }),
      this.prisma.agentEvent.count({
        where: { tenantId, status: { in: ['hata', 'error'] }, ts: { gte: bugun } },
      }),
    ]);

    const perMukellef = await this.prisma.agentEvent.groupBy({
      by: ['mukellef', 'status'],
      where: { tenantId, mukellef: { not: null } },
      _count: { _all: true },
    });

    return { toplam, buGun, buAy, hataBugun: hata, perMukellef };
  }

  /**
   * Mükellef başına ayın özet raporu — portal üzerinden kaç alış/satış faturası işlendi.
   * Sadece başarılı veya atlanan olaylar sayılır (hata olanlar işlenmiş sayılmaz).
   * Manuel işlenen faturalar bu özetin dışında kalır — kullanıcı hangi mükellefi kaçar
   * kere sistem üzerinden geçirdiğini görür.
   */
  async eventSummaryByMukellef(
    tenantId: string,
    agent: string,
    year: number,
    month: number,
  ) {
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 1);

    // İşlem başarılı/atlandı sayılır; 'hata' olanlar dahil edilmez.
    const SUCCESS_STATUSES = ['ok', 'onaylandi', 'basarili', 'skip', 'atlandi'];
    const ALIS_ACTIONS = ['isle_alis', 'isle_alis_isletme'];
    const SATIS_ACTIONS = ['isle_satis', 'isle_satis_isletme'];

    // v1.36.39: Geniş ts penceresi → meta.donem ile filtre.
    // Eski mantık ts (log yazıldığı an) bazlıydı; nisan faturalarını mayısın 2'sinde
    // işlersek nisan istatistiğinde gözükmüyordu. Artık agent her log'a meta.donem
    // (komutun ay'i, ör. "2026-04") yazıyor, biz onu kullanıyoruz.
    // donem yoksa (eski kayıtlar) ts'e fallback.
    const donemStr = `${year}-${String(month).padStart(2, '0')}`;
    const wideStart = new Date(year, month - 3, 1);
    const wideEnd = new Date(year, month + 2, 1);

    const allRows = await this.prisma.$queryRaw<
      Array<{ mukellef: string | null; action: string | null; status: string; ts: Date; donem: string | null }>
    >`
      SELECT "mukellef", "action", "status", "ts", "meta"->>'donem' AS "donem"
      FROM "agent_events"
      WHERE "tenantId" = ${tenantId}
        AND "agent" = ${agent}
        AND "status" IN (${Prisma.join(SUCCESS_STATUSES)})
        AND "ts" >= ${wideStart}
        AND "ts" < ${wideEnd}
        AND "mukellef" IS NOT NULL
      ORDER BY "ts" DESC
    `;

    const rows = allRows.filter((r) => {
      if (typeof r.donem === 'string' && r.donem.length > 0) {
        return r.donem === donemStr;
      }
      // Fallback: meta.donem yoksa (eski kayıt) → ts ile orijinal pencereye düş.
      return r.ts >= periodStart && r.ts < periodEnd;
    });

    // Mükellef → { alis, satis, atlanan }
    const map = new Map<string, { alis: number; satis: number; atlanan: number }>();
    for (const row of rows) {
      if (!row.mukellef) continue;
      const entry = map.get(row.mukellef) || { alis: 0, satis: 0, atlanan: 0 };
      const isAlis = !!row.action && ALIS_ACTIONS.includes(row.action);
      const isSatis = !!row.action && SATIS_ACTIONS.includes(row.action);
      const isSkip = row.status === 'skip' || row.status === 'atlandi';
      if (isAlis) entry.alis++;
      else if (isSatis) entry.satis++;
      if (isSkip) entry.atlanan++;
      map.set(row.mukellef, entry);
    }

    // AI maliyeti — bu ay her mukellef için harcanan USD (Claude/Anthropic + OCR)
    // ai-usage-logger'dan dönemdeki tüm kayıtları al; mukellef dolu olanları
    // mukellefe yaz, boş olanları (eski extension kayıtları) "diger" toplamına ekle.
    const { perMukellef: maliyetMap, digerUsd, toplamAiUsd, toplamCagri, anomalousUsd } =
      await this.aiMaliyetByMukellef(tenantId, periodStart, periodEnd);

    const items = Array.from(map.entries())
      .map(([mukellef, counts]) => {
        const toplamIslem = counts.alis + counts.satis + counts.atlanan;
        const maliyet = maliyetMap.get(mukellef)?.usd || 0;
        return {
          mukellef,
          alis: counts.alis,
          satis: counts.satis,
          atlanan: counts.atlanan,
          toplam: counts.alis + counts.satis,
          maliyetUsd: Number(maliyet.toFixed(4)),
          aiCagriSayisi: maliyetMap.get(mukellef)?.count || 0,
          birimMaliyetUsd: toplamIslem > 0 ? Number((maliyet / toplamIslem).toFixed(6)) : 0,
        };
      })
      .sort((a, b) => b.toplam - a.toplam);

    const toplam = items.reduce<{
      alis: number;
      satis: number;
      toplam: number;
      mukellefSayisi: number;
      maliyetUsd: number;
      birimMaliyetUsd: number;
    }>(
      (acc, i) => ({
        alis: acc.alis + i.alis,
        satis: acc.satis + i.satis,
        toplam: acc.toplam + i.toplam,
        mukellefSayisi: acc.mukellefSayisi + 1,
        maliyetUsd: acc.maliyetUsd + i.maliyetUsd,
        birimMaliyetUsd: acc.birimMaliyetUsd,
      }),
      { alis: 0, satis: 0, toplam: 0, mukellefSayisi: 0, maliyetUsd: 0, birimMaliyetUsd: 0 },
    );
    // Toplam maliyete mukellef-bağsız harcamayı da ekle (Toplam Maliyet kpi için).
    // Eski extension kayıtları mukellef field'ı yok — yine de ödendiği gerçek.
    toplam.maliyetUsd = Number((toplamAiUsd || (toplam.maliyetUsd + digerUsd)).toFixed(4));
    const toplamIslem = items.reduce((acc, i) => acc + i.alis + i.satis + i.atlanan, 0);
    toplam.birimMaliyetUsd = toplamIslem > 0 ? Number((toplam.maliyetUsd / toplamIslem).toFixed(6)) : 0;

    return {
      period: { year, month },
      toplam,
      items,
      maliyet: {
        toplamAiUsd: Number((toplamAiUsd || 0).toFixed(4)),
        mukellefBagliUsd: Number((toplam.maliyetUsd - digerUsd).toFixed(4)),
        digerUsd: Number((digerUsd || 0).toFixed(4)),
        anomalousUsd: Number((anomalousUsd || 0).toFixed(4)),
        toplamCagri,
        toplamIslem,
        birimMaliyetUsd: toplam.birimMaliyetUsd,
      },
    };
  }

  /** Mihsap fatura isleme loglarini analiz edilebilir Excel raporuna cevirir. */
  async mihsapProcessingReportXlsx(
    tenantId: string,
    opts: { year: number; month: number; taxpayerIds?: string; mukellef?: string; actions?: string },
  ): Promise<Buffer> {
    const csvList = (value?: string) =>
      String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const metaOf = (value: any): Record<string, any> =>
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
    const text = (value: any, max = 500) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const numberOf = (value: any) => {
      const n = Number(value || 0);
      return Number.isFinite(n) ? n : 0;
    };
    const normalized = (value: any) =>
      String(value || '')
        .toLocaleUpperCase('tr-TR')
        .replace(/[^A-Z0-9]/g, '');
    const normText = (value: any) =>
      String(value || '')
        .toLocaleLowerCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ı/g, 'i')
        .replace(/\s+/g, ' ')
        .trim();
    const trDate = (value: any) => {
      if (!value) return '';
      const d = value instanceof Date ? value : new Date(value);
      if (!Number.isFinite(d.getTime())) return '';
      return d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    };
    const trDay = (value: any) => {
      if (!value) return '';
      const raw = String(value).trim();
      const iso = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
      if (iso) return `${iso[3].padStart(2, '0')}.${iso[2].padStart(2, '0')}.${iso[1]}`;
      const tr = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
      if (tr) return `${tr[1].padStart(2, '0')}.${tr[2].padStart(2, '0')}.${tr[3].length === 2 ? `20${tr[3]}` : tr[3]}`;
      return raw;
    };
    const parseTrDay = (value: any): Date | null => {
      const raw = String(value || '').trim();
      const m = raw.match(/^(\d{1,2})[.](\d{1,2})[.](\d{4})$/);
      if (!m) return null;
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      return Number.isFinite(d.getTime()) ? d : null;
    };
    const readBelgeNo = (event: any, meta: Record<string, any>) =>
      text(event.fisNo || meta.belgeNo || meta?.belge?.belgeNo || meta?.decisionTrace?.belge?.belgeNo || meta?.decisionTrace?.ekran?.belgeNo, 80);
    const readFaturaTarihi = (meta: Record<string, any>, message?: string) => {
      for (const key of ['tarih', 'faturaTarihi', 'belgeTarihi', 'duzenlemeTarihi', 'evrakTarihi', 'mihsapTarih', 'belgeTarih']) {
        if (meta[key]) return trDay(meta[key]);
      }
      for (const value of [meta?.decisionTrace?.ekran?.tarih, meta?.decisionTrace?.belge?.tarih]) {
        if (value) return trDay(value);
      }
      const match = String(message || '').match(/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})/);
      return match ? trDay(match[1]) : '';
    };
    const readBelgeTuru = (meta: Record<string, any>, message?: string) =>
      text(
        meta.belgeTuru ||
          meta.faturaTuru ||
          meta?.decisionTrace?.ekran?.belgeTuru ||
          meta?.decisionTrace?.belge?.belgeTuru ||
          (String(message || '').match(/\bBT\s*:\s*([^·\n]+?)(?=\s*[·|]|\s+(?:AST|FatT|B\d+)\s*:|$)/i)?.[1] || ''),
        80,
      );
    const readFaturaTuru = (meta: Record<string, any>, message?: string) =>
      text(meta.faturaTuru || (String(message || '').match(/\bFatT\s*:\s*([^·\n]+?)(?:\s+BT:|$)/i)?.[1] || ''), 80);
    const readMissingFields = (message?: string, meta?: Record<string, any>) => {
      const raw: string[] = [];
      if (Array.isArray(meta?.missingFields)) raw.push(...meta!.missingFields.map(String));
      const msg = String(message || '');
      const m = msg.match(/Bo[sş]\s*alanlar\s*:\s*([^\n]+)/i);
      if (m) raw.push(...m[1].split(',').map((x) => x.trim()));
      return [...new Set(raw.map((x) => x.replace(/\(yok\)/i, '').trim()).filter(Boolean))];
    };
    const accountKey = (value: any) => {
      const match = String(value || '').match(/\b\d{3}(?:\.\d{1,3}){1,4}\b/);
      return match?.[0] || String(value || '').trim();
    };
    const readAccounts = (event: any, meta: Record<string, any>) => {
      const values = [
        ...(Array.isArray(meta.hesapKodlari) ? meta.hesapKodlari : []),
        ...(Array.isArray(meta?.decisionTrace?.ekran?.hesapKodlari) ? meta.decisionTrace.ekran.hesapKodlari : []),
        event.hesapKodu,
      ];
      const seen = new Set<string>();
      const all: string[] = [];
      for (const value of values) {
        const out = text(value, 160);
        const key = accountKey(out);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        all.push(out);
      }
      const isKdv = (code: string) => /^(191|391)\./.test(accountKey(code));
      const isCari = (code: string) => /^(120|320)\./.test(accountKey(code));
      const isPayment = (code: string) => /^(100|101|102|103|108|121|321|309|329|331|335|336)\./.test(accountKey(code));
      return {
        all,
        matrah: all.filter((code) => !isKdv(code) && !isCari(code) && !isPayment(code)),
        kdv: all.filter(isKdv),
        cari: all.filter((code) => isCari(code) || isPayment(code)),
      };
    };
    const actionLabel = (action?: string | null) => {
      const value = String(action || '');
      if (value === 'isle_alis') return 'Bilanço - Alış';
      if (value === 'isle_satis') return 'Bilanço - Satış';
      if (value === 'isle_alis_isletme') return 'İşletme - Alış';
      if (value === 'isle_satis_isletme') return 'İşletme - Satış';
      return value || 'Belirsiz';
    };
    const statusLabel = (status?: string | null) => {
      const value = String(status || '').toLowerCase();
      if (['ok', 'onaylandi', 'basarili'].includes(value)) return 'İşlendi';
      if (['skip', 'atlandi'].includes(value)) return 'İşlenmedi - Atlandı';
      if (['error', 'hata'].includes(value)) return 'İşlenmedi - Hata';
      return 'Bilgi';
    };

    const year = opts.year;
    const month = opts.month;
    const donemStr = `${year}-${String(month).padStart(2, '0')}`;
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 1);
    const wideStart = new Date(year, month - 3, 1);
    const wideEnd = new Date(year, month + 2, 1);
    const taxpayerIds = csvList(opts.taxpayerIds);
    const actions = csvList(opts.actions);
    const target = String(opts.mukellef || '').trim();

    const selectedTaxpayers = taxpayerIds.length
      ? await this.prisma.taxpayer.findMany({
          where: { tenantId, id: { in: taxpayerIds } },
          select: { id: true, firstName: true, lastName: true, companyName: true },
        })
      : [];
    const taxpayerName = (t: any) => t.companyName || [t.firstName, t.lastName].filter(Boolean).join(' ') || '';
    const selectedNames = new Set(selectedTaxpayers.map(taxpayerName).filter(Boolean));

    const events = await this.prisma.agentEvent.findMany({
      where: {
        tenantId,
        agent: 'mihsap',
        ts: { gte: wideStart, lt: wideEnd },
        ...(actions.length ? { action: { in: actions } } : {}),
      } as any,
      orderBy: { ts: 'asc' },
      take: 10000,
      select: this.lightEventSelect(),
    });

    const eventPeriodInfo = (event: any, meta: Record<string, any>) => {
      const faturaTarihi = readFaturaTarihi(meta, event.message);
      const faturaDate = parseTrDay(faturaTarihi);
      if (faturaDate) {
        return {
          faturaTarihi,
          inPeriod: faturaDate >= periodStart && faturaDate < periodEnd,
          source: 'Fatura tarihi',
        };
      }
      const rowDonem = String(meta.donem || '').trim();
      if (rowDonem) {
        return {
          faturaTarihi,
          inPeriod: rowDonem === donemStr,
          source: 'Komut dönemi',
        };
      }
      const rowTs = new Date(event.ts);
      return {
        faturaTarihi,
        inPeriod: rowTs >= periodStart && rowTs < periodEnd,
        source: 'Log zamanı',
      };
    };

    const filteredEvents = events.filter((event: any) => {
      const meta = metaOf(event.meta);
      const { inPeriod } = eventPeriodInfo(event, meta);
      if (!inPeriod) return false;
      if (taxpayerIds.length) {
        return taxpayerIds.includes(String(meta.mukellefId || '')) || selectedNames.has(String(event.mukellef || ''));
      }
      if (target) {
        const haystack = normText([event.mukellef, event.firma, event.message].filter(Boolean).join(' '));
        return haystack.includes(normText(target));
      }
      return true;
    });

    const eventTimes = filteredEvents.map((event: any) => new Date(event.ts).getTime()).filter(Number.isFinite);
    const usageStart = eventTimes.length ? new Date(Math.min(...eventTimes) - 30 * 60 * 1000) : periodStart;
    const usageEnd = eventTimes.length ? new Date(Math.max(...eventTimes) + 30 * 60 * 1000) : periodEnd;
    const usageWhere: any = {
      tenantId,
      source: { startsWith: 'mihsap' },
      createdAt: { gte: usageStart, lte: usageEnd },
    };
    if (taxpayerIds.length) {
      usageWhere.OR = [
        { taxpayerId: { in: taxpayerIds } },
        ...(selectedNames.size ? [{ mukellef: { in: Array.from(selectedNames) } }] : []),
      ];
    } else if (target) {
      usageWhere.mukellef = { contains: target, mode: 'insensitive' };
    }
    const usageRows = await this.prisma.aiUsageLog.findMany({
      where: usageWhere,
      orderBy: { createdAt: 'asc' },
      take: 10000,
      select: {
        id: true,
        createdAt: true,
        source: true,
        mukellef: true,
        taxpayerId: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        costUsd: true,
        karar: true,
        sebep: true,
        belgeNo: true,
        durationMs: true,
        cacheHit: true,
      },
    });
    const usageByBelge = new Map<string, any[]>();
    for (const usage of usageRows) {
      const key = normalized(usage.belgeNo);
      if (!key) continue;
      const list = usageByBelge.get(key) || [];
      list.push(usage);
      usageByBelge.set(key, list);
    }

    const reportRows = filteredEvents.map((event: any, index) => {
      const meta = metaOf(event.meta);
      const periodInfo = eventPeriodInfo(event, meta);
      const belgeNo = readBelgeNo(event, meta);
      const hesaplar = readAccounts(event, meta);
      const missing = readMissingFields(event.message, meta);
      const msgNorm = normText(event.message);
      const status = String(event.status || '').toLowerCase();
      const success = ['ok', 'onaylandi', 'basarili'].includes(status);
      const warnings: string[] = [];
      if (success && missing.length) warnings.push(`Onaylı kayıtta eksik alan: ${missing.join(', ')}`);
      if (/kdv orani var.*hesap kodu|hesap kodu gorunmuyor|kontrol gerekli|uyari|risk|fark|uyumsuz|eksik/.test(msgNorm)) {
        warnings.push(text(event.message, 160));
      }
      const matchedUsage = (usageByBelge.get(normalized(belgeNo)) || []).filter((usage) => {
        const metaTaxpayerId = String(meta.mukellefId || '');
        if (metaTaxpayerId && usage.taxpayerId) return usage.taxpayerId === metaTaxpayerId;
        if (event.mukellef && usage.mukellef) return normText(usage.mukellef) === normText(event.mukellef);
        return true;
      });
      const aiCostUsd = matchedUsage.length
        ? matchedUsage.reduce((acc, usage) => acc + numberOf(usage.costUsd), 0)
        : numberOf(meta.aiCostUsd ?? meta.costUsd ?? meta?.ai?.costUsd ?? meta?.maliyetUsd);
      const aiSources = [...new Set(matchedUsage.map((usage) => usage.source).filter(Boolean))];
      const category =
        success && warnings.length
          ? 'İşlendi - Kontrol Gerek'
          : success
            ? 'İşlendi - Temiz'
            : statusLabel(status);
      return {
        no: index + 1,
        islemZamani: trDate(event.ts),
        donem: String(meta.donem || donemStr),
        mukellef: event.mukellef || '',
        action: actionLabel(event.action),
        sonuc: category,
        status: event.status || '',
        firma: event.firma || meta.firma || '',
        belgeNo,
        faturaTarihi: periodInfo.faturaTarihi,
        tarihFiltreKaynak: periodInfo.source,
        belgeTuru: readBelgeTuru(meta, event.message),
        faturaTuru: readFaturaTuru(meta, event.message),
        tutar: event.tutar == null ? null : numberOf(event.tutar),
        kdv: event.kdv || meta.kdvOrani || meta?.decisionTrace?.belge?.kdvOrani || '',
        matrahHesaplari: hesaplar.matrah.join('\n'),
        kdvHesaplari: hesaplar.kdv.join('\n'),
        cariHesaplari: hesaplar.cari.join('\n'),
        tumHesaplar: hesaplar.all.join('\n'),
        eksikAlanlar: missing.join(', '),
        uyarilar: [...new Set(warnings)].join('\n'),
        kararSebebi: text(meta?.decisionTrace?.karar?.sebep || meta.sebep || event.message, 800),
        aiKaynak: aiSources.join(', ') || meta.decisionProvider || meta.provider || '',
        aiCagrisi: matchedUsage.length,
        aiMaliyetUsd: Number(aiCostUsd.toFixed(6)),
        agentVersion: meta.agentVersion || meta.runtime || meta.version || '',
        hamMesaj: text(event.message, 1500),
      };
    });

    const totals = reportRows.reduce(
      (acc, row) => {
        acc.toplam += 1;
        acc.tutar += numberOf(row.tutar);
        acc.aiMaliyetUsd += numberOf(row.aiMaliyetUsd);
        if (row.sonuc === 'İşlendi - Temiz') acc.temiz += 1;
        else if (row.sonuc === 'İşlendi - Kontrol Gerek') acc.kontrol += 1;
        else if (row.sonuc.includes('Atlandı')) acc.atlandi += 1;
        else if (row.sonuc.includes('Hata')) acc.hata += 1;
        else acc.bilgi += 1;
        return acc;
      },
      { toplam: 0, temiz: 0, kontrol: 0, atlandi: 0, hata: 0, bilgi: 0, tutar: 0, aiMaliyetUsd: 0 },
    );

    const byMukellef = Array.from(
      reportRows.reduce<Map<string, any>>((map, row) => {
        const key = row.mukellef || '(mükellef yok)';
        const item = map.get(key) || { mukellef: key, toplam: 0, temiz: 0, kontrol: 0, atlandi: 0, hata: 0, tutar: 0, aiMaliyetUsd: 0 };
        item.toplam += 1;
        item.tutar += numberOf(row.tutar);
        item.aiMaliyetUsd += numberOf(row.aiMaliyetUsd);
        if (row.sonuc === 'İşlendi - Temiz') item.temiz += 1;
        else if (row.sonuc === 'İşlendi - Kontrol Gerek') item.kontrol += 1;
        else if (row.sonuc.includes('Atlandı')) item.atlandi += 1;
        else if (row.sonuc.includes('Hata')) item.hata += 1;
        map.set(key, item);
        return map;
      }, new Map()).values(),
    ).sort((a, b) => b.toplam - a.toplam);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Moren Mali Musavirlik';
    wb.created = new Date();
    const gold = 'FFD4B876';
    const dark = 'FF1F1B16';
    const headerFill = 'FFF2E5C2';
    const thinBorder = { style: 'thin', color: { argb: 'FFD7C99D' } } as any;
    const styleHeader = (row: ExcelJS.Row) => {
      row.font = { bold: true, color: { argb: 'FF17130F' } };
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerFill } };
      row.alignment = { vertical: 'middle', wrapText: true };
      row.eachCell((cell) => {
        cell.border = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };
      });
    };

    const summary = wb.addWorksheet('Özet', { properties: { tabColor: { argb: gold } } });
    summary.addRow(['Mihsap Fatura İşleme Raporu']);
    summary.mergeCells('A1:H1');
    summary.getRow(1).font = { bold: true, size: 16, color: { argb: dark } };
    summary.addRow(['Dönem', donemStr, 'Mükellef filtresi', selectedNames.size ? Array.from(selectedNames).join(', ') : target || 'Tümü']);
    summary.addRow(['Rapor tarihi', new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }), 'İşlem filtresi', actions.length ? actions.map(actionLabel).join(', ') : 'Tümü']);
    summary.addRow(['Tarih filtresi', 'Önce fatura tarihi; yoksa komut dönemi; o da yoksa log zamanı', 'Dönem', donemStr]);
    summary.addRow([]);
    styleHeader(summary.addRow(['Sayaç', 'Adet', 'Açıklama']));
    [
      ['Toplam log', totals.toplam, 'Seçilen dönem ve firma filtresine giren kayıtlar'],
      ['İşlendi - Temiz', totals.temiz, 'Onaylandı ve belirgin uyarı yok'],
      ['İşlendi - Kontrol Gerek', totals.kontrol, 'Onaylandı ama eksik alan/uyarı var'],
      ['İşlenmedi - Atlandı', totals.atlandi, 'Manuel işlem veya kural nedeniyle atlandı'],
      ['İşlenmedi - Hata', totals.hata, 'Ajan veya Mihsap hatası'],
      ['Bilgi', totals.bilgi, 'İşlem sonucu olmayan bilgilendirme logları'],
      ['Toplam tutar', totals.tutar, 'Loglarda görünen toplam belge tutarı'],
      ['AI / OCR maliyeti USD', Number(totals.aiMaliyetUsd.toFixed(6)), 'Eşleşen kullanım kayıtlarından hesaplandı'],
    ].forEach((row) => summary.addRow(row));
    summary.columns = [{ width: 28 }, { width: 18 }, { width: 80 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
    summary.getColumn(2).numFmt = '#,##0.00';

    const byTaxpayerSheet = wb.addWorksheet('Mükellef Özeti');
    styleHeader(byTaxpayerSheet.addRow(['Mükellef', 'Toplam', 'Temiz', 'Kontrol Gerek', 'Atlandı', 'Hata', 'Toplam Tutar', 'AI Maliyet USD']));
    byMukellef.forEach((row) =>
      byTaxpayerSheet.addRow([
        row.mukellef,
        row.toplam,
        row.temiz,
        row.kontrol,
        row.atlandi,
        row.hata,
        Number(row.tutar.toFixed(2)),
        Number(row.aiMaliyetUsd.toFixed(6)),
      ]),
    );
    byTaxpayerSheet.columns = [{ width: 48 }, { width: 10 }, { width: 10 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 16 }, { width: 16 }];
    byTaxpayerSheet.getColumn(7).numFmt = '#,##0.00';
    byTaxpayerSheet.getColumn(8).numFmt = '#,##0.000000';
    byTaxpayerSheet.views = [{ state: 'frozen', ySplit: 1 }];
    byTaxpayerSheet.autoFilter = 'A1:H1';

    const detail = wb.addWorksheet('Fatura Logları');
    detail.columns = [
      { header: 'No', key: 'no', width: 7 },
      { header: 'İşlem Zamanı', key: 'islemZamani', width: 20 },
      { header: 'Dönem', key: 'donem', width: 10 },
      { header: 'Mükellef', key: 'mukellef', width: 42 },
      { header: 'İşlem', key: 'action', width: 18 },
      { header: 'Sonuç', key: 'sonuc', width: 24 },
      { header: 'Durum Kodu', key: 'status', width: 12 },
      { header: 'Karşı Firma', key: 'firma', width: 36 },
      { header: 'Belge No', key: 'belgeNo', width: 22 },
      { header: 'Fatura Tarihi', key: 'faturaTarihi', width: 15 },
      { header: 'Tarih Filtre Kaynağı', key: 'tarihFiltreKaynak', width: 19 },
      { header: 'Belge Türü', key: 'belgeTuru', width: 18 },
      { header: 'Fatura Türü', key: 'faturaTuru', width: 18 },
      { header: 'Tutar', key: 'tutar', width: 14 },
      { header: 'KDV', key: 'kdv', width: 10 },
      { header: 'Matrah/Gider Hesabı', key: 'matrahHesaplari', width: 34 },
      { header: 'KDV Hesabı', key: 'kdvHesaplari', width: 30 },
      { header: 'Cari/Ödeme Hesabı', key: 'cariHesaplari', width: 30 },
      { header: 'Tüm Hesaplar', key: 'tumHesaplar', width: 44 },
      { header: 'Eksik Alanlar', key: 'eksikAlanlar', width: 28 },
      { header: 'Uyarılar', key: 'uyarilar', width: 44 },
      { header: 'Karar / Sebep', key: 'kararSebebi', width: 62 },
      { header: 'AI Kaynak', key: 'aiKaynak', width: 24 },
      { header: 'AI Çağrısı', key: 'aiCagrisi', width: 10 },
      { header: 'AI Maliyet USD', key: 'aiMaliyetUsd', width: 15 },
      { header: 'Agent Versiyon', key: 'agentVersion', width: 14 },
      { header: 'Ham Mesaj', key: 'hamMesaj', width: 70 },
    ];
    styleHeader(detail.getRow(1));
    detail.addRows(reportRows);
    detail.views = [{ state: 'frozen', ySplit: 1 }];
    detail.autoFilter = 'A1:AA1';
    detail.getColumn('tutar').numFmt = '#,##0.00';
    detail.getColumn('aiMaliyetUsd').numFmt = '#,##0.000000';
    detail.eachRow((row, rowNo) => {
      row.alignment = { vertical: 'top', wrapText: true };
      if (rowNo === 1) return;
      const result = String(row.getCell(6).value || '');
      if (result.includes('Hata')) row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD9D9' } };
      else if (result.includes('Atlandı')) row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE8BF' } };
      else if (result.includes('Kontrol')) row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3C4' } };
      else if (result.includes('Temiz')) row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDF7E7' } };
    });

    const usageSheet = wb.addWorksheet('AI Kullanımı');
    styleHeader(usageSheet.addRow(['Zaman', 'Kaynak', 'Mükellef', 'Belge No', 'Model', 'Input', 'Output', 'Cache Read', 'Cache Write', 'Cost USD', 'Karar', 'Sebep', 'Süre ms', 'Cache Hit']));
    usageRows.forEach((row) =>
      usageSheet.addRow([
        trDate(row.createdAt),
        row.source,
        row.mukellef || '',
        row.belgeNo || '',
        row.model,
        row.inputTokens,
        row.outputTokens,
        row.cacheReadTokens,
        row.cacheWriteTokens,
        Number(numberOf(row.costUsd).toFixed(6)),
        row.karar || '',
        row.sebep || '',
        row.durationMs || '',
        row.cacheHit ? 'Evet' : 'Hayır',
      ]),
    );
    usageSheet.columns = [{ width: 20 }, { width: 28 }, { width: 42 }, { width: 22 }, { width: 28 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 12 }, { width: 42 }, { width: 10 }, { width: 10 }];
    usageSheet.getColumn(10).numFmt = '#,##0.000000';
    usageSheet.views = [{ state: 'frozen', ySplit: 1 }];
    usageSheet.autoFilter = 'A1:N1';

    for (const ws of wb.worksheets) {
      ws.eachRow((row) => {
        row.eachCell((cell) => {
          cell.border = cell.border || { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };
        });
      });
    }

    return Buffer.from((await wb.xlsx.writeBuffer()) as any);
  }

  /**
   * Diagnostic — son 30 AiUsageLog kaydı + özet sayaçlar.
   * Maliyet $0 sorununun kök nedenini görmek için.
   * try/catch ile hata mesajını geri döndürür (NestJS'in 500 yutmasını engellemek için).
   */
  async aiUsageDiag(tenantId: string) {
    try {
      const rows = await this.prisma.aiUsageLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      const sayilari = {
        toplam: rows.length,
        mukellefDolu: rows.filter((r) => !!r.mukellef && (r.mukellef as string).trim().length > 0).length,
        mukellefBos: rows.filter((r) => !r.mukellef || (r.mukellef as string).trim().length === 0).length,
        costUsdDolu: rows.filter((r) => Number(r.costUsd || 0) > 0).length,
        costUsdSifir: rows.filter((r) => !r.costUsd || Number(r.costUsd) === 0).length,
        kayitYok: rows.length === 0,
        tenantId,
      };
      const toplamUsd = rows.reduce((acc, r) => acc + Number(r.costUsd || 0), 0);
      return {
        ok: true,
        sayilari,
        toplamUsd: Number(toplamUsd.toFixed(6)),
        sonKayitlar: rows.map((r) => ({
          createdAt: r.createdAt,
          source: r.source,
          mukellef: r.mukellef,
          model: r.model,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costUsd: r.costUsd,
          karar: r.karar,
          sebep: (r.sebep || '').slice(0, 80),
          belgeNo: r.belgeNo,
        })),
      };
    } catch (e: any) {
      return {
        ok: false,
        error: e?.message || String(e),
        stack: (e?.stack || '').split('\n').slice(0, 5).join('\n'),
        tenantId,
      };
    }
  }

  /** Agent token ile son Mihsap eventleri ve AI usage maliyetlerini eslestirir. */
  async mihsapCostDiag(
    tenantId: string,
    opts: { mukellef?: string; limit?: number; since?: string } = {},
  ) {
    const target = String(opts.mukellef || '').trim();
    const limitRaw = Number(opts.limit || 80);
    const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 80));
    const parsedSince = opts.since ? new Date(opts.since) : null;
    const sinceDate = parsedSince && Number.isFinite(parsedSince.getTime()) ? parsedSince : null;

    const eventWhere: any = { tenantId, agent: 'mihsap' };
    if (sinceDate) eventWhere.ts = { gte: sinceDate };
    if (target) {
      eventWhere.OR = [
        { mukellef: { contains: target, mode: 'insensitive' } },
        { firma: { contains: target, mode: 'insensitive' } },
        { message: { contains: target, mode: 'insensitive' } },
      ];
    }

    const events = await this.prisma.agentEvent.findMany({
      where: eventWhere,
      orderBy: { ts: 'desc' },
      take: limit,
      select: this.lightEventSelect(),
    });

    const metaOf = (value: any): Record<string, any> =>
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
    const num = (value: any) => {
      const n = Number(value || 0);
      return Number.isFinite(n) ? n : 0;
    };
    const text = (value: any, max = 180) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const normalizeKey = (value: any) =>
      String(value || '')
        .toLocaleUpperCase('tr-TR')
        .replace(/[^A-Z0-9]/g, '');

    const eventRows = events.map((event: any) => {
      const meta = metaOf(event.meta);
      const belgeNo = event.fisNo || meta.belgeNo || meta?.belge?.belgeNo || null;
      const aiCostUsd = num(meta.aiCostUsd ?? meta.costUsd ?? meta?.ai?.costUsd ?? meta?.maliyetUsd);
      return {
        ts: event.ts,
        status: event.status,
        action: event.action,
        mukellef: event.mukellef,
        firma: event.firma,
        belgeNo,
        tutar: event.tutar == null ? null : num(event.tutar),
        hesapKodu: event.hesapKodu,
        kdv: event.kdv,
        message: text(event.message, 240),
        aiCostUsd,
        decisionProvider: meta.decisionProvider || meta.provider || null,
        aiCallReason: meta.aiCallReason || meta.reason || null,
        cacheHit: meta.cacheHit ?? null,
        runtime: meta.runtime || meta.version || null,
      };
    });

    const belgeNos = Array.from(new Set(eventRows.map((row) => normalizeKey(row.belgeNo)).filter(Boolean)));
    const eventTimes = eventRows.map((row) => new Date(row.ts).getTime()).filter(Number.isFinite);
    const earliestEventTs = eventTimes.length ? new Date(Math.min(...eventTimes)) : null;
    const usageSince = sinceDate || earliestEventTs || new Date(Date.now() - 36 * 60 * 60 * 1000);

    const allUsageRows = await this.prisma.aiUsageLog.findMany({
      where: {
        tenantId,
        createdAt: { gte: usageSince },
        source: { startsWith: 'mihsap' },
      } as any,
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        createdAt: true,
        source: true,
        mukellef: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        costUsd: true,
        karar: true,
        sebep: true,
        belgeNo: true,
        durationMs: true,
        cacheHit: true,
      },
    });

    const targetNorm = normalizeKey(target);
    const matchedUsageRows = allUsageRows.filter((row) => {
      if (!targetNorm && belgeNos.length === 0) return true;
      const mukellefMatch = targetNorm && normalizeKey(row.mukellef).includes(targetNorm);
      const belgeMatch = belgeNos.length > 0 && belgeNos.includes(normalizeKey(row.belgeNo));
      return !!mukellefMatch || !!belgeMatch;
    });
    const usageRows = target || belgeNos.length ? matchedUsageRows : allUsageRows;

    const usageJson = usageRows.map((row) => ({
      createdAt: row.createdAt,
      source: row.source,
      mukellef: row.mukellef,
      belgeNo: row.belgeNo,
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      costUsd: num(row.costUsd),
      karar: row.karar,
      sebep: text(row.sebep, 180),
      durationMs: row.durationMs,
      cacheHit: row.cacheHit,
    }));

    const paidRows = usageJson.filter((row) => row.costUsd > 0);
    const tokenRows = usageJson.filter(
      (row) =>
        !row.cacheHit &&
        (num(row.inputTokens) + num(row.outputTokens) + num(row.cacheReadTokens) + num(row.cacheWriteTokens) > 0),
    );
    const sourceBreakdown = Object.values(
      usageJson.reduce<Record<string, { source: string; count: number; costUsd: number; inputTokens: number; outputTokens: number }>>(
        (acc, row) => {
          const key = row.source || 'unknown';
          const item = acc[key] || { source: key, count: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
          item.count += 1;
          item.costUsd += num(row.costUsd);
          item.inputTokens += num(row.inputTokens);
          item.outputTokens += num(row.outputTokens);
          acc[key] = item;
          return acc;
        },
        {},
      ),
    ).map((item) => ({ ...item, costUsd: Number(item.costUsd.toFixed(6)) }));

    const totalCostUsd = usageJson.reduce((acc, row) => acc + num(row.costUsd), 0);
    const eventReportedCostUsd = eventRows.reduce((acc, row) => acc + num(row.aiCostUsd), 0);
    const usageKeys = new Set(
      usageRows.map((row) => `${row.createdAt.toISOString()}|${row.source}|${row.belgeNo || ''}|${row.model}`),
    );
    const unmatchedPaidInWindow = allUsageRows.filter(
      (row) => !usageKeys.has(`${row.createdAt.toISOString()}|${row.source}|${row.belgeNo || ''}|${row.model}`) && num(row.costUsd) > 0,
    );

    return {
      ok: true,
      tenantId,
      filter: {
        mukellef: target || null,
        since: usageSince,
        limit,
      },
      summary: {
        eventCount: eventRows.length,
        usageCount: usageJson.length,
        totalCostUsd: Number(totalCostUsd.toFixed(6)),
        eventReportedCostUsd: Number(eventReportedCostUsd.toFixed(6)),
        paidUsageRows: paidRows.length,
        apiTokenUsageRows: tokenRows.length,
        cacheOrRuleRows: usageJson.length - tokenRows.length,
        unmatchedPaidInWindow: unmatchedPaidInWindow.length,
      },
      sourceBreakdown,
      paidRows: paidRows.slice(0, 50),
      tokenRows: tokenRows.slice(0, 50),
      usages: usageJson.slice(0, 120),
      events: eventRows.slice(0, 80),
    };
  }

  /**
   * Bu ayda AI USD harcamasini cikarir:
   *  - perMukellef: mukellef adi dolu olan kayitlar gruplanir
   *  - digerUsd: mukellef field NULL/bos olan kayitlarin toplami (eski extension)
   *  - toplamAiUsd: donemdeki tum AI USD (Toplam Maliyet kpi icin)
   */
  private async aiMaliyetByMukellef(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ perMukellef: Map<string, { usd: number; count: number }>; digerUsd: number; toplamAiUsd: number; toplamCagri: number; anomalousUsd: number }> {
    const perMukellef = new Map<string, { usd: number; count: number }>();
    let digerUsd = 0;
    let toplamAiUsd = 0;
    let toplamCagri = 0;
    let anomalousUsd = 0;
    try {
      const rows = await this.prisma.aiUsageLog.findMany({
        where: {
          tenantId,
          createdAt: { gte: periodStart, lt: periodEnd },
          source: { in: ['mihsap-fatura', 'mihsap-fatura-cache', 'mihsap-isletme', 'kdv-ocr'] },
        },
        select: { costUsd: true, mukellef: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
      });
      for (const r of rows) {
        const cost = Number(r.costUsd || 0);
        if (!Number.isFinite(cost) || cost <= 0) continue;
        // Bir fatura karar çağrısının 25 cent üstüne çıkması pratikte anomali.
        // Bu koruma yanlış/mükerrer usage kayıtlarının mükellef tablosunu şişirmesini engeller.
        if (cost > 0.25) {
          anomalousUsd += cost;
          continue;
        }
        toplamAiUsd += cost;
        toplamCagri++;
        const muk = (r.mukellef || '').trim();
        if (muk) {
          const prev = perMukellef.get(muk) || { usd: 0, count: 0 };
          perMukellef.set(muk, { usd: prev.usd + cost, count: prev.count + 1 });
        } else {
          digerUsd += cost;
        }
      }
    } catch (e) {
      console.warn('[summary-by-mukellef] aiMaliyetByMukellef hatası:', e);
    }
    return { perMukellef, digerUsd, toplamAiUsd, toplamCagri, anomalousUsd };
  }

  async upsertStatus(
    tenantId: string,
    agent: string,
    data: { running?: boolean; hedefAy?: string; status?: string; version?: string; deviceId?: string; meta?: any },
  ) {
    const rawMeta = data.meta && typeof data.meta === 'object' ? { ...data.meta } : {};
    if (data.version && !rawMeta.version) rawMeta.version = data.version;
    const safeMeta = this.sanitizeMetaForStorage(rawMeta);
    const rawStatus = String(data.status || '').toLowerCase();
    const running =
      typeof data.running === 'boolean'
        ? data.running
        : rawStatus
          ? ['online', 'running', 'ok', 'ready'].includes(rawStatus)
          : true;
    const payload = {
      running,
      hedefAy: data.hedefAy ?? undefined,
      meta: safeMeta ?? undefined,
    };
    // Multi-device: meta.deviceId -> deviceId column. (tenantId, agent, deviceId)
    // unique key sayesinde her cihaz ayrı satırda kalır, son ping üzerine yazar.
    const deviceId = String(data.deviceId || safeMeta?.deviceId || '').trim();
    try {
      return await (this.prisma as any).agentStatus.upsert({
        where: { tenantId_agent_deviceId: { tenantId, agent, deviceId } },
        update: { ...payload, lastPing: new Date() },
        create: { tenantId, agent, deviceId, ...payload },
      });
    } catch (e: any) {
      // Legacy production DBs may still have the old (tenantId, agent) unique index.
      // If create collides there, promote the existing row into a device-specific row.
      if (e?.code !== 'P2002') throw e;
      const existing = await (this.prisma as any).agentStatus.findFirst({
        where: { tenantId, agent },
        orderBy: { lastPing: 'desc' },
      });
      if (!existing) throw e;
      return (this.prisma as any).agentStatus.update({
        where: { id: existing.id },
        data: { deviceId, ...payload, lastPing: new Date() },
      });
    }
  }

  // === PAUSE/RESUME (control state) ===
  // Portaldan set edilir, agent her iterasyonda okur, RUNNING/PAUSED/STOP'a göre davranır.
  async setControlState(
    tenantId: string,
    agent: string,
    state: 'RUNNING' | 'PAUSED' | 'STOP',
    setBy: string,
  ) {
    const data = {
      controlState: state,
      controlSetBy: setBy,
      controlSetAt: new Date(),
    };
    const updated = await (this.prisma as any).agentStatus.updateMany({
      where: { tenantId, agent },
      data,
    });
    if (updated?.count) {
      return (this.prisma as any).agentStatus.findFirst({
        where: { tenantId, agent },
        orderBy: { lastPing: 'desc' },
      });
    }
    return (this.prisma as any).agentStatus.create({
      data: {
        tenantId,
        agent,
        deviceId: '',
        ...data,
      },
    });
  }

  async getControlState(tenantId: string, agent: string) {
    const s = await (this.prisma as any).agentStatus.findFirst({
      where: { tenantId, agent },
      orderBy: { lastPing: 'desc' },
      select: { controlState: true, controlSetBy: true, controlSetAt: true, running: true, lastPing: true },
    });
    return s || { controlState: 'RUNNING', running: false, lastPing: null };
  }

  async listStatus(tenantId: string) {
    const statuses = await this.prisma.agentStatus.findMany({
      where: { tenantId },
      select: {
        id: true,
        tenantId: true,
        agent: true,
        running: true,
        hedefAy: true,
        lastPing: true,
        controlState: true,
        controlSetBy: true,
        controlSetAt: true,
      },
    });
    return statuses.map((status) => ({ ...status, meta: null }));
  }

  /**
   * Ajan sağlık özeti — Sağlık Paneli için tek endpoint'ten her şey.
   *
   * Döner:
   *  - agents[]: agent başı durum, cihaz listesi, kontrol durumu, bugünkü iş sayıları, aktif iş & son hata
   *  - hourlyActivity[]: son 24 saat, saatlik biten/hata sayısı
   *  - totals: anlık özet
   */
  async getHealthSummary(tenantId: string) {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentErrorCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [statuses, lucaJobs, agentEvents, agentCommands] = await Promise.all([
      this.prisma.agentStatus.findMany({
        where: { tenantId },
        orderBy: { lastPing: 'desc' },
      }),
      (this.prisma as any).lucaFetchJob.findMany({
        where: { tenantId, createdAt: { gte: last24h } },
        orderBy: { createdAt: 'desc' },
      }) as Promise<Array<any>>,
      this.prisma.agentEvent.findMany({
        where: { tenantId, ts: { gte: last24h } },
        orderBy: { ts: 'desc' },
        take: 500,
      }),
      (this.prisma as any).agentCommand.findMany({
        where: { tenantId, createdAt: { gte: last24h } },
        orderBy: { createdAt: 'desc' },
      }) as Promise<Array<any>>,
    ]);

    // Cihazları agent'a göre grupla — bir agent için birden çok cihaz olabilir
    // (örn. ofis + ev PC'sinde local-agent veya farklı tarayıcılarda extension)
    const devicesByAgent = new Map<string, Array<any>>();
    for (const s of statuses as any[]) {
      const list = devicesByAgent.get(s.agent) || [];
      const meta: any = s.meta || {};
      // Multi-device migration sonrası deviceId column'da. Eski satırlar için meta'dan fallback.
      const deviceId = s.deviceId || meta.deviceId || null;
      const lastPingMs = new Date(s.lastPing).getTime();
      const stale = Date.now() - lastPingMs > 5 * 60 * 1000; // 5dk üstü stale
      list.push({
        deviceId,
        workerName: meta.workerName || null,
        version: meta.version || null,
        running: s.running && !stale,
        lastPing: s.lastPing,
        stale,
        isLocal: !!meta.localWorker || (deviceId && !/^DEV-/i.test(String(deviceId))),
        jobTypes: Array.isArray(meta.jobTypes) ? meta.jobTypes : null,
        url: meta.url || null,
        controlState: s.controlState || 'RUNNING',
        controlSetBy: s.controlSetBy || null,
        controlSetAt: s.controlSetAt,
      });
      devicesByAgent.set(s.agent, list);
    }

    // Luca job'ları agent='luca' altına eşle (LucaFetchJob içinde agent field yok)
    const lucaJobsByStatus = (() => {
      const buckets = { done: 0, failed: 0, pending: 0, running: 0, cancelled: 0 };
      for (const j of lucaJobs) {
        const k = (j.status || 'pending') as keyof typeof buckets;
        if (k in buckets) buckets[k]++;
      }
      return { ...buckets, total: lucaJobs.length };
    })();

    const lucaActiveJobs = lucaJobs
      .filter((j: any) => j.status === 'running' || j.status === 'pending')
      .slice(0, 10)
      .map((j: any) => ({
        id: j.id,
        tip: j.tip,
        donem: j.donem,
        status: j.status,
        startedAt: j.startedAt,
        createdAt: j.createdAt,
        targetDeviceId: j.targetDeviceId,
        mukellefId: j.mukellefId,
      }));

    const lucaRecentErrors = lucaJobs
      .filter((j: any) => j.status === 'failed' && j.errorMsg)
      .slice(0, 5)
      .map((j: any) => ({
        id: j.id,
        message: String(j.errorMsg || '').split('\n').slice(-1)[0]?.slice(0, 200) || '',
        ts: j.finishedAt || j.createdAt,
      }));

    // Mihsap & diğer agent'lar için AgentEvent + AgentCommand'tan istatistik
    const otherAgents = new Set<string>();
    for (const s of statuses) {
      if (s.agent && s.agent !== 'luca') otherAgents.add(s.agent);
    }
    for (const c of agentCommands) {
      if (c.agent && c.agent !== 'luca') otherAgents.add(c.agent);
    }

    const agents: any[] = [];

    // Luca ajanı
    agents.push({
      agent: 'luca',
      displayName: 'Luca (e-Arşiv/E-Fatura/Mizan)',
      devices: devicesByAgent.get('luca') || [],
      todayJobs: lucaJobsByStatus,
      activeJobs: lucaActiveJobs,
      recentErrors: lucaRecentErrors,
      controlState: (devicesByAgent.get('luca')?.[0]?.controlState) || 'RUNNING',
    });

    // Diğer agent'lar (Mihsap, vb.)
    for (const agentName of otherAgents) {
      const cmds = agentCommands.filter((c: any) => c.agent === agentName);
      const evts = agentEvents.filter((e: any) => e.agent === agentName);
      const cmdBuckets = { done: 0, failed: 0, pending: 0, running: 0, total: cmds.length };
      for (const c of cmds) {
        const k = (c.status || 'pending') as keyof typeof cmdBuckets;
        if (k in cmdBuckets && k !== 'total') (cmdBuckets as any)[k]++;
      }
      const recentErrors = evts
        .filter((e: any) => e.status === 'hata')
        .slice(0, 5)
        .map((e: any) => ({
          id: e.id,
          message: e.message?.slice(0, 200) || '',
          mukellef: e.mukellef,
          ts: e.ts,
        }));
      agents.push({
        agent: agentName,
        displayName: agentName === 'mihsap' ? 'Mihsap (Fatura Onay)' : agentName,
        devices: devicesByAgent.get(agentName) || [],
        todayJobs: cmdBuckets,
        activeJobs: cmds
          .filter((c: any) => c.status === 'running' || c.status === 'pending')
          .slice(0, 10)
          .map((c: any) => ({
            id: c.id,
            tip: c.action,
            status: c.status,
            startedAt: c.startedAt,
            createdAt: c.createdAt,
          })),
        recentErrors,
        controlState: (devicesByAgent.get(agentName)?.[0]?.controlState) || 'RUNNING',
      });
    }

    // Saatlik aktivite (son 24h) — Luca job'larının finishedAt'ine göre
    const hourBuckets = new Map<string, { done: number; failed: number }>();
    for (let i = 23; i >= 0; i--) {
      const t = new Date(now.getTime() - i * 60 * 60 * 1000);
      t.setMinutes(0, 0, 0);
      hourBuckets.set(t.toISOString(), { done: 0, failed: 0 });
    }
    for (const j of lucaJobs) {
      if (!j.finishedAt) continue;
      const t = new Date(j.finishedAt);
      t.setMinutes(0, 0, 0);
      const key = t.toISOString();
      const bucket = hourBuckets.get(key);
      if (!bucket) continue;
      if (j.status === 'done') bucket.done++;
      else if (j.status === 'failed') bucket.failed++;
    }
    const hourlyActivity = Array.from(hourBuckets.entries()).map(([hour, v]) => ({
      hour,
      done: v.done,
      failed: v.failed,
    }));

    return {
      generatedAt: now.toISOString(),
      agents,
      hourlyActivity,
      totals: {
        activeJobs:
          lucaActiveJobs.length +
          agents.reduce((sum, a) => (a.agent !== 'luca' ? sum + a.activeJobs.length : sum), 0),
        pendingLucaJobs: lucaJobsByStatus.pending,
        runningLucaJobs: lucaJobsByStatus.running,
        doneToday: lucaJobsByStatus.done,
        failedToday: lucaJobsByStatus.failed,
      },
    };
  }

  // Rules
  async listRules(tenantId: string) {
    return this.prisma.agentRule.findMany({ where: { tenantId }, orderBy: { mukellef: 'asc' } });
  }

  async getRule(tenantId: string, mukellef: string) {
    return this.prisma.agentRule.findUnique({ where: { tenantId_mukellef: { tenantId, mukellef } } });
  }

  async upsertRule(tenantId: string, mukellef: string, data: { faaliyet?: string; defterTuru?: string; profile: any }) {
    return this.prisma.agentRule.upsert({
      where: { tenantId_mukellef: { tenantId, mukellef } },
      update: data,
      create: { tenantId, mukellef, ...data },
    });
  }

  async deleteRule(tenantId: string, mukellef: string) {
    return this.prisma.agentRule.delete({ where: { tenantId_mukellef: { tenantId, mukellef } } });
  }

  getAgentRegistry() {
    return getAgentRegistry();
  }

  // Komut kuyruğu
  async createCommand(
    tenantId: string,
    data: { agent: string; action: string; payload: any; createdBy?: string },
  ) {
    return this.prisma.agentCommand.create({
      data: { tenantId, agent: data.agent, action: data.action, payload: data.payload, createdBy: data.createdBy },
    });
  }

  async listCommands(tenantId: string, opts: { agent?: string; status?: string; limit?: number } = {}) {
    // Stale watchdog: 30dk ustu running komutlari failed yap (Mihsap tab kapandiysa)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    await this.prisma.agentCommand.updateMany({
      where: { tenantId, status: 'running', startedAt: { lt: thirtyMinAgo } },
      data: { status: 'failed', result: { message: 'Zaman asimi (30dk) - agent yanit vermedi', stale: true } as any, finishedAt: new Date() } as any,
    });
    const { agent, status, limit = 50 } = opts;
    const where: any = { tenantId };
    const agentFilter = commandListAgentsForFilter(agent);
    if (agentFilter?.length === 1) where.agent = agentFilter[0];
    else if (agentFilter?.length) where.agent = { in: agentFilter };
    if (status) where.status = status;
    return this.prisma.agentCommand.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  /** Tek komutu getir - agent her iterasyonda cancel kontrolu icin */
  async getCommand(tenantId: string, id: string) {
    return this.prisma.agentCommand.findFirst({ where: { id, tenantId } });
  }

  /** Komuta canlı log satırı ekle — agent'tan çağrılır.
   *  Loglar AgentCommand.result.logs array'inde tutulur (en son 200 satır).
   */
  async appendCommandLog(tenantId: string, id: string, level: string, message: string) {
    const cmd = await this.prisma.agentCommand.findFirst({ where: { id, tenantId } });
    if (!cmd) return null;
    const result: any = (cmd.result as any) || {};
    const logs: any[] = Array.isArray(result.logs) ? result.logs : [];
    logs.push({ ts: new Date().toISOString(), level: level || 'info', message: String(message || '').slice(0, 500) });
    // Son 200 satırı tut (çok büyümesin)
    const trimmed = logs.slice(-200);
    return this.prisma.agentCommand.update({
      where: { id },
      data: { result: { ...result, logs: trimmed } as any } as any,
    });
  }

  /** Komutu iptal et - agent cancel'i gorup duracak */
  async cancelCommand(tenantId: string, id: string) {
    const cmd = await this.prisma.agentCommand.findFirst({ where: { id, tenantId } });
    if (!cmd) return null;
    if (['done', 'failed', 'cancelled'].includes(cmd.status)) return cmd;
    return this.prisma.agentCommand.update({
      where: { id },
      data: {
        status: 'cancelled',
        result: { ...(cmd.result as any || {}), message: 'Kullanici iptal etti' } as any,
        finishedAt: new Date(),
      } as any,
    });
  }

    /** Yerel runner için bekleyen komutları claim eder (status=running yapar)
     * v1.36.61: Device-aware filter — backward-compatible.
     * - Komut payload.targetDeviceId yok ise → herkes alabilir (eski davranış, etki yok)
     * - Komut payload.targetDeviceId var ise → sadece o deviceId'li agent alır
     * - Agent deviceId göndermezse → eski davranış (filter uygulanmaz)
     */
  async claimPendingCommands(tenantId: string, agent?: string, deviceId?: string) {
    const where: any = { tenantId, status: 'pending' };
    const claimAgents = commandClaimAgentsForRunner(agent);
    if (claimAgents?.length === 1) where.agent = claimAgents[0];
    else if (claimAgents?.length) where.agent = { in: claimAgents };
    const pending = await this.prisma.agentCommand.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    if (pending.length === 0) return [];
    // Device filter: targetDeviceId varsa eşleşmesi gerekir
    const matched = deviceId
      ? pending.filter((p) => {
          const target = (p.payload as any)?.targetDeviceId;
          // target yoksa herkesin (eski davranış); varsa sadece eşleşen device alır
          return !target || target === deviceId;
        })
      : pending;
    if (matched.length === 0) return [];
    await this.prisma.agentCommand.updateMany({
      where: { id: { in: matched.map((p) => p.id) } },
      data: { status: 'running', startedAt: new Date() },
    });
    return matched;
  }

  /**
   * Claude Haiku 4.5 ile fatura kararı verir.
   * Input: fatura jpeg base64 + hesap kodları
   * Output: { karar: 'onay'|'atla'|'emin_degil', sebep: string, ocrOzet?: string, onerilenler?: {...} }
   *
   * YENİ (Bilanço SATIŞ modu): bosAlanSecenekleri verilirse AI boş alanlar için
   * Mihsap dropdown'undan hesap kodu önerir (matrah / kdv / cari).
   */
  async decideFatura(input: {
    faturaImageBase64: string;
    faturaImageMediaType?: string;
    faturaText?: string;
    hesapKodlari: string[];
    faturaTarihi?: string;
    hedefAy?: string;
    belgeNo?: string;
    belgeTuru?: string;
    faturaTuru?: string;
    mukellef?: string;
    mukellefId?: string; // YENİ: Taxpayer.id — Firma Hafızası mükellef-bazlı öğrenme için
    firma?: string;
    firmaKimlikNo?: string; // Karsi firma VKN/TCKN — Firma Hafizasi icin
    tutar?: number | string;
    action?: string; // 'isle_alis' | 'isle_satis' | 'isle_alis_isletme' | 'isle_satis_isletme'
    tenantId?: string;
    forceFresh?: boolean;
    ruleOnly?: boolean;
    /**
     * Boş alanlar için dropdown seçenekleri. Runner, Mihsap'ta boş alana tıkladığında
     * Luca entegrasyonundan gelen hesap kodu listesini buraya koyar.
     * AI her alan için listedeki en uygun kodu seçer.
     */
    bosAlanSecenekleri?: {
      matrahKodlari?: string[];  // Matrah hesabı (ör: 600.01.001, 600.01.005...)
      kdvKodlari?: string[];     // KDV hesabı (ör: 391.01.001, 391.01.006...)
      cariKodlari?: string[];    // Cari hesap (ör: 120.01.ABC, 120.02.XYZ...)
    };
  }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const decisionMode = this.getMihsapDecisionMode();
    if (!apiKey && decisionMode === 'claude_only') {
      return { karar: 'emin_degil', sebep: 'ANTHROPIC_API_KEY yok' };
    }

    // Mükellef ID eksikse, mükellef adından bulmaya çalış.
    // Arama stratejisi: equals / contains / reverse-contains / firstName+lastName
    if (!input.mukellefId && input.tenantId && input.mukellef) {
      try {
        const mukellefAd = input.mukellef.trim();
        // Önce tüm mükellefleri kısaca çek, kod tarafında fuzzy eşleştir
        const candidates = await this.prisma.taxpayer.findMany({
          where: { tenantId: input.tenantId, isActive: true },
          select: { id: true, companyName: true, firstName: true, lastName: true },
        });
        const normalize = (s: string) => s.toLocaleUpperCase('tr-TR').replace(/\s+/g, ' ').trim();
        const target = normalize(mukellefAd);
        let found: { id: string } | null = null;
        // 1. Tam eşleşme
        for (const c of candidates) {
          const name = c.companyName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
          if (!name) continue;
          if (normalize(name) === target) { found = c; break; }
        }
        // 2. İçerik karşılaştırması (iki yönlü)
        if (!found) {
          for (const c of candidates) {
            const name = c.companyName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
            if (!name) continue;
            const n = normalize(name);
            if (n.includes(target) || target.includes(n)) { found = c; break; }
          }
        }
        // 3. İlk kelime eşleşmesi (son çare)
        if (!found) {
          const firstWord = target.split(' ')[0];
          if (firstWord && firstWord.length >= 4) {
            for (const c of candidates) {
              const name = c.companyName || `${c.firstName || ''} ${c.lastName || ''}`.trim();
              if (!name) continue;
              const n = normalize(name);
              if (n.startsWith(firstWord + ' ') || n === firstWord) { found = c; break; }
            }
          }
        }
        if (found) input.mukellefId = found.id;
      } catch {}
    }

    // === MÜKELLEF PROFİLİ ZORUNLU KONTROL ===
    // Sektör/faaliyet tanımı yoksa AI'ya bile gitme — "önce profil tanımla" uyarısı
    let rule: any = null;
    if (input.tenantId && input.mukellef) {
      try {
        rule = await this.prisma.agentRule.findUnique({
          where: { tenantId_mukellef: { tenantId: input.tenantId, mukellef: input.mukellef } },
        });
      } catch {}
    }
    const sektor = rule?.profile?.sektor?.toString().trim();
    if (!sektor) {
      return {
        karar: 'atla',
        sebep: `⚠️ Mükellef profili eksik — Mükellef Profilleri'nden "${input.mukellef}" için sektör/faaliyet tanımlayın`,
        profilEksik: true,
        mukellef: input.mukellef,
        mukellefId: input.mukellefId,
      };
    }

    const hasBosAlanSecenekleri = !!(
      input.bosAlanSecenekleri &&
      ((input.bosAlanSecenekleri.matrahKodlari?.length || 0) +
        (input.bosAlanSecenekleri.kdvKodlari?.length || 0) +
        (input.bosAlanSecenekleri.cariKodlari?.length || 0)) > 0
    );

    // === ZORUNLU META KONTROLÜ ===
    // Agent tarih/belge türü okuyamadıysa fatura işleme — tutarsız karar vermesin.
    // Kullanıcı bu alanları canlı akışta ✗ görüyorsa sebep burada.
    const faturaTarihi = (input.faturaTarihi || '').trim();
    const belgeTuru = (input.belgeTuru || '').trim();
    if (!faturaTarihi || faturaTarihi === '?' || faturaTarihi === '??') {
      return {
        karar: 'atla',
        sebep: '⚠️ Fatura tarihi okunamadı — agent meta eksik, fatura atlandı',
        metaEksik: 'tarih',
      };
    }
    if (!hasBosAlanSecenekleri && (!belgeTuru || belgeTuru === '?' || belgeTuru === '??')) {
      return {
        karar: 'atla',
        sebep: '⚠️ Belge türü okunamadı — agent meta eksik, fatura atlandı',
        metaEksik: 'belgeTuru',
      };
    }

    // Mükellef profili prompt metni (sektör dahil tüm yapılandırılmış alanlar)
    let mukellefTalimat = '';
    if (rule?.profile) {
      mukellefTalimat = profileToPromptText(rule.profile);
    }

    // Firma Hafizasi — bu firma icin gecmis onaylari hint olarak al.
    // Hint varsa AI prompt'una OVERRIDE kuraliyla eklenecek (fatura icerigi cakisirsa
    // AI hint'i gormezden gelebilir). 3+ onay yoksa null doner (yeni/az kullanilmis firma).
    let vendorHint: Awaited<ReturnType<VendorMemoryService['getHintForVendor']>> = null;
    if (input.tenantId && input.firmaKimlikNo) {
      try {
        vendorHint = await this.vendorMemory.getHintForVendor(
          input.tenantId,
          input.firmaKimlikNo,
          'fatura',
          input.mukellefId || null, // Mükellef-bazlı hint
        );
      } catch {}
    }
    const kodListe = input.hesapKodlari.join(', ');
    // Hem Bilanço hem İşletme Defteri için alış/satış ayrımı aynı — URL farklı, işlem mantığı aynı.
    const SATIS_ACTIONS = ['isle_satis', 'isle_satis_isletme'];
    const ALIS_ACTIONS = ['isle_alis', 'isle_alis_isletme'];
    const islemTuru = SATIS_ACTIONS.includes(input.action || '')
      ? 'SATIŞ'
      : ALIS_ACTIONS.includes(input.action || '')
      ? 'ALIŞ'
      : 'ALIŞ';

    // === DETERMİNİSTİK KOD KONTROLÜ ===
    const SATIS_PFX = ['600', '601', '602', '120', '121', '122', '391'];
    const ALIS_PFX  = ['150', '153', '157', '253', '255', '320', '321', '322', '740', '770', '191'];
    const firstThree = (c: string) => (c.match(/^(\d{3})/)?.[1] || '');
    const codesArr = input.hesapKodlari.map(c => c.trim()).filter(Boolean);
    const pfxs = codesArr.map(firstThree).filter(Boolean);
    const hasSatis = pfxs.some(p => SATIS_PFX.includes(p));
    const hasAlis  = pfxs.some(p => ALIS_PFX.includes(p));
    const demirbas = pfxs.some(p => p === '253' || p === '255');
    const codeType = hasSatis && !hasAlis ? 'SATIŞ' : hasAlis && !hasSatis ? 'ALIŞ' : 'KARIŞIK';
    const primaryFaturaAccount = this.pickPrimaryFaturaAccount(codesArr);

    // Demirbaş → atla
    if (demirbas) {
      return { karar: 'atla', sebep: `Demirbaş kodu (253/255) — ${codesArr[0]}` };
    }
    // Mod/kod uyumsuzluğu → AI'ya sormadan atla
    if (islemTuru === 'SATIŞ' && codeType === 'ALIŞ') {
      return { karar: 'atla', sebep: `SATIŞ modu ama kodlar ALIŞ (${codesArr.slice(0,2).join('+')})` };
    }
    if (islemTuru === 'ALIŞ' && codeType === 'SATIŞ') {
      return { karar: 'atla', sebep: `ALIŞ modu ama kodlar SATIŞ (${codesArr.slice(0,2).join('+')})` };
    }

    // Tarih kontrolü (deterministik)
    const tarihM = (input.faturaTarihi || '').match(/^(\d{2})[-.\/](\d{2})[-.\/](\d{4})/);
    const faturaAyi = tarihM ? tarihM[2] : '';
    const hedefAyNum = (input.hedefAy || '').match(/-(\d{2})$/)?.[1] || '';
    if (faturaAyi && hedefAyNum && faturaAyi !== hedefAyNum) {
      return { karar: 'atla', sebep: `Tarih ayı ${faturaAyi} ≠ hedef ayı ${hedefAyNum}` };
    }

    const startMs = Date.now();
    const MODEL = 'claude-haiku-4-5-20251001';
    const aiCallReasons = new Set<string>();
    if (hasBosAlanSecenekleri) aiCallReasons.add('bos_kod');

    const logZeroUsage = (source: string, karar: string, sebep: string, cacheHit = true) =>
      logAiUsage(this.prisma, {
        tenantId: input.tenantId || 'unknown',
        taxpayerId: input.mukellefId || null,
        source,
        model: MODEL,
        mukellef: input.mukellef,
        belgeNo: input.belgeNo,
        karar,
        sebep,
        durationMs: Date.now() - startMs,
        cacheHit,
        usage: { input_tokens: 0, output_tokens: 0 },
      });

    const ruleDecisionTrace = (sonuc: string, sebep: string, memoryCategory: string | null = null, vendorHintUsed = false) => ({
      belge: {
        tarih: input.faturaTarihi || null,
        belgeNo: input.belgeNo || null,
        cari: input.firma || null,
        belgeTuru: input.belgeTuru || null,
        kdvOrani: null,
        ocrToplam: input.tutar ?? null,
      },
      ekran: {
        tarih: input.faturaTarihi || null,
        belgeNo: input.belgeNo || null,
        belgeTuru: input.belgeTuru || null,
        faturaTuru: input.faturaTuru || null,
        tutar: input.tutar ?? null,
        hesapKodlari: input.hesapKodlari || [],
      },
      karar: {
        sonuc,
        sebep,
        icerikSinifi: null,
        memoryCategory,
        vendorHintUsed,
      },
    });

    if (ALIS_ACTIONS.includes(input.action || '') && hasBosAlanSecenekleri) {
      const sebep = 'rule_fast_path: Alista bos muhasebe alani var; manuel islenecek, secim/Claude atlandi';
      await logZeroUsage('mihsap-fatura-rule', 'atla', sebep);
      return {
        karar: 'atla',
        sebep,
        aiCallReason: 'alis_bos_kod_manual',
        decisionProvider: 'rule-based',
        decisionTrace: ruleDecisionTrace('atla', sebep, primaryFaturaAccount || null),
      };
    }

    const tutarNum = Number(input.tutar);
    const hasKasaAccount = !!(
      SISTEM_KURALLARI.kasaLimit.aktif &&
      codesArr.some((code) => this.extractAccountCode(code).startsWith(`${SISTEM_KURALLARI.kasaLimit.hesapPrefix}.`))
    );
    if (hasKasaAccount && Number.isFinite(tutarNum) && tutarNum > SISTEM_KURALLARI.kasaLimit.maxTutar) {
      const sebep = `rule_fast_path: Kasa hesabi ${SISTEM_KURALLARI.kasaLimit.maxTutar.toLocaleString('tr-TR')} TL limitini asiyor; manuel kontrol`;
      await logZeroUsage('mihsap-fatura-rule', 'atla', sebep);
      return {
        karar: 'atla',
        sebep,
        aiCallReason: 'kasa_limit_rule',
        decisionProvider: 'rule-based',
        decisionTrace: ruleDecisionTrace('atla', sebep, primaryFaturaAccount || null),
      };
    }

    const freeContent = this.analyzeFreeFaturaContent(input.faturaText);
    const vehiclePurchaseRisk = this.detectFaturaVehiclePurchaseRisk({
      action: input.action,
      firma: input.firma,
      tutar: input.tutar,
      primaryAccount: primaryFaturaAccount,
      faturaText: input.faturaText,
    });
    const firmManualRule = this.detectProfileFirmaManualRule(rule?.profile, input.firma);
    const earlyRuleRisk = freeContent.risk
      ? freeContent.sebep
      : vehiclePurchaseRisk || firmManualRule;
    if (!hasBosAlanSecenekleri && earlyRuleRisk) {
      const sebep = earlyRuleRisk || 'Kural tabanli icerik riski; otomatik F2 yapilmaz';
      await logZeroUsage('mihsap-fatura-content-rule', 'atla', sebep);
      return {
        karar: 'atla',
        sebep,
        aiCallReason: vehiclePurchaseRisk ? 'vehicle_purchase_rule_risk' : firmManualRule ? 'profile_firma_rule_risk' : 'free_content_rule_risk',
        decisionProvider: 'rule-based',
        decisionTrace: ruleDecisionTrace('atla', sebep, primaryFaturaAccount || null, !!vendorHint),
      };
    }

    const imageHash = input.faturaImageBase64
      ? createHash('sha256').update(input.faturaImageBase64).digest('hex')
      : '';
    const decisionCacheKey = [
      input.tenantId || 'unknown',
      input.mukellefId || input.mukellef || '',
      input.belgeNo || '',
      input.tutar || '',
      imageHash.slice(0, 24),
      input.action || '',
    ].join('|');

    const memCached = this.faturaDecisionCache.get(decisionCacheKey);
    if (!input.forceFresh && memCached && memCached.expiresAt > Date.now()) {
      await logZeroUsage('mihsap-fatura-cache', memCached.value?.karar || 'cache_hit', 'cache_hit: memory decision reused');
      return { ...memCached.value, cacheHit: true, aiCallReason: 'cache_hit' };
    }

    if (!input.forceFresh && input.tenantId && input.belgeNo && input.mukellef) {
      try {
        const previous = await this.prisma.agentEvent.findFirst({
          where: {
            tenantId: input.tenantId,
            agent: 'mihsap',
            mukellef: input.mukellef,
            fisNo: input.belgeNo,
            ...(input.tutar != null && input.tutar !== '' ? { tutar: Number(input.tutar) } : {}),
            status: { in: ['onaylandi', 'basarili', 'atlandi'] },
          },
          orderBy: { ts: 'desc' },
        });
        if (previous?.meta) {
          const meta: any = previous.meta;
          const karar =
            previous.status === 'atlandi'
              ? 'atla'
              : meta?.decisionTrace?.karar?.sonuc || meta?.karar || 'onay';
          const cachedDecision = {
            karar,
            sebep: `cache_hit: ayni belge daha once islendi (${previous.status})`,
            decisionTrace: meta?.decisionTrace || null,
            faturaDecisionCandidate: meta?.faturaDecisionCandidate || null,
          };
          this.faturaDecisionCache.set(decisionCacheKey, {
            expiresAt: Date.now() + 6 * 60 * 60 * 1000,
            value: cachedDecision,
          });
          await logZeroUsage('mihsap-fatura-cache', karar, cachedDecision.sebep);
          return { ...cachedDecision, cacheHit: true, aiCallReason: 'cache_hit' };
        }
      } catch {}
    }

    const isZRaporu = /z[\s_-]*rapor/i.test(`${input.belgeTuru || ''} ${input.firma || ''}`);
    const canUseDeterministicZRaporu =
      isZRaporu &&
      !hasBosAlanSecenekleri &&
      codesArr.length > 0 &&
      Number.isFinite(Number(input.tutar)) &&
      !vendorHint;
    if (canUseDeterministicZRaporu) {
      const memoryCategory = primaryFaturaAccount || codesArr.find((c) => /^(600|601|602|150|153|157|740|770)\./.test(c)) || codesArr[0];
      const deterministicDecision = {
        karar: 'onay',
        sebep: 'rule_fast_path: Z raporu, kod/tarih/tutar ekran verisi yeterli; Claude cagrilmadi',
        icerikSinifi: 'Mal',
        ocrOzet: 'Z raporu perakende satis',
        faturaDecisionCandidate: input.firmaKimlikNo
          ? {
              kararTipi: 'fatura',
              hesapKodu: memoryCategory,
              firmaKimlikNo: input.firmaKimlikNo || null,
              firmaUnvan: input.firma || null,
              taxpayerId: input.mukellefId || null,
            }
          : undefined,
        decisionTrace: {
          belge: {
            tarih: input.faturaTarihi || null,
            belgeNo: input.belgeNo || null,
            cari: input.firma || null,
            belgeTuru: input.belgeTuru || null,
            kdvOrani: null,
            ocrToplam: input.tutar ?? null,
          },
          ekran: {
            tarih: input.faturaTarihi || null,
            belgeNo: input.belgeNo || null,
            belgeTuru: input.belgeTuru || null,
            faturaTuru: input.faturaTuru || null,
            tutar: input.tutar ?? null,
            hesapKodlari: input.hesapKodlari || [],
          },
          karar: {
            sonuc: 'onay',
            sebep: 'Z raporu deterministik kural ile onaylandi; AI maliyeti olusmadi',
            icerikSinifi: 'Mal',
            memoryCategory,
            vendorHintUsed: false,
          },
        },
      };
      this.faturaDecisionCache.set(decisionCacheKey, {
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
        value: deterministicDecision,
      });
      await logZeroUsage('mihsap-fatura-rule', 'onay', deterministicDecision.sebep);
      return { ...deterministicDecision, aiCallReason: 'rule_fast_path' };
    }

    const primaryAccountCode = this.extractAccountCode(primaryFaturaAccount);
    const vendorMemoryMatch = primaryAccountCode && vendorHint?.topKategoriler
      ? vendorHint.topKategoriler.find(
          (row) =>
            this.extractAccountCode(row.kategori) === primaryAccountCode &&
            (row.onayAdedi || 0) >= this.getMihsapVendorRuleMinOnay(),
        )
      : null;
    if (
      !input.forceFresh &&
      !hasBosAlanSecenekleri &&
      vendorMemoryMatch &&
      freeContent.available &&
      !freeContent.risk &&
      primaryFaturaAccount &&
      codeType !== 'KARIŞIK' &&
      Number.isFinite(Number(input.tutar))
    ) {
      const memoryCategory = vendorMemoryMatch.kategori || primaryFaturaAccount;
      const sebep = `rule_fast_path: Firma hafizasi ${vendorMemoryMatch.onayAdedi} onay, ayni hesap (${primaryAccountCode}) ve ucretsiz icerik kontrolu temiz; Claude cagrilmadi`;
      const deterministicDecision = {
        karar: 'onay',
        sebep,
        icerikSinifi: 'Firma Hafizasi',
        ocrOzet: `${input.firma || 'Firma'} gecmis hesap hafizasi ile uyumlu`,
        decisionProvider: 'rule-based',
        faturaDecisionCandidate: input.firmaKimlikNo
          ? {
              kararTipi: 'fatura',
              hesapKodu: memoryCategory,
              firmaKimlikNo: input.firmaKimlikNo || null,
              firmaUnvan: input.firma || null,
              taxpayerId: input.mukellefId || null,
            }
          : undefined,
        decisionTrace: ruleDecisionTrace('onay', sebep, memoryCategory, true),
      };
      this.faturaDecisionCache.set(decisionCacheKey, {
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
        value: deterministicDecision,
      });
      await logZeroUsage('mihsap-fatura-vendor-rule', 'onay', sebep);
      return { ...deterministicDecision, aiCallReason: 'vendor_memory_rule_fast_path' };
    }

    if (input.ruleOnly) {
      return {
        karar: 'needs_ai',
        sebep: 'rule_only_no_match',
        aiCallReason: 'rule_only_no_match',
        decisionProvider: 'rule-based',
      };
    }

    if (!hasBosAlanSecenekleri) aiCallReasons.add('manuel_kontrol');
    const system = `Sen bir fatura doğrulayıcısın. VARSAYILAN KARAR: ONAY.

### 🚨 MUTLAK İLK KAPI — HER ŞEYDEN ÖNCE OKU 🚨

**E-FATURA YÖN BİLGİSİ:**
E-fatura belgesinde yazan "Fatura Tipi: SATIŞ" İFADESİ KARŞI FİRMANIN (satıcının) BAKIŞ AÇISIDIR.
Satıcı her faturasına "Fatura Tipi: SATIŞ" yazar — bu e-fatura standardıdır.
Alıcı (mükellefimiz) için aynı fatura ALIŞ'tır.

**EKRANDAKİ işlem yönü "${islemTuru}" — bu tek doğru yön bilgisidir.**

Fatura üzerinde "SATIŞ" yazmasını, ekrandaki ALIŞ moduyla çelişki olarak YORUMLAMA.
"Belge no uyumlu ama Fatura Tipi SATIŞ olarak işaretlenmiş" gibi sebeplerle ATLAMA — BU HATA.
"Senaryo: TICARIFATURA / TEMELFATURA" e-fatura standardıdır, yön bilgisi DEĞİL.
"ETTN: xxx-xxx-xxx" elektronik tebligat numarasıdır, BELGE NO DEĞİL.
"UBL-TR 1.2" / "TR 1.x" XML versiyonudur, BELGE NO DEĞİL.

### /MUTLAK İLK KAPI ###

### NAKLIYE / ARAÇ KURALI ###
Fatura satırında şu ifadelerden HERHANGİ BİRİ geçiyorsa: "nakliye bedeli", "nakliyat bedeli", "taşıma bedeli", "sevk bedeli", "sefer bedeli", "taşımacılık bedeli", "lojistik bedeli", "nakliye ücreti", "nakl bedeli" → KARAR: ONAY.
BU CÜMLELERDE "aracın", "araç", "plaka", "otomobil", "kamyon", "tır" KELİMELERİ GEÇSE DAHİ → ONAY.
"aracın nakliye bedeli" = NAKLİYE HİZMETİ FATURASIDIR, ARAÇ SATIŞI DEĞİLDİR. Bunu "araç satışı" diye yorumlamak YASAK.
"34XXX YYY PLAKALI ARACIN [güzergah] NAKLIYE BEDELİ" formatı = nakliye faturası = ONAY.
Bu kurala uymayan ATLA kararları KESİNLİKLE geçersizdir.
### /NAKLIYE KURALI ###

Sadece aşağıdaki KESİN ATLA LİSTESİ'nden biri varsa atla. Yoksa ONAY. Görüntü okunamazsa emin_degil.

=== BACKEND ZATEN DOĞRULADI (sorgulama) ===
İşlem modu: ${islemTuru} | Kodlar: ${codesArr.join(', ')} | Kod türü: ${codeType}
Ekrandaki fatura türü: ${input.faturaTuru || '?'} | Belge türü: ${input.belgeTuru || '?'}
Mod-kod uyumu: TAMAM. Tarih ayı: TAMAM. Alış/satış yönü: TAMAM.

=== KESİN ATLA LİSTESİ (yalnızca bu 6 durumda atla) ===

⚠️ **KRİTİK — YANILTICI E-FATURA ALANLARI:**
E-fatura belgesinde şu alanlar KARŞI FİRMANIN bakış açısındadır, bunları bizim ekran alanlarımızla karıştırma:
  • "Fatura Tipi: SATIŞ" — satıcı açısından yazılır. Biz alış yapıyorsak NORMAL, atlama sebebi DEĞİL.
  • "Senaryo: TICARIFATURA / TEMELFATURA" — e-fatura standardı, yön bilgisi değil.
  • "ETTN: xxx-xxx-xxx" — Elektronik Tebligat Tebliğ No, BELGE NO DEĞİL.
  • "UBL-TR 1.2" / "TR x.y" — XML versiyon, BELGE NO DEĞİL.
Belge no olarak SADECE faturanın başındaki "Fatura No: XXX" veya "Belge No: XXX" alanına bak.

[A] TARİH FARKLI: MIHSAP ekranındaki tarih (${input.faturaTarihi || '?'}) ile fatura görüntüsündeki tarih AYNI GÜN DEĞİL.
    → Gün/ay/yıl üçünden biri farklıysa atla. Okuyamazsan bu kontrolü GEÇ (atlama).

[B] KDV ORANI FARKLI: Faturadaki KDV oranı (%1/%10/%20) ile ekrandaki KDV oranı eşleşmiyor.
    → Farklıysa atla. Okuyamazsan bu kontrolü GEÇ.

[C] CARİ FİRMA TAMAMEN FARKLI: Ekrandaki firma ile fatura karşı tarafı BAŞKA ŞİRKET (örn. "Ahmet Ltd" vs "Mehmet AŞ").
    → Kısaltma/uzun ad/unvan farkı (LTD ŞTİ vs LİMİTED ŞİRKETİ) önemsiz — ONAY.
    → Bariz farklı şirket isimleriyse atla.

[D] BELGE NO FARKLI: Ekrandaki belge no (${input.belgeNo || '?'}) ile fatura üzerindeki gerçek "Fatura No" FARKLI.
    → Farklıysa atla. ETTN / UBL / Senaryo alanları belge no DEĞİL — onlara bakma.
    → Okuyamazsan bu kontrolü GEÇ.

[E] SABİT KIYMET / DEMİRBAŞ / ARAÇ / MAKİNE:
    ⛔ **Fatura içeriği şunlardan biri ise KARAR: ATLA** (hem ALIŞ hem SATIŞ'ta):
      - Bilgisayar, laptop, yazıcı, telefon (demirbaş)
      - Mobilya, masa, sandalye, dolap, koltuk (demirbaş)
      - Klima, kombi, televizyon, buzdolabı (demirbaş)
      - Araba, kamyon, minibüs, motosiklet (taşıt)
      - Üretim makinesi, tezgah, kompresör, jeneratör (makine)
      - Hat, tesisat, inşaat ekipmanı (tesis)
    Sebep: "Sabit kıymet — amortisman gerekli, kullanıcı elle işlesin"
    AI'nın 253/254/255 koduna yazma hakkı YOK — bu içerikler bulunursa atla.

[E.alt] AÇIK DEMİRBAŞ/ARAÇ/İADE SATIŞI:
    Fatura satırının TAMAMINI bir cümle olarak oku. Cümlede şu kelimelerden BİRİ geçiyorsa ONAY (atlamadan geç):
      "nakliye", "nakliyat", "taşıma", "taşımacılık", "sevk", "sevkiyat", "lojistik", "hat", "güzergah", "sefer", "bedel", "ücret"
    Bu kelimeler yoksa, cümlede AÇIKÇA şunlardan biri YAZIYORSA atla:
      - "İADE FATURASI" büyük harfle
      - "demirbaş satışı", "taşıt satışı" veya satılan şeyin kendi ismi (bilgisayar, yazıcı, klima, mobilya, kompresör, makine teçhizat)
    Parçaları tek tek analiz etme (plaka vs güzergah vs kelime), CÜMLEYİ BÜTÜN OLARAK OKU.
    Örnek: "34FPL505 AVCILAR-KARTAL NAKLİYE BEDELİ" — cümlede "nakliye" ve "bedeli" geçiyor → ONAY.

[F] FATURA TÜRÜ / BELGE TÜRÜ UYUMU:
    Ekrandaki fatura türü: ${input.faturaTuru || '?'}  (örn. NORMAL_SATIS, TEVKIFATLI_SATIS, NORMAL_ALIS, IADE, İHRACAT)
    Ekrandaki belge türü: ${input.belgeTuru || '?'}  (örn. E_FATURA, E_ARSIV, FIS, IRSALIYE)
    Görüntüye bak:
    • Fatura üzerinde "TEVKİFATLI FATURA" / "TEVKİFAT UYGULANIR" yazıyor ama ekrandaki faturaTuru TEVKIFAT içermiyorsa → atla
    • Fatura üzerinde TEVKİFAT YOK ama ekranda TEVKIFATLI seçiliyse → atla
    • Fatura üzerinde "İADE FATURASI" yazıyor ama ekran faturaTuru IADE değilse → atla
    • Fatura "e-Arşiv Fatura" yazıyor ama belgeTuru E_FATURA ise veya tam tersi → atla
    • Fatura "e-Fatura" yazıyor ama belgeTuru E_ARSIV ise → atla
    • Fatura üzerinde "İHRACAT / EXPORT" yazıyor ama faturaTuru normal satışsa → atla

    [F.1] ÖKC FİŞİ vs FATURA UYUMSUZLUĞU (ÇOK ÖNEMLİ):
      ÖKC fişi (yazarkasa fişi) belirteçleri — herhangi biri görülüyorsa belge ÖKC FİŞİ'dir:
        • "Z NO" / "Z NO:" numarası (örn "Z NO:1462")
        • "EKÜ NO" / "EKÜ NO:" numarası
        • "T. SİCİL NO" / "T.SİCİL NO" (yazarkasa sicil numarası)
        • "EMV SATIŞ TUTARI" veya "EMU SATIŞ TUTARI"
        • "FİŞ NO" küçük formatta (örn "FİŞ NO: 0099") — üstte yazarkasa adı/VD ile birlikte
        • Altta "AID:" veya "I:" ve "T:" EMV kart kodları
        • Termal yazıcı görünümlü dar kağıt, "TOPKDV" / "TOPLAM" toplu satırları
      e-Fatura/e-Arşiv belirteçleri — tek başına veya kombinasyon:
        • Üstte "e-FATURA" / "e-ARŞİV FATURA" ibaresi
        • GİB kare kodu / barkod
        • GTİP satırları, satır kalemli tablo (adet, birim fiyat, matrah, KDV, toplam sütunları)
        • ETTN numarası veya fatura no formatı "XXX2026000000123"
      KARAR KURALI:
        • Görüntüde ÖKC göstergelerinden (Z NO / EKÜ NO / T.SİCİL / EMV SATIŞ) en az 2 tanesi KESİN görünüyor
          VE ekrandaki belgeTuru "E_FATURA" veya "E_ARSIV" ise → ATLA ("ÖKC fişi ama Fatura seçilmiş")
        • Görüntüde e-Fatura/e-Arşiv göstergeleri KESİN var ama ekrandaki belgeTuru "FIS" ise → ATLA ("Fatura ama ÖKC seçilmiş")
        • Görüntü ÖKC/yazarkasa fişi ve ekrandaki belgeTuru "FIS" / "Yazarkasa Fişi" ise UYUMLUDUR → ATLA DEME, ONAY.
        • Emin değilsen atlama, GEÇ.

    NOT: Okuyamadığın madde için atlama, GEÇ. Sadece KESİN gördüğün uyumsuzlukta atla.

=== MUTLAK YASAKLAR (asla bu gerekçelerle ATLA deme) ===
× "Mükellef alıcı/satıcı konumunda" / "ALIŞ/SATIŞ konumu" — yön backend'in işi
× "Alış/satış kodu çelişkisi" — yön kontrolü backend'in işi, YAPMA
× "Backend X demiş ama görüntüde Y" cümlesi kurma — backend doğru
× Plaka/güzergah/rota görünce araç satışı çıkarımı
× "Emin değilim ama ihtimal..." — şüpheliyse onay_bekliyor kullan

=== [G] İÇERİK ↔ KOD UYUM KONTROLÜ (YENİ — bir mali müşavirin yaptığı iş) ===
Fatura kalemlerini oku, içeriği SINIFLANDIR:
  • "Mal" (ticari ürün satışı/alışı — gıda, içecek, tekstil, hammadde, yedek parça, bitmiş ürün)
  • "Hizmet" (nakliye, temizlik, danışmanlık, yazılım, iletişim, muhasebe, sigorta)
  • "Sabit Kıymet" (bilgisayar, mobilya, makine, taşıt — işletmede kullanılan uzun ömürlü eşya)
  • "Kira/Kiralama" (gayrimenkul, araç, makine kiralama)
  • "Enerji/Sarf" (elektrik, su, doğalgaz, akaryakıt, kırtasiye, temizlik malzemesi)
  • "Finansal" (faiz, bankacılık, sigorta primi)

Ekrandaki matrah kodu (${codesArr.join(', ')}) içerik türüne UYUYOR mu? Hızlı eşleştirme:
  • **153.xx** (Ticari Mallar) → sadece "Mal" içeriği (ticari ürün alışı)
  • **150.xx / 151.xx / 152.xx** (İlk Madde/Yarı Mamul/Mamul) → hammadde veya üretim malzemesi
  • **157.xx** (Diğer Stoklar) → sarf malzemesi stoklanıyor
  • **253.xx** (Tesis, Makine, Cihazlar) → üretim makinesi, ağır ekipman
  • **254.xx** (Taşıtlar) → araba, kamyon, minibüs (taşıt)
  • **255.xx** (Demirbaşlar) → bilgisayar, masa, mobilya, küçük makine
  • **740.xx** (Hizmet Üretim Maliyeti) → üretimde kullanılan hizmet/sarf (ör. üretim için alınan nakliye, elektrik)
  • **760.xx** (Pazarlama Satış Dağıtım Gid.) → reklam, sosyal medya, tanıtım, kargo-dağıtım
  • **770.xx** (Genel Yönetim Giderleri) → ofis elektriği, internet, kırtasiye, muhasebe, kira
  • **600.xx / 601.xx** (Satışlar) → "Mal" satışı
  • **120.xx / 320.xx** (Alıcı/Satıcı cari) → her tür (cari hesap, matrah değil)

**ALTIN KURAL — Her fatura için mantıksal akıl yürütme (EZBERE YOK):**

Mükellefin sektörü yukarıda MÜKELLEF PROFİLİ'nde verildi. Bu bilgiyle aşağıdaki soruları sor:

1. **Fatura ne içeriyor?** (mal/hizmet açıklaması)
2. **Bu içerik mükellefin NE olduğuyla ilgili?**
   • Mükellefin **satış konusu** mu? (aynı sektörden ürün/hizmet alıyor) → **Mal/Stok grubu** (153/150/152/157)
   • Mükellefin **üretim/hizmet sürecinin parçası** mı? (hizmet sektörü için yakıt, depo elektriği, sarf gibi iş için kullanılan gider) → **Hizmet Üretim Maliyeti** (740)
   • Mükellefin **pazarlama/satış aşamasının** parçası mı? (reklam, kargo, tanıtım) → **Pazarlama Satış Dağıtım** (760)
   • **Yönetim/ofis giderleri** (ofis elektriği, kırtasiye, muhasebe hizmeti) → **Genel Yönetim** (770)
   • **İşletmede uzun süre kullanılacak eşya** mı? → **Sabit Kıymet** (253 makine / 254 taşıt / 255 demirbaş)
   • **Finansman** (faiz, bankacılık, sigorta primi) → 780 veya ilgili

3. **Ekrandaki kod** (${codesArr.join(', ')}) **yukarıda çıkardığın mantıksal koda uyuyor mu?**
   • Uyuyorsa → **onay**
   • Ana hesap grubu farklıysa → **onay_bekliyor** (sebep: "X olmalı ama Y seçilmiş")

**ÖRNEK AKIL YÜRÜTME — faaliyete göre farklılık:**
  • Mükellef = gıda toptancısı, fatura = gıda → satış konusu → 153 doğru
  • Mükellef = inşaat, fatura = gıda → satış konusu DEĞİL, personel için → 770 doğru
  • Mükellef = nakliye, fatura = akaryakıt → işin maliyeti → **740 doğru** (ezbere 770 DEĞİL)
  • Mükellef = nakliye, fatura = depo kirası → işin maliyeti → **740 doğru**
  • Mükellef = nakliye, fatura = ofis kirası → yönetim → 770 doğru
  • Mükellef = imalatçı, fatura = fabrika elektriği → üretim → **740 / 730**
  • Mükellef = imalatçı, fatura = ofis elektriği → yönetim → 770
  • Mükellef = ofis işletmesi, fatura = ofis elektriği → 770 doğru
  • Mükellef = her sektör, fatura = bilgisayar → uzun süre kullanım → **255** doğru

**NOT:** Fatura AÇIKLAMASI net değilse (sadece "hizmet bedeli" gibi) onay ver — aksi halde aşırı titiz atmış olursun.

Kontrolde **ekran kodunun ilk 3 hanesi** dikkate alınır (153.01.005 → 153). Alt kırılım (153.01.001 vs 153.01.005) kontrol EDİLMEZ.

**UYUMLUYSA** → onay. Emin değilsen → onay_bekliyor (ATLA değil — kullanıcı bakacak).

=== KARAR AKIŞI (yeni) ===
1. [A][B][C][D][E][F] kesinse → **atla** (ekran-görüntü tutarsızlığı, özel durum)
2. [G] içerik-kod uyumsuzluğu varsa (mükellef sektörü dahil) → **onay_bekliyor** (kullanıcı bakacak)
3. Görüntü tamamen okunamıyor mu? → **emin_degil**
4. Diğer tüm durumlar → **onay** (F2)

NOT: "onay_bekliyor" ATLA DEĞİL. Fatura kullanıcının onay kuyruğuna düşer, kullanıcı elle karar verir.

${vendorHint ? `
${vendorHint.hintText}` : ''}
${mukellefTalimat ? `
=== MÜKELLEF ÖZEL TALİMATI (${input.mukellef}) ===
${mukellefTalimat}

[TALİMAT YORUM KURALLARI — ÇOK ÖNEMLİ]
Yukarıdaki talimatta "araç satışı" geçiyor. Bunu UYGULAMAK için şu ŞART'ı ara:
  Fatura satırında AÇIKÇA şunlardan biri yazıyor olmalı:
    • "ARAÇ SATIŞ BEDELİ" / "TAŞIT SATIŞ BEDELİ" / "OTO SATIŞ BEDELİ"
    • "aracın satış bedeli" / "aracın satışı"
    • "DEMİRBAŞ SATIŞI" + araç modeli/şasisi

ŞUNLAR "ARAÇ SATIŞI" DEĞİLDİR — TALİMATI TETİKLEMEZ:
  ✗ "plakalı aracın X nakliye bedeli" → taşımayı yapan aracın nakliye ücreti (ONAY)
  ✗ "34ABC123 PLAKALI ARAÇ [güzergah] NAKLIYE" → nakliye hizmeti (ONAY)
  ✗ Plaka + güzergah + "bedel/ücret/nakliye" kombinasyonu → hizmet faturası (ONAY)
  ✗ İçerikte "araç" kelimesi geçiyor olması tek başına araç satışı DEĞİL

Cümlede "nakliye/taşıma/sevk/lojistik/sefer" kelimesi geçiyorsa, içerikte plaka veya "araç" kelimesi de olsa DAHİ → ONAY.
` : ''}
${
  // Hem ALIŞ hem SATIŞ modunda — boş alan seçeneği verildiyse öneri bölümünü ekle
  ['isle_satis', 'isle_alis', 'isle_satis_isletme', 'isle_alis_isletme'].includes(input.action || '') && input.bosAlanSecenekleri &&
  ((input.bosAlanSecenekleri.matrahKodlari?.length || 0) +
   (input.bosAlanSecenekleri.kdvKodlari?.length || 0) +
   (input.bosAlanSecenekleri.cariKodlari?.length || 0)) > 0
  ? `
=== HESAP KODU ÖNERİSİ — ${islemTuru} ===
Runner bu faturada BOŞ alan tespit etti. Dropdown'daki mevcut seçeneklerden doğru kodu sen seçeceksin.
Mevcut seçenekler aşağıda. HER ALAN İÇİN tam olarak bu listelerden BİRİNİ seç — listenin dışından kod ÜRETME.

A) MATRAH HESABI (faturanın KDV'siz bedeli hangi ${islemTuru === 'SATIŞ' ? 'satış' : 'alış/gider'} hesabına yazılacak):
   Seçenekler: ${input.bosAlanSecenekleri.matrahKodlari?.join(', ') || '(runner listelemedi — önerme)'}

   🔴 KRİTİK KURAL (v1.36.23) — KDV ORAN EŞLEŞMESİ (KOŞULLU):
   ÖNCE listedeki hesap kodu AÇIKLAMALARINDA KDV oranı (%1, %01, %8, %08, %10, %18, %20) yazıyor mu kontrol et.

   ───────────────────────────────────────────────────────────
   DURUM 1: Hesaplardan EN AZ İKİSİ farklı KDV oranı içeriyor
   ───────────────────────────────────────────────────────────
   Örn: "153.01.010-%10 TİCARİ MAL ALIŞLARI" + "153.01.020-%20 TİCARİ MAL ALIŞLARI"
   → KDV oran eşleşmesi ZORUNLU. Faturanın KDV oranıyla AYNI %X içeren kodu seç.
   → Eşleşmezse matrahHesapKodu: null + onay_bekliyor.
   → Geçmişte farklı oranda kullanıldıysa bile bu faturanın oranına göre git.

   ───────────────────────────────────────────────────────────
   DURUM 2: Hesaplardan HİÇBİRİNDE KDV oranı YAZMIYOR (veya hepsi aynı)
   ───────────────────────────────────────────────────────────
   Örn: sadece "153.01.001 TİCARİ MAL ALIŞLARI" + "150.01.001 İLK MADDE"
   → KDV oran eşleşmesi UYGULANMAZ. Sektör/içerik mantığıyla seç.
   → Tek kod varsa direkt onu seç.

   ───────────────────────────────────────────────────────────
   DURUM 3: Bazı kodlarda %X var, bazılarında yok (KARIŞIK)
   ───────────────────────────────────────────────────────────
   → Önce %X yazan kodlar arasında oran eşleşeni bul. Bulursan onu seç.
   → Bulamazsan: %X yazmayan kodlardan içeriğe en uyanı seç.
   → Hiçbiri uymadıysa null + onay_bekliyor.

   ${islemTuru === 'SATIŞ' ? `SATIŞ kuralı:
     • 600.xx → Yurtiçi Mal/Hizmet Satışı (en yaygın)
     • 601.xx → Yurtdışı Satış (İHRACAT faturalarında)
     • 602.xx → Diğer Satışlar` : `ALIŞ kuralı — fatura içeriğine göre seç:
     • 153.xx → Ticari Mal Alışı (mükellefin satış konusuyla aynı ürün)
     • 150.xx → İlk Madde/Malzeme (üretimde kullanılacak hammadde)
     • 740.xx → Hizmet Üretim Maliyeti (mükellefin işinin maliyeti — ör. nakliyecinin yakıtı)
     • 760.xx → Pazarlama/Satış/Dağıtım Gideri (reklam, kargo, tanıtım)
     • 770.xx → Genel Yönetim Gideri (ofis, elektrik, kira, muhasebe, internet)

     ⛔ **SABİT KIYMET (253/254/255) YASAK**: Fatura içeriği bilgisayar/mobilya/makine/taşıt ise
     → karar: "atla", sebep: "Sabit kıymet alımı — kullanıcı elle işlesin"
     → Bu ürünler amortisman gerektirir, AI otomatik işlemez.`}
   Fatura satırındaki ÜRÜN/HİZMET AÇIKLAMASINA + mükellef sektörüne bak.
   ÖNCELİK: KDV oran eşleşmesi → sektör/içerik uygunluğu → tek kod ise direkt seç.

B) KDV HESABI:
   Seçenekler: ${input.bosAlanSecenekleri.kdvKodlari?.join(', ') || '(runner listelemedi — önerme)'}
   ${islemTuru === 'SATIŞ' ? `Kural: Satışta KDV hep 391 grubunda (Hesaplanan KDV).`
    : `Kural: Alışta KDV hep 191 grubunda (İndirilecek KDV).`}
   🔴 KDV oran eşleşmesi MATRAH ile aynı kuralda: hesap kodu açıklamasındaki %X faturanın KDV oranı ile eşleşmeli.
   Listede birden fazla alt kod varsa, MATRAH seçtiğin kodla AYNI alt gruplama mantığı önceliklidir.
   ⚠ KDV oran eşleşmiyorsa → kdvHesapKodu: null + onay_bekliyor.

C) CARİ HESAP:
   Seçenekler: ${input.bosAlanSecenekleri.cariKodlari?.join(', ') || '(runner listelemedi — önerme)'}
   ${islemTuru === 'SATIŞ' ? `Kural: Alici firmayi 120.xx cariye sadece profil buna izin veriyorsa eslestir.`
    : `Kural: Satici firmayi 320.xx cariye sadece profil buna izin veriyorsa eslestir.`}
   PROFIL KAPISI ZORUNLU:
   - Cari takip politikasi "hepsi_cari" ise cari eslestirme serbesttir.
   - "sadece_tanimli" veya "cari_yoksa_odeme" ise 120/320 sadece firma adi "Cari takip edilecek surekli tedarikciler" listesinde acikca geciyorsa secilir.
   - Firma bu listede degilse 120/320 secme; cari yoksa kullanilacak hesap / odeme hesabi / tahsilat hesabi neyse onu sec (orn. 100.01.001).
   - Emin degilsen 120/320 yerine odeme hesabi sec veya null birak; yanlis cariye otomatik F2 en riskli hatadir.
   Cari kod listesinde firma YOKSA ama mukellef profilinde cari yoksa kullanilacak hesap/odeme hesabi tanimliysa (orn. 100.01.001), onu cariHesapKodu olarak oner.
   Profilde acik tanimli hesap kodu varsa ve fatura icerigiyle uyumluysa, dropdown sondaj listesinde gorunmese bile onu onerebilirsin; runner kodu yazarak secmeyi deneyecek.

ÇIKTI: JSON response'una "onerilenler" objesi ekle (AŞAĞIDAKİ JSON ŞEMASINA BAK).
       Emin olmadığın alanı null bırak. Yanlış tahmin etme — null daha güvenli.
       Confidence: her alan için 0-1 arası skor. 0.8 altındaki önerileri runner uygulamayacak.
` : ''
}

=== SEBEP YAZIM KURALI (ÇOK ÖNEMLİ) ===
İşlem yönü "${islemTuru}" — MÜKELLEF AÇISINDAN yazarken:
• ALIŞ ise: "mal alışı", "hizmet alışı", "gider kaydı", "tedarik" gibi terim kullan.
• SATIŞ ise: "mal satışı", "hizmet satışı", "gelir kaydı" gibi terim kullan.
• Karşı firmanın bakış açısını YAZMA. Mükellef ALIŞ yaparken "mal satışı geçerli" DEME, "mal alışı geçerli" de.
• "fatura geçerli" tarzı nötr ifadeler de olabilir.

=== STRUCTURED ALAN ÇIKARIMI ===
Fatura görüntüsünden şu alanları da çıkarıp JSON'a ekle (okunamazsa null):
• tarih: "DD.MM.YYYY" veya "DD-MM-YYYY" formatında
• belgeNo: fatura üzerindeki belge/fiş/ETTN numarası
• cari: fatura üzerindeki karşı tarafın tam ünvanı
• belgeTuru: "E_FATURA" | "E_ARSIV" | "FIS" | "IRSALIYE" (görüntüden tespit ettiğin)
• kdvOrani: "0" | "1" | "10" | "20" (ana KDV oranı, birden fazla varsa dominant olan)
• ocrToplam: faturadaki TOPLAM (ödenecek/genel toplam) tutarı, sayı olarak (örn: 3316.00). Para birimi/TL/virgül olmadan.
• ocrMatrah: faturadaki MATRAH (KDV hariç toplam) tutarı, sayı olarak. Birden fazla matrah varsa AYNI orandakileri topla.
• ocrKdvTutari: faturadaki TOPLAM KDV tutarı, sayı olarak.
NOT: Bu üç değer ÇOK ÖNEMLİ — Mihsap'a giriş hatası kontrolü için kullanılacak. Görüntüden tam okunmuyorsa null dön, asla tahmin etme.

Sadece JSON döndür: {
  "karar": "onay|atla|onay_bekliyor|emin_degil",
  "sebep": "mükellef açısından 80 karakter (onay_bekliyor ise net sebep: 'Sabit kıymet 253 olmalı', 'Faaliyet uymuyor' vb.)",
  "icerikSinifi": "Mal|Hizmet|Sabit Kıymet|Kira|Enerji/Sarf|Finansal" ,
  "ocrOzet": "1 satır",
  "tarih": "18.03.2026" | null,
  "belgeNo": "TEE2026000000384" | null,
  "cari": "Karşı Firma Tam Ünvanı" | null,
  "belgeTuru": "E_FATURA|E_ARSIV|FIS|IRSALIYE" | null,
  "kdvOrani": "20" | null,
  "ocrToplam": 3316.00 | null,
  "ocrMatrah": 2763.33 | null,
  "ocrKdvTutari": 552.67 | null${
    ['isle_satis', 'isle_alis', 'isle_satis_isletme', 'isle_alis_isletme'].includes(input.action || '') && input.bosAlanSecenekleri
      ? `,
  "onerilenler": {
    "matrahHesapKodu": "600.01.005" | null,
    "kdvHesapKodu": "391.01.006" | null,
    "cariHesapKodu": "120.01.ABC" | null,
    "confidence": { "matrah": 0.92, "kdv": 0.95, "cari": 0.75 }
  }`
      : ''
  }
}`;

    const userText = `Mükellef: ${input.mukellef || '?'} | Karşı firma: ${input.firma || '?'}
Kodlar: ${kodListe || '(boş)'} | Tarih: ${input.faturaTarihi || '?'} | Belge no: ${input.belgeNo || '?'}
Belge türü: ${input.belgeTuru || '?'} | Tutar: ${input.tutar || '?'} | Hedef ay: ${input.hedefAy || '?'}

Fatura görüntüsünü incele ve yukarıdaki sistem talimatlarına göre JSON döndür.`;

    const logUsage = (
      karar: string | undefined,
      sebep: string | undefined,
      usage?: any,
    ) => {
      const reasonText = [...aiCallReasons].join(',') || 'manuel_kontrol';
      return logAiUsage(this.prisma, {
        tenantId: input.tenantId || 'unknown',
        taxpayerId: input.mukellefId || null,
        source: 'mihsap-fatura',
        model: MODEL,
        mukellef: input.mukellef,
        belgeNo: input.belgeNo,
        karar,
        sebep: `[reason=${reasonText}] ${sebep || ''}`.trim(),
        durationMs: Date.now() - startMs,
        cacheHit: false,
        usage,
      });
    };

    let cheapDecision =
      decisionMode === 'claude_only'
        ? null
        : await this.tryMihsapCheapFaturaDecision(input, system, userText, rule);

    if (decisionMode === 'balanced' && this.isCheapFaturaAcceptable(cheapDecision, input, vendorHint)) {
      return this.finalizeCheapFaturaDecision(
        cheapDecision!,
        input,
        decisionCacheKey,
        (input.hesapKodlari?.[0] || '').trim(),
      );
    }

    if (!apiKey && !cheapDecision) {
      cheapDecision = await this.tryMihsapCheapFaturaDecision(input, system, userText, rule, true);
    }
    if (!apiKey && this.isCheapFaturaAcceptable(cheapDecision, input, vendorHint)) {
      return this.finalizeCheapFaturaDecision(
        cheapDecision!,
        input,
        decisionCacheKey,
        (input.hesapKodlari?.[0] || '').trim(),
      );
    }

    if (!apiKey) {
      return {
        karar: 'emin_degil',
        sebep: `ANTHROPIC_API_KEY yok; ucuz karar yeterli degil (${cheapDecision?.fallbackReason || 'fallback gerekli'})`,
        decisionProvider: cheapDecision?.provider || 'none',
        ocrProvider: cheapDecision?.ocrProvider || null,
        fallbackReason: cheapDecision?.fallbackReason || 'anthropic_key_missing',
        cheapConfidence: cheapDecision?.confidence ?? null,
      };
    }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // v1.36.40: Prompt caching aktif — system prompt 5 dk cache'lenir.
          // Haiku 4.5 fiyatlama: cache write 1.25×, cache read 0.1× (10× ucuz).
          // Aynı islemTuru + benzer hesap planı ardışık çağrılarda input maliyeti düşer.
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model: MODEL,
          // Öneri modunda cevap daha uzun (onerilenler JSON'u eklenir) → 900 token güvenli
          max_tokens: input.bosAlanSecenekleri ? 900 : 600,
          // v1.36.40: system'i array yap + cache_control ekle.
          // Tüm system bloğu önbelleğe alınır; benzer prefix'li çağrılar input maliyetinde
          // ~%80-90 tasarruf sağlar (cache hit halinde $1.0/M → $0.1/M).
          system: [
            { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
          ],
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: input.faturaImageMediaType || 'image/jpeg',
                    data: input.faturaImageBase64,
                  },
                },
                { type: 'text', text: userText },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        const claudeError = this.classifyClaudeApiError(res.status, errText);
        if (!cheapDecision && (claudeError.code === 'claude_billing_or_quota' || claudeError.code === 'claude_rate_limit')) {
          cheapDecision = await this.tryMihsapCheapFaturaDecision(input, system, userText, rule, true);
        }
        if (this.isCheapFaturaAcceptable(cheapDecision, input, vendorHint)) {
          await logUsage('onay', `${claudeError.code}: cheap fallback kullanildi`);
          return this.finalizeCheapFaturaDecision(
            cheapDecision!,
            input,
            decisionCacheKey,
            (input.hesapKodlari?.[0] || '').trim(),
          );
        }
        await logUsage('emin_degil', claudeError.logMessage);
        return {
          karar: 'emin_degil',
          sebep: claudeError.userMessage,
          decisionProvider: 'claude',
          providerError: true,
          providerErrorCode: claudeError.code,
          ocrProvider: cheapDecision?.ocrProvider || null,
          fallbackReason: cheapDecision?.fallbackReason || claudeError.code,
          cheapConfidence: cheapDecision?.confidence ?? null,
        };
      }
      const json = await res.json();
      const text = json?.content?.[0]?.text || '';
      const usage = json?.usage || {};

      // JSON parse (çok katmanlı)
      const codeBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      const candidates: string[] = [];
      if (codeBlock) candidates.push(codeBlock[1]);
      const greedy = text.match(/\{[\s\S]*\}/);
      if (greedy) candidates.push(greedy[0]);
      const nonGreedy = text.match(/\{[\s\S]*?"karar"[\s\S]*?\}/);
      if (nonGreedy) candidates.push(nonGreedy[0]);

      // kategori key (Firma Hafizasi icin) — KDV/cari/odeme hesabi yerine asıl matrah/gider hesabini kullan.
      const ekranKategoriAdayi = primaryFaturaAccount || (input.hesapKodlari?.[0] || '').trim();

      for (const c of candidates) {
        try {
          const parsed = JSON.parse(c);
          if (parsed?.karar) {
            // === POST-PROCESSING: AI Hallüsinasyon Filtresi ===
            // AI "atla" dediğinde sebep'i kontrol et — geçersiz sebep varsa ONAY'a çevir.
            // Bunlar prompt'ta açıkça yasaklanmış ama AI bazen inatçı, burada override ediyoruz.
            if (parsed.karar === 'atla' && typeof parsed.sebep === 'string') {
              const sebepLower = parsed.sebep.toLowerCase();
              const gecersizSebepKaliplari = [
                'fatura tipi sati',      // "Fatura Tipi: SATIŞ" / "Fatura Tipi SATIŞ"
                'fatura tipi: sati',
                'satıcı: mükellef',      // "satıcı: Mükellef"
                'senaryo: ticari',       // e-fatura senaryo
                'senaryo:ticari',
                'senaryo ticari',
                'ettn',                  // ETTN numarası belge no değil
                'ubl-tr',                // XML versiyon
                'ubl tr 1',
                'tr 1.2',
                'tr1.2',
                'tr 1.3',
                'satış türü (satıcı',    // "SATIŞ türü (satıcı: Mükellef)"
              ];
              const gecersizMi = gecersizSebepKaliplari.some(k => sebepLower.includes(k));
              if (gecersizMi) {
                // AI hatalı atladı — override et, ONAY'a çevir
                const orijSebep = parsed.sebep;
                parsed.karar = 'onay';
                parsed.sebep = `F2 · otomatik onay (AI\'nın "${orijSebep.slice(0, 60)}" sebebi geçersiz — karşı firma yön bilgisi)`;
                parsed._overrideReason = 'ai-gecersiz-sebep';
              }
              const fold = (v: any) => String(v || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/ı/g, 'i');
              const sebepFold = fold(parsed.sebep);
              const ekranBelgeFold = fold(input.belgeTuru);
              const aiBelgeFold = fold(parsed.belgeTuru);
              const ekranFis = /(fis|okc|yazarkasa|perakende)/.test(ekranBelgeFold);
              const ekranFatura = /e[_\s-]?(fatura|arsiv)|fatura/.test(ekranBelgeFold);
              const kisaSayisalFisNo = /^\d{1,6}$/.test(String(input.belgeNo || '').trim());
              const aiOkcDiyor = /(okc|yazarkasa|z\s*no|eku\s*no|terminal|fisidir|fisidir|fis\s*uyumsuzlugu)/.test(sebepFold)
                || /(fis|okc|yazarkasa)/.test(aiBelgeFold);
              const aiFaturaDiyor = /(e[_\s-]?fatura|e[_\s-]?arsiv)/.test(aiBelgeFold)
                || /fatura ama/.test(sebepFold);
              if (parsed.karar === 'atla' && ekranFis && aiOkcDiyor && !aiFaturaDiyor) {
                const orijSebep = parsed.sebep;
                parsed.karar = 'onay';
                parsed.sebep = `ÖKC/Yazarkasa fişi ekrandaki belge türüyle uyumlu — otomatik onay`;
                parsed._overrideReason = 'okc-fis-uyumlu';
                parsed._originalSebep = orijSebep;
              }
              if (parsed.karar === 'atla' && ekranFatura && aiOkcDiyor && kisaSayisalFisNo && !aiFaturaDiyor) {
                const orijSebep = parsed.sebep;
                parsed.karar = 'onay';
                parsed.sebep = `ÖKC/Yazarkasa fişi tespit edildi; kısa fiş no nedeniyle eski belge türü bilgisi yok sayıldı`;
                parsed._overrideReason = 'okc-fis-api-belge-turu-stale';
                parsed._originalSebep = orijSebep;
              }
            }

            // Öneri mod: AI'nın önerdiği kodları gerçekten dropdown'da var mı ve
            // güven skoru >= 0.8 mi diye doğrula. Halüsinasyon korumasıdır.
            if (input.bosAlanSecenekleri && parsed.onerilenler) {
              parsed.onerilenler = this.applyCariPolicyToOneriler(
                parsed.onerilenler,
                input,
                rule?.profile,
              );
              parsed.onerilenler = this.sanitizeHesapKoduOnerileri(
                parsed.onerilenler,
                input.bosAlanSecenekleri,
              );
            }
            const memoryCategory = this.resolveFaturaMemoryCategory(parsed, ekranKategoriAdayi);
            const decisionTrace = {
              belge: {
                tarih: parsed.tarih || null,
                belgeNo: parsed.belgeNo || null,
                cari: parsed.cari || null,
                belgeTuru: parsed.belgeTuru || null,
                kdvOrani: parsed.kdvOrani ?? null,
                ocrToplam: parsed.ocrToplam ?? null,
                ocrMatrah: parsed.ocrMatrah ?? null,
                ocrKdvTutari: parsed.ocrKdvTutari ?? null,
              },
              ekran: {
                tarih: input.faturaTarihi || null,
                belgeNo: input.belgeNo || null,
                belgeTuru: input.belgeTuru || null,
                faturaTuru: input.faturaTuru || null,
                tutar: input.tutar ?? null,
                hesapKodlari: input.hesapKodlari || [],
              },
              karar: {
                sonuc: parsed.karar,
                sebep: parsed.sebep || null,
                icerikSinifi: parsed.icerikSinifi || null,
                memoryCategory: memoryCategory || null,
                vendorHintUsed: !!vendorHint,
              },
            };

            // === FIRMA HAFIZASI ENTEGRASYONU ===
            // Sadece AI "onay" derse memory'ye yansit. "atla"/"emin_degil" etkilemez.
            if (
              parsed.karar === 'onay' &&
              input.tenantId &&
              input.firmaKimlikNo &&
              memoryCategory
            ) {
              // Sapma var mi?
              if (vendorHint) {
                const sapma = this.vendorMemory.detectDeviation({
                  topKategoriler: vendorHint.topKategoriler,
                  aiKategori: memoryCategory,
                  aiAltKategori: null,
                });
                if (sapma.isSapma) {
                  // Onay kuyruguna dus, AI'yi otomatik islemeden durdur
                  try {
                    const pending = await this.pendingDecisions.create({
                      tenantId: input.tenantId,
                      taxpayerId: input.mukellefId || null,
                      mukellef: input.mukellef,
                      firmaKimlikNo: input.firmaKimlikNo,
                      firmaUnvan: input.firma,
                      belgeNo: input.belgeNo,
                      belgeTuru: input.belgeTuru,
                      faturaTarihi: input.faturaTarihi,
                      tutar: typeof input.tutar === 'number' ? input.tutar : (input.tutar ? Number(input.tutar) : null),
                      kararTipi: 'fatura',
                      aiKarari: { ...parsed, hesapKodu: memoryCategory, decisionTrace },
                      gecmisBeklenen: {
                        topKategoriler: vendorHint.topKategoriler,
                        enCok: sapma.enCokGecmisKategori,
                        enCokSayisi: sapma.enCokGecmisOnaySayisi,
                      },
                      sapmaSebep: sapma.sebep,
                      imageBase64: input.faturaImageBase64,
                    });
                    await logUsage('onay_bekliyor', sapma.sebep, usage);
                    return {
                      karar: 'onay_bekliyor',
                      sebep: sapma.sebep,
                      pendingId: pending.id,
                      sapmaSebep: sapma.sebep,
                    };
                  } catch (e: any) {
                    // Pending olusturma basarisizsa AI kararina gec — guvenli fallback
                    await logUsage(parsed.karar, `pending create failed: ${e?.message}`, usage);
                    return {
                      karar: 'onay_bekliyor',
                      sebep: `Onay kuyruğu oluşturulamadı: ${e?.message || 'bilinmeyen hata'}`,
                      decisionTrace,
                      decisionProvider: 'claude',
                      ocrProvider: cheapDecision?.ocrProvider || null,
                      fallbackReason: cheapDecision?.fallbackReason || 'pending_create_failed',
                      cheapConfidence: cheapDecision?.confidence ?? null,
                    };
                  }
                }
              }
              // Sapma yoksa hafiza kaydi burada yapilmaz; F2 basari log'u geldikten
              // sonra createEvent icinde kaydedilir.
            }
            // === /FIRMA HAFIZASI ===

            if (parsed.karar === 'onay' && memoryCategory) {
              parsed.faturaDecisionCandidate = {
                kararTipi: 'fatura',
                hesapKodu: memoryCategory,
                firmaKimlikNo: input.firmaKimlikNo || null,
                firmaUnvan: input.firma || null,
                taxpayerId: input.mukellefId || null,
              };
            }
      parsed.decisionTrace = decisionTrace;
      parsed.aiCallReason = [...aiCallReasons].join(',') || 'manuel_kontrol';
      parsed.decisionProvider = 'claude';
      parsed.ocrProvider = cheapDecision?.ocrProvider || null;
      parsed.fallbackReason = cheapDecision?.fallbackReason || (cheapDecision ? 'claude_shadow_or_fallback' : null);
      parsed.cheapConfidence = cheapDecision?.confidence ?? null;
      parsed.shadowDiff = decisionMode === 'shadow'
        ? this.buildMihsapShadowDiff('fatura', cheapDecision?.parsed, parsed)
        : null;
      await this.logMihsapShadowDiff('mihsap-fatura-shadow', input, parsed.shadowDiff, cheapDecision);
      this.faturaDecisionCache.set(decisionCacheKey, {
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
        value: parsed,
      });
      await logUsage(parsed.karar, parsed.sebep, usage);
      return parsed;
          }
        } catch {}
      }

      const kararM = text.match(/"karar"\s*:\s*"(onay|atla|emin_degil)"/);
      const sebepM = text.match(/"sebep"\s*:\s*"([^"]{0,200})"/);
      if (kararM) {
        await logUsage(kararM[1], sebepM?.[1] || 'partial parse', usage);
        return {
          karar: kararM[1],
          sebep: sebepM?.[1] || 'partial parse',
          raw: text.slice(0, 200),
          decisionProvider: 'claude',
          ocrProvider: cheapDecision?.ocrProvider || null,
          fallbackReason: cheapDecision?.fallbackReason || null,
          cheapConfidence: cheapDecision?.confidence ?? null,
        };
      }

      if (this.isCheapFaturaAcceptable(cheapDecision, input, vendorHint)) {
        await logUsage('onay', 'claude_json_parse_fail: cheap fallback kullanildi', usage);
        return this.finalizeCheapFaturaDecision(
          cheapDecision!,
          input,
          decisionCacheKey,
          (input.hesapKodlari?.[0] || '').trim(),
        );
      }
      await logUsage('emin_degil', 'JSON parse fail', usage);
      return {
        karar: 'emin_degil',
        sebep: 'JSON parse fail',
        raw: text.slice(0, 200),
        decisionProvider: 'claude',
        ocrProvider: cheapDecision?.ocrProvider || null,
        fallbackReason: cheapDecision?.fallbackReason || 'claude_json_parse_fail',
        cheapConfidence: cheapDecision?.confidence ?? null,
      };
    } catch (e: any) {
      if (!cheapDecision) {
        cheapDecision = await this.tryMihsapCheapFaturaDecision(input, system, userText, rule, true);
      }
      if (this.isCheapFaturaAcceptable(cheapDecision, input, vendorHint)) {
        await logUsage('onay', `claude_network_error: cheap fallback kullanildi`);
        return this.finalizeCheapFaturaDecision(
          cheapDecision!,
          input,
          decisionCacheKey,
          (input.hesapKodlari?.[0] || '').trim(),
        );
      }
      await logUsage('emin_degil', `Network: ${e?.message || 'unknown'}`);
      return {
        karar: 'emin_degil',
        sebep: `Network: ${e?.message || 'unknown'}`,
        decisionProvider: 'claude',
        providerError: true,
        providerErrorCode: 'claude_network_error',
        ocrProvider: cheapDecision?.ocrProvider || null,
        fallbackReason: cheapDecision?.fallbackReason || 'claude_network_error',
        cheapConfidence: cheapDecision?.confidence ?? null,
      };
    }
  }

  /**
   * AI'nın önerdiği hesap kodlarını doğrular:
   *  - Kod gerçekten dropdown seçeneklerinde var mı? (halüsinasyon koruması)
   *  - Güven skoru MIN_CONFIDENCE (0.8) üstü mü? Değilse null.
   * Geçersiz öneri → null döner → runner bu alanı boş bırakıp atlar.
   */
  private sanitizeHesapKoduOnerileri(
    oneriler: any,
    secenekler: { matrahKodlari?: string[]; kdvKodlari?: string[]; cariKodlari?: string[] },
  ): any {
    const MIN_CONFIDENCE = this.getMihsapMinConfidence();
    const conf = (oneriler?.confidence as Record<string, number>) || {};
    const validateKod = (
      kod: any,
      izinliListe: string[] | undefined,
      guvenSkoru: number | undefined,
    ): string | null => {
      if (!kod || typeof kod !== 'string') return null;
      const trimmed = kod.trim();
      if (!trimmed) return null;
      // Listede yoksa halüsinasyon → reddet
      if (!izinliListe || izinliListe.length === 0) return null;
      if (!izinliListe.includes(trimmed)) return null;
      // Güven düşükse → reddet
      if (typeof guvenSkoru === 'number' && guvenSkoru < MIN_CONFIDENCE) return null;
      return trimmed;
    };
    return {
      matrahHesapKodu: validateKod(oneriler?.matrahHesapKodu, secenekler.matrahKodlari, conf.matrah),
      kdvHesapKodu: validateKod(oneriler?.kdvHesapKodu, secenekler.kdvKodlari, conf.kdv),
      cariHesapKodu: validateKod(oneriler?.cariHesapKodu, secenekler.cariKodlari, conf.cari),
      confidence: conf,
    };
  }

  private applyCariPolicyToOneriler(
    oneriler: any,
    input: { firma?: string; action?: string; bosAlanSecenekleri?: { cariKodlari?: string[] } },
    profile: any,
  ): any {
    if (!oneriler || !profile) return oneriler;
    const policy = String(profile.cariTakipPolitikasi || '').trim();
    if (!policy || policy === 'hepsi_cari') return oneriler;

    const selected = typeof oneriler.cariHesapKodu === 'string' ? oneriler.cariHesapKodu.trim() : '';
    const selectedCari = /^(120|320)\./.test(selected);
    if (!selectedCari) return oneriler;

    const firma = this.normalizeCariName(input.firma || '');
    const listed = this.isFirmaInSurekliTedarikciler(firma, profile.surekliTedarikciler);
    if (listed) return oneriler;

    if (policy === 'cari_yoksa_onay') {
      const next = { ...oneriler, confidence: { ...(oneriler.confidence || {}) } };
      next.cariHesapKodu = null;
      next.confidence.cari = 0;
      next._cariPolicyOverride = `non-listed vendor requires approval: ${selected}`;
      return next;
    }

    const allowed = input.bosAlanSecenekleri?.cariKodlari || [];
    const candidates = [
      profile.cariYoksaHesap,
      input.action === 'isle_satis' || input.action === 'isle_satis_isletme'
        ? profile.tahsilatHesabi
        : profile.odemeHesabi,
      profile.odemeHesabi,
      profile.tahsilatHesabi,
      '100.01.001',
      '102.01.001',
    ]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim());

    const preferred = candidates.find((code) => allowed.includes(code));
    const next = { ...oneriler, confidence: { ...(oneriler.confidence || {}) } };
    if (preferred) {
      next.cariHesapKodu = preferred;
      next.confidence.cari = Math.max(Number(next.confidence.cari) || 0, 0.95);
      next._cariPolicyOverride = `non-listed vendor: ${selected} -> ${preferred}`;
    } else {
      next.cariHesapKodu = null;
      next.confidence.cari = 0;
      next._cariPolicyOverride = `non-listed vendor blocked: ${selected}`;
    }
    return next;
  }

  private isFirmaInSurekliTedarikciler(firma: string, surekliTedarikciler: any): boolean {
    if (!firma || typeof surekliTedarikciler !== 'string') return false;
    return surekliTedarikciler
      .split(/[\n,;]+/)
      .map((v) => this.normalizeCariName(v))
      .filter((v) => v.length >= 4)
      .some((name) => firma.includes(name) || name.includes(firma));
  }

  private normalizeCariName(value: string): string {
    return value
      .toLocaleUpperCase('tr-TR')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\b(ANONIM|LIMITED|SIRKETI|SIRKET|TICARET|SANAYI|VE|A S|LTD|STI)\b/g, ' ')
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private resolveFaturaMemoryCategory(parsed: any, ekranKategoriAdayi: string): string {
    const direct =
      parsed?.hesapKodu ||
      parsed?.kategori ||
      parsed?.matrahHesapKodu ||
      parsed?.onerilenler?.matrahHesapKodu ||
      ekranKategoriAdayi;
    return typeof direct === 'string' ? direct.trim() : '';
  }

  /**
   * Claude ile İşletme Defteri bloğu için Kayıt Türü + K. Alt Türü seçimi.
   * Input: fatura görüntüsü + ekranda mevcut seçenekler.
   * Output: { kayitTuru?, altTuru?, emin: true|false, sebep }
   * Emin değilse (kayitTuru veya altTuru eşleşmezse) karar=atla.
   */
  async decideIsletme(input: {
    faturaImageBase64: string;
    faturaImageMediaType?: string;
    kayitTuruOptions: string[];
    altTuruOptions: string[];
    faturaTarihi?: string;
    belgeNo?: string;
    belgeTuru?: string;
    faturaTuru?: string;
    mukellef?: string;
    mukellefId?: string; // YENİ: Taxpayer.id — Firma Hafızası mükellef-bazlı öğrenme için
    firma?: string;
    firmaKimlikNo?: string; // Karsi firma VKN/TCKN — Firma Hafizasi icin
    tutar?: number | string;
    action?: string;
    matrah?: string | number;
    kdv?: string;
    blokIndex?: number;
    blokToplam?: number;
    tenantId?: string;
  }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const decisionMode = this.getMihsapDecisionMode();
    if (!apiKey && decisionMode === 'claude_only') {
      return { emin: false, sebep: 'ANTHROPIC_API_KEY yok' };
    }

    const SATIS_ACTIONS = ['isle_satis', 'isle_satis_isletme'];
    const ALIS_ACTIONS = ['isle_alis', 'isle_alis_isletme'];
    const islemTuru = SATIS_ACTIONS.includes(input.action || '')
      ? 'SATIŞ'
      : ALIS_ACTIONS.includes(input.action || '')
      ? 'ALIŞ'
      : 'ALIŞ';

    // Mükellef ID eksikse mükellef adından bul (Firma Hafızası mükellef-bazlı)
    if (!input.mukellefId && input.tenantId && input.mukellef) {
      try {
        const mukellefAd = input.mukellef.trim();
        const taxpayer = await this.prisma.taxpayer.findFirst({
          where: {
            tenantId: input.tenantId,
            OR: [
              { companyName: { equals: mukellefAd, mode: 'insensitive' } },
              { companyName: { contains: mukellefAd, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        });
        if (taxpayer) input.mukellefId = taxpayer.id;
      } catch {}
    }

    // Mükellef profili (yapılandırılmış + sistem kuralları)
    let mukellefTalimat = '';
    if (input.tenantId && input.mukellef) {
      try {
        const rule = await this.prisma.agentRule.findUnique({
          where: { tenantId_mukellef: { tenantId: input.tenantId, mukellef: input.mukellef } },
        });
        if (rule?.profile) {
          mukellefTalimat = profileToPromptText(rule.profile);
        }
      } catch {}
    }

    // Firma Hafizasi hint — isletme defteri modu icin (kayitTuru + altTuru kombinasyonu)
    let vendorHintIsletme: Awaited<ReturnType<VendorMemoryService['getHintForVendor']>> = null;
    if (input.tenantId && input.firmaKimlikNo) {
      try {
        vendorHintIsletme = await this.vendorMemory.getHintForVendor(
          input.tenantId,
          input.firmaKimlikNo,
          'isletme',
          input.mukellefId || null, // Mükellef-bazlı hint
        );
      } catch {}
    }

    const kayitListe = input.kayitTuruOptions.filter(Boolean).join(' | ');
    const altListe = input.altTuruOptions.filter(Boolean).join(' | ');

    const system = `Sen bir işletme defteri kayıt kategorisi seçicisin. Fatura görüntüsüne bakıp bir blok için Kayıt Türü ve K. Alt Türü karar vereceksin.
${vendorHintIsletme ? '\n' + vendorHintIsletme.hintText : ''}
### İŞLEM BAĞLAMI ###
İşlem yönü: ${islemTuru}  (ALIŞ = alış/gider, SATIŞ = satış/gelir)
Blok: ${input.blokIndex || 1}/${input.blokToplam || 1}
Ekrandaki fatura türü: ${input.faturaTuru || '?'} | Belge türü: ${input.belgeTuru || '?'}
Ekrandaki blok matrah: ${input.matrah ?? '?'} | KDV: ${input.kdv || '?'}

### MEVCUT SEÇENEKLER (sadece bu listeden seç, eşleştiremezsen emin_degil) ###
Kayıt Türü seçenekleri: ${kayitListe || '(boş)'}
K. Alt Türü seçenekleri: ${altListe || '(boş)'}

### KAYIT TÜRÜ SEÇİM KURALLARI (ÇOK ÖNEMLİ) ###

**VARSAYILAN YOK.** Emin değilsen → emin:false. Tahmin etme, "En yakın" diye alakasız kategori seçme.

**"Mal Alışı" SADECE şu durumlarda kullanılır:**
- Mükellef bir MARKET, BÜFE, BAKKAL, TOPTAN SATIŞ veya PERAKENDE TİCARET işletmesiyse VE
- Faturadaki ürünler mükellefin SATIŞ AMAÇLI aldığı TİCARİ EMTIA ise (raftan satacağı ürünler)
- Örnek: Büfe sahibi → toptancıdan çikolata/içecek alışı = Mal Alışı
- Örnek: Büfe sahibi → elektrik faturası = İndirilecek Giderler (Mal Alışı DEĞİL!)

**"Mal Alışı" KULLANILMAZ şu durumlarda:**
- Mağazadan/marketten kendi kullanım için alışveriş (ofis malzemesi, temizlik vb.)
- Akaryakıt, kira, telefon, internet, sigorta, muhasebe ücreti
- Yemek, konaklama, ulaşım giderleri
- Herhangi bir HİZMET faturası

**"Sabit Kıymet Alışı":** Bilgisayar, araç, makine, ofis mobilyası gibi uzun ömürlü varlıklar
**"Gider Kabul Edilmeyen Ödemeler (GVK Md. 41)":** Cezalar, bağışlar, kişisel harcamalar
**"İndirilecek Giderler (GVK Md. 40)":** Fatura içeriği SOMUT bir gider kalemiyse (akaryakıt, telefon, kira, yemek, vb.)

### K. ALT TÜRÜ SEÇİM KURALLARI — SOMUT KALEMLE EŞLEŞME ZORUNLU ###
Fatura içeriği → alt tür (birebir eşleşme olmalı):
- Akaryakıt/benzin/mazot/LPG → "Taşıt Akaryakıt Giderleri (GVK 40/1-40/5)"
- Telefon/GSM → "Telefon Giderleri (GVK 40/1)"
- Elektrik → "Elektrik Giderleri (GVK 40/1)"
- Doğalgaz → "Doğalgaz/Isınma Giderleri (GVK 40/1)" (listedeyse)
- Su → "Su Giderleri (GVK 40/1)" (listedeyse)
- Kırtasiye/kalem/defter → "Kırtasiye Harcamaları (GVK 40/1)"
- Yemek/gıda/baklava/pasta/kebap/lokanta → "Gıda Harcamaları (GVK 40/1-40/2)" veya "Temsil ve Ağırlama Gideri (İş yemeği vb.) (GVK 40/1)"
- Ofis temizlik/çay/kahve/şeker → "Ofis Giderleri(Çay, Kahve, Şeker, Temizlik vb.) (GVK 40/1)"
- Muhasebe/mali müşavir → "Muhasebe/Mali Müşavirlik Giderleri (GVK 40/1)"
- Kira/işyeri kirası → "Kira Giderleri (GVK 40/1)"
- İnternet → "İnternet Giderleri (GVK 40/1)"
- Mal Alışı için alt tür genellikle "Mal Alışı" (aynı isim)

### GENEL KURALLAR ###
1. Emin olduğun değerler MEVCUT SEÇENEKLER'de birebir var olmalı (karakter karakter). Yoksa emin:false.
2. Fatura görüntüsü okunamıyorsa → emin:false
3. ÖKC fişi / perakende satış fişi içeriği okunamıyorsa → emin:false (kesinlikle "Diğer" demiyorsun)
4. Makul çıkarım yapabilirsin (OPET = akaryakıt, TURKCELL = telefon). Ama MARKA TANIMLAMADIYSAN → emin:false.

### ⛔ MUTLAK YASAKLAR ⛔ ###
× Listede olmayan değer üretmek
× "Belki", "muhtemelen", "sanırım" ile emin=true demek
× **"Diğer" içeren HERHANGİ BİR kategori seçmek** (ör: "Diğer (GVK 40/1)", "Diğer Giderler", "Diğer Gelir", "Diğer Hasılat", "Diğer Sabit Kıymet Alışı")
  → İçerik bu somut kalemlerden birine denk gelmiyorsa **emin:false** dön. "Diğer" seçmektense atla.
× İçerik okunamıyorsa herhangi bir tahminle kategori seçmek — emin:false

${mukellefTalimat ? `### MÜKELLEF ÖZEL TALİMATI ###\n${mukellefTalimat}\n` : ''}

### STRUCTURED ALAN ÇIKARIMI ###
Fatura görüntüsünden şu alanları çıkarıp JSON'a da ekle (okunamazsa null):
• tarih: "DD.MM.YYYY" formatında
• belgeNo: fatura/fiş numarası
• cari: fatura üzerindeki karşı firma tam ünvanı
• belgeTuru: "E_FATURA" | "E_ARSIV" | "FIS" | "IRSALIYE"
• kdvOrani: "0" | "1" | "10" | "20"
• ocrToplam: faturadaki TOPLAM / genel toplam tutarı, sayı olarak. Okunamazsa null, tahmin etme.
• ocrMatrah: faturadaki KDV hariç matrah toplamı, sayı olarak. Okunamazsa null, tahmin etme.
• ocrKdvTutari: faturadaki toplam KDV tutarı, sayı olarak. Okunamazsa null, tahmin etme.

### SEBEP YAZIM KURALI ###
Sebep yazarken MÜKELLEF AÇISINDAN yaz (işlem yönü "${islemTuru}"):
• ALIŞ ise "gider/alış" terimleri kullan, karşı firmanın "satış" ifadesini YAZMA.
• SATIŞ ise "gelir/satış" terimleri kullan.

### ÇIKTI ###
Sadece JSON: {"emin":true,"kayitTuru":"<liste değeri>","altTuru":"<liste değeri>","sebep":"60 karakter","tarih":"DD.MM.YYYY"|null,"belgeNo":"..."|null,"cari":"..."|null,"belgeTuru":"..."|null,"kdvOrani":"..."|null,"ocrToplam":123.45|null,"ocrMatrah":100.00|null,"ocrKdvTutari":23.45|null}
veya: {"emin":false,"sebep":"60 karakter","tarih":null,"belgeNo":null,"cari":null,"belgeTuru":null,"kdvOrani":null,"ocrToplam":null,"ocrMatrah":null,"ocrKdvTutari":null}`;

    const userText = `Mükellef: ${input.mukellef || '?'} | Karşı firma: ${input.firma || '?'}
Belge no: ${input.belgeNo || '?'} | Tarih: ${input.faturaTarihi || '?'} | Tutar: ${input.tutar || '?'}
Blok matrah: ${input.matrah ?? '?'} | KDV: ${input.kdv || '?'}

Fatura görüntüsünü incele. Yukarıdaki MEVCUT SEÇENEKLER'den Kayıt Türü + K. Alt Türü seç ya da emin:false dön.`;

    const startMs = Date.now();
    const MODEL = 'claude-haiku-4-5-20251001';
    const logUsage = (
      karar: string | undefined,
      sebep: string | undefined,
      usage?: any,
    ) =>
      logAiUsage(this.prisma, {
        tenantId: input.tenantId || 'unknown',
        source: 'mihsap-isletme',
        model: MODEL,
        mukellef: input.mukellef,
        belgeNo: input.belgeNo,
        karar,
        sebep,
        durationMs: Date.now() - startMs,
        usage,
      });

    let cheapDecision =
      decisionMode === 'claude_only'
        ? null
        : await this.tryMihsapCheapIsletmeDecision(input, system, userText);

    if (decisionMode === 'balanced' && this.isCheapIsletmeAcceptable(cheapDecision, input, vendorHintIsletme)) {
      const parsed = {
        ...(cheapDecision!.parsed || {}),
        decisionProvider: cheapDecision!.provider,
        ocrProvider: cheapDecision!.ocrProvider,
        fallbackReason: cheapDecision!.fallbackReason || null,
        cheapConfidence: cheapDecision!.confidence,
      };
      return parsed;
    }

    if (!apiKey && !cheapDecision) {
      cheapDecision = await this.tryMihsapCheapIsletmeDecision(input, system, userText, true);
    }
    if (!apiKey && this.isCheapIsletmeAcceptable(cheapDecision, input, vendorHintIsletme)) {
      return {
        ...(cheapDecision!.parsed || {}),
        decisionProvider: cheapDecision!.provider,
        ocrProvider: cheapDecision!.ocrProvider,
        fallbackReason: cheapDecision!.fallbackReason || 'anthropic_key_missing',
        cheapConfidence: cheapDecision!.confidence,
      };
    }

    if (!apiKey) {
      return {
        emin: false,
        sebep: `ANTHROPIC_API_KEY yok; ucuz karar yeterli degil (${cheapDecision?.fallbackReason || 'fallback gerekli'})`,
        decisionProvider: cheapDecision?.provider || 'none',
        ocrProvider: cheapDecision?.ocrProvider || null,
        fallbackReason: cheapDecision?.fallbackReason || 'anthropic_key_missing',
        cheapConfidence: cheapDecision?.confidence ?? null,
      };
    }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // v1.36.40: Prompt caching aktif (decideIsletme).
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 650,
          system: [
            { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
          ],
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: input.faturaImageMediaType || 'image/jpeg',
                    data: input.faturaImageBase64,
                  },
                },
                { type: 'text', text: userText },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        const claudeError = this.classifyClaudeApiError(res.status, errText);
        if (!cheapDecision && (claudeError.code === 'claude_billing_or_quota' || claudeError.code === 'claude_rate_limit')) {
          cheapDecision = await this.tryMihsapCheapIsletmeDecision(input, system, userText, true);
        }
        if (this.isCheapIsletmeAcceptable(cheapDecision, input, vendorHintIsletme)) {
          await logUsage('onay', `${claudeError.code}: cheap fallback kullanildi`);
          return {
            ...(cheapDecision!.parsed || {}),
            decisionProvider: cheapDecision!.provider,
            ocrProvider: cheapDecision!.ocrProvider,
            fallbackReason: cheapDecision!.fallbackReason || claudeError.code,
            cheapConfidence: cheapDecision!.confidence,
          };
        }
        await logUsage('emin_degil', claudeError.logMessage);
        return {
          emin: false,
          sebep: claudeError.userMessage,
          decisionProvider: 'claude',
          providerError: true,
          providerErrorCode: claudeError.code,
          ocrProvider: cheapDecision?.ocrProvider || null,
          fallbackReason: cheapDecision?.fallbackReason || claudeError.code,
          cheapConfidence: cheapDecision?.confidence ?? null,
        };
      }
      const json = await res.json();
      const text = json?.content?.[0]?.text || '';
      const usage = json?.usage || {};

      const codeBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      const candidates: string[] = [];
      if (codeBlock) candidates.push(codeBlock[1]);
      const greedy = text.match(/\{[\s\S]*\}/);
      if (greedy) candidates.push(greedy[0]);

      for (const c of candidates) {
        try {
          const parsed = JSON.parse(c);
          if (typeof parsed?.emin === 'boolean') {
            // Sanity: seçilen değerler gerçekten listede mi?
            if (parsed.emin) {
              // ⛔ "Diğer" kategorisi yasağı — AI prompt'a rağmen "Diğer..." dediyse override et, atla
              const isDigerKayit = /diger|diğer/i.test(String(parsed.kayitTuru || ''));
              const isDigerAlt = /diger|diğer/i.test(String(parsed.altTuru || ''));
              if (isDigerKayit || isDigerAlt) {
                await logUsage(
                  'emin_degil',
                  `Diğer kategorisi yasağı: kayit=${parsed.kayitTuru} alt=${parsed.altTuru}`,
                  usage,
                );
                return {
                  emin: false,
                  sebep: `AI "Diğer" kategorisi seçti, atlandı (kayit=${parsed.kayitTuru}, alt=${parsed.altTuru})`,
                };
              }

              // 2-aşamalı yaklaşım: ilk çağrıda altTuruOptions boş gönderilir (sadece kayıt kararı).
              // Bu durumda altTuru validasyonunu atla.
              const inKayit = input.kayitTuruOptions.length === 0 || input.kayitTuruOptions.includes(parsed.kayitTuru);
              const altListeVar = input.altTuruOptions && input.altTuruOptions.length > 0;
              const inAlt = !altListeVar || input.altTuruOptions.includes(parsed.altTuru);
              if (!inKayit || !inAlt) {
                await logUsage('emin_degil', `liste dışı: kayit=${inKayit} alt=${inAlt}`, usage);
                return {
                  emin: false,
                  sebep: `AI liste dışı değer döndü (kayit=${parsed.kayitTuru}, alt=${parsed.altTuru})`,
                };
              }

              // === FIRMA HAFIZASI ENTEGRASYONU (isletme modu) ===
              // Sadece tam karar (hem kayitTuru hem altTuru belli) + firma VKN varsa
              const altTuruKey = altListeVar ? (parsed.altTuru || '').trim() : null;
              if (
                input.tenantId &&
                input.firmaKimlikNo &&
                parsed.kayitTuru
              ) {
                if (vendorHintIsletme) {
                  const sapma = this.vendorMemory.detectDeviation({
                    topKategoriler: vendorHintIsletme.topKategoriler,
                    aiKategori: String(parsed.kayitTuru),
                    aiAltKategori: altTuruKey,
                  });
                  if (sapma.isSapma) {
                    try {
                      const pending = await this.pendingDecisions.create({
                        tenantId: input.tenantId,
                        mukellef: input.mukellef,
                        firmaKimlikNo: input.firmaKimlikNo,
                        firmaUnvan: input.firma,
                        belgeNo: input.belgeNo,
                        belgeTuru: input.belgeTuru,
                        faturaTarihi: input.faturaTarihi,
                        tutar: typeof input.tutar === 'number' ? input.tutar : (input.tutar ? Number(input.tutar) : null),
                        kararTipi: 'isletme',
                        aiKarari: parsed,
                        gecmisBeklenen: {
                          topKategoriler: vendorHintIsletme.topKategoriler,
                          enCok: sapma.enCokGecmisKategori,
                          enCokSayisi: sapma.enCokGecmisOnaySayisi,
                        },
                        sapmaSebep: sapma.sebep,
                        imageBase64: input.faturaImageBase64,
                      });
                      await logUsage('onay_bekliyor', sapma.sebep, usage);
                      return {
                        emin: false,
                        karar: 'onay_bekliyor',
                        sebep: sapma.sebep,
                        pendingId: pending.id,
                        sapmaSebep: sapma.sebep,
                      };
                    } catch (e: any) {
                      // Fallback: pending olusmazsa normal AI kararini don
                      await logUsage('onay', `pending create failed: ${e?.message}`, usage);
                      parsed.decisionProvider = 'claude';
                      parsed.ocrProvider = cheapDecision?.ocrProvider || null;
                      parsed.fallbackReason = cheapDecision?.fallbackReason || 'pending_create_failed';
                      parsed.cheapConfidence = cheapDecision?.confidence ?? null;
                      return parsed;
                    }
                  }
                }
                // Sapma yoksa hafiza kaydi burada yapilmaz; F2 basari log'u geldikten
                // sonra createEvent icinde kaydedilir.
              }
              // === /FIRMA HAFIZASI ===
            }
            parsed.decisionProvider = 'claude';
            parsed.ocrProvider = cheapDecision?.ocrProvider || null;
            parsed.fallbackReason = cheapDecision?.fallbackReason || (cheapDecision ? 'claude_shadow_or_fallback' : null);
            parsed.cheapConfidence = cheapDecision?.confidence ?? null;
            parsed.shadowDiff = decisionMode === 'shadow'
              ? this.buildMihsapShadowDiff('isletme', cheapDecision?.parsed, parsed)
              : null;
            await this.logMihsapShadowDiff('mihsap-isletme-shadow', input, parsed.shadowDiff, cheapDecision);
            await logUsage(parsed.emin ? 'onay' : 'emin_degil', parsed.sebep, usage);
            return parsed;
          }
        } catch {}
      }

      if (this.isCheapIsletmeAcceptable(cheapDecision, input, vendorHintIsletme)) {
        await logUsage('onay', 'claude_json_parse_fail: cheap fallback kullanildi', usage);
        return {
          ...(cheapDecision!.parsed || {}),
          decisionProvider: cheapDecision!.provider,
          ocrProvider: cheapDecision!.ocrProvider,
          fallbackReason: cheapDecision!.fallbackReason || 'claude_json_parse_fail',
          cheapConfidence: cheapDecision!.confidence,
        };
      }
      await logUsage('emin_degil', 'JSON parse fail', usage);
      return {
        emin: false,
        sebep: 'JSON parse fail',
        raw: text.slice(0, 200),
        decisionProvider: 'claude',
        ocrProvider: cheapDecision?.ocrProvider || null,
        fallbackReason: cheapDecision?.fallbackReason || 'claude_json_parse_fail',
        cheapConfidence: cheapDecision?.confidence ?? null,
      };
    } catch (e: any) {
      if (!cheapDecision) {
        cheapDecision = await this.tryMihsapCheapIsletmeDecision(input, system, userText, true);
      }
      if (this.isCheapIsletmeAcceptable(cheapDecision, input, vendorHintIsletme)) {
        await logUsage('onay', `claude_network_error: cheap fallback kullanildi`);
        return {
          ...(cheapDecision!.parsed || {}),
          decisionProvider: cheapDecision!.provider,
          ocrProvider: cheapDecision!.ocrProvider,
          fallbackReason: cheapDecision!.fallbackReason || 'claude_network_error',
          cheapConfidence: cheapDecision!.confidence,
        };
      }
      await logUsage('emin_degil', `Network: ${e?.message || 'unknown'}`);
      return {
        emin: false,
        sebep: `Network: ${e?.message || 'unknown'}`,
        decisionProvider: 'claude',
        providerError: true,
        providerErrorCode: 'claude_network_error',
        ocrProvider: cheapDecision?.ocrProvider || null,
        fallbackReason: cheapDecision?.fallbackReason || 'claude_network_error',
        cheapConfidence: cheapDecision?.confidence ?? null,
      };
    }
  }

  // USD/TRY kur cache'i — TCMB'den günde 1 kez çekilir
  private usdTryCache: { rate: number; fetchedAt: Date } | null = null;

  private async getUsdTryRate(): Promise<number> {
    const now = new Date();
    // 6 saatten eski ise yeniden çek
    if (
      this.usdTryCache &&
      now.getTime() - this.usdTryCache.fetchedAt.getTime() < 6 * 60 * 60 * 1000
    ) {
      return this.usdTryCache.rate;
    }
    try {
      const res = await fetch('https://www.tcmb.gov.tr/kurlar/today.xml', {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const xml = await res.text();
        // <Currency Kod="USD"> ... <ForexSelling>X.XXXX</ForexSelling>
        const usdBlock = xml.match(/<Currency[^>]*Kod="USD"[\s\S]*?<\/Currency>/);
        if (usdBlock) {
          const sell = usdBlock[0].match(/<ForexSelling>([\d.]+)<\/ForexSelling>/);
          const rate = sell ? parseFloat(sell[1]) : NaN;
          if (!isNaN(rate) && rate > 0) {
            this.usdTryCache = { rate, fetchedAt: now };
            return rate;
          }
        }
      }
    } catch {
      // TCMB erişilmezse (hafta sonu / tatil) önceki cache varsa kullan
    }
    if (this.usdTryCache) return this.usdTryCache.rate;
    // Hiç değer yoksa makul bir fallback (env'den de okunur)
    return parseFloat(process.env.USD_TRY_FALLBACK || '40');
  }

  /**
   * AI kullanım istatistikleri — panel widget'ı için.
   * Bugün / Bu ay / Toplam istatistikleri döner.
   */
  async getAiUsageStats(tenantId: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const aggregate = async (since?: Date) => {
      const where: any = { tenantId };
      if (since) where.createdAt = { gte: since };
      const rows = await (this.prisma as any).aiUsageLog.findMany({
        where,
        select: {
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
          costUsd: true,
          karar: true,
          cacheHit: true,
        },
      });
      const acc = {
        sorguSayisi: rows.length,
        cacheHitSayisi: 0,
        gercekCagriSayisi: 0,
        onaySayisi: 0,
        atlaSayisi: 0,
        eminDegilSayisi: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toplamToken: 0,
        maliyetUsd: 0,
      };
      for (const r of rows) {
        if (r.cacheHit) acc.cacheHitSayisi++;
        else acc.gercekCagriSayisi++;
        if (r.karar === 'onay') acc.onaySayisi++;
        else if (r.karar === 'atla') acc.atlaSayisi++;
        else acc.eminDegilSayisi++;
        acc.inputTokens += r.inputTokens || 0;
        acc.outputTokens += r.outputTokens || 0;
        acc.cacheReadTokens += r.cacheReadTokens || 0;
        acc.cacheWriteTokens += r.cacheWriteTokens || 0;
        acc.maliyetUsd += r.costUsd || 0;
      }
      acc.toplamToken = acc.inputTokens + acc.outputTokens + acc.cacheReadTokens + acc.cacheWriteTokens;
      return acc;
    };

    // Topup toplamı (yüklenmiş kontör)
    const topupAgg = async () => {
      const rows = await (this.prisma as any).aiCreditTopup.findMany({
        where: { tenantId },
        select: { amountUsd: true },
      });
      return rows.reduce((s: number, r: any) => s + (r.amountUsd || 0), 0);
    };

    const [bugun, buAy, toplam, usdTry, toplamYuklenenUsd] = await Promise.all([
      aggregate(todayStart),
      aggregate(monthStart),
      aggregate(),
      this.getUsdTryRate(),
      topupAgg(),
    ]);

    const kalanBakiyeUsd = Math.max(0, toplamYuklenenUsd - toplam.maliyetUsd);

    return {
      bugun,
      buAy,
      toplam,
      usdTry,
      bakiye: {
        toplamYuklenenUsd,
        toplamHarcananUsd: toplam.maliyetUsd,
        kalanBakiyeUsd,
      },
      updatedAt: now,
    };
  }

  /** Kontör yükleme kaydı ekle */
  async addCreditTopup(tenantId: string, userId: string | null, amountUsd: number, note?: string) {
    if (!amountUsd || amountUsd <= 0) {
      throw new Error('amountUsd > 0 olmalı');
    }
    return (this.prisma as any).aiCreditTopup.create({
      data: {
        tenantId,
        amountUsd,
        note: note || null,
        addedBy: userId,
      },
    });
  }

  /** Kontör yükleme geçmişi */
  async listCreditTopups(tenantId: string, limit = 50) {
    return (this.prisma as any).aiCreditTopup.findMany({
      where: { tenantId },
      orderBy: { addedAt: 'desc' },
      take: limit,
    });
  }

  async updateCommand(
    tenantId: string,
    id: string,
    data: { status?: string; result?: any },
  ) {
    const finishedAt = data.status === 'done' || data.status === 'failed' ? new Date() : undefined;
    // Result alanını overwrite ETMEMEK için mevcut logs'u koru (canlı log akışı için kritik)
    let mergedResult = data.result;
    if (data.result !== undefined) {
      const existing = await this.prisma.agentCommand.findUnique({
        where: { id },
        select: { result: true },
      });
      const existingLogs = (existing?.result as any)?.logs;
      if (Array.isArray(existingLogs)) {
        mergedResult = { ...data.result, logs: existingLogs };
      }
    }
    const updated = await this.prisma.agentCommand.update({
      where: { id },
      data: { ...data, ...(mergedResult !== undefined ? { result: mergedResult } : {}), finishedAt } as any,
    });

    // HGS toplu-sorgu tamamlandığında otomatik WhatsApp bildirim
    if (data.status === 'done' && updated.agent === 'hgs' && updated.action === 'toplu-sorgu') {
      // Async olarak tetikle, response'u bekleyenleri yavaşlatma
      this.hgsToplu_SorguTamamlandi(tenantId, id).catch((err) =>
        this.logger.warn(`[HGS WhatsApp] Bildirim başarısız: ${err?.message || err}`),
      );
    }

    return updated;
  }

  /** HGS toplu sorgu tamamlandığında WhatsApp ile özet gönder.
   *  Alıcı: HGS_RAPOR_ALICI_NUMARA env veya default Halil Bey numarası.
   */
  private async hgsToplu_SorguTamamlandi(tenantId: string, commandId: string) {
    const aliciNumara = process.env.HGS_RAPOR_ALICI_NUMARA || '905348610965';
    const aliciAd = process.env.HGS_RAPOR_ALICI_AD || 'Halil Bey';

    // Komut detaylarını al
    const cmd = await this.prisma.agentCommand.findFirst({ where: { id: commandId, tenantId } });
    if (!cmd) return;
    const result: any = cmd.result || {};
    const aracSayisi = result.araclar || 0;
    const basariliSayisi = result.basarili || 0;

    // Toplam ihlal ve tutar — son sorgulardan topla
    const aracIds: string[] = (cmd.payload as any)?.aracIds || [];
    let toplamIhlal = 0;
    let toplamTutar = 0;
    let ihlalliArac = 0;
    if (aracIds.length > 0) {
      const sonuclar = await (this.prisma as any).hgsIhlalSorguSonucu.findMany({
        where: { tenantId, aracId: { in: aracIds } },
        orderBy: [{ aracId: 'asc' }, { sorguTarihi: 'desc' }],
      });
      // Her araç için son sorguyu al
      const sonPerArac = new Map<string, any>();
      for (const s of sonuclar) {
        if (!sonPerArac.has(s.aracId)) sonPerArac.set(s.aracId, s);
      }
      for (const s of sonPerArac.values()) {
        const adet = s.ihlalSayisi || 0;
        toplamIhlal += adet;
        toplamTutar += Number(s.toplamTutar || 0);
        if (adet > 0) ihlalliArac++;
      }
    }

    const tutarFmt = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toplamTutar);
    const mesaj = [
      `${aliciAd} Merhabalar,`,
      ``,
      `HGS toplu sorgulama işleminiz tamamlanmıştır.`,
      ``,
      `📋 Özet:`,
      `• Sorgulanan: ${basariliSayisi}/${aracSayisi} araç`,
      `• İhlalli araç: ${ihlalliArac}`,
      `• Toplam ihlal: ${toplamIhlal}`,
      `• Toplam tutar: ${tutarFmt} ₺`,
      ``,
      `Detaylı döküm için: https://portal.morenmusavirlik.com/panel/galeri/hgs-ihlal`,
      ``,
      `İyi günler.`,
    ].join('\n');

    // WhatsApp gönderim — Meta Cloud API varsa onu, yoksa QR (Baileys) — fallback mantığı
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (accessToken && phoneNumberId) {
      // 1. yol: Meta Cloud API (kurumsal numara)
      try {
        const apiVersion = process.env.WHATSAPP_API_VERSION || 'v20.0';
        const res = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: aliciNumara,
            type: 'text',
            text: { body: mesaj, preview_url: false },
          }),
        });
        if (res.ok) {
          this.logger.log(`[HGS WhatsApp Meta] Bildirim gönderildi: ${aliciNumara} (${aracSayisi} araç, ${toplamIhlal} ihlal)`);
          return;
        }
        const errBody = await res.text();
        this.logger.warn(`[HGS WhatsApp Meta] Başarısız ${res.status}: ${errBody.slice(0, 200)} — QR fallback deneniyor`);
      } catch (err: any) {
        this.logger.warn(`[HGS WhatsApp Meta] Hata: ${err?.message || err} — QR fallback deneniyor`);
      }
    }

    // 2. yol: QR (Baileys) — kişisel WhatsApp
    try {
      const result = await this.whatsappQr.sendMessage(tenantId, aliciNumara, mesaj);
      this.logger.log(`[HGS WhatsApp QR] Bildirim gönderildi: ${aliciNumara} (msgId=${result?.messageId || 'n/a'})`);
    } catch (err: any) {
      this.logger.warn(`[HGS WhatsApp QR] Gönderim hatası (atlandı, hgs cron etkilenmez): ${err?.message || err}`);
    }
  }

  /** Mihsap'tan çekilen mükellefleri toplu upsert (taxNumber ile eşle) */
  async bulkImportTaxpayers(
    tenantId: string,
    taxpayers: Array<{
      type: string;
      taxNumber: string;
      taxOffice?: string;
      companyName?: string;
      firstName?: string;
      lastName?: string;
      mihsapId?: string;
      mihsapDefterTuru?: string;
      lucaSlug?: string;
    }>,
  ) {
    const created: string[] = [];
    const updated: string[] = [];
    const errors: Array<{ taxNumber: string; error: string }> = [];

    for (const t of taxpayers) {
      if (!t.taxNumber || t.taxNumber.length < 10) {
        errors.push({ taxNumber: t.taxNumber || '(bos)', error: 'gecersiz vergi no' });
        continue;
      }
      try {
        const existing = await this.prisma.taxpayer.findFirst({
          where: { tenantId, taxNumber: t.taxNumber },
          select: { id: true },
        });
        const data: any = {
          tenantId,
          type: t.type as any,
          taxNumber: t.taxNumber,
          taxOffice: t.taxOffice || '-',
          companyName: t.companyName || null,
          firstName: t.firstName || null,
          lastName: t.lastName || null,
          mihsapId: t.mihsapId || null,
          mihsapDefterTuru: t.mihsapDefterTuru || null,
          lucaSlug: t.lucaSlug || null,
        };
        if (existing) {
          await this.prisma.taxpayer.update({ where: { id: existing.id }, data });
          updated.push(t.taxNumber);
        } else {
          await this.prisma.taxpayer.create({ data });
          created.push(t.taxNumber);
        }
      } catch (e: any) {
        errors.push({ taxNumber: t.taxNumber, error: e?.message ?? 'unknown' });
      }
    }
    return { created: created.length, updated: updated.length, errors };
  }
}
