import { Injectable, Logger } from '@nestjs/common';
import { ToolExecutorService } from '../moren-ai/tool-executor.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ACTION_BY_NAME } from './action-catalog';

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
        return this.sendWhatsAppTemplate(args);
      case 'send_whatsapp_freeform':
        return this.sendWhatsAppFreeform(args);
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
        return this.stubResponse(toolName, 'Resmi Gazete tetikleyicisi Faz 7\'de açılacak.');

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

      default:
        throw new Error(`Aksiyon "${toolName}" tanımlı ama dispatcher'da uygulanmamış.`);
    }
  }

  // ---------------------------------------------------------------
  // İLETİŞİM AKSİYONLARI
  // ---------------------------------------------------------------

  private async sendWhatsAppTemplate(args: any) {
    const phone = String(args.to ?? '');
    const templateName = String(args.templateName ?? '');
    const variables: Record<string, string> = args.variables ?? {};
    // Variables objesi (`{ "1": "Ali", "2": "Nisan" }`) Meta'nın beklediği sıralı
    // diziye çevrilir. Numerik key'ler 1, 2, 3 ... varsayılır.
    const ordered = Object.keys(variables)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => String(variables[k]));
    const ok = await this.whatsapp.sendTemplate(phone, ordered, templateName || undefined);
    return { sent: ok, to: phone, template: templateName };
  }

  private async sendWhatsAppFreeform(args: any) {
    const phone = String(args.to ?? '');
    const message = String(args.message ?? '').slice(0, 4096);
    const ok = await this.whatsapp.sendMessage(phone, message);
    return { sent: ok, to: phone };
  }

  private async sendEmail(args: any, ctx: { tenantId: string }) {
    // Mevcut nodemailer entegrasyonu için ayrı bir Email servisi yok — burada
    // doğrudan nodemailer kullanıyoruz. SMTP env değişkenleri zaten kullanımda.
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || 'noreply@morenmusavirlik.com',
      to: String(args.to ?? ''),
      subject: String(args.subject ?? ''),
      [args.isHtml ? 'html' : 'text']: String(args.body ?? ''),
    });
    return { sent: true, messageId: info.messageId, to: args.to };
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
  // STUB (Faz 6/7)
  // ---------------------------------------------------------------

  private stubResponse(toolName: string, message: string) {
    this.logger.warn(`[STUB] ${toolName}: ${message}`);
    return { stub: true, message, tool: toolName };
  }
}
