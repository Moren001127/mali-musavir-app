import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AutomationStatus } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AutomationParserService } from './automation-parser.service';
import { AutomationRunnerService } from './automation-runner.service';
import { AutomationsService } from './automations.service';
import { ParsePromptDto } from './dto/parse-prompt.dto';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { ListAutomationsQueryDto } from './dto/list-automations-query.dto';
import { AutomationStatusDto, UpdateAutomationDto } from './dto/update-automation.dto';
import { AUTOMATION_ACTION_CATALOG } from './action-catalog';

/**
 * REST API — Moren AI Otomasyon Motoru, Faz 1+2+3.
 *
 * Tüm endpoint'ler JWT ile korunur ve tenant izolasyonu uygulanır.
 * req.user.tenantId ve req.user.sub auth modülünden gelir.
 */
@Controller('automations')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AutomationsController {
  constructor(
    private automationsService: AutomationsService,
    private parserService: AutomationParserService,
    private runner: AutomationRunnerService,
  ) {}

  // ---------------------------------------------------------------
  // FAZ 2 ENDPOINT'LERİ
  // ---------------------------------------------------------------

  // POST /automations/parse  — cümleden öneri üret (KAYDETMEZ)
  @Post('parse')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  parse(@Body() dto: ParsePromptDto) {
    return this.parserService.parse(dto.prompt);
  }

  // GET /automations/summary  — tenant geneli istatistikler (üst bant)
  @Get('summary')
  summary(@Req() req: any) {
    return this.automationsService.summary(req.user.tenantId);
  }

  // GET /automations/recent-runs  — tüm otomasyonlardan son çalışmalar feed'i
  @Get('recent-runs')
  recentRuns(@Req() req: any, @Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : undefined;
    return this.automationsService.listRecentRuns(req.user.tenantId, parsed);
  }

  // POST /automations/:id/duplicate  — yeni DRAFT olarak çoğalt
  @Post(':id/duplicate')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.CREATED)
  duplicate(@Req() req: any, @Param('id') id: string) {
    return this.automationsService.duplicate(req.user.tenantId, req.user.sub, id);
  }

  // GET /automations/catalog  — UI'ın "Yeni Otomasyon" sayfasında örnek/kategori için
  @Get('catalog')
  getCatalog() {
    return AUTOMATION_ACTION_CATALOG.map((a) => ({
      name: a.name,
      category: a.category,
      description: a.description.slice(0, 200),
      estimatedClaudeCostPerCall: a.estimatedClaudeCostPerCall,
    }));
  }

  // ---------------------------------------------------------------
  // FAZ 1 CRUD ENDPOINT'LERİ
  // ---------------------------------------------------------------

  // GET /automations?status=ACTIVE&triggerType=CRON&search=KDV&page=1&pageSize=20
  @Get()
  list(@Req() req: any, @Query() query: ListAutomationsQueryDto) {
    return this.automationsService.list(req.user.tenantId, query);
  }

  // GET /automations/:id
  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.automationsService.findOne(req.user.tenantId, id);
  }

  // GET /automations/:id/runs
  @Get(':id/runs')
  listRuns(@Req() req: any, @Param('id') id: string, @Query('limit') limit?: string) {
    const parsed = limit ? parseInt(limit, 10) : undefined;
    return this.automationsService.listRuns(req.user.tenantId, id, parsed);
  }

  // GET /automations/runs/:runId  — tek bir run'ın detayı (step logları dahil)
  @Get('runs/:runId')
  getRun(@Req() req: any, @Param('runId') runId: string) {
    return this.automationsService.getRun(req.user.tenantId, runId);
  }

  // POST /automations
  @Post()
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: any, @Body() dto: CreateAutomationDto) {
    return this.automationsService.create(req.user.tenantId, req.user.sub, dto);
  }

  // PATCH /automations/:id
  @Patch(':id')
  @Roles('ADMIN', 'STAFF')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateAutomationDto) {
    return this.automationsService.update(req.user.tenantId, id, dto);
  }

  // PATCH /automations/:id/status  — duraklat / aktive et / arşivle
  @Patch(':id/status')
  @Roles('ADMIN', 'STAFF')
  setStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body('status') status: AutomationStatusDto,
  ) {
    return this.automationsService.setStatus(
      req.user.tenantId,
      id,
      status as unknown as AutomationStatus,
    );
  }

  // DELETE /automations/:id  — yumuşak silme (ARCHIVED)
  @Delete(':id')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  archive(@Req() req: any, @Param('id') id: string) {
    return this.automationsService.archive(req.user.tenantId, id);
  }

  // DELETE /automations/:id/hard  — sadece DRAFT için sert silme
  @Delete(':id/hard')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  hardDelete(@Req() req: any, @Param('id') id: string) {
    return this.automationsService.hardDelete(req.user.tenantId, id);
  }

  // ---------------------------------------------------------------
  // FAZ 3 — ÇALIŞTIRMA ENDPOINT'LERİ
  // ---------------------------------------------------------------

  // POST /automations/:id/run  — manuel "Şimdi Çalıştır"
  @Post(':id/run')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.ACCEPTED)
  async runNow(@Req() req: any, @Param('id') id: string) {
    // Önce tenant kontrolü
    await this.automationsService.findOne(req.user.tenantId, id);
    // Background'da çalıştır — istemciye hemen run id döner
    const result = await this.runner.enqueueAutomation(id, {
      source: 'manual',
      userId: req.user.sub,
      firedAt: new Date().toISOString(),
    }, { requireActive: true });
    return result;
  }

  // POST /automations/:id/dry-run  — gerçek aksiyon yapmadan adımları logla
  @Post(':id/dry-run')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  async dryRun(@Req() req: any, @Param('id') id: string) {
    await this.automationsService.findOne(req.user.tenantId, id);
    return this.runner.enqueueAutomation(
      id,
      { source: 'dry-run', userId: req.user.sub, firedAt: new Date().toISOString() },
      { dryRun: true },
    );
  }
}
