import {
  Controller, Get, Post, Body, Param, Query, Req, Res,
  UseGuards, UseInterceptors, UploadedFile, Headers,
  HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { EarsivService, EarsivTip, BelgeKaynak } from './earsiv.service';
import { LucaService } from '../luca/luca.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class EarsivController {
  constructor(
    private readonly earsiv: EarsivService,
    private readonly luca: LucaService,
    private readonly prisma: PrismaService,
  ) {}

  // === PORTAL UI ENDPOINTS (JWT) ===

  @Post('earsiv/fetch-from-luca')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  async fetchFromLuca(
    @Req() req: any,
    @Body() body: { mukellefId: string; donem: string; tip: EarsivTip; belgeKaynak?: BelgeKaynak },
  ) {
    if (!body?.mukellefId || !body?.donem || !body?.tip) {
      throw new BadRequestException('mukellefId, donem ve tip gerekli');
    }
    if (body.tip !== 'SATIS' && body.tip !== 'ALIS') {
      throw new BadRequestException('tip SATIS veya ALIS olmalı');
    }
    const belgeKaynak: BelgeKaynak = body.belgeKaynak || 'EARSIV';
    if (belgeKaynak !== 'EFATURA' && belgeKaynak !== 'EARSIV') {
      throw new BadRequestException('belgeKaynak EFATURA veya EARSIV olmalı');
    }
    // Job tip: EARSIV_SATIS | EARSIV_ALIS | EFATURA_SATIS | EFATURA_ALIS
    const jobTip = `${belgeKaynak}_${body.tip}`;
    // Mükellef adını al (Luca SirketCombo'da text-based eşleşme için)
    const taxpayer = await (this.prisma as any).taxpayer.findFirst({
      where: { id: body.mukellefId, tenantId: req.user.tenantId },
      select: { firstName: true, lastName: true, companyName: true },
    });
    const mukellefAdi =
      taxpayer?.companyName ||
      [taxpayer?.firstName, taxpayer?.lastName].filter(Boolean).join(' ') ||
      '';

    const job = await this.luca.createFetchJob({
      tenantId: req.user.tenantId,
      sessionId: undefined as any,
      mukellefId: body.mukellefId,
      donem: body.donem,
      tip: jobTip,
      createdBy: req.user.id,
      mukellefAdi,
    });
    return { jobId: job.id, status: job.status };
  }

  @Get('earsiv/luca-job/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  async getLucaJob(@Req() req: any, @Param('id') id: string) {
    const job = await this.luca.getJob(id, req.user.tenantId);
    return { job };
  }

  @Get('earsiv/list')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  async list(
    @Req() req: any,
    @Query('taxpayerId') taxpayerId?: string,
    @Query('donem') donem?: string,
    @Query('tip') tip?: EarsivTip,
    @Query('belgeKaynak') belgeKaynak?: BelgeKaynak,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.earsiv.list({
      tenantId: req.user.tenantId,
      taxpayerId, donem, tip, belgeKaynak, search,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? Math.min(parseInt(pageSize, 10), 200) : 50,
    });
  }

  @Get('earsiv/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  async getOne(@Req() req: any, @Param('id') id: string) {
    return this.earsiv.getById(req.user.tenantId, id);
  }

  @Post('earsiv/download-bulk')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  async downloadBulk(
    @Req() req: any,
    @Body() body: { ids: string[] },
    @Res() res: Response,
  ) {
    const buf = await this.earsiv.downloadBulkZip(req.user.tenantId, body?.ids || []);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="earsiv-${Date.now()}.zip"`);
    res.send(buf);
  }

  /**
   * Manuel ZIP yükleme — kullanıcı kendi indirdiği Luca e-arşiv ZIP'ini portala yükler.
   * Agent endpoint'i ile aynı parser'ı kullanır, sadece auth JWT.
   */
  @Post('earsiv/upload-zip')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } }))
  async uploadZipManual(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { taxpayerId: string; donem: string; tip: EarsivTip; belgeKaynak?: BelgeKaynak },
  ) {
    if (!file) throw new BadRequestException('ZIP dosyası gerekli (field: file)');
    if (!body?.taxpayerId || !body?.donem || !body?.tip) {
      throw new BadRequestException('taxpayerId, donem ve tip gerekli');
    }
    if (body.tip !== 'SATIS' && body.tip !== 'ALIS') {
      throw new BadRequestException('tip SATIS veya ALIS olmalı');
    }
    const belgeKaynak: BelgeKaynak = body.belgeKaynak || 'EARSIV';
    return this.earsiv.importFromZip({
      tenantId: req.user.tenantId,
      taxpayerId: body.taxpayerId,
      donem: body.donem,
      tip: body.tip,
      belgeKaynak,
      zipBuffer: file.buffer,
    });
  }

  // === AGENT ENDPOINTS (X-Agent-Token) ===

  @Post('agent/luca/earsiv/upload-zip')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } }))
  async uploadZipFromAgent(
    @Headers('x-agent-token') agentToken: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('mukellefId') mukellefId: string,
    @Query('donem') donem: string,
    @Query('tip') tipQuery: string,
    @Query('belgeKaynak') belgeKaynakQuery?: string,
    @Query('jobId') jobId?: string,
  ) {
    if (!file) throw new BadRequestException('ZIP dosyası gerekli (field: file)');
    if (!mukellefId || !donem) throw new BadRequestException('mukellefId ve donem gerekli');
    const tip = tipQuery === 'ALIS' ? 'ALIS' : 'SATIS';
    const belgeKaynak: BelgeKaynak = belgeKaynakQuery === 'EFATURA' ? 'EFATURA' : 'EARSIV';

    const tenantId = await this.resolveTenantFromAgentToken(agentToken);

    const result = await this.earsiv.importFromZip({
      tenantId,
      taxpayerId: mukellefId,
      donem,
      tip: tip as EarsivTip,
      belgeKaynak,
      fetchJobId: jobId,
      zipBuffer: file.buffer,
    });

    if (jobId) {
      await this.luca.markJobDone(jobId, result.inserted).catch(() => {});
    }
    return { ok: true, ...result };
  }

  // === Helpers ===

  private async resolveTenantFromAgentToken(agentToken: string): Promise<string> {
    if (!agentToken) throw new BadRequestException('X-Agent-Token gerekli');
    const t = (agentToken || '').trim();
    const tenant = await (this.prisma as any).tenant.findFirst({
      where: { OR: [{ slug: t }, { id: t }] },
      select: { id: true },
    });
    if (!tenant) throw new BadRequestException('Geçersiz X-Agent-Token');
    return tenant.id;
  }
}
