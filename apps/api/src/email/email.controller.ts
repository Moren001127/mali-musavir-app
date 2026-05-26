import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EmailService, EmailConfig } from './email.service';

@Controller('integrations/email')
@UseGuards(AuthGuard('jwt'))
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Get()
  async getConfig(@Req() req: any) {
    const cfg = await this.email.getConfig(req.user.tenantId);
    return { configured: !!cfg, config: cfg };
  }

  @Put()
  async saveConfig(@Req() req: any, @Body() body: EmailConfig) {
    await this.email.saveConfig(req.user.tenantId, body);
    return { ok: true };
  }

  @Post('test/verify')
  async testVerify(@Req() req: any) {
    return this.email.testConnection(req.user.tenantId);
  }

  @Post('test/send')
  async testSend(@Req() req: any, @Body() body: { to?: string }) {
    return this.email.sendTestMail(req.user.tenantId, body?.to);
  }
}
