import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WhatsAppService, WhatsAppConfig } from './whatsapp.service';

/**
 * WhatsApp Meta Cloud API entegrasyon yönetimi — sadece konfigürasyon
 * okuma/yazma/test endpoint'leri. Gerçek mesaj gönderim endpoint'leri
 * WhatsAppController içinde kalıyor.
 */
@Controller('integrations/whatsapp')
@UseGuards(AuthGuard('jwt'))
export class WhatsAppIntegrationController {
  constructor(private readonly whatsapp: WhatsAppService) {}

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
