import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DesktopService } from './desktop.service';

/**
 * Moren Masaüstü uygulaması uçları. Tümü JWT korumalı — masaüstü uygulaması
 * önce /auth/login ile giriş yapıp access token alır, sonra bu uçları çağırır.
 */
@Controller('desktop')
@UseGuards(AuthGuard('jwt'))
export class DesktopController {
  constructor(private readonly service: DesktopService) {}

  /** Firma listesi + portal kataloğu + şifre durumu (şifre içeriği dönmez). */
  @Get('shortcuts')
  shortcuts(@Req() req: any) {
    return this.service.shortcuts(req.user.tenantId);
  }

  /** Tek firma + portal için çözülmüş giriş bilgisi (otomatik giriş enjeksiyonu). */
  @Post('credential')
  @HttpCode(HttpStatus.OK)
  credential(@Req() req: any, @Body() body: { taxpayerId?: string; provider?: string }) {
    return this.service.credential(req.user.tenantId, body || {});
  }

  /**
   * Portal giriş güvenlik kodunu (CAPTCHA) çöz. Masaüstü, açtığı tarayıcıda
   * captcha görselini yakalar ve base64 olarak buraya gönderir; çözücü anahtarı
   * (TWOCAPTCHA_API_KEY) sunucuda kalır.
   */
  @Post('solve-captcha')
  @HttpCode(HttpStatus.OK)
  solveCaptcha(@Body() body: { imageBase64?: string }) {
    return this.service.solveCaptcha(String(body?.imageBase64 || ''));
  }

  /** Yanlış çözülen güvenlik kodunu 2captcha'ya bildir (iade). */
  @Post('captcha-bad')
  @HttpCode(HttpStatus.OK)
  reportBadCaptcha(@Body() body: { captchaId?: string }) {
    return this.service.reportBadCaptcha(String(body?.captchaId || ''));
  }
}
