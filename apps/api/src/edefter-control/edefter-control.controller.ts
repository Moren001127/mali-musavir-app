import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { LucaService } from '../luca/luca.service';
import { PrismaService } from '../prisma/prisma.service';
import { EDefterControlService, EDefterDonemTipi } from './edefter-control.service';
import { resolveTenantFromAgentToken as resolveAgentTenant } from '../common/agent-token';

@Controller()
export class EDefterControlController {
  constructor(
    private readonly service: EDefterControlService,
    private readonly luca: LucaService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('edefter-control')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  list(@Req() req: any, @Query('taxpayerId') taxpayerId?: string) {
    return this.service.listSessions(req.user.tenantId, taxpayerId);
  }

  @Get('edefter-control/luca-job/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  async getLucaJob(@Req() req: any, @Param('id') id: string) {
    let job = await this.luca.getJob(id, req.user.tenantId);
    if (
      job.status === 'pending' &&
      job.tip === 'EDEFTER_FIS_LISTESI' &&
      /^DEV-/i.test(String(job.targetDeviceId || ''))
    ) {
      await (this.prisma as any).lucaFetchJob.updateMany({
        where: { id: job.id, tenantId: req.user.tenantId, status: 'pending' },
        data: {
          targetDeviceId: null,
          preferredAgent: 'local-node',
        },
      });
      await this.luca
        .appendJobLog(job.id, 'e-Defter isi Chrome sekmesine kilitlenmisti; local Luca ajanina yonlendirildi')
        .catch(() => undefined);
      job = await this.luca.getJob(id, req.user.tenantId);
    }

    let session: any = null;
    if (job.status === 'done') {
      session = await (this.prisma as any).eDefterControlSession.findFirst({
        where: {
          tenantId: req.user.tenantId,
          taxpayerId: job.mukellefId,
          donem: job.donem,
        },
        orderBy: { createdAt: 'desc' },
      });
    }
    const mizanJob = await (this.prisma as any).lucaFetchJob.findFirst({
      where: {
        tenantId: req.user.tenantId,
        mukellefId: job.mukellefId,
        donem: job.donem,
        tip: 'MIZAN',
        sessionId: job.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    const mizan = await this.service.findCompanionMizan(
      req.user.tenantId,
      job.mukellefId,
      job.donem,
      job.donemTipi,
      `edefter-control:${job.id}`,
    );
    return { job, session, mizanJob, mizan };
  }

  @Get('edefter-control/rule-settings')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  getRuleSettings(@Req() req: any) {
    return this.service.getRuleSettings(req.user.tenantId);
  }

  @Patch('edefter-control/rule-settings/:code')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  updateRuleSetting(
    @Req() req: any,
    @Param('code') code: string,
    @Body() body: { active?: boolean },
  ) {
    if (typeof body?.active !== 'boolean') throw new BadRequestException('active boolean olmali');
    return this.service.setRuleSetting({
      tenantId: req.user.tenantId,
      code,
      active: body.active,
      userId: req.user.sub,
    });
  }

  @Get('edefter-control/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  getOne(@Req() req: any, @Param('id') id: string) {
    return this.service.getSession(id, req.user.tenantId);
  }

  @Post('edefter-control/fetch-from-luca')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  async fetchFromLuca(
    @Req() req: any,
    @Body()
    body: {
      mukellefId: string;
      donem: string;
      donemTipi?: EDefterDonemTipi;
      targetDeviceId?: string;
    },
  ) {
    if (!body?.mukellefId || !body?.donem) {
      throw new BadRequestException('mukellefId ve donem gerekli');
    }
    const jobs = await this.service.createFetchJob({
      tenantId: req.user.tenantId,
      mukellefId: body.mukellefId,
      donem: body.donem,
      donemTipi: body.donemTipi,
      targetDeviceId: body.targetDeviceId,
      createdBy: req.user.sub,
    });
    return {
      jobId: jobs.detailJob.id,
      mizanJobId: null,
      status: jobs.detailJob.status,
      mizanStatus: null,
    };
  }

  @Patch('edefter-control/:sessionId/findings/:findingId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  updateFindingStatus(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Param('findingId') findingId: string,
    @Body() body: { status?: 'OPEN' | 'RESOLVED' | 'IGNORED'; note?: string | null },
  ) {
    const status = body?.status;
    if (!status || !['OPEN', 'RESOLVED', 'IGNORED'].includes(status)) {
      throw new BadRequestException('status OPEN, RESOLVED veya IGNORED olmali');
    }
    return this.service.updateFindingStatus({
      tenantId: req.user.tenantId,
      sessionId,
      findingId,
      status,
      note: body?.note ?? null,
      userId: req.user.sub,
    });
  }

  @Post('edefter-control/:id/reanalyze')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  reanalyze(@Req() req: any, @Param('id') id: string) {
    return this.service.reanalyzeSession(id, req.user.tenantId);
  }

  @Get('edefter-control/:id/export.xlsx')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  async exportExcel(@Req() req: any, @Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.exportFindingsAsExcel(id, req.user.tenantId);
    const fileName = `edefter-bulgular-${id}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Post('edefter-control/upload')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }))
  uploadExcel(
    @Req() req: any,
    @Body() body: { taxpayerId: string; donem: string; donemTipi?: EDefterDonemTipi },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Excel dosyasi gerekli');
    if (!body.taxpayerId || !body.donem) throw new BadRequestException('taxpayerId ve donem zorunlu');
    return this.service.importFromExcel({
      tenantId: req.user.tenantId,
      taxpayerId: body.taxpayerId,
      donem: body.donem,
      donemTipi: body.donemTipi,
      buffer: file.buffer,
      createdBy: req.user.sub,
    });
  }

  @Post('agent/luca/runner/upload-edefter-fis-listesi')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }))
  async uploadFromRunner(
    @Headers('x-agent-token') agentToken: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('mukellefId') mukellefId: string,
    @Query('donem') donem: string,
    @Query('donemTipi') donemTipi?: EDefterDonemTipi,
    @Query('jobId') jobId?: string,
  ) {
    if (!file) throw new BadRequestException('Excel dosyasi gerekli (field: file)');
    if (!mukellefId || !donem) throw new BadRequestException('mukellefId ve donem query parametreleri gerekli');

    const tenantId = await this.resolveTenantFromAgentToken(agentToken);
    let sourceJob: any = null;
    if (jobId) {
      const job = await this.luca.getJob(jobId, tenantId).catch(() => null);
      if (!job) throw new BadRequestException('e-Defter upload reddedildi: job bulunamadi');
      if (job.tip !== 'EDEFTER_FIS_LISTESI') {
        throw new BadRequestException(`e-Defter upload reddedildi: job tipi ${job.tip}`);
      }
      if (job.mukellefId !== mukellefId) {
        throw new BadRequestException('e-Defter upload reddedildi: mukellef job ile uyusmuyor');
      }
      if (String(job.donem || '').replace('/', '-') !== String(donem || '').replace('/', '-')) {
        throw new BadRequestException('e-Defter upload reddedildi: donem job ile uyusmuyor');
      }
      sourceJob = job;
    }

    try {
      const result = await this.service.importFromExcel({
        tenantId,
        taxpayerId: mukellefId,
        donem,
        donemTipi,
        buffer: file.buffer,
        createdBy: jobId ? `edefter-control:${jobId}` : 'luca-agent',
      });
      const mizanJob = jobId
        ? await this.service
            .createCompanionMizanJob({
              tenantId,
              detailJobId: jobId,
              mukellefId,
              donem,
              donemTipi,
              targetDeviceId: sourceJob?.targetDeviceId,
              createdBy: sourceJob?.createdBy || 'luca-agent',
            })
            .catch((err: any) => {
              this.luca
                .appendJobLog(
                  jobId,
                  `e-Defter eslik eden mizan job olusturulamadi: ${err?.message || 'bilinmeyen'}`,
                )
                .catch(() => undefined);
              return null;
            })
        : null;
      if (jobId) await this.luca.markJobDone(jobId, result.rows).catch(() => undefined);
      return { ok: true, ...result, mizanJobId: mizanJob?.id || null };
    } catch (err: any) {
      if (jobId) await this.luca.markJobFailed(jobId, err?.message || 'bilinmeyen').catch(() => undefined);
      throw new BadRequestException(`e-Defter Detay Fis Listesi import hatasi: ${err?.message || 'bilinmeyen'}`);
    }
  }

  private async resolveTenantFromAgentToken(token?: string): Promise<string> {
    return resolveAgentTenant(token, this.prisma as any);
  }
}
