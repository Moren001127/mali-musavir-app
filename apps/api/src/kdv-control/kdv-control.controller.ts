import {
  Controller, Get, Post, Patch, Param, Body, Query,
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

  @Post('sessions')
  @Roles('ADMIN', 'STAFF')
  createSession(@Req() req: any, @Body() body: any) {
    if (!body.type || !VALID_KDV_TYPES.includes(body.type)) {
      throw new BadRequestException(`Geçersiz kontrol türü. Geçerli türler: ${VALID_KDV_TYPES.join(', ')}`);
    }
    return this.kdvService.createSession(req.user.tenantId, req.user.sub, body);
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
    @Body() body: { belgeNo?: string; date?: string; kdvTutari?: string },
  ) {
    return this.kdvService.confirmImageOcr(imageId, req.user.tenantId, body);
  }

  /* ── EŞLEŞTİRME ─────────────────────────────────── */

  @Post('sessions/:id/reconcile')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  reconcile(@Req() req: any, @Param('id') id: string) {
    return this.kdvService.runReconciliation(id, req.user.tenantId);
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
