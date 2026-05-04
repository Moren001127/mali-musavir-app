import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { IsletmeHesapOzetiService } from './isletme-hesap-ozeti.service';

@Controller('isletme-hesap-ozeti')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class IsletmeHesapOzetiController {
  constructor(private readonly service: IsletmeHesapOzetiService) {}

  /** Tüm liste — opsiyonel taxpayerId ve yıl filtreli */
  @Get()
  list(
    @Req() req: any,
    @Query('taxpayerId') taxpayerId?: string,
    @Query('yil') yil?: string,
  ) {
    return this.service.list(req.user.tenantId, taxpayerId, yil ? Number(yil) : undefined);
  }

  /** Bir mükellef + yıl için 4 çeyreği birden getir (karşılaştırmalı görünüm için) */
  @Get('yil/:taxpayerId/:yil')
  getYil(
    @Req() req: any,
    @Param('taxpayerId') taxpayerId: string,
    @Param('yil') yil: string,
  ) {
    return this.service.getYil(req.user.tenantId, taxpayerId, Number(yil));
  }

  /** Excel export — yılın 4 çeyreği yan yana (literal prefix → generic route'tan önce) */
  @Get('export/:taxpayerId/:yil')
  @Roles('ADMIN', 'STAFF')
  async exportYil(
    @Req() req: any,
    @Param('taxpayerId') taxpayerId: string,
    @Param('yil') yil: string,
    @Res() res: any,
  ) {
    const buffer = await this.service.exportYilExcel(
      req.user.tenantId,
      taxpayerId,
      Number(yil),
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="isletme-hesap-ozeti-${yil}.xlsx"`,
    );
    res.send(buffer);
  }

  /** Tek çeyrek detayı (generic route — son sıraya konuluyor) */
  @Get(':taxpayerId/:yil/:donem')
  getOne(
    @Req() req: any,
    @Param('taxpayerId') taxpayerId: string,
    @Param('yil') yil: string,
    @Param('donem') donem: string,
  ) {
    return this.service.getOne(req.user.tenantId, taxpayerId, Number(yil), Number(donem));
  }

  /** Tek çeyrek için boş kayıt oluştur (manuel veri girişine açık) */
  @Post('olustur')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  olustur(
    @Req() req: any,
    @Body() body: { taxpayerId: string; yil: number; donem: number },
  ) {
    if (!body?.taxpayerId || !body?.yil || !body?.donem) {
      throw new BadRequestException('taxpayerId, yil, donem zorunlu');
    }
    return this.service.olustur({
      tenantId: req.user.tenantId,
      taxpayerId: body.taxpayerId,
      yil: Number(body.yil),
      donem: Number(body.donem),
      createdBy: req.user.sub,
    });
  }

  /** Q1-Q4 boş kayıtları sırayla oluştur (yıl başlatma) */
  @Post('olustur-yil')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  olusturYil(
    @Req() req: any,
    @Body() body: { taxpayerId: string; yil: number },
  ) {
    if (!body?.taxpayerId || !body?.yil) {
      throw new BadRequestException('taxpayerId, yil zorunlu');
    }
    return this.service.olusturYil({
      tenantId: req.user.tenantId,
      taxpayerId: body.taxpayerId,
      yil: Number(body.yil),
      createdBy: req.user.sub,
    });
  }

  /**
   * Manuel veri güncelle (tüm finansal alanlar manueldir).
   * Bir alan gönderilmezse mevcut değer korunur.
   */
  @Patch(':id/manuel')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  updateManuel(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: {
      satisHasilati?: number;
      digerGelir?: number;
      malAlisi?: number;
      donemBasiStok?: number;
      kalanStok?: number;
      satilanMalMaliyeti?: number;
      donemIciGiderler?: number;
      gecmisYilZarari?: number;
      oncekiOdenenGecVergi?: number;
      not?: string;
    },
  ) {
    return this.service.updateManuel({
      tenantId: req.user.tenantId,
      id,
      ...body,
    });
  }

  /** Kesin kayıt — kilitle */
  @Patch(':id/lock')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  lock(@Req() req: any, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.service.lock(req.user.tenantId, id, req.user.sub, body?.note);
  }

  /** Kilidi aç (sadece ADMIN) */
  @Patch(':id/unlock')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  unlock(@Req() req: any, @Param('id') id: string, @Body() body: { reason: string }) {
    if (!body?.reason) throw new BadRequestException('reason zorunlu');
    return this.service.unlock(req.user.tenantId, id, req.user.sub, body.reason);
  }

  @Delete(':id')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: any, @Param('id') id: string) {
    await this.service.remove(req.user.tenantId, id);
  }
  /** Luca'dan İşletme Defteri çekim job'u başlat */
  @Post(':id/luca-cek')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  lucaCek(@Req() req: any, @Param('id') id: string) {
    return this.service.lucaCek({
      tenantId: req.user.tenantId,
      id,
      createdBy: req.user.sub,
    });
  }

  /** Luca çekim job durumunu sorgula (frontend polling için) */
  @Get('luca-job/:jobId')
  getLucaJob(@Req() req: any, @Param('jobId') jobId: string) {
    return this.service.getLucaJob(jobId, req.user.tenantId);
  }

}
