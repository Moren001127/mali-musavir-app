import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, Res,
  UseGuards, Req, UseInterceptors, UploadedFile, UploadedFiles,
  HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { KdvControlService } from './kdv-control.service';

const VALID_KDV_TYPES = ['KDV_191', 'KDV_391', 'ISLETME_GELIR', 'ISLETME_GIDER'];

@Controller('kdv-control')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class KdvControlController {
  constructor(private kdvService: KdvControlService) {}

  /* ── OTURUM ─────────────────────────────────────── */

  @Get('sessions')
  getSessions(@Req() req: any) {
    return this.kdvService.findSessions(req.user.tenantId);
  }

  @Get('sessions/:id')
  getSession(@Req() req: any, @Param('id') id: string) {
    return this.kdvService.findSession(id, req.user.tenantId);
  }

  @Get('sessions/:id/stats')
  getStats(@Req() req: any, @Param('id') id: string) {
    return this.kdvService.getSessionStats(id, req.user.tenantId);
  }

  @Delete('sessions/:id')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSession(@Req() req: any, @Param('id') id: string) {
    return this.kdvService.deleteSession(id, req.user.tenantId);
  }

  @Post('sessions')
  @Roles('ADMIN', 'STAFF')
  createSession(@Req() req: any, @Body() body: any) {
    if (!body.type || !VALID_KDV_TYPES.includes(body.type)) {
      throw new BadRequestException(`Geçersiz kontrol türü. Geçerli türler: ${VALID_KDV_TYPES.join(', ')}`);
    }
    return this.kdvService.createSession(req.user.tenantId, req.user.sub, body);
  }

  /**
   * Mükellef + dönem + tip kombinasyonu için aktif seans varsa onu
   * döndür, yoksa oluştur. Ana ekrandan direkt akış için kullanılır.
   */
  @Post('sessions/find-or-create')
  @Roles('ADMIN', 'STAFF')
  findOrCreateSession(@Req() req: any, @Body() body: any) {
    if (!body.type || !VALID_KDV_TYPES.includes(body.type)) {
      throw new BadRequestException(`Geçersiz kontrol türü. Geçerli türler: ${VALID_KDV_TYPES.join(', ')}`);
    }
    return this.kdvService.findOrCreateSession(req.user.tenantId, req.user.sub, body);
  }

  @Patch('sessions/:id/complete')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  completeSession(@Req() req: any, @Param('id') id: string) {
    return this.kdvService.completeSession(id, req.user.tenantId);
  }

  /* ── EXCEL ───────────────────────────────────────── */

  @Post('sessions/:id/excel')
  @Roles('ADMIN', 'STAFF')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  uploadExcel(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new Error('Dosya gerekli');
    return this.kdvService.uploadExcel(id, req.user.tenantId, file.buffer);
  }

  /**
   * Excel dosyasını preview eder — sütun başlıkları + ilk 10 satır döner.
   * Kullanıcı bu bilgiyle TARİH / EVRAK NO / KDV sütunlarını eşleştirir,
   * sonra /excel-import-mapped endpoint'iyle gerçek import yapılır.
   */
  @Post('sessions/:id/excel-preview')
  @Roles('ADMIN', 'STAFF')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  previewExcel(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Dosya gerekli');
    return this.kdvService.previewExcel(id, req.user.tenantId, file.buffer);
  }

  /**
   * Kullanıcının seçtiği sütun mapping'i ile Excel'i import eder.
   * Body: { tarihCol, belgeNoCol, kdvCol, sheetName? } — her birisi sütun index'i veya başlık adı.
   * File: multipart `file` alanı.
   */
  @Post('sessions/:id/excel-import-mapped')
  @Roles('ADMIN', 'STAFF')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  importExcelMapped(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: {
      tarihCol: string;
      belgeNoCol: string;
      kdvCol: string;
      sheetName?: string;
    },
  ) {
    if (!file) throw new BadRequestException('Dosya gerekli');
    if (!body?.tarihCol || !body?.belgeNoCol || !body?.kdvCol) {
      throw new BadRequestException('tarihCol, belgeNoCol, kdvCol zorunlu');
    }
    return this.kdvService.importExcelWithMapping(
      id,
      req.user.tenantId,
      file.buffer,
      {
        tarihCol: body.tarihCol,
        belgeNoCol: body.belgeNoCol,
        kdvCol: body.kdvCol,
        sheetName: body.sheetName,
      },
    );
  }

  @Get('sessions/:id/records')
  getRecords(@Req() req: any, @Param('id') id: string) {
    return this.kdvService.getKdvRecords(id, req.user.tenantId);
  }

  /* ── GÖRSELLER ───────────────────────────────────── */

  /**
   * Doğrudan multipart yükleme (presigned URL gerektirmez).
   * POST /kdv-control/sessions/:id/images/upload
   * field: images[] (max 100 dosya, 15 MB/dosya)
   */
  @Post('sessions/:id/images/upload')
  @Roles('ADMIN', 'STAFF')
  @UseInterceptors(
    FilesInterceptor('images', 100, {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Sadece görsel dosyalar kabul edilir') as any, false);
        }
      },
    }),
  )
  async uploadImagesMultipart(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('En az bir görsel gerekli');
    }
    const results = await Promise.allSettled(
      files.map((file) =>
        this.kdvService.uploadImageBuffer(
          id,
          req.user.tenantId,
          file.buffer,
          file.originalname,
          file.mimetype,
        ),
      ),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').map((r: any) => r.reason?.message);
    return { uploaded: succeeded, failed: failed.length, errors: failed };
  }

  @Post('sessions/:id/images/initiate')
  @Roles('ADMIN', 'STAFF')
  initiateImageUpload(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { originalName: string; mimeType: string },
  ) {
    return this.kdvService.initiateImageUpload(id, req.user.tenantId, body);
  }

  @Post('sessions/:id/images/confirm')
  @Roles('ADMIN', 'STAFF')
  confirmImageUpload(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { s3Key: string; originalName: string; mimeType: string },
  ) {
    return this.kdvService.confirmImageUpload(id, req.user.tenantId, body);
  }

  @Get('sessions/:id/images')
  getImages(@Req() req: any, @Param('id') id: string) {
    return this.kdvService.getImages(id, req.user.tenantId);
  }

  @Get('images/:imageId/download')
  getImageDownload(@Req() req: any, @Param('imageId') imageId: string) {
    return this.kdvService.getImageDownloadUrl(imageId, req.user.tenantId);
  }

  @Patch('images/:imageId/confirm-ocr')
  @Roles('ADMIN', 'STAFF')
  confirmOcr(
    @Req() req: any,
    @Param('imageId') imageId: string,
    @Body() body: {
      belgeNo?: string;
      date?: string;
      kdvTutari?: string;
      kdvTevkifat?: string | null;
      kdvBreakdown?: Array<{ oran: number; tutar: number; matrah?: number | null }> | null;
    },
  ) {
    return this.kdvService.confirmImageOcr(imageId, req.user.tenantId, body);
  }

  @Delete('images/:imageId')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteImage(@Req() req: any, @Param('imageId') imageId: string) {
    return this.kdvService.deleteImage(imageId, req.user.tenantId);
  }

  /**
   * Tek bir fatura görselinin OCR'ını yeniden çalıştır.
   * "OCR FATURA OKUMA" panelinde her satırın yanındaki ⟳ butonu için.
   * Cache atlanır, manuel teyit sıfırlanır, OCR arkaplanda yeniden çalışır.
   */
  @Post('images/:imageId/reocr')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  reocrImage(@Req() req: any, @Param('imageId') imageId: string) {
    return this.kdvService.reocrSingleImage(imageId, req.user.tenantId);
  }

  /* ── OTOMATİK ÇEKİM (LUCA + MIHSAP) ──────────────── */

  /**
   * Luca'dan muavin/işletme defteri otomatik çekimi başlat.
   * Arka planda bir Luca fetch job yaratır; runner Luca sayfasında
   * Excel'i indirip /excel endpoint'ine gönderir.
   */
  @Post('sessions/:id/import-from-luca')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  importFromLuca(@Req() req: any, @Param('id') id: string) {
    return this.kdvService.queueLucaImport(id, req.user.tenantId, req.user.sub);
  }

  /**
   * Luca fetch job durum sorgusu — frontend polling ile log/state alır.
   * Mizan'daki `/mizan/luca-job/:id` ile aynı pattern.
   */
  @Get('luca-job/:id')
  @Roles('ADMIN', 'STAFF')
  async getLucaJob(@Req() req: any, @Param('id') id: string) {
    const job = await this.kdvService.getLucaJob(id, req.user.tenantId);
    // Job done olduysa session'ı + record sayısını da dön
    let session: any = null;
    if (job?.status === 'done' && job.sessionId) {
      session = await this.kdvService.findSession(job.sessionId, req.user.tenantId).catch(() => null);
    }
    return { job, session };
  }

  /**
   * Mevcut (portal DB'sindeki) Mihsap fatura kayıtlarını bu oturuma
   * görsel olarak bağlar. Mihsap'a yeniden gitmez.
   */
  @Post('sessions/:id/link-mihsap-invoices')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  linkMihsap(@Req() req: any, @Param('id') id: string) {
    return this.kdvService.linkMihsapInvoices(id, req.user.tenantId);
  }

  /**
   * Oturumdaki bekleyen (PENDING) tüm görsellerin OCR'ını başlat.
   * Mihsap kaynaklı görseller Mihsap CDN'den indirilir, diğerleri S3'ten.
   *
   * body.forceFresh=true → "Yenile" butonundan gelen istekler. NEEDS_REVIEW
   * olanlar da kuyruğa alınır ve OCR cache atlanır (yeni düzeltmeler uygulansın).
   */
  @Post('sessions/:id/start-ocr')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  startOcr(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body?: { forceFresh?: boolean },
  ) {
    return this.kdvService.startOcrForSession(id, req.user.tenantId, {
      forceFresh: body?.forceFresh === true,
    });
  }

  /**
   * Runner Luca Excel'ini yüklerken bu endpoint'i kullanır —
   * uploadExcel ile aynı ama jobId parametresi ile job kapatılır.
   */
  @Post('sessions/:id/excel-from-runner/:jobId')
  @Roles('ADMIN', 'STAFF')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  uploadExcelFromRunner(
    @Req() req: any,
    @Param('id') id: string,
    @Param('jobId') jobId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Dosya gerekli');
    return this.kdvService.uploadExcelFromRunner(id, req.user.tenantId, jobId, file.buffer);
  }

  /* ── EŞLEŞTİRME ─────────────────────────────────── */

  @Post('sessions/:id/reconcile')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  reconcile(@Req() req: any, @Param('id') id: string) {
    return this.kdvService.runReconciliation(id, req.user.tenantId);
  }

  @Get('sessions/:id/export-excel')
  @Roles('ADMIN', 'STAFF')
  async exportExcel(
    @Req() req: any,
    @Param('id') id: string,
    @Res() res: any,
  ) {
    const buffer = await this.kdvService.exportResultsToExcel(id, req.user.tenantId, {
      autoArchive: true,
      createdBy: req.user.sub,
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="kdv-kontrol-${id}.xlsx"`);
    res.send(buffer);
  }

  /* ── ÇIKTI ARŞİVİ (fiş yazdırmadaki gibi) ────────────────── */

  @Get('outputs')
  listOutputs(@Req() req: any) {
    return this.kdvService.listOutputs(req.user.tenantId);
  }

  @Get('outputs/:id/download')
  async downloadOutput(@Req() req: any, @Param('id') id: string, @Res() res: any) {
    const rec = await this.kdvService.getOutput(req.user.tenantId, id);
    if (!rec) throw new BadRequestException('Çıktı bulunamadı');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${rec.filename}"`);
    res.send(rec.fileBytes);
  }

  @Delete('outputs/:id')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteOutput(@Req() req: any, @Param('id') id: string) {
    await this.kdvService.deleteOutput(req.user.tenantId, id);
  }

  @Get('sessions/:id/results')
  getResults(@Req() req: any, @Param('id') id: string) {
    return this.kdvService.getResults(id, req.user.tenantId);
  }

  @Patch('results/:resultId/resolve')
  @Roles('ADMIN', 'STAFF')
  resolveResult(
    @Req() req: any,
    @Param('resultId') resultId: string,
    @Body() body: { action: 'CONFIRMED' | 'REJECTED'; notes?: string },
  ) {
    return this.kdvService.resolveResult(
      resultId,
      req.user.tenantId,
      req.user.sub,
      body.action,
      body.notes,
    );
  }
}
