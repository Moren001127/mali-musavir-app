/**
 * Mobil uygulama cihaz belirteci uçları (müşavir 'jwt' VE mükellef 'taxpayer-jwt' — PushKimlikGuard seçer).
 *  POST   /api/v1/notifications/push-token { token, platform, persona?, deviceName? }
 *  DELETE /api/v1/notifications/push-token { token }
 * NotificationsController ile aynı 'notifications' öneki; orada POST/DELETE yok, çakışmaz.
 */
import { Body, Controller, Delete, HttpCode, HttpStatus, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { PushKimlikGuard, kimlikCikar } from './push-kimlik.guard';
import { PushTokenDto, PushTokenSilDto } from './push.dto';
import { PushService } from './push.service';

@Controller('notifications')
@UseGuards(PushKimlikGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('push-token')
  @HttpCode(HttpStatus.OK)
  kaydet(@Req() req: any, @Body() body: PushTokenDto) {
    return this.push.kaydet(this.kimlik(req), {
      token: body.token,
      platform: body.platform,
      persona: body.persona,
      deviceName: body.deviceName,
    });
  }

  @Delete('push-token')
  @HttpCode(HttpStatus.OK)
  sil(@Req() req: any, @Body() body: PushTokenSilDto) {
    return this.push.sil(this.kimlik(req), body.token);
  }

  private kimlik(req: any) {
    try {
      return kimlikCikar(req?.user);
    } catch {
      throw new UnauthorizedException();
    }
  }
}
