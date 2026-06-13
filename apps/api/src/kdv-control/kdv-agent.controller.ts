import { Controller, Post, Get, HttpCode, HttpStatus, Headers, Query, Param } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { KdvControlService } from './kdv-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTenantFromAgentToken } from '../common/agent-token';

/** Agent token ile çağrılabilen KDV OCR denetim endpoint'leri (JWT gerektirmez). */
@SkipThrottle()
@Controller('agent/kdv-control')
export class KdvAgentController {
  constructor(
    private readonly kdvService: KdvControlService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Tüm görselleri (SUCCESS dahil) tekrar OCR'dan geçir, DB'ye hiç yazma.
   * Mevcut kayıtla karşılaştır, hata pattern'lerini raporla.
   */
  @Post('ocr-audit')
  @HttpCode(HttpStatus.OK)
  async ocrAudit(
    @Headers('x-agent-token') agentToken: string,
    @Query('limit') limit?: string,
  ) {
    const tenantId = await resolveTenantFromAgentToken(agentToken, this.prisma as any);
    const n = Math.min(parseInt(limit || '200', 10) || 200, 500);
    return this.kdvService.dryRunOcrAudit(tenantId, n);
  }

  /**
   * OCR durum özeti: hangi belge tiplerinde kaç NEEDS_REVIEW/FAILED var.
   * Mükellef adı filtresi ile arama yapılabilir.
   */
  @Get('ocr-status-summary')
  async ocrStatusSummary(
    @Headers('x-agent-token') agentToken: string,
    @Query('mukellef') mukellefFilter?: string,
  ) {
    const tenantId = await resolveTenantFromAgentToken(agentToken, this.prisma as any);

    const where: any = { session: { tenantId } };
    if (mukellefFilter) {
      where.session = {
        ...where.session,
        taxpayer: {
          OR: [
            { firstName: { contains: mukellefFilter, mode: 'insensitive' } },
            { lastName: { contains: mukellefFilter, mode: 'insensitive' } },
            { companyName: { contains: mukellefFilter, mode: 'insensitive' } },
          ],
        },
      };
    }

    const [statusCounts, belgeTipiCounts, needsReviewSamples] = await Promise.all([
      (this.prisma as any).receiptImage.groupBy({
        by: ['ocrStatus'],
        where,
        _count: { id: true },
      }),
      (this.prisma as any).receiptImage.groupBy({
        by: ['ocrBelgeTipi', 'ocrStatus'],
        where: { ...where, ocrStatus: { in: ['NEEDS_REVIEW', 'FAILED', 'LOW_CONFIDENCE'] } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 20,
      }),
      (this.prisma as any).receiptImage.findMany({
        where: { ...where, ocrStatus: { in: ['NEEDS_REVIEW', 'FAILED'] } },
        select: {
          id: true, ocrStatus: true, ocrBelgeTipi: true, ocrBelgeNo: true,
          ocrDate: true, ocrKdvTutari: true, originalName: true,
          session: { select: { periodLabel: true, taxpayer: { select: { firstName: true, lastName: true, companyName: true } } } },
        },
        orderBy: { uploadedAt: 'desc' },
        take: 30,
      }),
    ]);

    return { statusCounts, belgeTipiCounts, needsReviewSamples };
  }

  /** Belirli bir görsel için raw OCR text'i döndürür — parser debug için */
  @Get('raw-ocr/:imageId')
  async rawOcrText(
    @Headers('x-agent-token') agentToken: string,
    @Param('imageId') imageId: string,
  ) {
    const tenantId = await resolveTenantFromAgentToken(agentToken, this.prisma as any);
    const img = await (this.prisma as any).receiptImage.findFirst({
      where: { id: imageId, session: { tenantId } },
      select: { id: true, s3Key: true, originalName: true, ocrStatus: true, ocrBelgeTipi: true, ocrRawText: true },
    });
    if (!img) return { error: 'bulunamadı' };
    return { id: img.id, originalName: img.originalName, ocrStatus: img.ocrStatus, ocrBelgeTipi: img.ocrBelgeTipi, rawText: img.ocrRawText };
  }
}
