import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AiCostService } from './ai-cost.service';

/**
 * AI maliyet özeti — tek ekran, gerçek AiUsageLog verisi, modül bazında.
 * GET /ai-cost/summary?month=YYYY-MM  (month opsiyonel, varsayılan içinde bulunulan ay)
 */
@Controller('ai-cost')
@UseGuards(AuthGuard('jwt'))
export class AiCostController {
  constructor(private readonly aiCost: AiCostService) {}

  @Get('summary')
  async summary(@Req() req: any, @Query('month') month?: string) {
    return this.aiCost.summary(req.user.tenantId, month);
  }
}
