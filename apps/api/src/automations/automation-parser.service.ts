import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  ACTION_BY_NAME,
  AutomationAction,
  VALID_EVENT_NAMES,
  buildCatalogMarkdown,
} from './action-catalog';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Parser doğruluk-hassas bir görev (yanlış parse = yanlış otomasyon),
// ayda az sayıda çalışır (her otomasyon kurulurken bir kere). Bu yüzden
// varsayılan Sonnet 4.6 — daha iyi reasoning. İstenirse env ile Haiku'ya düşürülür.
const DEFAULT_PARSER_MODEL = process.env.AUTOMATION_PARSER_MODEL || 'claude-sonnet-4-6';

// Tahmini token maliyetleri (1M token başına USD) — Sonnet 4.6 için.
// Cost dashboard ile sürekli güncel tutulacak.
const SONNET_INPUT_COST_PER_M = 3.0;
const SONNET_OUTPUT_COST_PER_M = 15.0;

export interface ParsedAutomation {
  /** İnsan-okur başlık (Türkçe, kısa) */
  title: string;
  /** İnsan-okur açıklama (kullanıcıya önizleme için, Türkçe) */
  description: string;
  /** İnsan-okur ÖNİZLEME — "ne yapacağım" tek paragraf, kullanıcı onayı için */
  humanReadablePreview: string;
  /** Tetikleyici tanımı */
  triggerType: 'CRON' | 'EVENT' | 'WEBHOOK' | 'MANUAL';
  triggerConfig: Record<string, unknown>;
  /** Workflow JSON (schemaVersion + steps) */
  steps: { schemaVersion: 1; steps: ParsedStep[] };
  /** Run başına tahmini Claude maliyeti (USD) */
  estimatedCostPerRun: number;
  /** KVKK / hassasiyet uyarısı (kullanıcıya gösterilir) */
  privacyNotice?: string;
  /** Parser'ın bu öneriye olan güveni (0-1) — düşükse UI ekstra onay ister */
  confidence: number;
  /** Parse meta verisi (debug için) */
  meta: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    parseCostUsd: number;
  };
}

export interface ParsedStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  outputAs?: string;
  steps?: ParsedStep[]; // for_each, branch_if, parallel için iç adımlar
  then?: ParsedStep[];
  else?: ParsedStep[];
  branches?: ParsedStep[][];
}

/**
 * Doğal dil → workflow JSON çevirmeni.
 *
 * Tasarım:
 *  - Tek bir Claude çağrısı yapılır.
 *  - System prompt aksiyon kataloğunu açıklar.
 *  - Tek bir meta-tool tanımlanır: `propose_automation` — Claude bu tool'u çağırarak
 *    yapısal cevabını "submit" eder. Bu, açık metinden daha güvenilir bir JSON çıktı.
 *  - Sonuç şema doğrulanır, geçerli değilse hata fırlatılır.
 *
 * GÜVENLİK:
 *  - System prompt'a müvekkil verisi GÖNDERİLMEZ. Sadece yapı bilgisi (mevcut aksiyon
 *    isimleri, parametre adları) verilir.
 *  - Kullanıcı cümlesinde yanlışlıkla müvekkil verisi olsa bile (örn. "Ahmet'in
 *    numarasına mesaj at") bu Claude'a gider — kullanıcı sorumluluğu, ama Faz 8'de
 *    PII tarama eklenecek.
 */
@Injectable()
export class AutomationParserService {
  private readonly logger = new Logger(AutomationParserService.name);

  /**
   * Cümleyi parse eder. Hiçbir DB değişikliği YAPMAZ — sadece öneri döner.
   * Onay aşamasında AutomationsService.create() çağrılır.
   */
  async parse(prompt: string): Promise<ParsedAutomation> {
    if (!prompt || prompt.trim().length < 5) {
      throw new BadRequestException('Otomasyon cümlesi en az 5 karakter olmalı.');
    }
    if (prompt.length > 2000) {
      throw new BadRequestException('Otomasyon cümlesi en fazla 2000 karakter olabilir.');
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'ANTHROPIC_API_KEY environment değişkeni ayarlanmamış. ' +
          'Railway / yerel .env\'e eklenmelidir.',
      );
    }

    const systemPrompt = this.buildSystemPrompt();
    const proposeTool = this.buildProposeAutomationTool();

    const payload = {
      model: DEFAULT_PARSER_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools: [proposeTool],
      tool_choice: { type: 'tool', name: 'propose_automation' }, // mecbur bu tool'u çağır
      messages: [{ role: 'user', content: prompt }],
    };

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      this.logger.error('Anthropic API\'ye bağlanılamadı', err.stack);
      throw new ServiceUnavailableException('AI servisine ulaşılamadı: ' + err.message);
    }

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`Parser API hata ${response.status}: ${errText.slice(0, 500)}`);
      if (response.status === 401) {
        throw new ServiceUnavailableException('Anthropic API anahtarı geçersiz.');
      }
      if (response.status === 429) {
        throw new ServiceUnavailableException('AI servisi şu an meşgul. Birazdan tekrar deneyin.');
      }
      throw new ServiceUnavailableException(`AI servisi hatası (${response.status}).`);
    }

    const data: any = await response.json();
    const inputTokens = data?.usage?.input_tokens ?? 0;
    const outputTokens = data?.usage?.output_tokens ?? 0;
    const parseCostUsd = this.computeCost(inputTokens, outputTokens);

    const toolUseBlock = (data?.content ?? []).find((b: any) => b.type === 'tool_use');
    if (!toolUseBlock || toolUseBlock.name !== 'propose_automation') {
      this.logger.warn(
        `Parser propose_automation çağırmadı. stop_reason=${data?.stop_reason}`,
      );
      throw new BadRequestException(
        'Cümleyi anlayamadım. Lütfen daha açık bir cümleyle deneyin. ' +
          'Örnek: "Her ayın 22\'sinde KDV gecikenlere WhatsApp at."',
      );
    }

    const proposed = toolUseBlock.input;
    this.validateProposed(proposed);

    // Maliyet hesabı: her step'in run-time maliyetini topla
    const estimatedCostPerRun = this.estimateRunCost(proposed.steps.steps);

    // Privacy notice üret
    const privacyNotice = this.buildPrivacyNotice(proposed.steps.steps);

    return {
      title: proposed.title,
      description: proposed.description ?? '',
      humanReadablePreview: proposed.humanReadablePreview,
      triggerType: proposed.triggerType,
      triggerConfig: proposed.triggerConfig,
      steps: proposed.steps,
      estimatedCostPerRun,
      privacyNotice,
      confidence: proposed.confidence ?? 0.8,
      meta: {
        model: DEFAULT_PARSER_MODEL,
        inputTokens,
        outputTokens,
        parseCostUsd,
      },
    };
  }

  // ---------------------------------------------------------------
  // SYSTEM PROMPT
  // ---------------------------------------------------------------
  private buildSystemPrompt(): string {
    return `Sen Moren AI Otomasyon Mimarısın. Görevin: bir mali müşavirin Türkçe yazdığı bir cümleyi, ofisinin portal sisteminde çalışacak bir OTOMASYON tanımına dönüştürmek.

# BAĞLAM

Kullanıcı, Türkiye'de mali müşavirlik yapan biridir. Portalında müvekkel bilgileri, KDV/Muhtasar/SGK beyannameleri, mizan/bilanço, faturalar, Luca muhasebe entegrasyonu, WhatsApp ve e-posta gönderim yetenekleri vardır. Kullanıcı sana ofisinde tekrarlayan bir işi anlatır; sen bunu uygun TETİKLEYİCİ + ADIMLAR halinde tanımlarsın.

# KURALLAR

1. **Sadece kataloğumdaki aksiyonları kullan.** Aşağıdaki katalog dışı bir tool ÜRETME. Kataloğda olmayan bir şey isteniyorsa, en yakın aksiyonu kullan veya humanReadablePreview'da bunu belirt.

2. **Tetikleyiciyi doğru seç.**
   - "Her ay X tarihinde", "her gün saat Y'de", "her hafta" → CRON (cron expression üret)
   - "Bir müvekkil X yaptığında", "fatura yüklendiğinde", "WhatsApp mesajı geldiğinde" → EVENT
   - "Dışarıdan HTTP isteği geldiğinde" → WEBHOOK
   - Test/tek seferlik → MANUAL

2b. **EVENT seçtiysen \`triggerConfig.eventName\` MUTLAKA aşağıdaki listeden BİRİ olmalı:**
   - \`Taxpayer.EvrakDurumuChanged\` — müvekkilin "evrak geldi" alanı değişti (evrak teslim alındı/iptal edildi). Filtre olarak \`newValue: true\` koyarsan sadece "evrak geldi" olunca tetiklenir.
   - \`Taxpayer.EvrakIslendiChanged\` — "evrak işlendi" alanı değişti.
   - \`Taxpayer.KontrolEdildiChanged\` — "kontrol edildi" alanı değişti.
   - \`Taxpayer.BeyannameDurumuChanged\` — "beyanname verildi" alanı değişti. Filtre: \`newValue: true\` beyanname verildiğinde, \`false\` iptal edildiğinde.
   - \`Taxpayer.Created\` — yeni müvekkil eklendi.
   - \`WhatsApp.MessageReceived\` — müvekkilden serbest WhatsApp mesajı geldi.
   - \`WhatsApp.DocumentReceived\` — WhatsApp'tan belge (PDF, görsel) geldi.
   - \`Document.Uploaded\` — portala belge yüklendi.
   - \`Invoice.Created\` — fatura kaydı oluştu.
   ASLA bu listede olmayan bir event ismi (örn. \`taxpayer.evrak_durumu_guncellendi\`) üretme.
   Tüm Taxpayer.* event'leri şu payload alanlarına sahiptir: \`tenantId\`, \`taxpayerId\`, \`year\`, \`month\`, \`field\`, \`oldValue\`, \`newValue\`, \`taxpayerUnvan\`. Sonraki adımlarda \`{{trigger.payload.taxpayerUnvan}}\` veya \`{{trigger.payload.taxpayerId}}\` ile bu verilere erişebilirsin.

3. **Cron expression'ı dikkatli yaz.**
   - "Her ayın 22'sinde sabah 10:00" → "0 10 22 * *"
   - "Her gün sabah 9:00" → "0 9 * * *"
   - "Her hafta Pazartesi 8:00" → "0 8 * * 1"
   - Saat verilmemişse mantıklı bir varsayılan seç (sabah 10:00).
   - Timezone "Europe/Istanbul".

4. **Müvekkil filtrelerini doğru kur.** "KDV gecikenlere" → \`list_taxpayers_monthly_status\` aksiyonunu \`beyannameDurumu: "verilmedi"\` ile çağır.

5. **Toplu iş varsa for_each kullan.** "Her birine mesaj at" gibi durumlarda önce listeyi alıp sonra for_each ile döngüye sok. Listeyi outputAs ile bir değişkene ata, for_each.list'te o değişkene başvur.

6. **Template referansları:** Bir adımın çıktısına sonraki adımda erişmek için \`{{degisken.field}}\` formatı kullan. Örn. önceki adımda \`outputAs: "gecikenler"\` denildiyse, sonraki adımda \`{{gecikenler}}\` ile listeye erişilir. Tarihler için: \`{{currentMonth}}\` (YYYY-MM), \`{{today}}\` (YYYY-MM-DD), \`{{currentUser.email}}\`.

7. **humanReadablePreview Türkçe ve net.** Kullanıcının onaylayacağı kısa paragraf. Hangi zaman, hangi koşul, hangi aksiyonlar — sırayla anlat. Cron yerine "her ayın 22'sinde saat 10'da" gibi insan dili kullan.

7b. **YAPISAL VERİYİ DOĞRUDAN STRING ALANINA GÖMME.** \`list_taxpayers\`, \`list_taxpayers_monthly_status\`, \`get_tax_calendar\` gibi tool'lar dizi/nesne döner. Bunu doğrudan bir bildirim/e-posta/WhatsApp metin alanına \`{{liste}}\` olarak yerleştirirsen ham JSON görünür ve okunamaz olur. Bunun yerine MUTLAKA bir ara adımla insan-okur metne çevir:

   - **Tercih edilen:** \`format_list\` aksiyonu (deterministik, ÜCRETSİZ). Önce listeyi getiren adımın çıktısını \`outputAs: "veriler"\` ile sakla, sonra \`format_list({ list: "{{veriler}}", itemTemplate: "- {{item.isim}} (VKN: {{item.vkn_tckn}})" })\` ile bir string'e çevir, onu da \`outputAs: "metin"\` olarak sakla, en son \`create_pending_action({ body: "Şu müvekkillerin KDV beyannamesi verilmedi:\\n\\n{{metin}}" })\` gibi kullan.
   - Sadece özet/yorum gerekiyorsa \`summarize_with_claude\` da kullanılabilir ama \$0.01 maliyetlidir.

   ÖRNEK BAŞARILI ADIMLAR (KDV gecikenleri bildirim olarak yolla):
   \`\`\`
   1) list_taxpayers_monthly_status (beyannameDurumu="verilmedi") outputAs: "veriler"
   2) format_list (list="{{veriler}}", itemTemplate="- {{item.isim}} (VKN: {{item.vkn_tckn}})", emptyMessage="Bu dönemde gecikmiş müvekkel yok.") outputAs: "liste_metni"
   3) create_pending_action (title="KDV gecikenleri", body="{{liste_metni}}")
   \`\`\`

8. **Belirsizlik varsa confidence düşür.** Kullanıcının cümlesinde eksik bilgi varsa (örn. "müvekkillere mesaj at" — kimlere? hangi mesaj?), makul bir yorum yap ama confidence'ı 0.6-0.7'ye düşür ve humanReadablePreview'da "anladığım kadarıyla şu varsayımlarla kurdum: ..." de.

9. **Kataloğun dışında bir şey istendiyse** (örn. "müvekkilin TC'sini Google'da ara") confidence: 0, propose_automation'u yine çağır ama humanReadablePreview'da "Bu işlemi mevcut araçlarımla yapamıyorum çünkü ..." diye reddet ve steps'i boş dizi yap.

# AKSIYON KATALOĞU

${buildCatalogMarkdown()}

# ÇIKTI FORMAT

propose_automation tool'unu çağır. JSON şeması zorunlu.`;
  }

  // ---------------------------------------------------------------
  // PROPOSE_AUTOMATION META-TOOL ŞEMASI
  // ---------------------------------------------------------------
  private buildProposeAutomationTool() {
    return {
      name: 'propose_automation',
      description: 'Önerilen otomasyon tanımını yapısal olarak sun.',
      input_schema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Türkçe, kısa, kullanıcının listede göreceği ad (max 100 karakter).',
          },
          description: {
            type: 'string',
            description: 'Türkçe, 1-2 cümle daha uzun açıklama (max 500 karakter).',
          },
          humanReadablePreview: {
            type: 'string',
            description:
              'Türkçe, kullanıcının onaylaması için tek paragraf önizleme. ' +
              '"Şu zaman X olunca, ben şunları yapacağım: ..." formatında.',
          },
          triggerType: {
            type: 'string',
            enum: ['CRON', 'EVENT', 'WEBHOOK', 'MANUAL'],
          },
          triggerConfig: {
            type: 'object',
            description:
              'CRON için { cron, timezone }. EVENT için { eventName, filters }. ' +
              'WEBHOOK için boş obje (secret backend\'de üretilir). MANUAL için boş obje.',
          },
          steps: {
            type: 'object',
            properties: {
              schemaVersion: { type: 'number', const: 1 },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    tool: { type: 'string', description: 'Katalogdaki aksiyon adı.' },
                    args: { type: 'object' },
                    outputAs: {
                      type: 'string',
                      description: 'Bu adımın çıktısını saklayacak değişken adı (opsiyonel).',
                    },
                    steps: { type: 'array', items: { type: 'object' } },
                    then: { type: 'array', items: { type: 'object' } },
                    else: { type: 'array', items: { type: 'object' } },
                    branches: { type: 'array', items: { type: 'array' } },
                  },
                  required: ['id', 'tool', 'args'],
                },
              },
            },
            required: ['schemaVersion', 'steps'],
          },
          confidence: {
            type: 'number',
            description: '0-1 arası. Düşükse UI ekstra uyarı gösterir.',
          },
        },
        required: [
          'title',
          'humanReadablePreview',
          'triggerType',
          'triggerConfig',
          'steps',
          'confidence',
        ],
      },
    };
  }

  // ---------------------------------------------------------------
  // ÇIKTI DOĞRULAMA
  // ---------------------------------------------------------------
  private validateProposed(proposed: any): void {
    if (!proposed?.title || !proposed?.humanReadablePreview) {
      throw new BadRequestException('Parser çıktısı eksik (title veya humanReadablePreview yok).');
    }
    if (!['CRON', 'EVENT', 'WEBHOOK', 'MANUAL'].includes(proposed.triggerType)) {
      throw new BadRequestException(`Geçersiz triggerType: ${proposed.triggerType}`);
    }
    if (!proposed.steps || proposed.steps.schemaVersion !== 1) {
      throw new BadRequestException('steps.schemaVersion=1 olmalı.');
    }
    if (!Array.isArray(proposed.steps.steps)) {
      throw new BadRequestException('steps.steps bir dizi olmalı.');
    }

    // Her aksiyon adı kataloğumda olmalı
    const unknownTools = this.collectUnknownTools(proposed.steps.steps);
    if (unknownTools.length > 0 && proposed.steps.steps.length > 0) {
      throw new BadRequestException(
        `Bilinmeyen aksiyon(lar): ${unknownTools.join(', ')}. Parser kataloğa uymayan bir çıktı verdi.`,
      );
    }

    // CRON için cron expression olmalı
    if (proposed.triggerType === 'CRON') {
      const cron = proposed.triggerConfig?.cron;
      if (typeof cron !== 'string' || !cron.trim()) {
        throw new BadRequestException('CRON tetikleyici için triggerConfig.cron zorunlu.');
      }
    }

    // EVENT için event ismi mutlaka kataloğumuzda olmalı
    if (proposed.triggerType === 'EVENT') {
      const eventName = proposed.triggerConfig?.eventName;
      if (typeof eventName !== 'string' || !VALID_EVENT_NAMES.includes(eventName)) {
        throw new BadRequestException(
          `EVENT tetikleyici için triggerConfig.eventName şu listeden olmalı: ${VALID_EVENT_NAMES.join(', ')}. ` +
            `Üretilen: "${eventName ?? 'eksik'}".`,
        );
      }
    }
  }

  private collectUnknownTools(steps: ParsedStep[]): string[] {
    const unknown: string[] = [];
    const walk = (list: ParsedStep[]) => {
      for (const s of list) {
        if (s.tool && !ACTION_BY_NAME[s.tool]) unknown.push(s.tool);
        if (Array.isArray(s.steps)) walk(s.steps);
        if (Array.isArray(s.then)) walk(s.then);
        if (Array.isArray(s.else)) walk(s.else);
        if (Array.isArray(s.branches)) s.branches.forEach(walk);
      }
    };
    walk(steps);
    return Array.from(new Set(unknown));
  }

  // ---------------------------------------------------------------
  // MALİYET TAHMİNİ
  // ---------------------------------------------------------------
  private estimateRunCost(steps: ParsedStep[]): number {
    let cost = 0;
    const walk = (list: ParsedStep[], multiplier: number) => {
      for (const s of list) {
        const action = ACTION_BY_NAME[s.tool];
        if (action) cost += action.estimatedClaudeCostPerCall * multiplier;
        if (Array.isArray(s.steps)) {
          // for_each varsayılan: 10 eleman üzerinden tahmin (gerçek run'da bilinir)
          const m = s.tool === 'for_each' ? multiplier * 10 : multiplier;
          walk(s.steps, m);
        }
        if (Array.isArray(s.then)) walk(s.then, multiplier);
        if (Array.isArray(s.else)) walk(s.else, multiplier * 0.5); // else tarafına daha az ağırlık
        if (Array.isArray(s.branches)) s.branches.forEach((b) => walk(b, multiplier));
      }
    };
    walk(steps, 1);
    return Math.round(cost * 10000) / 10000; // 4 ondalık
  }

  /**
   * Parser çağrısının Claude maliyeti (Sonnet 4.6).
   */
  private computeCost(inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1_000_000) * SONNET_INPUT_COST_PER_M;
    const outputCost = (outputTokens / 1_000_000) * SONNET_OUTPUT_COST_PER_M;
    return Math.round((inputCost + outputCost) * 10000) / 10000;
  }

  // ---------------------------------------------------------------
  // KVKK / PRIVACY UYARISI
  // ---------------------------------------------------------------
  private buildPrivacyNotice(steps: ParsedStep[]): string | undefined {
    const aiTools: string[] = [];
    const walk = (list: ParsedStep[]) => {
      for (const s of list) {
        const action = ACTION_BY_NAME[s.tool];
        if (action?.category === 'AI') aiTools.push(action.name);
        if (Array.isArray(s.steps)) walk(s.steps);
        if (Array.isArray(s.then)) walk(s.then);
        if (Array.isArray(s.else)) walk(s.else);
        if (Array.isArray(s.branches)) s.branches.forEach(walk);
      }
    };
    walk(steps);

    if (aiTools.length === 0) return undefined;

    const unique = Array.from(new Set(aiTools));
    return (
      `Bu otomasyon çalışırken bazı verileri Anthropic API'sine gönderir ` +
      `(${unique.join(', ')}). Müvekkil bilgilerinin AI servisine gitmesini istemiyorsanız ` +
      `bu otomasyonu KVKK açısından gözden geçirin.`
    );
  }
}
