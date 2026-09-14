import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TaxpayerPortalService } from './taxpayer-portal.service';

/**
 * Mükellef portalı — AYLIK ÖDEME CETVELİ (mükellef JWT).
 *
 * İki ön ekle yayınlanır: ön yüz sözleşmesi `GET /taxpayer-portal/odeme-cetveli` der, portalın diğer
 * uçları ise `/portal/...` altındadır (web `taxpayerApi.get('/portal/me')`). İkisi de aynı yere gider.
 * Mükellef yalnız KENDİ satırlarını görür — taxpayerId JWT'den alınır, sorgudan alınmaz.
 */
@Controller(['taxpayer-portal', 'portal'])
export class TaxpayerPortalOdemeController {
  constructor(private readonly service: TaxpayerPortalService) {}

  @UseGuards(AuthGuard('taxpayer-jwt'))
  @Get('odeme-cetveli')
  odemeCetveli(@Req() req: any, @Query('month') month?: string) {
    return this.service.getOdemeCetveli(req.user.taxpayerId, req.user.tenantId, month || undefined);
  }
}
