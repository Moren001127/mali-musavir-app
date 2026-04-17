import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LucaService } from './luca.service';
import { LucaAutoScraperService } from './luca-auto-scraper.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Luca entegrasyon controller'ı.
 *
 * İki yol:
 *  A) /luca/* — portal kullanıcıları için (JWT korumalı, UI'dan gelir)
 *  B) /agent/luca/* — tarayıcı eklentisi/runner için (X-Agent-Token korumalı)
 */
@Controller()
export class LucaController {
  constructor(
    private readonly luca: LucaService,
    private readonly autoScraper: LucaAutoScraperService,
    private readonly prisma: PrismaService,
  ) {}

  // ==================== LUCA CREDENTIAL (AUTO SCRAPER) ====================

  /** Luca hesap bilgisinin kayıtlı olup olmadığını döndür */
  @Get('luca/credential')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  getCredential(@Req() req: any) {
    return this.autoScraper.getCredentialStatus(req.user.tenantId);
  }

  /** Luca username + password kaydet (AES-GCM ile şifrelenmiş) */
  @Post('luca/credential')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  async saveCredential(
    @Req() req: any,
    @Body() body: { username: string; password: string },
  ) {
    if (!body?.username || !body?.password) {
      throw new BadRequestException('Kullanıcı adı ve şifre zorunlu');
    }
    return this.autoScraper.saveCredential(
      req.user.tenantId,
      body.username.trim(),
      body.password,
      req.user.sub,
    );
  }

  /** Kayıtlı Luca hesabını sil */
  @Delete('luca/credential')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCredential(@Req() req: any) {
    await this.autoScraper.deleteCredential(req.user.tenantId);
  }

  /** Luca'ya login denemesi yap — UI'daki "Bağlantıyı Test Et" butonu */
  @Post('luca/credential/test')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  async testCredential(@Req() req: any) {
    return this.autoScraper.testLogin(req.user.tenantId);
  }

  // ==================== PORTAL UI → /luca/* ====================

  @Get('luca/session')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  async getSession(@Req() req: any) {
    return (await this.luca.getSession(req.user.tenantId)) || { connected: false };
  }

  @Delete('luca/session')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearSession(@Req() req: any) {
    await this.luca.clearSession(req.user.tenantId);
  }

  @Get('luca/jobs')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  listJobs(@Req() req: any) {
    return this.luca.listJobs(req.user.tenantId);
  }

  @Get('luca/jobs/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  getJob(@Req() req: any, @Param('id') id: string) {
    return this.luca.getJob(id, req.user.tenantId);
  }

  // ==================== RUNNER → /agent/luca/* ====================
  // NOT: X-Agent-Token doğrulaması için mevcut agent-events guard'ı kullanılır.
  // Yalnızca token'a sahip tarayıcı eklentisi bu endpoint'leri çağırabilir.
  // Basit bir tenant lookup ile tenantId çıkartılır (AgentEventsController
  // mevcut projedeki gibi davranır).

  @Post('agent/luca/token')
  @HttpCode(HttpStatus.OK)
  async syncToken(
    @Body() body: { token: string; cookies?: string; origin?: string; email?: string },
    @Headers('x-agent-token') agentToken: string,
  ) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    await this.luca.saveToken(tenantId, body, 'extension');
    return { ok: true };
  }

  @Get('agent/luca/jobs/pending')
  async pendingJobs(@Headers('x-agent-token') agentToken: string) {
    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    return this.luca.pendingJobsForAgent(tenantId);
  }

  @Post('agent/luca/jobs/:id/start')
  @HttpCode(HttpStatus.OK)
  async startJob(
    @Param('id') id: string,
    @Headers('x-agent-token') agentToken: string,
  ) {
    await this.resolveTenantFromAgentToken(agentToken);
    await this.luca.markJobRunning(id);
    return { ok: true };
  }

  @Post('agent/luca/jobs/:id/done')
  @HttpCode(HttpStatus.OK)
  async finishJob(
    @Param('id') id: string,
    @Body() body: { recordCount?: number },
    @Headers('x-agent-token') agentToken: string,
  ) {
    await this.resolveTenantFromAgentToken(agentToken);
    await this.luca.markJobDone(id, body.recordCount ?? 0);
    return { ok: true };
  }

  @Post('agent/luca/jobs/:id/fail')
  @HttpCode(HttpStatus.OK)
  async failJob(
    @Param('id') id: string,
    @Body() body: { error: string },
    @Headers('x-agent-token') agentToken: string,
  ) {
    await this.resolveTenantFromAgentToken(agentToken);
    await this.luca.markJobFailed(id, body.error || 'bilinmeyen hata');
    return { ok: true };
  }

  // --------------------------------------------------------------
  // Agent token'dan tenantId çöz — mevcut agent-events desenini takip eder.
  // Proje gerçek implementasyonunda AgentEventsService/Guard merkezi;
  // buraya aynı logic'i koymak yerine uygun servisi inject edebilirsiniz.
  // --------------------------------------------------------------
  private async resolveTenantFromAgentToken(token?: string): Promise<string> {
    if (!token) throw new ForbiddenException('Agent token eksik');
    // Basit eşleşme: tenant.slug === token (mevcut agent desenine uygun)
    // Gerçek projede AgentToken tablosu / hash kullanılır.
    const tenant = await (this.prisma as any).tenant.findFirst({
      where: {
        OR: [{ slug: token }, { id: token }],
      },
    });
    if (!tenant) throw new ForbiddenException('Agent token geçersiz');
    return tenant.id;
  }
}
