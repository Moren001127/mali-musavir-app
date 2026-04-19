import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PendingDecisionsService } from './pending-decisions.service';

/**
 * Onay Kuyrugu endpoint'leri. Sadece web UI (JWT).
 */
@Controller('onay-kuyrugu')
@UseGuards(AuthGuard('jwt'))
export class PendingDecisionsController {
  constructor(private readonly service: PendingDecisionsService) {}

  /** Bekleyen + onaylanmis + reddedilmis kararlar */
  @Get()
  list(@Req() req: any, @Query('durum') durum?: string, @Query('limit') limit?: string) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    const lim = limit ? parseInt(limit, 10) : 100;
    return this.service.list(tenantId, { durum, limit: lim });
  }

  /** Badge icin — sadece bekleyen sayisi */
  @Get('count')
  async count(@Req() req: any) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    const bekleyen = await this.service.countBekleyen(tenantId);
    return { bekleyen };
  }

  /** Tek kararin tam detayi (gorsel dahil) */
  @Get(':id')
  detail(@Req() req: any, @Param('id') id: string) {
    const tenantId = req?.user?.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    return this.service.detail(tenantId, id);
  }

  /**
   * AI kararini onayla. Body:
   *   { override?: { kategori, altKategori? }, notlar? }
   * override verilmezse AI'nin onerisi final karar olur.
   */
  @Post(':id/onayla')
  onayla(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { override?: { kategori: string; altKategori?: string }; notlar?: string },
  ) {
    const tenantId = req?.user?.tenantId;
    const userId = req?.user?.userId || req?.user?.id || null;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    return this.service.onayla({
      tenantId,
      id,
      userId,
      override: body?.override,
      notlar: body?.notlar,
    });
  }

  /** Bekleyen karari reddet — hafizaya kayit olmaz */
  @Post(':id/reddet')
  reddet(@Req() req: any, @Param('id') id: string, @Body() body: { notlar?: string }) {
    const tenantId = req?.user?.tenantId;
    const userId = req?.user?.userId || req?.user?.id || null;
    if (!tenantId) throw new BadRequestException('tenantId yok');
    return this.service.reddet({
      tenantId,
      id,
      userId,
      notlar: body?.notlar,
    });
  }
}
