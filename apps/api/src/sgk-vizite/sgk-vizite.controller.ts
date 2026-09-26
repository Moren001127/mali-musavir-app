import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SgkViziteService } from './sgk-vizite.service';

/**
 * SGK e-Rapor (vizite) + hastane iş kazası uçları (2026-09-26). Sözleşme: packages/shared/src/constants/sgk-vizite.ts
 * Okuma uçları portalın diğer ekranları gibi JWT + tenant; SGK'ya giden işlemler (sorgu, onay, personelim değil)
 * yalnız ofis kullanıcıları (ADMIN, STAFF).
 */
@Controller('sgk-vizite')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SgkViziteController {
  constructor(private readonly vizite: SgkViziteService) {}

  @Get('ozet')
  ozet(@Req() req: any, @Query('taxpayerId') taxpayerId?: string) {
    return this.vizite.ozet(req.user.tenantId, taxpayerId || undefined);
  }

  /** durum=bekleyen (BEKLIYOR + PARCALI) | onaylanan (ONAYLANDI) */
  @Get('raporlar')
  raporlar(@Req() req: any, @Query('durum') durum?: string, @Query('taxpayerId') taxpayerId?: string) {
    return this.vizite.raporlar(req.user.tenantId, durum === 'onaylanan' ? 'onaylanan' : 'bekleyen', taxpayerId || undefined);
  }

  @Get('is-kazalari')
  isKazalari(@Req() req: any, @Query('taxpayerId') taxpayerId?: string) {
    return this.vizite.isKazalari(req.user.tenantId, taxpayerId || undefined);
  }

  @Get('durumlar')
  durumlar(@Req() req: any) {
    return this.vizite.durumlar(req.user.tenantId);
  }

  @Post('sorgula')
  @Roles('ADMIN', 'STAFF')
  sorgula(@Req() req: any, @Body() body: { taxpayerIds?: string[] }) {
    const ids = Array.isArray(body?.taxpayerIds) ? body.taxpayerIds.filter((x) => typeof x === 'string' && x).slice(0, 500) : undefined;
    return this.vizite.sorguBaslat(req.user.tenantId, ids);
  }

  /** İŞVEREN BEYANI: rapora çalıştı/çalışmadı onayı → SGK raporOnay. */
  @Post('raporlar/:id/onay')
  @Roles('ADMIN', 'STAFF')
  onay(@Req() req: any, @Param('id') id: string, @Body() body: { bitisTarihi?: string; calisti?: boolean }) {
    return this.vizite.raporOnay(req.user.tenantId, req.user.sub || req.user.id || null, id, body || {});
  }

  /** İŞVEREN BEYANI: "personelim değil" → SGK personelimDegildir. */
  @Post('raporlar/:id/personelim-degil')
  @Roles('ADMIN', 'STAFF')
  personelimDegil(@Req() req: any, @Param('id') id: string) {
    return this.vizite.personelimDegil(req.user.tenantId, req.user.sub || req.user.id || null, id);
  }
}
