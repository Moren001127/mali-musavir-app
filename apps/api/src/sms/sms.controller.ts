import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SmsService } from './sms.service';

@Controller('sms')
@UseGuards(AuthGuard('jwt'))
export class SmsController {
  constructor(private sms: SmsService) {}

  /** NetGSM yapılandırma durumu (şifre dönmez). */
  @Get('status')
  status() {
    return { configured: this.sms.isConfigured(), header: process.env.NETGSM_HEADER || 'MOREN' };
  }

  /** Test SMS gönder (MOREN başlık). */
  @Post('send-test')
  sendTest(@Body() body: { to?: string; message?: string }) {
    return this.sms.sendSms(String(body?.to || ''), String(body?.message || 'Moren Portal — test SMS.'));
  }
}
