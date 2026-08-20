import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FaturaKesService, FaturaKesInput } from './fatura-kes.service';

/**
 * FATURA KES uçları.
 *
 * Bu uçların HİÇBİRİ GİB'e/entegratöre belge GÖNDERMEZ. Yalnız taslak hazırlar,
 * listeler ve önizler. Gönderim ayrı bir adım olarak, ayrı onayla eklenecektir.
 */
@Controller('fatura-kes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'STAFF')
export class FaturaKesController {
  constructor(private readonly service: FaturaKesService) {}

  /** Taslak oluştur — hesaplar, kaydeder, önizleme döner. Gönderim YOK. */
  @Post('taslak')
  @HttpCode(HttpStatus.OK)
  create(@Req() req: any, @Body() body: FaturaKesInput) {
    return this.service.createDraft(req.user.tenantId, req.user?.userId || req.user?.sub || null, body);
  }

  @Get('taslak')
  list(@Req() req: any, @Query() q: any) {
    return this.service.listDrafts(req.user.tenantId, {
      taxpayerId: q.taxpayerId,
      durum: q.durum,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    });
  }

  @Get('taslak/:id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.service.getDraft(req.user.tenantId, id);
  }

  /** Önizlemeyi HTML olarak döndür (iframe / yeni sekme için). */
  @Get('taslak/:id/onizleme')
  async onizleme(@Req() req: any, @Param('id') id: string, @Res() res: any) {
    const d: any = await this.service.getDraft(req.user.tenantId, id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(d.onizlemeHtml || '<p>Önizleme üretilemedi</p>');
  }

  @Delete('taslak/:id')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.service.cancelDraft(req.user.tenantId, id);
  }
}
