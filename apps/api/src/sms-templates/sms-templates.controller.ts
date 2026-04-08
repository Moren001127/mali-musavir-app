import { Controller, Get, Patch, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SmsTemplatesService } from './sms-templates.service';

@Controller('sms-templates')
@UseGuards(AuthGuard('jwt'))
export class SmsTemplatesController {
  constructor(private smsTemplatesService: SmsTemplatesService) {}

  @Get()
  getTemplate(@Req() req: any) {
    return this.smsTemplatesService.getTemplate(req.user.tenantId);
  }

  @Patch()
  updateTemplate(@Req() req: any, @Body() body: { evrakTalepMesaji?: string; evrakGeldiMesaji?: string }) {
    return this.smsTemplatesService.updateTemplate(req.user.tenantId, body);
  }
}
