import { Injectable, Logger } from '@nestjs/common';
import { ToolExecutorService } from '../moren-ai/tool-executor.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { FisYazdirmaService } from '../fis-yazdirma/fis-yazdirma.service';
import { MihsapService } from '../mihsap/mihsap.service';
import { EmailService } from '../email/email.service';
import { KdvBeyannameService } from '../kdv-beyanname/kdv-beyanname.service';
import { ACTION_BY_NAME } from './action-catalog';
import { claudeTextViaMax } from '../common/max-inference';

/**
 * Runner'ın çağırdığı tek nokta — bir aksiyon adını gerçek servis çağrısına yönlendirir.
 *
 * FLOW aksiyonları (for_each, branch_if, parallel, wait) BURADA değil RUNNER'da
 * yorumlanır. Bu dispatcher yalnız LEAF aksiyonlarını çalıştırır.
 *
 * Faz 3 kapsamında:
 *  - READ tool'ları: mevcut ToolExecutorService'e delege edilir.
 *  - WRITE tool'ları (send_whatsapp_*, send_email, send_sms, create_pending_action):
 *    gerçek servis metoduna bağlanır.
 *  - AI tool'ları (summarize_with_claude, classify_with_claude): Anthropic API'ye fetch.
 *  - OCR / Luca / external aksiyonları: ŞİMDİLİK STUB döner — Faz 6'da gerçeklenecek.
 *
 * Tenant izolasyonu: çağırırken ctx.tenantId zorunlu, her servis bunu kullanır.
 */
@Injectable()
export class ActionDispatcherService {
  private readonly logger = new Logger(ActionDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolExecutor: ToolExecutorService,
    private readonly notifications: NotificationsService,
    private readonly whatsapp: WhatsAppService,
    private readonly fisYazdirma: FisYazdirmaService,
    private readonly mihsap: MihsapService,
    private readonly email: EmailService,
    private readonly kdvBeyanname: KdvBeyannameService,
  ) {}

  /**
   * Aksiyonu çalıştır. Hata fırlatırsa runner yakalar ve step log'una yazar.
   */
  async dispatch(
    toolName: string,
    args: Record<string, unknown>,
    ctx: { tenantId: string; userId?: string | null; automationId: string },
  ): Promise<unknown> {
    const action = ACTION_BY_NAME[toolName];
    if (!action) {
      throw new Error(`Bilinmeyen aksiyon: ${toolName}`);
    }
    if (action.category === 'FLOW') {
      throw new Error(`Flow aksiyonları runner'da işlenir, dispatch'e geçmemeli: ${toolName}`);
    }

    // READ kategorisi: mevcut ToolExecutorService'e delege et
    if (action.category === 'READ') {
      return this.toolExecutor.execute(toolName, args, {
        tenantId: ctx.tenantId,
        userId: ctx.userId ?? null,
      });
    }

    // WRITE / AI / EXTERNAL: aksiyona özel dispatch
    switch (toolName) {
      // ---------------- İLETİŞİM ----------------
      case 'send_whatsapp_template':
        return this.sendWhatsAppTemplate(args, ctx);
      case 'send_whatsapp_freeform':
        return this.sendWhatsAppFreeform(args, ctx);
      case 'send_email':
        return this.sendEmail(args, ctx);
      case 'send_sms':
        return this.sendSms(args, ctx);
      case 'create_pending_action':
        return this.createPendingAction(args, ctx);

      // ---------------- AI YARDIMCILARI ----------------
      case 'summarize_with_claude':
        return this.summarizeWithClaude(args);
      case 'classify_with_claude':
        return this.classifyWithClaude(args);

      // ---------------- DIŞ KAYNAK ----------------
      case 'http_get':
        return this.httpGet(args);
      case 'check_official_gazette':
        return this.checkOfficialGazette(args);

      // ---------------- BELGE / OCR / LUCA ----------------
      case 'extract_invoice_fields':
        return this.extractInvoiceFields(args);
      case 'ocr_pdf':
        return this.stubResponse(
          toolName,
          'OCR aksiyonu kdv-control/OcrService ile entegre edilecek. Şu an documentId verirseniz boş döner. ' +
            'Tam entegrasyon için: StorageService.getObject + Buffer + OcrService.extractFromImage akışı kurulmalı.',
        );
      case 'post_to_luca':
        return this.stubResponse(
          toolName,
          'Luca\'ya direkt fiş atma aksiyonu LucaService.createFetchJob yerine yeni bir "createEntry" metoduna ihtiyaç duyar. ' +
            'Şu an Luca\'da bu metot yok — manuel olarak portal/Luca arayüzünden işleme alın.',
        );
      case 'generate_fis_word_from_invoices':
        return this.generateFisWordFromInvoices(args, ctx);
      case 'print_word_output':
        return this.printWordOutput(args, ctx);
      case 'fetch_invoices_for_period':
        return this.fetchInvoicesForPeriod(args, ctx);

      case 'fetch_kdv_from_luca':
        return this.fetchKdvFromLuca(args, ctx);

      default:
        throw new Error(`Aksiyon "${toolName}" tanımlı ama dispatcher'da uygulanmamış.`);
    }
  }

  // ---------------------------------------------------------------
  // İLETİŞİM AKSİYONLARI
  // ---------------------------------------------------------------

  private async sendWhatsAppTemplate(args: any, ctx: { tenantId: string }) {
    const phone = String(args.to ?? '');
    const templateName = String(args.templateName ?? '');
    const variables: Record<string, string> = args.variables ?? {};
    // Variables objesi (`{ "1": "Ali", "2": "Nisan" }`) Meta'nın beklediği sıralı
    // diziye çevrilir. Numerik key'ler 1, 2, 3 ... varsayılır.
    const ordered = Object.keys(variables)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => String(variables[k]));
    const ok = await this.whatsapp.sendTemplate(phone, ordered, templateName || undefined, ctx.tenantId);
    return { sent: ok, to: phone, template: templateName };
  }

  private async sendWhatsAppFreeform(args: any, ctx: { tenantId: string }) {
    const phone = String(args.to ?? '');
    const message = String(args.message ?? '').slice(0, 4096);
    const ok = await this.whatsapp.sendMessage(phone, message, ctx.tenantId);
    return { sent: ok, to: phone };
  }

  private async sendEmail(args: any, ctx: { tenantId: string }) {
    // Merkezi EmailService — tenant'a ozel SMTP config'i (DB) veya env fallback
    const result = await this.email.send(
      {
        to: String(args.to ?? ''),
        subject: String(args.subject ?? ''),
        html: args.isHtml ? String(args.body ?? '') : undefined,
        text: !args.isHtml ? String(args.body ?? '') : undefined,
      },
      ctx.tenantId,
    );
    return { sent: result.sent, messageId: result.messageId, to: args.to };
  }

  private async sendSms(args: any, _ctx: { tenantId: string }) {
    // SMS sağlayıcı entegrasyonu için ayrı SmsService yok — şimdilik notification
    // olarak kaydedip operatör/ekran tarafında bildirim gösteriyoruz.
    // Gerçek SMS gönderimi (NetGSM, Twilio vb.) Faz 8 polish'inde eklenir.
    this.logger.warn(`[SMS] Gerçek sağlayıcı bağlı değil. ${args.to} için stub.`);
    return { sent: false, reason: 'SMS sağlayıcı yapılandırılmamış (stub)', to: args.to };
  }

  private async createPendingAction(
    args: any,
    ctx: { tenantId: string; userId?: string | null; automationId: string },
  ) {
    const notification = await this.notifications.create({
      tenantId: ctx.tenantId,
      userId: args.userId || ctx.userId || undefined,
      title: String(args.title ?? '').slice(0, 200),
      body: String(args.body ?? '').slice(0, 1000),
      type: 'AUTOMATION',
      metadata: {
        automationId: ctx.automationId,
        taxpayerId: args.taxpayerId,
        priority: args.priority || 'normal',
      },
    });
    return { created: true, notificationId: notification.id };
  }

  // ---------------------------------------------------------------
  // AI YARDIMCILARI (Anthropic API)
  // ---------------------------------------------------------------

  private async summarizeWithClaude(args: any) {
    const text = String(args.text ?? '');
    if (!text) return { summary: '', cost: 0 };
    const maxWords = Number(args.maxWords ?? 100);
    const focus = args.focus ? `\nÖzellikle şuna odaklan: ${args.focus}` : '';
    const userPrompt = `Aşağıdaki metni Türkçe olarak ${maxWords} kelimeyi geçmeyecek şekilde özetle.${focus}\n\n---\n${text.slice(0, 16000)}`;
    return this.claudeCall(userPrompt, 'claude-haiku-4-5-20251001', 800);
  }

  private async classifyWithClaude(args: any) {
    const text = String(args.text ?? '').slice(0, 8000);
    const categories: string[] = Array.isArray(args.categories) ? args.categories : [];
    if (!categories.length) throw new Error('classify_with_claude: categories listesi boş.');
    const userPrompt = `Aşağıdaki metni şu kategorilerden TEKİNE ata: ${categories.join(', ')}.\nSadece kategori adını döndür, başka açıklama yapma.\n\n---\n${text}`;
    const result = await this.claudeCall(userPrompt, 'claude-haiku-4-5-20251001', 50);
    const picked = String(result.text).trim();
    const normalized = categories.find((c) => c.toLowerCase() === picked.toLowerCase()) ?? picked;
    return { category: normalized, raw: result.text, cost: result.cost };
  }

  /**
   * Claude API'ye düz prompt çağrısı. Kullanım sayacı kaydedilmez (Faz 8'de eklenir).
   */
  private async claudeCall(
    userPrompt: string,
    model = 'claude-haiku-4-5-20251001',
    maxTokens = 800,
  ): Promise<{ text: string; cost: number; inputTokens: number; outputTokens: number }> {
    // ÖNCE MAX (ücretsiz, abonelik). Saf metin işi olduğu için Max yeterli.
    const max = await claudeTextViaMax({ prompt: userPrompt, model });
    if (max.ok) {
      return { text: max.text, cost: 0, inputTokens: 0, outputTokens: 0 };
    }
    // Max başarısız: API fallback yalnızca açıkça izin verilmişse (varsayılan: API'ye düşme).
    if (process.env.AI_ALLOW_API_FALLBACK !== '1' && process.env.MOREN_AI_ALLOW_ANTHROPIC_API !== '1') {
      throw new Error(`Max çağrısı başarısız, API fallback kapalı: ${max.error}`);
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY ayarlanmamış.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API hata ${res.status}: ${err.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const text = data?.content?.[0]?.text ?? '';
    const inputTokens = data?.usage?.input_tokens ?? 0;
    const outputTokens = data?.usage?.output_tokens ?? 0;
    // Haiku 4.5 fiyat tahmini ($0.80/M giriş, $4/M çıkış)
    const cost =
      Math.round((inputTokens * 0.0000008 + outputTokens * 0.000004) * 10000) / 10000;
    return { text, cost, inputTokens, outputTokens };
  }

  // ---------------------------------------------------------------
  // FİŞ YAZDIRMA (Word raporu)
  // ---------------------------------------------------------------
  /**
   * Mükellef + dönem için MIHSAP'tan FIS faturalarını çekip Word üretir.
   * Otomasyon "KDV kilitlendi → fiş Word raporu" akışı için.
   */
  /**
   * Donem string'ini "YYYY-MM" formatına normalize eder.
   * Kabul ettiği girdiler:
   *   "2026-04", "2026-4", "2026/04", "2026/4"  -> "2026-04"
   *   "04/2026", "4/2026", "04-2026", "4-2026"  -> "2026-04"
   *   "2026.04", "2026.4"                        -> "2026-04"
   * Gecersizse null doner.
   *
   * BUG FIX: KDV Kontrol session.periodLabel "2026/04" formatinda (slash) sakliyor
   * ama MihsapInvoice.donem "2026-04" formatinda (tire). Ayrica otomasyon parser
   * `{{year}}-{{month}}` template'i kullanirsa padding kaybolup "2026-4" uretir.
   * Bu fonksiyon her iki format farkini ve padding eksikligini duzeltir.
   */
  private normalizeDonem(input: string): string | null {
    const s = String(input ?? '').trim();
    if (!s) return null;
    const parts = s.split(/[-/.]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length !== 2) return null;
    let year: number;
    let month: number;
    if (/^\d{4}$/.test(parts[0])) {
      year = Number(parts[0]);
      month = Number(parts[1]);
    } else if (/^\d{4}$/.test(parts[1])) {
      year = Number(parts[1]);
      month = Number(parts[0]);
    } else {
      return null;
    }
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    if (year < 2000 || year > 2100) return null;
    if (month < 1 || month > 12) return null;
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  private async generateFisWordFromInvoices(
    args: any,
    ctx: { tenantId: string; userId?: string | null },
  ) {
    const taxpayerId = String(args.taxpayerId ?? '');
    const donemRaw = String(args.donem ?? '');
    if (!taxpayerId || !donemRaw) {
      throw new Error('generate_fis_word_from_invoices: taxpayerId ve donem zorunlu.');
    }
    const donem = this.normalizeDonem(donemRaw);
    if (!donem) {
      throw new Error(
        `generate_fis_word_from_invoices: donem formati gecersiz ("${donemRaw}"). Beklenen: "YYYY-MM" (orn. "2026-04").`,
      );
    }
    const result = await this.fisYazdirma.generateFromInvoices({
      tenantId: ctx.tenantId,
      mukellefId: taxpayerId,
      donem,
      createdBy: ctx.userId ?? undefined,
    });
    return {
      success: true,
      filename: result.filename,
      fileCount: result.fileCount,
      outputId: result.outputId,
      downloadUrl: result.downloadUrl,
    };
  }

  // ---------------------------------------------------------------
  // PRINT WORD OUTPUT — lokal agent uzerinden yazicidan cikar
  // ---------------------------------------------------------------
  private async printWordOutput(
    args: any,
    ctx: { tenantId: string; userId?: string | null },
  ) {
    const outputId = String(args.outputId ?? '');
    if (!outputId) {
      throw new Error('print_word_output: outputId zorunlu.');
    }
    const deviceId = args.deviceId ? String(args.deviceId) : undefined;
    const result = await this.fisYazdirma.enqueuePrint(ctx.tenantId, outputId, deviceId);
    return {
      success: true,
      outputId: result.id,
      printStatus: result.printStatus,
      message: 'Yazdirma kuyruga eklendi; lokal agent birkac saniye icinde alacak.',
    };
  }

  // ---------------------------------------------------------------
  // FETCH INVOICES FOR PERIOD — MIHSAP'tan canli cek
  // ---------------------------------------------------------------
  private async fetchInvoicesForPeriod(
    args: any,
    ctx: { tenantId: string; userId?: string | null },
  ) {
    const taxpayerId = String(args.taxpayerId ?? '');
    const donemRaw = String(args.donem ?? '');
    if (!taxpayerId || !donemRaw) {
      throw new Error('fetch_invoices_for_period: taxpayerId ve donem zorunlu.');
    }
    const donem = this.normalizeDonem(donemRaw);
    if (!donem) {
      throw new Error(
        `fetch_invoices_for_period: donem formati gecersiz ("${donemRaw}"). Beklenen: "YYYY-MM".`,
      );
    }
    const faturaTuru = args.faturaTuru === 'ALIS' || args.faturaTuru === 'SATIS'
      ? args.faturaTuru
      : null; // null = ikisi de

    // Mukellefin MIHSAP ID'sini bul
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: taxpayerId, tenantId: ctx.tenantId },
      select: { mihsapId: true, firstName: true, lastName: true, companyName: true, type: true },
    });
    if (!taxpayer?.mihsapId) {
      throw new Error('fetch_invoices_for_period: Bu mukellefin MIHSAP ID\'si yok. Mukellef kartindan ekleyin.');
    }

    const results: any[] = [];
    const turler: ('ALIS' | 'SATIS')[] = faturaTuru ? [faturaTuru] : ['ALIS', 'SATIS'];
    for (const tur of turler) {
      try {
        // fetchAndStoreInvoices senkron çeker; { jobId, total, fetched, errorMsg } döner.
        // Hata olursa fırlatır (catch'e düşer). Hatasız ama 0 fatura = "yeşil ama boş".
        const job: any = await this.mihsap.fetchAndStoreInvoices({
          tenantId: ctx.tenantId,
          mukellefId: taxpayerId,
          mukellefMihsapId: String(taxpayer.mihsapId),
          donem,
          faturaTuru: tur,
          createdBy: ctx.userId ?? undefined,
        });
        results.push({
          tur,
          jobId: job?.jobId ?? null,
          bulunan: Number(job?.total ?? 0),
          cekilen: Number(job?.fetched ?? 0),
          ok: true,
        });
      } catch (err: any) {
        results.push({ tur, ok: false, error: err.message?.slice(0, 200) });
      }
    }
    const cekilenFatura = results.reduce((s, r) => s + (Number(r.cekilen) || 0), 0);
    const bulunanFatura = results.reduce((s, r) => s + (Number(r.bulunan) || 0), 0);
    const hataVar = results.some((r) => !r.ok);
    return {
      // Hatasız tamamlandıysa success=true; ama GERÇEK fatura sayısını da raporla ki
      // otomasyon geçmişinde "yeşil ama 0 fatura" durumu görünsün (sessiz boş başarı yok).
      success: !hataVar,
      taxpayerId,
      donem,
      cekilenFatura,
      bulunanFatura,
      results,
      not:
        !hataVar && cekilenFatura === 0
          ? `Mihsap "${donem}" döneminde 0 fatura döndürdü. Muhtemel sebep: faturalar Mihsap arşivine henüz düşmemiş (kutu erken işaretlendi) ya da dönem yanlış. Manuel "Hepsini Çek" ile aynı dönemi doğrula.`
          : undefined,
    };
  }

  /**
   * fetch_kdv_from_luca — KDV verilerini Luca'dan çeker (KDV beyanname panosunu besler).
   * Manuel "Luca'dan Çek" ile aynı `autoFetchForKontrolTamam`'ı kullanır; aynı dönem
   * için bekleyen/çalışan job varsa yeni açılmaz (tekrar önleme orada). Hata fırlatırsa
   * runner kırmızı işler — sessiz boş başarı yok.
   */
  private async fetchKdvFromLuca(args: any, ctx: { tenantId: string }) {
    const taxpayerId = String(args.taxpayerId ?? '');
    const donemRaw = String(args.donem ?? '');
    if (!taxpayerId || !donemRaw) {
      throw new Error('fetch_kdv_from_luca: taxpayerId ve donem zorunlu.');
    }
    const donem = this.normalizeDonem(donemRaw);
    if (!donem) {
      throw new Error(
        `fetch_kdv_from_luca: donem formati gecersiz ("${donemRaw}"). Beklenen: "YYYY-MM".`,
      );
    }
    const res: any = await this.kdvBeyanname.autoFetchForKontrolTamam({
      tenantId: ctx.tenantId,
      mukellefId: taxpayerId,
      donem,
    });
    return {
      success: true,
      taxpayerId,
      donem,
      tip: res?.tip ?? null,
      jobId: res?.jobId ?? null,
      durum: res?.status ?? null,
      mevcutJob: !!res?.reused,
      not: res?.reused
        ? 'Bu donem icin zaten bir Luca job vardi; yenisi acilmadi (tekrar onleme).'
        : undefined,
    };
  }

  // ---------------------------------------------------------------
  // FATURA ALAN ÇIKARICI (Claude ile)
  // ---------------------------------------------------------------
  /**
   * Fatura OCR çıktısından yapısal alan çıkarımı. Claude'a şema verilir,
   * o JSON döner. Türkçe fatura terminolojisi (KDV, Tevkifat, vb.) tanır.
   */
  private async extractInvoiceFields(args: any) {
    const text = String(args.ocrText ?? '').slice(0, 16000);
    if (!text) return { error: 'ocrText boş — OCR çıktısı verilmeli.' };

    const prompt = `Sen bir Türk fatura analiz uzmanısın. Aşağıdaki OCR metninden fatura alanlarını çıkar.
Yanıtını SADECE JSON olarak ver, başka açıklama yapma.

Şema:
{
  "tedarikciAdi": "string veya null",
  "tedarikciVkn": "string (10/11 hane) veya null",
  "aliciAdi": "string veya null",
  "aliciVkn": "string veya null",
  "faturaNo": "string veya null",
  "faturaTarihi": "YYYY-MM-DD veya null",
  "donem": "YYYY-MM veya null (faturanın ait olduğu dönem)",
  "matrah": "number veya null (KDV hariç toplam)",
  "kdvOrani": "number veya null (1, 8, 10, 18, 20 vb.)",
  "kdvTutari": "number veya null",
  "tevkifatOrani": "number veya null (tevkifat varsa)",
  "genelToplam": "number veya null",
  "paraBirimi": "TRY|USD|EUR veya null",
  "aciklama": "string (kısa özet)"
}

OCR METNİ:
---
${text}`;

    const result = await this.claudeCall(prompt, 'claude-haiku-4-5-20251001', 1000);
    try {
      // Claude bazen ```json blokları içine sarar — temizle
      const cleaned = result.text
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      return { ...parsed, _meta: { cost: result.cost, model: 'haiku-4-5' } };
    } catch (err: any) {
      return {
        error: `Claude çıktısı JSON olarak parse edilemedi: ${err.message}`,
        rawText: result.text.slice(0, 500),
      };
    }
  }

  // ---------------------------------------------------------------
  // DIŞ KAYNAK
  // ---------------------------------------------------------------

  private async httpGet(args: any) {
    const url = String(args.url ?? '');
    if (!url.startsWith('https://')) throw new Error('http_get sadece HTTPS destekler.');
    // Müvekkil verisi sızıntısını önlemek için allowlist (Faz 7'de genişler).
    const ALLOWLIST = [
      'resmigazete.gov.tr',
      'gib.gov.tr',
      'sgk.gov.tr',
      'mevzuat.gov.tr',
    ];
    const host = new URL(url).hostname;
    if (!ALLOWLIST.some((d) => host === d || host.endsWith('.' + d))) {
      throw new Error(`http_get domain'i allowlist'te değil: ${host}`);
    }
    const res = await fetch(url, { headers: args.headers ?? {} });
    const text = await res.text();
    return { status: res.status, body: text.slice(0, 100_000) };
  }

  // ---------------------------------------------------------------
  // RESMİ GAZETE TAKİBİ (Faz 7)
  // ---------------------------------------------------------------
  /**
   * Resmi Gazete sayfasını çeker, Claude ile yapısal olarak parse eder,
   * verilen anahtar kelimelerle eşleşenleri filtreler ve her biri için özet üretir.
   *
   * Tek bir Claude çağrısıyla: extract + filter + summarize.
   *
   * RG'nin sitesi bot koruması veya JS gerektirebilir — fetch başarısız olursa
   * { error, hint } döner, runner bunu "kısmi" olarak işaretler.
   */
  private async checkOfficialGazette(args: any) {
    const keywords: string[] = Array.isArray(args.keywords) ? args.keywords : [];
    const sinceDays = Number(args.sinceDays ?? 1);
    if (keywords.length === 0) {
      throw new Error('check_official_gazette: keywords boş olamaz (örn. ["KDV", "katma değer vergisi"]).');
    }

    // Bugünden N gün geriye giderek günlük endeksleri tara
    const today = new Date();
    const targets: { url: string; tarih: string }[] = [];
    for (let i = 0; i < Math.min(sinceDays, 7); i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const tarih = d.toISOString().slice(0, 10);
      targets.push({
        url: `https://www.resmigazete.gov.tr/?tarih=${tarih}`,
        tarih,
      });
    }

    const matches: any[] = [];
    let claudeCost = 0;
    const fetchErrors: string[] = [];

    for (const { url, tarih } of targets) {
      let html = '';
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
            Accept: 'text/html,application/xhtml+xml,application/xml',
            'Accept-Language': 'tr-TR,tr;q=0.9',
          },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          fetchErrors.push(`${tarih}: HTTP ${res.status}`);
          continue;
        }
        html = await res.text();
      } catch (err: any) {
        fetchErrors.push(`${tarih}: ${err.message}`);
        continue;
      }

      if (html.length < 500) {
        fetchErrors.push(`${tarih}: HTML çok kısa (${html.length} byte) — bot koruması olabilir.`);
        continue;
      }

      // HTML'i Claude'a yolla, JSON çıktısı al
      const prompt = `Aşağıdaki Resmi Gazete HTML sayfasını (${tarih} tarihli) analiz et.
Sadece şu anahtar kelimelerle ilgili maddeleri çıkar: ${keywords.join(', ')}.
Anahtar kelimeler büyük/küçük harf duyarsız aranır.

Çıktı formatı (sadece JSON, başka açıklama yapma):
[
  {
    "baslik": "maddenin başlığı",
    "bolum": "Yürütme / Yargı / Tebliğ / Yönetmelik / Kanun / Karar (varsa)",
    "ozet": "1-2 cümlelik Türkçe özet — neyi düzenliyor",
    "ilgisi": "Hangi anahtar kelimeyle eşleşti ve mali müşavir için neden önemli (1 cümle)"
  }
]

Hiç eşleşme yoksa: []

HTML:
---
${html.slice(0, 60000)}`;

      try {
        const result = await this.claudeCall(prompt, 'claude-haiku-4-5-20251001', 2000);
        claudeCost += result.cost;
        const cleaned = result.text
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```\s*$/, '')
          .trim();
        const items = JSON.parse(cleaned);
        if (Array.isArray(items)) {
          for (const it of items) matches.push({ ...it, tarih });
        }
      } catch (err: any) {
        fetchErrors.push(`${tarih}: Claude parse hatası — ${err.message}`);
      }
    }

    return {
      matches,
      count: matches.length,
      keywords,
      sinceDays,
      claudeCostUsd: Math.round(claudeCost * 10000) / 10000,
      ...(fetchErrors.length > 0 && { fetchErrors }),
    };
  }

  // ---------------------------------------------------------------
  // STUB (Faz 6)
  // ---------------------------------------------------------------

  private stubResponse(toolName: string, message: string) {
    this.logger.warn(`[STUB] ${toolName}: ${message}`);
    return { stub: true, message, tool: toolName };
  }
}
