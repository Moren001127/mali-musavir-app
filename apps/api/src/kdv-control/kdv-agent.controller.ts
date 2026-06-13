import { Controller, Post, HttpCode, HttpStatus, Headers, Query } from '@nestjs/common';
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
}
