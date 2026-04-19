import { Injectable, Logger } from '@nestjs/common';

/**
 * WhatsApp Servisi — Meta WhatsApp Cloud API entegrasyonu
 *
 * Ortam değişkenleri:
 *   WHATSAPP_ACCESS_TOKEN       Meta Business API erişim token'ı (zorunlu)
 *   WHATSAPP_PHONE_NUMBER_ID    Meta Business hesabınızın WhatsApp numara ID'si (zorunlu)
 *   WHATSAPP_TEMPLATE_NAME      Proaktif hatırlatma şablonu adı (önerilen — 24 saat dışı için şart)
 *   WHATSAPP_TEMPLATE_LANG      Şablon dil kodu (varsayılan: tr)
 *   WHATSAPP_API_VERSION        Graph API versiyonu (varsayılan: v20.0)
 *
 * Meta Cloud API kuralları:
 *   - Müşteri son 24 saatte bize yazdıysa serbest metin mesajı gönderilebilir.
 *   - Aksi halde SADECE önceden onaylı şablon (template) mesaj gönderilebilir.
 *   - Bu servis proaktif hatırlatmalarda her zaman şablon kullanır.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  private get accessToken() { return process.env.WHATSAPP_ACCESS_TOKEN || ''; }
  private get phoneNumberId() { return process.env.WHATSAPP_PHONE_NUMBER_ID || ''; }
  private get templateName() { return process.env.WHATSAPP_TEMPLATE_NAME || ''; }
  private get templateLang() { return process.env.WHATSAPP_TEMPLATE_LANG || 'tr'; }
  private get apiVersion() { return process.env.WHATSAPP_API_VERSION || 'v20.0'; }

  private get isConfigured(): boolean {
    return Boolean(this.accessToken && this.phoneNumberId);
  }

  /** Portal'daki WhatsApp durum göstergesi için */
  getStatus() {
    if (!this.isConfigured) {
      return {
        ready: false,
        hasQr: false,
        provider: 'meta-cloud',
        error: 'WhatsApp Cloud API ayarlanmamış. WHATSAPP_ACCESS_TOKEN ve WHATSAPP_PHONE_NUMBER_ID env değişkenlerini ayarlayın.',
      };
    }
    return {
      ready: true,
      hasQr: false,
      provider: 'meta-cloud',
      phoneNumberId: this.phoneNumberId,
      templateName: this.templateName || null,
    };
  }

  /** Meta Cloud API için QR yoktur — geriye dönük uyumluluk için null */
  getQr(): string | null {
    return null;
  }

  /**
   * Telefon numarasını Meta'nın beklediği formata (E.164, + yok) çevirir.
   * Türk numaraları için +90, 0090, 090 gibi girişleri normalize eder.
   */
  private normalizePhone(raw: string): string | null {
    if (!raw) return null;
    let digits = raw.replace(/[^\d]/g, '');
    if (!digits) return null;
    // Başında 00 varsa kaldır
    if (digits.startsWith('00')) digits = digits.slice(2);
    // Türk numarası: başında 0 ile başlıyor, 10 haneli (0532xxxxxxx) -> 90532xxxxxxx
    if (digits.startsWith('0') && digits.length === 11) digits = '90' + digits.slice(1);
    // 10 haneli, başında 5 (5xxxxxxxxx) -> 90 ekle
    else if (digits.length === 10 && digits.startsWith('5')) digits = '90' + digits;
    // Halihazırda 90 ile başlayan 12 haneli -> olduğu gibi
    // Diğer ülke kodları -> olduğu gibi (7-15 hane arası kabul)
    if (digits.length < 7 || digits.length > 15) return null;
    return digits;
  }

  /**
   * Serbest metin mesajı gönderir — SADECE 24 saatlik müşteri hizmetleri
   * penceresi içinde kullanılabilir. Proaktif hatırlatmalar için sendTemplate() kullanın.
   */
  async sendMessage(phone: string, message: string): Promise<boolean> {
    if (!this.isConfigured) {
      this.logger.warn(`[WhatsApp] Yapılandırılmamış — mesaj atlandı: ${phone}`);
      return false;
    }
    const to = this.normalizePhone(phone);
    if (!to) {
      this.logger.warn(`[WhatsApp] Geçersiz telefon numarası: ${phone}`);
      return false;
    }
    return this.callGraphApi({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message, preview_url: false },
    }, to);
  }

  /**
   * Önceden onaylı WhatsApp şablonu ile proaktif mesaj gönderir.
   * Meta Business Manager'da onaylanmış bir şablon gerektirir.
   *
   * @param phone  Müşteri telefon numarası (normalize edilir)
   * @param parameters  Şablon gövdesindeki {{1}}, {{2}}... yerine geçecek metinler
   * @param templateName  (opsiyonel) env'deki default yerine farklı şablon kullanmak için
   */
  async sendTemplate(
    phone: string,
    parameters: string[],
    templateName?: string,
  ): Promise<boolean> {
    if (!this.isConfigured) {
      this.logger.warn(`[WhatsApp] Yapılandırılmamış — şablon mesajı atlandı: ${phone}`);
      return false;
    }
    const name = templateName || this.templateName;
    if (!name) {
      this.logger.warn(
        `[WhatsApp] WHATSAPP_TEMPLATE_NAME ayarlanmamış, serbest metne düşülüyor (yalnız 24s pencerede çalışır).`,
      );
      // Fallback: if no template configured, just send as text — will only work inside 24h window
      return this.sendMessage(phone, parameters.join(' · '));
    }
    const to = this.normalizePhone(phone);
    if (!to) {
      this.logger.warn(`[WhatsApp] Geçersiz telefon numarası: ${phone}`);
      return false;
    }
    return this.callGraphApi({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name,
        language: { code: this.templateLang },
        components: parameters.length
          ? [{
              type: 'body',
              parameters: parameters.map((text) => ({ type: 'text', text })),
            }]
          : [],
      },
    }, to);
  }

  private async callGraphApi(payload: any, to: string): Promise<boolean> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const bodyText = await res.text();
      if (!res.ok) {
        this.logger.error(
          `[WhatsApp] Gönderim hatası ${to}: HTTP ${res.status} — ${bodyText.slice(0, 400)}`,
        );
        return false;
      }
      const data = (() => { try { return JSON.parse(bodyText); } catch { return null; } })();
      const wamid = data?.messages?.[0]?.id;
      this.logger.log(`[WhatsApp] Gönderildi ${to} — wamid=${wamid || 'n/a'}`);
      return true;
    } catch (err: any) {
      this.logger.error(`[WhatsApp] Ağ hatası ${to}: ${err?.message || err}`);
      return false;
    }
  }
}
