import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from '../common/crypto';

/**
 * E-posta (SMTP) Servisi — merkezi gönderim noktası.
 *
 * Konfigürasyon iki yerden okunur:
 *   1) DB:  IntegrationConnection where provider='EMAIL_SMTP' (UI'dan girilir, şifre AES-GCM ile şifreli)
 *   2) ENV: SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM / SMTP_SECURE (fallback)
 *
 * Önerilen sağlayıcılar:
 *   - Google Workspace: host=smtp.gmail.com  port=587 secure=false (STARTTLS)  user=tam email  pass=app password
 *   - Yandex:           host=smtp.yandex.com port=465 secure=true
 *   - Microsoft 365:    host=smtp.office365.com port=587 secure=false
 */

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass?: string; // okurken DB'den decrypt edilir, dışarı (response) hiç verilmez
  from: string;
  provider?: 'gmail' | 'yandex' | 'office365' | 'custom';
}

export interface SendMailArgs {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private prisma: PrismaService) {}

  /** UI tarafına gösterilebilir config (şifre asla dışarı verilmez) */
  async getConfig(tenantId: string): Promise<(EmailConfig & { hasPassword: boolean; source: 'db' | 'env' | 'none' }) | null> {
    const fromDb = await this.loadConfigFromDb(tenantId);
    if (fromDb) {
      return {
        host: fromDb.host,
        port: fromDb.port,
        secure: fromDb.secure,
        user: fromDb.user,
        from: fromDb.from,
        provider: fromDb.provider,
        hasPassword: Boolean(fromDb.pass),
        source: 'db',
      };
    }
    const env = this.loadConfigFromEnv();
    if (env) {
      return {
        host: env.host,
        port: env.port,
        secure: env.secure,
        user: env.user,
        from: env.from,
        provider: env.provider,
        hasPassword: Boolean(env.pass),
        source: 'env',
      };
    }
    return null;
  }

  /** UI'dan kaydet — şifre AES-GCM ile şifrelenir */
  async saveConfig(tenantId: string, cfg: EmailConfig): Promise<void> {
    if (!cfg.host || !cfg.user) {
      throw new Error('Host ve kullanıcı zorunlu.');
    }
    const port = Number(cfg.port) || 587;
    const secure = Boolean(cfg.secure);
    const provider = cfg.provider || this.guessProvider(cfg.host);

    // Mevcut config'i çek — şifre alanı boş gelirse eskisini koru
    const existing = await this.loadConfigFromDb(tenantId);
    const passToStore = cfg.pass && cfg.pass.length > 0 ? cfg.pass : existing?.pass || '';

    const configJson = {
      host: cfg.host.trim(),
      port,
      secure,
      user: cfg.user.trim(),
      from: (cfg.from || cfg.user).trim(),
      provider,
      // Şifreyi AES-GCM ile şifrele
      passEncrypted: passToStore ? encrypt(passToStore) : '',
    };

    await (this.prisma as any).integrationConnection.upsert({
      where: { tenantId_provider: { tenantId, provider: 'EMAIL_SMTP' } },
      update: { config: configJson, isActive: true, updatedAt: new Date() },
      create: { tenantId, provider: 'EMAIL_SMTP', config: configJson, isActive: true },
    });

    this.logger.log(`[Email] Konfig kaydedildi tenant=${tenantId} provider=${provider} host=${configJson.host}`);
  }

  /** Bağlantıyı test et — transport.verify() */
  async testConnection(tenantId: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = await this.loadConfigFromDb(tenantId) || this.loadConfigFromEnv();
    if (!cfg) return { ok: false, error: 'E-posta konfigürasyonu yok. Önce ayarları kaydedin.' };
    try {
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
      });
      await transport.verify();
      return { ok: true };
    } catch (err: any) {
      this.logger.warn(`[Email] verify() hata: ${err?.message || err}`);
      return { ok: false, error: err?.message || 'Bilinmeyen hata' };
    }
  }

  /** Test e-postası gönder — kendi gönderici adresine veya verilen adrese */
  async sendTestMail(tenantId: string, to?: string): Promise<{ sent: boolean; messageId?: string; error?: string }> {
    const cfg = await this.loadConfigFromDb(tenantId) || this.loadConfigFromEnv();
    if (!cfg) return { sent: false, error: 'E-posta konfigürasyonu yok.' };
    const recipient = to || cfg.from || cfg.user;
    try {
      const result = await this.send({
        to: recipient,
        subject: 'Moren Portal — Test E-postası',
        html: `<p>Bu, Moren Portal e-posta entegrasyonundan gönderilen bir test mesajıdır.</p>
               <p><b>Gönderen:</b> ${cfg.from}<br/>
                  <b>Sağlayıcı:</b> ${cfg.provider || 'custom'} (${cfg.host}:${cfg.port})<br/>
                  <b>Zaman:</b> ${new Date().toLocaleString('tr-TR')}</p>
               <p style="color:#888">Bu mesajı gördüyseniz entegrasyon çalışıyor demektir.</p>`,
      }, tenantId);
      return { sent: result.sent, messageId: result.messageId };
    } catch (err: any) {
      return { sent: false, error: err?.message || 'Gönderim hatası' };
    }
  }

  /** Ana gönderim metodu — action-dispatcher ve diğer modüller bunu çağırır */
  async send(args: SendMailArgs, tenantId?: string): Promise<{ sent: boolean; messageId?: string }> {
    const cfg = (tenantId ? await this.loadConfigFromDb(tenantId) : null) || this.loadConfigFromEnv();
    if (!cfg) {
      this.logger.warn('[Email] Konfig yok — gönderim atlandı.');
      return { sent: false };
    }
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
    const info = await transport.sendMail({
      from: cfg.from,
      to: this.normalizeRecipients(args.to),
      cc: args.cc ? this.normalizeRecipients(args.cc) : undefined,
      bcc: args.bcc ? this.normalizeRecipients(args.bcc) : undefined,
      subject: args.subject,
      text: args.text,
      html: args.html,
      attachments: args.attachments,
    });
    this.logger.log(`[Email] Gönderildi to=${info.envelope?.to?.join(',') || args.to} id=${info.messageId}`);
    return { sent: true, messageId: info.messageId };
  }

  // ---------------- helpers ----------------

  private normalizeRecipients(r: string | string[]): string {
    if (Array.isArray(r)) return r.join(', ');
    return String(r);
  }

  private async loadConfigFromDb(tenantId: string): Promise<EmailConfig | null> {
    try {
      const row = await (this.prisma as any).integrationConnection.findUnique({
        where: { tenantId_provider: { tenantId, provider: 'EMAIL_SMTP' } },
      });
      if (!row || !row.isActive) return null;
      const c = row.config as any;
      if (!c?.host) return null;
      let pass = '';
      if (c.passEncrypted) {
        try { pass = decrypt(c.passEncrypted); } catch { pass = ''; }
      }
      return {
        host: String(c.host),
        port: Number(c.port) || 587,
        secure: Boolean(c.secure),
        user: String(c.user || ''),
        pass,
        from: String(c.from || c.user || ''),
        provider: c.provider,
      };
    } catch (err: any) {
      this.logger.warn(`[Email] DB konfig okuma hata: ${err?.message || err}`);
      return null;
    }
  }

  private loadConfigFromEnv(): EmailConfig | null {
    const host = process.env.SMTP_HOST;
    if (!host) return null;
    return {
      host,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@morenmusavirlik.com',
      provider: this.guessProvider(host),
    };
  }

  private guessProvider(host: string): EmailConfig['provider'] {
    const h = host.toLowerCase();
    if (h.includes('gmail') || h.includes('google')) return 'gmail';
    if (h.includes('yandex')) return 'yandex';
    if (h.includes('office365') || h.includes('outlook')) return 'office365';
    return 'custom';
  }
}
