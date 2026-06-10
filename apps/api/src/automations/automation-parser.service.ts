import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  ACTION_BY_NAME,
  AutomationAction,
  VALID_EVENT_NAMES,
  buildCatalogMarkdown,
} from './action-catalog';
import { claudeTextViaMax, isMaxAvailable, MAX_MODEL_DEFAULT } from '../common/max-inference';

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

    const systemPrompt = this.buildSystemPrompt();

    // Maliyet sırası: ÖNCE Max aboneliği (ücretsiz). Max'ta araç (tool_choice) yok,
    // bu yüzden "sadece JSON döndür" talimatı veririz. Max yoksa/başarısızsa ücretli
    // Anthropic API + propose_automation tool_choice yoluna düşülür.
    let proposed: any = null;
    let model = DEFAULT_PARSER_MODEL;
    let inputTokens = 0;
    let outputTokens = 0;
    let parseCostUsd = 0;

    // 1) Max — JSON-prompt
    if (isMaxAvailable()) {
      try {
        const jsonInstruction =
          `${prompt}\n\n# ÇIKTI (ZORUNLU)\n` +
          `Yalnızca TEK bir geçerli JSON nesnesi döndür — markdown, kod bloğu veya ek açıklama YOK. ` +
          `Alanlar: {"title": string, "description": string, "humanReadablePreview": string, ` +
          `"triggerType": "CRON"|"EVENT"|"WEBHOOK"|"MANUAL", "triggerConfig": object, ` +
          `"steps": {"schemaVersion": 1, "steps": [{"id": string, "tool": string, "args": object, "outputAs"?: string}]}, ` +
          `"confidence": number}. Yapamadığın iş için confidence: 0 ve steps: [] ver.`;
        const max = await claudeTextViaMax({
          prompt: jsonInstruction,
          system: systemPrompt,
          model: MAX_MODEL_DEFAULT,
          maxTurns: 1,
        });
        if (max.ok && max.text) {
          const parsedJson = this.extractJsonObject(max.text);
          if (parsedJson) {
            proposed = parsedJson;
            model = max.model;
            // Max maliyeti kotadan düşer — token başına fatura değil.
            parseCostUsd = 0;
          } else {
            this.logger.warn('Parser Max JSON parse edilemedi; ücretli API fallback varsayılan kapalı.');
          }
        } else if (max.error) {
          this.logger.warn(`Parser Max başarısız: ${max.error}`);
        }
      } catch (err: any) {
        this.logger.warn(`Parser Max hatası: ${err?.message}`);
      }
    }

    // 2) Ücretli API (tool_choice) — yalnızca açık izin verilirse.
    if (!proposed) {
      const apiAllowed = process.env.MOREN_AI_ALLOW_ANTHROPIC_API === '1' || process.env.AI_ALLOW_API_FALLBACK === '1';
      if (!apiAllowed) {
        throw new ServiceUnavailableException(
          'Otomasyon ayrıştırıcı Claude Max ile sonuç üretemedi. Ücretli API fallback kapalı olduğu için API çağrısı yapılmadı.',
        );
      }
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new ServiceUnavailableException(
          'Otomasyon ayrıştırıcı için ANTHROPIC_API_KEY ayarlı değil.',
        );
      }

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
      inputTokens = data?.usage?.input_tokens ?? 0;
      outputTokens = data?.usage?.output_tokens ?? 0;
      parseCostUsd = this.computeCost(inputTokens, outputTokens);

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

      proposed = toolUseBlock.input;
    }

    if (!proposed) {
      throw new BadRequestException(
        'Cümleyi anlayamadım. Lütfen daha açık bir cümleyle deneyin. ' +
          'Örnek: "Her ayın 22\'sinde KDV gecikenlere WhatsApp at."',
      );
    }
    // Defensive normalization — Claude bazen steps'i tek başına dizi olarak verir,
    // bazen schemaVersion'ı atlar. Geçerli şemaya çekiyoruz.
    if (!proposed.steps || typeof proposed.steps !== 'object' || Array.isArray(proposed.steps)) {
      proposed.steps = {
        schemaVersion: 1,
        steps: Array.isArray(proposed.steps) ? proposed.steps : [],
      };
    }
    if (proposed.steps.schemaVersion !== 1) {
      proposed.steps.schemaVersion = 1;
    }
    if (!Array.isArray(proposed.steps.steps)) {
      proposed.steps.steps = [];
    }
    // Boş steps durumu — parser yapamıyor demektir, confidence'ı 0'a çek
    if (proposed.steps.steps.length === 0) {
      proposed.confidence = 0;
    }
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
        model,
        inputTokens,
        outputTokens,
        parseCostUsd,
      },
    };
  }

  /** Serbest metinden ilk geçerli JSON nesnesini çıkar (Max'ın saf-metin çıktısı için). */
  private extractJsonObject(raw: string): any | null {
    if (!raw) return null;
    const cleaned = String(raw)
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    // Doğrudan dene
    try {
      return JSON.parse(cleaned);
    } catch {}
    // İlk { ... son } aralığını dene
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {}
    }
    return null;
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

1b. **Bu sürümde pasif aksiyonlar.** \`ocr_pdf\`, \`post_to_luca\`, \`send_sms\` ve WEBHOOK tetikleyici üretme. Kullanıcı bunlardan birini isterse confidence: 0, steps: [] döndür ve humanReadablePreview'da bu yeteneğin henüz aktif olmadığını söyle.

2. **Tetikleyiciyi doğru seç.**
   - "Her ay X tarihinde", "her gün saat Y'de", "her hafta" → CRON (cron expression üret)
   - "Bir müvekkil X yaptığında", "fatura yüklendiğinde", "WhatsApp mesajı geldiğinde" → EVENT
   - "Dışarıdan HTTP isteği geldiğinde" → WEBHOOK yalnızca sistemde özellikle açıldıysa desteklenir. Bu kurulumda WEBHOOK pasif kabul et; kullanıcı webhook isterse confidence: 0 ve boş steps ile "henüz desteklenmiyor" diye açıkça belirt.
   - Test/tek seferlik → MANUAL

2b. **EVENT seçtiysen \`triggerConfig.eventName\` MUTLAKA aşağıdaki listeden BİRİ olmalı:**
   - \`Taxpayer.EvrakDurumuChanged\` — müvekkilin "evrak geldi" alanı değişti (evrak teslim alındı/iptal edildi). Filtre olarak \`newValue: true\` koyarsan sadece "evrak geldi" olunca tetiklenir.
   - \`Taxpayer.EvrakIslendiChanged\` — "evrak işlendi" alanı değişti.
   - \`Taxpayer.KontrolEdildiChanged\` — "kontrol edildi" alanı değişti.
   - \`Taxpayer.BeyannameDurumuChanged\` — "beyanname verildi" alanı değişti. Filtre: \`newValue: true\` beyanname verildiğinde, \`false\` iptal edildiğinde.
   - \`Taxpayer.EvraklarHazir\` — hem "evrak geldi" hem "evrak işlendi" true oldu. Tipik: \`fetch_invoices_for_period({ taxpayerId: "{{trigger.payload.taxpayerId}}", donem: "{{trigger.payload.beyannamePeriodLabel}}" })\` ile Mihsap fatura çek. KRİTİK: fatura BEYANNAME dönemine aittir → donem = \`beyannamePeriodLabel\` (işlem ayının BİR ÖNCEKİ ayı), \`periodLabel\` (işlem ayı) DEĞİL. "...sonra Drive'a yedekle" istenirse İKİNCİ adım: \`backup_to_drive({ taxpayerId: "{{trigger.payload.taxpayerId}}", donem: "{{trigger.payload.beyannamePeriodLabel}}" })\`.
   - \`Taxpayer.KdvKontrolTamam\` — aylık takipte ind.+hes. KDV + e-arşiv kontrol (ve evrak geldi/işlendi) HEPSİ işaretlendi. Tipik: \`fetch_kdv_from_luca({ taxpayerId: "{{trigger.payload.taxpayerId}}", donem: "{{trigger.payload.beyannamePeriodLabel}}" })\` ile Luca KDV verisini çek (BEYANNAME dönemi).
   - \`Taxpayer.Created\` — yeni müvekkil eklendi.
   - \`WhatsApp.MessageReceived\` — müvekkilden serbest WhatsApp mesajı geldi.
   - \`Document.Uploaded\` — portala belge yüklendi.
   ASLA bu listede olmayan bir event ismi (örn. \`taxpayer.evrak_durumu_guncellendi\`, \`Invoice.Created\`, \`WhatsApp.DocumentReceived\`) üretme. Kullanıcı "fatura oluşunca" veya "WhatsApp'tan belge gelince" gibi henüz desteklenmeyen bir olay isterse confidence: 0, steps: [] ver ve humanReadablePreview'da bu tetikleyicinin henüz aktif olmadığını söyle.
   Event payload alanları (\`{{trigger.payload.X}}\` ile erişilir):
   - Taxpayer.EvrakDurumuChanged / EvrakIslendiChanged / KontrolEdildiChanged / BeyannameDurumuChanged: \`taxpayerId\`, \`taxpayerUnvan\`, \`taxpayerVkn\`, \`year\`, \`month\`, \`periodLabel\` (YYYY-MM, sıfır-dolgulu — dönem için BUNU kullan), \`field\`, \`oldValue\`, \`newValue\`
   - Taxpayer.EvraklarHazir: \`taxpayerId\`, \`taxpayerUnvan\`, \`taxpayerVkn\`, \`year\`, \`month\`, \`periodLabel\` (işlem ayı YYYY-MM), \`beyannamePeriodLabel\` (BEYANNAME dönemi = işlem ayı-1, YYYY-MM). Fatura/KDV gibi VERİ çekme aksiyonlarında DAİMA \`beyannamePeriodLabel\` kullan (işlem ayı Haziran ise fatura Mayıs'a aittir).
   - Taxpayer.KdvKontrolTamam: \`taxpayerId\`, \`taxpayerUnvan\`, \`taxpayerVkn\`, \`year\`, \`month\`, \`donem\` (işlem ayı YYYY-MM), \`beyannamePeriodLabel\` (BEYANNAME dönemi YYYY-MM). \`fetch_kdv_from_luca\` için \`donem: "{{trigger.payload.beyannamePeriodLabel}}"\` kullan.
   NOT: "İşlem ayı" = evrakın işlendiği ay; "Beyanname dönemi" = onun bir önceki ayı. MIHSAP fatura ve Luca KDV verisi BEYANNAME dönemine aittir; per-alan event'lerde de \`beyannamePeriodLabel\` mevcuttur.
   - Taxpayer.KdvKontrolKilitlendi: \`taxpayerId\`, \`taxpayerUnvan\`, \`taxpayerVkn\`, \`year\`, \`month\`, \`periodLabel\` (YYYY/MM), \`sessionId\`. Bu event tetiklenince \`generate_fis_word_from_invoices\` aksiyonu ile fiş Word'ü üretmek için donem = "{{trigger.payload.year}}-{{trigger.payload.month}}" şeklinde formatlanır (ay tek haneliyse padStart). Pratik: parser triggerConfig.eventName="Taxpayer.KdvKontrolKilitlendi", filter olmadan, sonraki adımda \`generate_fis_word_from_invoices({ taxpayerId: "{{trigger.payload.taxpayerId}}", donem: "{{trigger.payload.periodLabel}}" })\` kullanır — periodLabel zaten "YYYY/MM" değil "YYYY-MM" istiyorsa parser önce bir hesaplama gerek ama periodLabel formatı kontrol edilmeli. ALTERNATİF: trigger.payload.year + "-" + trigger.payload.month string concat ile YYYY-M elde edilir, ama ay padding yoksa sorun olur; bu yüzden parser yıl-ay biçimini istediği gibi kullansın, action dispatcher tarafında strict format kontrolü var. AYRICA: "KDV kontrolü kilitlenince aylık takipte ind/hes/e-arşiv kutuları işaretlensin" istenirse → \`set_monthly_status({ taxpayerId: "{{trigger.payload.taxpayerId}}", year: "{{trigger.payload.islemYear}}", month: "{{trigger.payload.islemMonth}}", indirilecekKdvKontrol: true, hesaplananKdvKontrol: true, eArsivKontrol: true })\` kullan. ÖNEMLİ: aylık takip listesi İŞLEM AYINA göre anahtarlanır; KDV kontrol oturumu BEYANNAME dönemidir (year/month). Kutuları işaretlerken DAİMA \`islemYear\`/\`islemMonth\` (= beyanname dönemi + 1 ay) kullan, \`year\`/\`month\` DEĞİL — yoksa kutular kullanıcının gördüğü işlem-ayı satırında görünmez. KdvKontrolKilitlendi payload: \`taxpayerId\`, \`year\`/\`month\`/\`beyannamePeriodLabel\` (beyanname dönemi), \`islemYear\`/\`islemMonth\`/\`islemPeriodLabel\` (işlem ayı), \`sessionId\`.
   - Taxpayer.Created: \`taxpayerId\`, \`taxpayerUnvan\`, \`taxpayerVkn\`, \`taxpayerType\`
   - WhatsApp.MessageReceived: \`taxpayerId\`, \`taxpayerUnvan\`, \`from\` (telefon), \`text\` (mesaj içeriği), \`messageId\`
   - Document.Uploaded: \`documentId\`, \`taxpayerId\`, \`title\`, \`category\`, \`mimeType\`, \`sizeBytes\`, \`uploadedBy\`

3. **Cron expression'ı dikkatli yaz.**
   - "Her ayın 22'sinde sabah 10:00" → "0 10 22 * *"
   - "Her gün sabah 9:00" → "0 9 * * *"
   - "Her hafta Pazartesi 8:00" → "0 8 * * 1"
   - Saat verilmemişse mantıklı bir varsayılan seç (sabah 10:00).
   - **Saatler TÜRKİYE saatidir** — \`triggerConfig.timezone: "Europe/Istanbul"\` ekle. Runner cron'u bu timezone'da çalıştırır, kullanıcı UTC dönüşümü düşünmek zorunda kalmaz.

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

8. **Eşik / koşul izleme.** Kullanıcı "X şu değerin üstüne çıkınca uyar" derse:
   1) İlgili read aksiyonuyla değeri al (outputAs ile sakla).
   2) \`branch_if\` ile \`{ left: "{{deger}}", op: ">", right: <eşik> }\` kontrolü yap.
   3) Then dalında uyarı aksiyonunu çağır.
   Cron'u "her saat" veya "her gün" yap. Her tetiklemede koşul tekrar değerlendirilir — eşik aşıldığı sürece her seferinde tetiklenir (bu kasıtlı — bir hatırlatma sürekli aktif kalır).

9. **Çoklu adım kompozisyonu.** Karmaşık otomasyonlarda for_each + branch_if + format_list'i serbest kullan. Örnek pattern: "her müvekkel için: durumunu kontrol et → eğer sorun varsa: detayını al → bildirim ekle".

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

    // "Yapamıyorum" durumu (steps boş veya confidence 0) — tetikleyici detayını kontrol etme
    // Kullanıcı UI'da "yapamıyorum" mesajını görecek, kayıt yapılmayacak zaten.
    const isRefusal = proposed.steps.steps.length === 0 || proposed.confidence === 0;
    if (isRefusal) return;

    // Her aksiyon adı kataloğumda olmalı
    const unknownTools = this.collectUnknownTools(proposed.steps.steps);
    if (unknownTools.length > 0) {
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

    if (proposed.triggerType === 'WEBHOOK' && process.env.AUTOMATIONS_ENABLE_WEBHOOKS !== 'true') {
      throw new BadRequestException('WEBHOOK tetikleyici bu sürümde aktif değil.');
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
