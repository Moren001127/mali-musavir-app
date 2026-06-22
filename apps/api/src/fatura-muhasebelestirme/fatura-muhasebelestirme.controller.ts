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
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { FaturaMuhasebelestirmeService } from './fatura-muhasebelestirme.service';
import { IcerikEslestirmeService } from './icerik-eslestirme.service';
import { EFaturaSyncService } from '../efatura-adapters/efatura-sync.service';

const documentUploadInterceptor = () =>
  FilesInterceptor('files', 100, {
    storage: memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    // Tarayicilar bazi JPEG/PDF/ZIP dosyalarini application/octet-stream gonderebiliyor.
    // Dosya tipi denetimini buffer geldikten sonra serviste magic-byte ile yapiyoruz.
    fileFilter: (_req, _file, cb) => cb(null, true),
  });

@Controller('fatura-muhasebelestirme')
@UseGuards(AuthGuard('jwt'))
export class FaturaMuhasebelestirmeController {
  constructor(
    private readonly service: FaturaMuhasebelestirmeService,
    private readonly icerikEslestirme: IcerikEslestirmeService,
    private readonly eFaturaSyncService: EFaturaSyncService,
  ) {}

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

  @Get('kdv-client-report')
  kdvClientReport(
    @Req() req: any,
    @Query('taxpayerId') taxpayerId?: string,
    @Query('period') period?: string,
  ) {
    return this.service.kdvClientReport(req.user.tenantId, { taxpayerId, period });
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
    @Body('period') period?: string,
  ) {
    return this.service.uploadAndOcr(req.user.tenantId, req.user?.userId, files, {
      taxpayerId: taxpayerId || undefined,
      source: source || 'manual-web',
      documentType: documentType || 'OKC_FIS',
      invoiceKind: invoiceKind || 'ALIS',
      forceClaude: forceClaude === 'true',
      period: period || undefined,
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

  /** Toplu hesap planı yenileme — tüm mükellefler veya verilen liste için. */
  @Post('account-plan/refresh-all')
  refreshAccountPlanAll(
    @Req() req: any,
    @Body() body: { taxpayerIds?: string[]; targetDeviceId?: string },
  ) {
    return this.service.refreshAccountPlanBulk(req.user.tenantId, {
      taxpayerIds: body?.taxpayerIds,
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

  /** Elle eşleştirme kuralı: satıcı VKN → hesap kodu (öğrenilir + bekleyen belgelere uygulanır). */
  @Post('vendor-rule')
  setVendorRule(
    @Req() req: any,
    @Body() body: { taxpayerId?: string; vendorVkn?: string; vendorName?: string; accountCode?: string; kdvOrani?: number | string | null },
  ) {
    return this.service.setVendorRule(req.user.tenantId, body || {});
  }

  /** Öğrenilmiş eşleştirme kuralını sil. */
  @Delete('vendor-rule/:decisionId')
  deleteVendorRule(@Req() req: any, @Param('decisionId') decisionId: string) {
    return this.service.deleteVendorRule(req.user.tenantId, decisionId);
  }

  /** Matrah/KDV çıkmamış belgelere KDV oranı verip fiş satırlarını üret (toplam → matrah+KDV). */
  @Post('documents/set-kdv-rate')
  setDocumentsKdvRate(
    @Req() req: any,
    @Body() body: { documentIds?: string[]; kdvOrani?: number; accountCode?: string; tevkifatOrani?: number },
  ) {
    return this.service.setDocumentsKdvRate(req.user.tenantId, body || {});
  }

  /** Belgeyi Max-vision (Max aboneliği) ile oku → KDV kırılımı + fiş üret. Tek belge (frontend sırayla çağırır). */
  @Post('documents/ai-read')
  aiReadDocument(@Req() req: any, @Body() body: { documentId?: string }) {
    return this.service.aiReadDocument(req.user.tenantId, String(body?.documentId || ''));
  }

  /** Seçili belgeleri SUNUCU kuyruğunda AI ile oku (sayfa değişince durmaz). Hemen döner. */
  @Post('documents/ai-read-batch')
  aiReadBatch(@Req() req: any, @Body() body: { documentIds?: string[] }) {
    return this.service.aiReadBatch(req.user.tenantId, Array.isArray(body?.documentIds) ? body.documentIds : []);
  }

  /** OCR/okuma ilerlemesi — tarama şeridi için. */
  @Get('ocr-progress')
  ocrProgress(@Req() req: any, @Query('taxpayerId') taxpayerId?: string, @Query('period') period?: string) {
    return this.service.ocrProgress(req.user.tenantId, { taxpayerId, period });
  }

  /** Faz F/6: eksik belge takibi — düzenli gelen ama bu dönem gelmeyen satıcılar. */
  @Get('missing-suppliers')
  missingSuppliers(@Req() req: any, @Query('taxpayerId') taxpayerId?: string, @Query('period') period?: string) {
    return this.service.missingSuppliers(req.user.tenantId, { taxpayerId, period });
  }

  /** Hızlı düzeltme: belgeleri tekrar okumadan hesap kodlarını plana göre yeniden eşleştir
   *  (yanlış carileri temizler). */
  @Post('documents/reapply-codes')
  reapplyCodes(@Req() req: any, @Body() body: { taxpayerId?: string }) {
    return this.service.reapplyAccountCodes(req.user.tenantId, String(body?.taxpayerId || ''));
  }

  @Post('documents/from-earsiv/:faturaId')
  fromEarsiv(@Req() req: any, @Param('faturaId') faturaId: string) {
    return this.service.ensureFromEarsivFatura(req.user.tenantId, faturaId);
  }

  @Post('documents/backfill-earsiv')
  backfillEarsiv(
    @Req() req: any,
    @Body() body: { taxpayerId?: string; donem?: string; tip?: string; belgeKaynak?: string; limit?: number; ids?: string[] },
  ) {
    return this.service.backfillFromExistingEarsiv(req.user.tenantId, {
      taxpayerId: body?.taxpayerId || undefined,
      donem: body?.donem || undefined,
      tip: body?.tip || undefined,
      belgeKaynak: body?.belgeKaynak || undefined,
      limit: body?.limit,
      ids: Array.isArray(body?.ids) ? body.ids : undefined,
    });
  }

  @Post('import-from-mihsap')
  @UseGuards(AuthGuard('jwt'))
  importFromMihsap(
    @Req() req: any,
    @Body() body: { taxpayerId: string; donem: string; faturaTuru?: 'ALIS' | 'SATIS' },
  ) {
    if (!body?.taxpayerId || !body?.donem) {
      throw new BadRequestException('taxpayerId ve donem gerekli');
    }
    return this.service.importFromMihsap(req.user.tenantId, {
      taxpayerId: body.taxpayerId,
      donem: body.donem,
      faturaTuru: body.faturaTuru,
      createdBy: req.user.userId,
    });
  }

  // v2.2: taxpayerId boş olan belgeleri (sellerVkn/buyerVkn üzerinden) mevcut mukelleflere bağla
  @Post('documents/match-orphans')
  matchOrphans(
    @Req() req: any,
    @Body() body: { period?: string },
  ) {
    return this.service.matchOrphansToTaxpayers(req.user.tenantId, { period: body?.period });
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
    return this.service.update(req.user.tenantId, id, body, req.user?.userId);
  }

  @Post('documents/:id/approve')
  approve(@Req() req: any, @Param('id') id: string) {
    return this.service.approve(req.user.tenantId, id, req.user?.userId);
  }

  /** Faz C: onayı geri al (Luca'ya gitmemişse) — tekrar düzenlenebilir. */
  @Post('documents/:id/reopen')
  reopen(@Req() req: any, @Param('id') id: string) {
    return this.service.reopen(req.user.tenantId, id, req.user?.userId);
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

  /** Aktarım'daki toplu fişi (yön/dönem) Luca'ya GİTMEDEN Excel/CSV indir — kullanıcı elle yükler/arşivler. */
  @Get('batch-excel')
  async batchExcel(
    @Req() req: any,
    @Query('taxpayerId') taxpayerId: string,
    @Query('period') period: string,
    @Query('direction') direction: string,
    @Res() res: any,
  ) {
    const out = await this.service.buildBatchExcel(req.user.tenantId, {
      taxpayerId,
      period,
      direction: direction === 'ALIS' || direction === 'SATIS' ? (direction as 'ALIS' | 'SATIS') : undefined,
    });
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.setHeader('Content-Length', out.buffer.length.toString());
    res.end(out.buffer);
  }

  @Delete('documents/:id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.tenantId, id, req.user?.userId);
  }

  /** İçerik tabanlı hesap kodu / gider türü önerisi */
  @Post('icerik-eslestir')
  icerikEslestir(@Req() req: any, @Body() body: any) {
    return this.icerikEslestirme.eslestir({
      tenantId: req.user.tenantId,
      taxpayerId: body.taxpayerId,
      senderVkn: body.senderVkn || null,
      kalemler: body.kalemler || [],
      defterTuru: body.defterTuru || 'BILANCO',
    });
  }

  /** EFatura inbox listesi */
  @Get('efatura-inbox')
  efaturaInbox(@Req() req: any, @Query() q: any) {
    return (this.eFaturaSyncService as any).listInbox
      ? (this.eFaturaSyncService as any).listInbox(req.user.tenantId, q)
      : [];
  }

  /** Manuel tetikleme: entegratörden hemen çek */
  @Post('efatura-sync')
  async efaturaSync(@Req() req: any, @Body() body: any) {
    const direction = body?.direction === 'OUT' ? 'OUT' : 'IN';
    return this.eFaturaSyncService.syncAll(req.user.tenantId, { direction });
  }
}
