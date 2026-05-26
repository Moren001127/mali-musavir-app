import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from '../common/crypto';

/**
 * WhatsApp Servisi — Meta WhatsApp Cloud API entegrasyonu
 *
 * Konfigürasyon iki yerden okunur:
 *   1) DB:  IntegrationConnection where provider='WHATSAPP_META' (UI'dan girilir, token şifreli)
 *   2) ENV: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, ... (fallback)
 */

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  templateName?: string;
  templateLang?: string;
  apiVersion?: string;
  documentTemplateName?: string;
  portalTemplateName?: string;
  ownerAlertTemplateName?: string;
  webhookVerifyToken?: string;
  businessAccountId?: string;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private prisma: PrismaService) {}

  private get envConfig(): WhatsAppConfig {
    return {
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
      templateName: process.env.WHATSAPP_TEMPLATE_NAME || '',
      templateLang: process.env.WHATSAPP_TEMPLATE_LANG || 'tr',
      apiVersion: process.env.WHATSAPP_API_VERSION || 'v20.0',
      documentTemplateName: process.env.WHATSAPP_DOCUMENT_TEMPLATE_NAME || '',
      portalTemplateName: process.env.WHATSAPP_PORTAL_TEMPLATE_NAME || '',
      ownerAlertTemplateName: process.env.WHATSAPP_OWNER_ALERT_TEMPLATE_NAME || '',
      webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    };
  }

  private async getEffectiveConfig(tenantId?: string): Promise<WhatsAppConfig> {
    if (tenantId) {
      const fromDb = await this.loadConfigFromDb(tenantId);
      if (fromDb && fromDb.accessToken && fromDb.phoneNumberId) {
        return { ...this.envConfig, ...fromDb };
      }
    }
    return this.envConfig;
  }

  private isConfigured(cfg: WhatsAppConfig): boolean {
    return Boolean(cfg.accessToken && cfg.phoneNumberId);
  }

  async getStatus(tenantId?: string) {
    const cfg = await this.getEffectiveConfig(tenantId);
    if (!this.isConfigured(cfg)) {
      return {
        ready: false,
        hasQr: false,
        provider: 'meta-cloud',
        webhookReady: Boolean(cfg.webhookVerifyToken),
        error: 'WhatsApp Cloud API ayarlanmamış. Ayarlar > Entegrasyonlar sayfasından bağlayın.',
      };
    }
    return {
      ready: true,
      hasQr: false,
      provider: 'meta-cloud',
      phoneNumberId: cfg.phoneNumberId,
      templateName: cfg.templateName || null,
      documentTemplateName: cfg.documentTemplateName || cfg.templateName || null,
      portalTemplateName: cfg.portalTemplateName || cfg.templateName || null,
      ownerAlertTemplateName: cfg.ownerAlertTemplateName || null,
      webhookReady: Boolean(cfg.webhookVerifyToken),
    };
  }

  getQr(): string | null {
    return null;
  }

  private normalizePhone(raw: string): string | null {
    if (!raw) return null;
    let digits = raw.replace(/[^\d]/g, '');
    if (!digits) return null;
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) digits = '90' + digits.slice(1);
    else if (digits.length === 10 && digits.startsWith('5')) digits = '90' + digits;
    if (digits.length < 7 || digits.length > 15) return null;
    return digits;
  }

  /**
   * Master switch: tenant'ın WhatsApp otomasyonları aktif mi?
   * IntegrationConnection.isActive=false ise hiçbir mesaj gönderilmez.
   */
  async isAutomationActive(tenantId?: string): Promise<boolean> {
    if (!tenantId) return true; // tenantId yoksa fallback: aktif kabul et (eski env-based çağrılar)
    try {
      const row = await (this.prisma as any).integrationConnection.findUnique({
        where: { tenantId_provider: { tenantId, provider: 'WHATSAPP_META' } },
        select: { isActive: true },
      });
      // DB kaydı yoksa eski env-based kurulumları kırma; env yapılandırılmışsa aktif say.
      if (!row) return this.isConfigured(this.envConfig);
      return row.isActive === true;
    } catch {
      return false;
    }
  }

  /**
   * Master switch toggle — UI'dan çağrılır
   */
  async setAutomationActive(tenantId: string, active: boolean): Promise<{ active: boolean }> {
    await (this.prisma as any).integrationConnection.upsert({
      where: { tenantId_provider: { tenantId, provider: 'WHATSAPP_META' } },
      update: { isActive: active, updatedAt: new Date() },
      create: { tenantId, provider: 'WHATSAPP_META', config: {}, isActive: active },
    });
    this.logger.log(`[WhatsApp] Master switch tenant=${tenantId} → ${active ? 'AKTİF' : 'PASİF'}`);
    return { active };
  }

  async sendMessage(phone: string, message: string, tenantId?: string): Promise<boolean> {
    // MASTER SWITCH KONTROLÜ
    if (tenantId && !(await this.isAutomationActive(tenantId))) {
      this.logger.warn(`[WhatsApp] Master switch PASİF - mesaj atlandı: ${phone}`);
      return false;
    }
    const cfg = await this.getEffectiveConfig(tenantId);
    if (!this.isConfigured(cfg)) {
      this.logger.warn(`[WhatsApp] Yapilandirilmamis - mesaj atlandi: ${phone}`);
      return false;
    }
    const to = this.normalizePhone(phone);
    if (!to) {
      this.logger.warn(`[WhatsApp] Gecersiz telefon: ${phone}`);
      return false;
    }
    return this.callGraphApi(cfg, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message, preview_url: false },
    }, to);
  }

  async sendTemplate(
    phone: string,
    parameters: string[],
    templateName?: string,
    tenantId?: string,
  ): Promise<boolean> {
    // MASTER SWITCH KONTROLÜ
    if (tenantId && !(await this.isAutomationActive(tenantId))) {
      this.logger.warn(`[WhatsApp] Master switch PASİF - şablon atlandı: ${phone}`);
      return false;
    }
    const cfg = await this.getEffectiveConfig(tenantId);
    if (!this.isConfigured(cfg)) return false;
    const name = templateName || cfg.templateName;
    if (!name) {
      return this.sendMessage(phone, parameters.join(' - '), tenantId);
    }
    const to = this.normalizePhone(phone);
    if (!to) return false;
    return this.callGraphApi(cfg, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name,
        language: { code: cfg.templateLang || 'tr' },
        components: parameters.length
          ? [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) }]
          : [],
      },
    }, to);
  }

  private async callGraphApi(cfg: WhatsAppConfig, payload: any, to: string): Promise<boolean> {
    const url = `https://graph.facebook.com/${cfg.apiVersion || 'v20.0'}/${cfg.phoneNumberId}/messages`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const bodyText = await res.text();
      if (!res.ok) {
        this.logger.error(`[WhatsApp] Gonderim hatasi ${to}: HTTP ${res.status} - ${bodyText.slice(0, 400)}`);
        return false;
      }
      const data = (() => { try { return JSON.parse(bodyText); } catch { return null; } })();
      const wamid = data?.messages?.[0]?.id;
      this.logger.log(`[WhatsApp] Gonderildi ${to} wamid=${wamid || 'n/a'}`);
      return true;
    } catch (err: any) {
      this.logger.error(`[WhatsApp] Ag hatasi ${to}: ${err?.message || err}`);
      return false;
    }
  }

  async downloadMedia(
    mediaId: string,
    tenantId?: string,
  ): Promise<{ buffer: Buffer; mimeType: string; sizeBytes: number } | null> {
    const cfg = await this.getEffectiveConfig(tenantId);
    if (!this.isConfigured(cfg) || !mediaId) return null;

    const metaUrl = `https://graph.facebook.com/${cfg.apiVersion || 'v20.0'}/${mediaId}`;
    try {
      const metaRes = await fetch(metaUrl, {
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
      });
      const metaText = await metaRes.text();
      if (!metaRes.ok) {
        this.logger.warn(`[WhatsApp] Medya bilgisi alinamadi ${mediaId}: HTTP ${metaRes.status} - ${metaText.slice(0, 200)}`);
        return null;
      }
      const meta = (() => { try { return JSON.parse(metaText); } catch { return null; } })();
      const url = meta?.url;
      if (!url) return null;

      const fileRes = await fetch(url, {
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
      });
      if (!fileRes.ok) {
        this.logger.warn(`[WhatsApp] Medya indirilemedi ${mediaId}: HTTP ${fileRes.status}`);
        return null;
      }
      const arrayBuffer = await fileRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = meta?.mime_type || fileRes.headers.get('content-type') || 'application/octet-stream';
      return { buffer, mimeType, sizeBytes: buffer.length };
    } catch (err: any) {
      this.logger.warn(`[WhatsApp] Medya indirme hatasi ${mediaId}: ${err?.message || err}`);
      return null;
    }
  }

  // ===================================================================
  // KONFIGURASYON YONETIMI - UI / IntegrationConnection
  // ===================================================================

  async getPublicConfig(tenantId: string) {
    const fromDb = await this.loadConfigFromDb(tenantId);
    const env = this.envConfig;
    const effective = fromDb && fromDb.accessToken ? fromDb : env;
    return {
      source: fromDb && fromDb.accessToken ? 'db' : (env.accessToken ? 'env' : 'none'),
      configured: this.isConfigured(effective),
      phoneNumberId: effective.phoneNumberId || '',
      businessAccountId: effective.businessAccountId || '',
      templateName: effective.templateName || '',
      templateLang: effective.templateLang || 'tr',
      apiVersion: effective.apiVersion || 'v20.0',
      documentTemplateName: effective.documentTemplateName || '',
      portalTemplateName: effective.portalTemplateName || '',
      ownerAlertTemplateName: effective.ownerAlertTemplateName || '',
      hasAccessToken: Boolean(effective.accessToken),
      hasWebhookToken: Boolean(effective.webhookVerifyToken),
      automationActive: await this.isAutomationActive(tenantId),
    };
  }

  async saveConfig(tenantId: string, input: Partial<WhatsAppConfig>): Promise<void> {
    const existing = await this.loadConfigFromDb(tenantId);
    const merged: WhatsAppConfig = {
      accessToken: input.accessToken && input.accessToken.length > 0 ? input.accessToken : (existing?.accessToken || ''),
      phoneNumberId: input.phoneNumberId ?? existing?.phoneNumberId ?? '',
      businessAccountId: input.businessAccountId ?? existing?.businessAccountId ?? '',
      templateName: input.templateName ?? existing?.templateName ?? '',
      templateLang: input.templateLang ?? existing?.templateLang ?? 'tr',
      apiVersion: input.apiVersion ?? existing?.apiVersion ?? 'v20.0',
      documentTemplateName: input.documentTemplateName ?? existing?.documentTemplateName ?? '',
      portalTemplateName: input.portalTemplateName ?? existing?.portalTemplateName ?? '',
      ownerAlertTemplateName: input.ownerAlertTemplateName ?? existing?.ownerAlertTemplateName ?? '',
      webhookVerifyToken: input.webhookVerifyToken && input.webhookVerifyToken.length > 0
        ? input.webhookVerifyToken
        : (existing?.webhookVerifyToken || ''),
    };

    if (!merged.accessToken || !merged.phoneNumberId) {
      throw new Error('Access Token ve Phone Number ID zorunlu.');
    }

    const configJson = {
      phoneNumberId: merged.phoneNumberId,
      businessAccountId: merged.businessAccountId,
      templateName: merged.templateName,
      templateLang: merged.templateLang,
      apiVersion: merged.apiVersion,
      documentTemplateName: merged.documentTemplateName,
      portalTemplateName: merged.portalTemplateName,
      ownerAlertTemplateName: merged.ownerAlertTemplateName,
      accessTokenEncrypted: encrypt(merged.accessToken),
      webhookTokenEncrypted: merged.webhookVerifyToken ? encrypt(merged.webhookVerifyToken) : '',
    };

    await (this.prisma as any).integrationConnection.upsert({
      where: { tenantId_provider: { tenantId, provider: 'WHATSAPP_META' } },
      update: { config: configJson, isActive: true, updatedAt: new Date() },
      create: { tenantId, provider: 'WHATSAPP_META', config: configJson, isActive: true },
    });

    this.logger.log(`[WhatsApp] Konfig kaydedildi tenant=${tenantId} phoneNumberId=${merged.phoneNumberId}`);
  }

  async testConnection(tenantId: string): Promise<{ ok: boolean; error?: string; phoneInfo?: any }> {
    const cfg = await this.getEffectiveConfig(tenantId);
    if (!this.isConfigured(cfg)) {
      return { ok: false, error: 'Yapilandirma eksik. Once ayarlari kaydedin.' };
    }
    const url = `https://graph.facebook.com/${cfg.apiVersion || 'v20.0'}/${cfg.phoneNumberId}`;
    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${cfg.accessToken}` },
      });
      const bodyText = await res.text();
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status} - ${bodyText.slice(0, 300)}` };
      }
      const data = (() => { try { return JSON.parse(bodyText); } catch { return null; } })();
      return { ok: true, phoneInfo: data };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Ag hatasi' };
    }
  }

  async sendTestMessage(tenantId: string, to: string, templateName?: string, params?: string[]) {
    if (templateName) {
      const ok = await this.sendTemplate(to, params || ['Test'], templateName, tenantId);
      return { sent: ok };
    }
    const ok = await this.sendMessage(to, 'Moren Portal - Test mesaji (' + new Date().toLocaleString('tr-TR') + ')', tenantId);
    return { sent: ok };
  }

  private async loadConfigFromDb(tenantId: string): Promise<WhatsAppConfig | null> {
    try {
      const row = await (this.prisma as any).integrationConnection.findUnique({
        where: { tenantId_provider: { tenantId, provider: 'WHATSAPP_META' } },
      });
      if (!row || !row.isActive) return null;
      const c = row.config as any;
      let accessToken = '';
      if (c?.accessTokenEncrypted) {
        try { accessToken = decrypt(c.accessTokenEncrypted); } catch { accessToken = ''; }
      }
      let webhookVerifyToken = '';
      if (c?.webhookTokenEncrypted) {
        try { webhookVerifyToken = decrypt(c.webhookTokenEncrypted); } catch { webhookVerifyToken = ''; }
      }
      return {
        accessToken,
        phoneNumberId: String(c?.phoneNumberId || ''),
        businessAccountId: String(c?.businessAccountId || ''),
        templateName: String(c?.templateName || ''),
        templateLang: String(c?.templateLang || 'tr'),
        apiVersion: String(c?.apiVersion || 'v20.0'),
        documentTemplateName: String(c?.documentTemplateName || ''),
        portalTemplateName: String(c?.portalTemplateName || ''),
        ownerAlertTemplateName: String(c?.ownerAlertTemplateName || ''),
        webhookVerifyToken,
      };
    } catch (err: any) {
      this.logger.warn(`[WhatsApp] DB konfig okuma hata: ${err?.message || err}`);
      return null;
    }
  }
}
