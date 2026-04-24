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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MizanService, MizanDonemTipi } from './mizan.service';
import { GelirTablosuService } from './gelir-tablosu.service';
import { BilancoService } from './bilanco.service';
import { LucaService } from '../luca/luca.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class MizanController {
  constructor(
    private readonly mizanService: MizanService,
    private readonly gelirTablosuService: GelirTablosuService,
    private readonly bilancoService: BilancoService,
    private readonly lucaService: LucaService,
    private readonly prisma: PrismaService,
  ) {}

  // ==================== MİZAN ====================

  @Get('mizan')
  list(@Req() req: any, @Query('taxpayerId') taxpayerId?: string) {
    return this.mizanService.listMizans(req.user.tenantId, taxpayerId);
  }

  @Get('mizan/:id')
  getOne(@Req() req: any, @Param('id') id: string) {
    return this.mizanService.getMizan(id, req.user.tenantId);
  }

  @Post('mizan/import')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  async import(
    @Req() req: any,
    @Body() body: { taxpayerId: string; donem: string; donemTipi?: MizanDonemTipi },
  ) {
    if (!body.taxpayerId || !body.donem) {
      throw new BadRequestException('taxpayerId ve donem zorunlu');
    }
    return this.mizanService.importFromLuca({
      tenantId: req.user.tenantId,
      taxpayerId: body.taxpayerId,
      donem: body.donem,
      donemTipi: body.donemTipi,
      createdBy: req.user.sub,
    });
  }

  @Post('mizan/upload')
  @Roles('ADMIN', 'STAFF')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }))
  uploadExcel(
    @Req() req: any,
    @Body() body: { taxpayerId: string; donem: string; donemTipi?: MizanDonemTipi },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Excel dosyası gerekli');
    if (!body.taxpayerId || !body.donem) throw new BadRequestException('taxpayerId ve donem zorunlu');
    return this.mizanService.importFromExcel({
      tenantId: req.user.tenantId,
      taxpayerId: body.taxpayerId,
      donem: body.donem,
      donemTipi: body.donemTipi,
      buffer: file.buffer,
      createdBy: req.user.sub,
    });
  }

  @Post('mizan/:id/analyze')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  analyze(@Req() req: any, @Param('id') id: string) {
    // Yetki: önce mizan bu tenant'a mı kontrol et
    return this.mizanService.getMizan(id, req.user.tenantId).then(() =>
      this.mizanService.analyzeAccounts(id),
    );
  }

  // === LUCA'DAN OTOMATİK ÇEKİM (EXTENSION-FIRST) ===
  // Frontend bu endpoint'i çağırır → LucaFetchJob oluşur → moren-agent.js
  // (personelin tarayıcısında açık Luca sekmesinde) job'u alıp Excel indirir,
  // /agent/luca/runner/upload-mizan'a yükler. Multi-user: her personel kendi
  // tarayıcısından çalıştırabilir, job tenant bazlı paylaşılır.
  @Post('mizan/fetch-from-luca')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  async fetchFromLuca(
    @Req() req: any,
    @Body() body: { mukellefId: string; donem: string; donemTipi?: MizanDonemTipi },
  ) {
    if (!body?.mukellefId || !body?.donem) {
      throw new BadRequestException('mukellefId ve donem gerekli');
    }
    const job = await this.lucaService.createFetchJob({
      tenantId: req.user.tenantId,
      sessionId: undefined as any, // Mizan için null (KDV kontrol'e bağlı değil)
      mukellefId: body.mukellefId,
      donem: body.donem,
      tip: 'MIZAN',
      createdBy: req.user.sub,
    });
    return { jobId: job.id, status: job.status };
  }

  // Polling endpoint — frontend "Luca sekmesini açık tut" gösterirken bunu çağırır
  @Get('mizan/luca-job/:id')
  async getLucaJob(@Req() req: any, @Param('id') id: string) {
    const job = await this.lucaService.getJob(id, req.user.tenantId);
    // Job done olduysa yeni oluşan mizan kaydını da dön
    let mizan: any = null;
    if (job.status === 'done') {
      mizan = await (this.prisma as any).mizan.findFirst({
        where: {
          tenantId: req.user.tenantId,
          taxpayerId: job.mukellefId,
          donem: job.donem,
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    return { job, mizan };
  }

  @Delete('mizan/:id')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Req() req: any, @Param('id') id: string) {
    await this.mizanService.deleteMizan(id, req.user.tenantId);
  }

  @Patch('mizan/:id/lock')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  lockMizan(@Req() req: any, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.mizanService.lockMizan(id, req.user.tenantId, req.user.sub, body?.note);
  }

  @Patch('mizan/:id/unlock')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  unlockMizan(@Req() req: any, @Param('id') id: string, @Body() body: { reason: string }) {
    return this.mizanService.unlockMizan(id, req.user.tenantId, req.user.sub, body?.reason);
  }

  // ==================== GELİR TABLOSU ====================

  @Get('gelir-tablosu')
  listGelirTablolari(@Req() req: any, @Query('taxpayerId') taxpayerId?: string) {
    return this.gelirTablosuService.listGelirTablolari(req.user.tenantId, taxpayerId);
  }

  @Get('gelir-tablosu/:id')
  getGelirTablosu(@Req() req: any, @Param('id') id: string) {
    return this.gelirTablosuService.getGelirTablosu(id, req.user.tenantId);
  }

  @Post('gelir-tablosu/generate')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  generateGelirTablosu(
    @Req() req: any,
    @Body() body: { mizanId: string; donemTipi?: string },
  ) {
    if (!body.mizanId) throw new BadRequestException('mizanId zorunlu');
    return this.gelirTablosuService.generateFromMizan({
      mizanId: body.mizanId,
      tenantId: req.user.tenantId,
      donemTipi: body.donemTipi,
      createdBy: req.user.sub,
    });
  }

  @Get('gelir-tablosu/:id/export-excel')
  @Roles('ADMIN', 'STAFF')
  async exportGelirTablosu(
    @Req() req: any,
    @Param('id') id: string,
    @Res() res: any,
  ) {
    const buffer = await this.gelirTablosuService.exportToExcel(id, req.user.tenantId);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="gelir-tablosu-${id}.xlsx"`);
    res.send(buffer);
  }

  @Delete('gelir-tablosu/:id')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteGelirTablosu(@Req() req: any, @Param('id') id: string) {
    await this.gelirTablosuService.deleteGelirTablosu(id, req.user.tenantId);
  }

  /** Manuel düzeltmeleri kaydet (2. dönem için mizana kaydetmeden önce). */
  @Patch('gelir-tablosu/:id/duzeltmeler')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  updateDuzeltmeler(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { duzeltmeler: Record<string, number> },
  ) {
    return this.gelirTablosuService.updateDuzeltmeler(id, req.user.tenantId, body?.duzeltmeler || {});
  }

  @Patch('gelir-tablosu/:id/lock')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  lockGelirTablosu(@Req() req: any, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.gelirTablosuService.lockGelirTablosu(id, req.user.tenantId, req.user.sub, body?.note);
  }

  @Patch('gelir-tablosu/:id/unlock')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  unlockGelirTablosu(@Req() req: any, @Param('id') id: string, @Body() body: { reason: string }) {
    return this.gelirTablosuService.unlockGelirTablosu(id, req.user.tenantId, req.user.sub, body?.reason);
  }

  // ==================== BİLANÇO ====================

  @Get('bilanco')
  listBilancolar(@Req() req: any, @Query('taxpayerId') taxpayerId?: string) {
    return this.bilancoService.listBilancolar(req.user.tenantId, taxpayerId);
  }

  @Get('bilanco/:id')
  getBilanco(@Req() req: any, @Param('id') id: string) {
    return this.bilancoService.getBilanco(id, req.user.tenantId);
  }

  @Post('bilanco/generate')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  generateBilanco(
    @Req() req: any,
    @Body() body: { mizanId: string; tarih?: string; donemTipi?: string },
  ) {
    if (!body.mizanId) throw new BadRequestException('mizanId zorunlu');
    return this.bilancoService.generateFromMizan({
      mizanId: body.mizanId,
      tenantId: req.user.tenantId,
      tarih: body.tarih ? new Date(body.tarih) : undefined,
      donemTipi: body.donemTipi,
      createdBy: req.user.sub,
    });
  }

  @Delete('bilanco/:id')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBilanco(@Req() req: any, @Param('id') id: string) {
    await this.bilancoService.deleteBilanco(id, req.user.tenantId);
  }

  /** Manuel düzeltmeleri kaydet (geçici vergi için 590/591 vb.) */
  @Patch('bilanco/:id/duzeltmeler')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  updateBilancoDuzeltmeler(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { duzeltmeler: Record<string, number> },
  ) {
    return this.bilancoService.updateDuzeltmeler(id, req.user.tenantId, body?.duzeltmeler || {});
  }

  @Patch('bilanco/:id/lock')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  lockBilanco(@Req() req: any, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.bilancoService.lockBilanco(id, req.user.tenantId, req.user.sub, body?.note);
  }

  @Patch('bilanco/:id/unlock')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  unlockBilanco(@Req() req: any, @Param('id') id: string, @Body() body: { reason: string }) {
    return this.bilancoService.unlockBilanco(id, req.user.tenantId, req.user.sub, body?.reason);
  }
}
