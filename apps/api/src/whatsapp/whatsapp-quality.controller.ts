import { Body, Controller, Get, ForbiddenException, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { QualityLogService } from './quality-log.service';
import { BotTestRunnerService } from './bot-test-runner.service';

@Controller('whatsapp/quality')
@UseGuards(AuthGuard('jwt'))
export class WhatsAppQualityController {
  constructor(
    private readonly quality: QualityLogService,
    private readonly tests: BotTestRunnerService,
  ) {}

  @Get('summary')
  summary(@Req() req: any) {
    return this.quality.summary(req.user.tenantId);
  }

  @Get('logs')
  logs(@Req() req: any, @Query('status') status?: string, @Query('limit') limit?: string) {
    return this.quality.logs(req.user.tenantId, status, Number(limit || 50));
  }

  @Post('feedback')
  feedback(@Req() req: any, @Body() body: any) {
    return this.quality.feedback(req.user.tenantId, req.user.sub, body);
  }

  @Post('test/run-now')
  runNow(@Req() req: any) {
    this.assertAdmin(req.user);
    return this.tests.runNow(req.user.tenantId);
  }

  @Get('test/last-results')
  lastResults(@Req() req: any, @Query('limit') limit?: string) {
    return this.quality.lastTestResults(req.user.tenantId, Number(limit || 60));
  }

  @Get('improvement-report')
  improvementReport(@Req() req: any) {
    return this.quality.weeklyImprovementReport(req.user.tenantId);
  }

  private assertAdmin(user: any) {
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    if (!roles.includes('ADMIN')) throw new ForbiddenException('Bu islem icin ADMIN yetkisi gerekir');
  }
}
