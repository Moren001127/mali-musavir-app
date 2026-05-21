import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';

const documentUploadInterceptor = () =>
  FilesInterceptor('files', 100, {
    storage: memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok =
        file.mimetype.startsWith('image/') ||
        file.mimetype === 'application/pdf' ||
        file.mimetype.includes('xml') ||
        /\.xml$/i.test(file.originalname);
      if (ok) cb(null, true);
      else cb(new BadRequestException('Sadece görsel, PDF veya XML belge kabul edilir') as any, false);
    },
  });

@Controller('fatura-muhasebelestirme')
@UseGuards(AuthGuard('jwt'))
export class FaturaMuhasebelestirmeController {
  constructor(private readonly service: FaturaMuhasebelestirmeService) {}

  @Get('documents')
  list(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('taxpayerId') taxpayerId?: string,
    @Query('period') period?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(req.user.tenantId, {
      status,
      taxpayerId,
      period,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('dashboard')
  dashboard(@Req() req: any, @Query('period') period?: string) {
    return this.service.dashboard(req.user.tenantId, { period });
  }

  @Get('integrations')
  integrations(@Req() req: any, @Query('taxpayerId') taxpayerId?: string) {
    return this.service.listIntegrations(req.user.tenantId, { taxpayerId: taxpayerId || null });
  }

  @Post('integrations')
  saveIntegration(@Req() req: any, @Body() body: any) {
    return this.service.saveIntegration(
      req.user.tenantId,
      body || {},
      req.user?.userId || req.user?.sub,
    );
  }

  @Post('integrations/fetch')
  fetchIntegrations(@Req() req: any, @Body() body: any) {
    return this.service.fetchConfiguredIntegrations(
      req.user.tenantId,
      body || {},
      req.user?.userId || req.user?.sub,
    );
  }

  /** Talimat ver/kaldır — her gece otomatik fetch. */
  @Post('integrations/talimat')
  setTalimat(@Req() req: any, @Body() body: any) {
    return this.service.setIntegrationTalimat(req.user.tenantId, body || {});
  }

  /** Mukellef için bir entegratör kaydını sil. */
  @Delete('integrations')
  deleteIntegration(
    @Req() req: any,
    @Query('taxpayerId') taxpayerId?: string,
    @Query('provider') provider?: string,
  ) {
    return this.service.deleteIntegration(req.user.tenantId, {
      taxpayerId: taxpayerId || null,
      provider: provider || '',
    });
  }

  /** Yeni Fatura Merkezi v2'nin kullandığı kısa özet endpoint. */
  @Get('summary')
  summary(
    @Req() req: any,
    @Query('period') period?: string,
    @Query('taxpayerId') taxpayerId?: string,
  ) {
    return this.service.summary(req.user.tenantId, { period, taxpayerId });
  }

  /** Her mukellef için bekleyen/onaylanan sayıları tek scan'de döner. */
  @Get('per-taxpayer-summary')
  perTaxpayerSummary(@Req() req: any, @Query('period') period?: string) {
    return this.service.perTaxpayerSummary(req.user.tenantId, { period });
  }

  @Post('documents/upload')
  @UseInterceptors(documentUploadInterceptor())
  upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: any,
    @Body('taxpayerId') taxpayerId?: string,
    @Body('source') source?: string,
    @Body('documentType') documentType?: string,
    @Body('invoiceKind') invoiceKind?: string,
    @Body('forceClaude') forceClaude?: string,
  ) {
    return this.service.uploadAndOcr(req.user.tenantId, req.user?.userId, files, {
      taxpayerId: taxpayerId || undefined,
      source: source || 'manual-web',
      documentType: documentType || 'OKC_FIS',
      invoiceKind: invoiceKind || 'ALIS',
      forceClaude: forceClaude === 'true',
    });
  }

  @Get('account-plan')
  accountPlan(
    @Req() req: any,
    @Query('taxpayerId') taxpayerId: string,
    @Query('q') q?: string,
    @Query('prefixes') prefixes?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.accountPlan(req.user.tenantId, {
      taxpayerId,
      q,
      prefixes: prefixes ? prefixes.split(',').map((p) => p.trim()).filter(Boolean) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('account-plan/refresh')
  refreshAccountPlan(
    @Req() req: any,
    @Body() body: { taxpayerId?: string; targetDeviceId?: string },
  ) {
    return this.service.refreshAccountPlan(req.user.tenantId, {
      taxpayerId: body?.taxpayerId || '',
      targetDeviceId: body?.targetDeviceId,
      createdBy: req.user?.userId || req.user?.sub,
    });
  }

  /** Yeni hesap aç — sonra Luca'ya gönderilebilir. */
  @Post('account-plan')
  createAccount(
    @Req() req: any,
    @Body() body: { taxpayerId?: string; code?: string; name?: string },
  ) {
    return this.service.createAccount(req.user.tenantId, {
      taxpayerId: body?.taxpayerId || '',
      code: body?.code || '',
      name: body?.name || '',
    });
  }

  /** Sadece yerelde açılmış (Luca'ya gönderilmemiş) hesapları Luca'ya yükler. */
  @Post('account-plan/push-to-luca')
  pushAccountPlanToLuca(
    @Req() req: any,
    @Body() body: { taxpayerId?: string },
  ) {
    return this.service.pushAccountPlanToLuca(req.user.tenantId, {
      taxpayerId: body?.taxpayerId || '',
      createdBy: req.user?.userId || req.user?.sub,
    });
  }

  @Post('documents/from-earsiv/:faturaId')
  fromEarsiv(@Req() req: any, @Param('faturaId') faturaId: string) {
    return this.service.ensureFromEarsivFatura(req.user.tenantId, faturaId);
  }

  @Post('documents/backfill-earsiv')
  backfillEarsiv(
    @Req() req: any,
    @Body() body: { taxpayerId?: string; donem?: string; tip?: string; belgeKaynak?: string; limit?: number },
  ) {
    return this.service.backfillFromExistingEarsiv(req.user.tenantId, {
      taxpayerId: body?.taxpayerId || undefined,
      donem: body?.donem || undefined,
      tip: body?.tip || undefined,
      belgeKaynak: body?.belgeKaynak || undefined,
      limit: body?.limit,
    });
  }

  @Post('documents/duplicate-check')
  duplicateCheck(@Req() req: any, @Body() body: any) {
    return this.service.duplicateCheck(req.user.tenantId, body || {});
  }

  @Get('documents/:id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.service.get(req.user.tenantId, id);
  }

  @Get('documents/:id/file-url')
  fileUrl(@Req() req: any, @Param('id') id: string) {
    return this.service.fileUrl(req.user.tenantId, id);
  }

  @Patch('documents/:id')
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.update(req.user.tenantId, id, body);
  }

  @Post('documents/:id/approve')
  approve(@Req() req: any, @Param('id') id: string) {
    return this.service.approve(req.user.tenantId, id, req.user?.userId);
  }

  // v1.38: Luca aktarimi basarisiz olursa veya kullanici manuel tekrarlamak isterse
  @Post('documents/:id/retry-luca')
  retryLuca(@Req() req: any, @Param('id') id: string) {
    return this.service.retryLucaPost(req.user.tenantId, id, req.user?.userId);
  }

  // v1.38: Bir mukellef+donem icin TUM QUEUED belgeleri tek toplu Excel olarak
  // Luca'ya aktar (BATCH_EXCEL job). Frontend Sahne 5'teki "Luca'ya Aktar"
  // butonu bunu cagirir.
  // Body: { taxpayerId: string; period?: "YYYY-MM"; documentIds?: string[] }
  @Post('batch-post-to-luca')
  batchPostToLuca(@Req() req: any, @Body() body: any) {
    return this.service.batchPostToLuca(req.user.tenantId, body, req.user?.userId);
  }

  @Delete('documents/:id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.tenantId, id);
  }
}
