import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditService } from './audit.service';

/**
 * Audit log okuma API'si — sadece ADMIN.
 * Yazma: AuditInterceptor otomatik yapıyor (her POST/PUT/PATCH/DELETE için).
 */
@Controller('audit-logs')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(
    @Req() req: any,
    @Query('userId') userId?: string,
    @Query('resource') resource?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit = 100,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset = 0,
  ) {
    return this.auditService.list({
      tenantId: req.user.tenantId,
      userId: userId || undefined,
      resource: resource || undefined,
      action: action || undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      search: search || undefined,
      limit,
      offset,
    });
  }

  @Get('facets')
  getFacets(@Req() req: any) {
    return this.auditService.getFacets(req.user.tenantId);
  }

  @Get('daily-stats')
  getDailyStats(
    @Req() req: any,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days = 30,
  ) {
    return this.auditService.getDailyStats(req.user.tenantId, days);
  }
}
