import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GenelSorgularService } from './genel-sorgular.service';

/**
 * Genel Sorgulamalar uçları (2026-09-14). Portaldaki diğer controller'larla aynı auth/tenant deseni.
 * Şimdilik yalnız OKUMA; sorgu tetikleme ileride eklenecek.
 */
@Controller('genel-sorgular')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class GenelSorgularController {
  constructor(private readonly genelSorgular: GenelSorgularService) {}

  /**
   * GET /genel-sorgular/ozet
   * → { VERGI_BORCU:{adet,sonSorgu}, E_HACIZ:{…}, YOKLAMA_DENETIM:{…}, POS:{…}, GELEN_EARSIV:{…} }
   */
  @Get('ozet')
  ozet(@Req() req: any) {
    return this.genelSorgular.ozet(req.user.tenantId);
  }

  /**
   * GET /genel-sorgular/earsiv-eksik?taxpayerId=&donem=YYYY-MM
   * → { rows:[{ taxpayerId, taxpayer, donem, sorguTarihi, faturaNo, duzenlenmeTarihi, saticiUnvan, saticiVkn,
   *             toplamTutar, vergilerTutari, odenecekTutar, durum:'LUCA_YOK'|'GORSEL_YOK' }],
   *     ozet:{ dvd, lucaVar, lucaYok, gorselYok, sorguSayisi } }
   */
  @Get('earsiv-eksik')
  eksikGorseller(@Req() req: any, @Query('taxpayerId') taxpayerId?: string, @Query('donem') donem?: string) {
    return this.genelSorgular.eksikGorseller(req.user.tenantId, { taxpayerId: taxpayerId || undefined, donem: donem || undefined });
  }

  /**
   * GET /genel-sorgular?taxpayerId=&tur=&donem=YYYY-MM&page=1&pageSize=50
   * → { rows:[{ id, taxpayerId, taxpayer:{id,companyName,firstName,lastName,taxNumber}, tur, donem,
   *              sorguTarihi, ozet, veri, kaynak, whatsappGonderildiMi }], total, page, pageSize }
   */
  @Get()
  listele(
    @Req() req: any,
    @Query('taxpayerId') taxpayerId?: string,
    @Query('tur') tur?: string,
    @Query('donem') donem?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.genelSorgular.listele(req.user.tenantId, {
      taxpayerId: taxpayerId || undefined,
      tur: tur || undefined,
      donem: donem || undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }
}
