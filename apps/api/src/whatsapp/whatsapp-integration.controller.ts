import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WhatsAppService, WhatsAppConfig } from './whatsapp.service';
import { BaileysService } from './baileys.service';

/**
 * WhatsApp Meta Cloud API entegrasyon yönetimi — sadece konfigürasyon
 * okuma/yazma/test endpoint'leri. Gerçek mesaj gönderim endpoint'leri
 * WhatsAppController içinde kalıyor.
 */
@Controller('integrations/whatsapp')
@UseGuards(AuthGuard('jwt'))
export class WhatsAppIntegrationController {
  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly baileys: BaileysService,
  ) {}

  // ─── QR (Baileys) — Meta'sız, QR ile bağlanma ───────────────────────
  /** Bağlantıyı başlat — QR üretir (telefondan okutulacak). */
  @Post('qr/connect')
  async qrConnect(@Req() req: any) {
    await this.baileys.connect(req.user.tenantId);
    // QR'ın üretilmesi için kısa bekleme, sonra durumu dön.
    await new Promise((r) => setTimeout(r, 1200));
    return this.baileys.getStatus(req.user.tenantId);
  }

  /** Durum + QR (data URL). Portal bunu birkaç saniyede bir çağırıp QR/bağlı durumunu gösterir. */
  @Get('qr/status')
  async qrStatus(@Req() req: any) {
    return this.baileys.getStatus(req.user.tenantId);
  }

  /** Bağlantıyı kes ve kayıtlı oturumu temizle (yeniden QR gerekir). */
  @Post('qr/logout')
  async qrLogout(@Req() req: any) {
    await this.baileys.logout(req.user.tenantId);
    return { ok: true };
  }

  @Get()
  async getConfig(@Req() req: any) {
    return this.whatsapp.getPublicConfig(req.user.tenantId);
  }

  @Put()
  async saveConfig(@Req() req: any, @Body() body: Partial<WhatsAppConfig>) {
    await this.whatsapp.saveConfig(req.user.tenantId, body);
    return { ok: true };
  }

  @Post('test/verify')
  async testVerify(@Req() req: any) {
    return this.whatsapp.testConnection(req.user.tenantId);
  }

  @Post('test/send')
  async testSend(@Req() req: any, @Body() body: { to?: string; templateName?: string; params?: string[] }) {
    if (!body?.to) return { sent: false, error: 'to (telefon) zorunlu' };
    return this.whatsapp.sendTestMessage(req.user.tenantId, body.to, body.templateName, body.params);
  }

  /**
   * Master switch toggle — tüm WhatsApp otomasyonlarını AÇ/KAPA
   * Body: { active: boolean }
   */
  @Put('toggle')
  async toggleAutomation(@Req() req: any, @Body() body: { active?: boolean }) {
    const active = body?.active === true;
    return this.whatsapp.setAutomationActive(req.user.tenantId, active);
  }
}
