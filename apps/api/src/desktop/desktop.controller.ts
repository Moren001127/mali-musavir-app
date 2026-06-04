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
}
