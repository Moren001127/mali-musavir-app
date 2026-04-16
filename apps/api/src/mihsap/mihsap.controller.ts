import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Req,
  Headers,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MihsapService } from './mihsap.service';

@Controller('agent/mihsap')
export class MihsapController {
  constructor(private readonly service: MihsapService) {}

  /** Tenant'ı agent token'dan çöz (eklenti kullanımı için) */
  private resolveTenantFromAgentToken(token?: string): string {
    if (!token) throw new UnauthorizedException('Missing X-Agent-Token');
    const raw = process.env.AGENT_INGEST_TOKENS || '';
    const map: Record<string, string> = {};
    for (const pair of raw.split(',')) {
      const [tid, tok] = pair.split(':');
      if (tid && tok) map[tok.trim()] = tid.trim();
    }
    const tenantId = map[token.trim()];
    if (!tenantId) throw new UnauthorizedException('Invalid agent token');
    return tenantId;
  }

  /** Eklenti MIHSAP token'ını gönderir (X-Agent-Token ile kimlik doğrulama) */
  @Post('token')
  async saveToken(
    @Headers('x-agent-token') agentToken: string,
    @Body() body: { token: string; email?: string },
  ) {
    if (!body?.token) throw new BadRequestException('token gerekli');
    const tenantId = this.resolveTenantFromAgentToken(agentToken);
    await this.service.saveToken(
      tenantId,
      body.token,
      body.email,
      'extension',
    );
    return { ok: true };
  }

  /** Mevcut MIHSAP bağlantı durumu */
  @Get('session')
  @UseGuards(AuthGuard('jwt'))
  async session(@Req() req: any) {
    const s = await this.service.getSession(req.user.tenantId);
    return s || { connected: false };
  }

  /** MIHSAP'tan toplu fatura çek + storage + DB */
  @Post('fetch')
  @UseGuards(AuthGuard('jwt'))
  async fetch(
    @Req() req: any,
    @Body()
    body: {
      mukellefId: string;
      mukellefMihsapId: string;
      donem: string; // "2026-03"
      faturaTuru?: 'ALIS' | 'SATIS';
      forceRefresh?: boolean;
    },
  ) {
    if (!body?.mukellefId || !body?.mukellefMihsapId || !body?.donem) {
      throw new BadRequestException('mukellefId, mukellefMihsapId ve donem gerekli');
    }
    return this.service.fetchAndStoreInvoices({
      tenantId: req.user.tenantId,
      mukellefId: body.mukellefId,
      mukellefMihsapId: body.mukellefMihsapId,
      donem: body.donem,
      faturaTuru: body.faturaTuru,
      forceRefresh: body.forceRefresh,
      createdBy: req.user.userId,
    });
  }

  /** Panelden indirilmiş faturaları listele */
  @Get('invoices')
  @UseGuards(AuthGuard('jwt'))
  async list(
    @Req() req: any,
    @Query('mukellefId') mukellefId?: string,
    @Query('donem') donem?: string,
    @Query('faturaTuru') faturaTuru?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listStoredInvoices({
      tenantId: req.user.tenantId,
      mukellefId,
      donem,
      faturaTuru,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /** Fatura download URL */
  @Get('invoices/:id/download')
  @UseGuards(AuthGuard('jwt'))
  async download(@Req() req: any, @Param('id') id: string) {
    const url = await this.service.getInvoiceDownloadUrl(req.user.tenantId, id);
    if (!url) return { error: 'dosya bulunamadı' };
    return { url };
  }

  /** Son çekme job'larını listele */
  @Get('jobs')
  @UseGuards(AuthGuard('jwt'))
  async jobs(@Req() req: any, @Query('limit') limit?: string) {
    return this.service.listFetchJobs(req.user.tenantId, limit ? parseInt(limit, 10) : undefined);
  }
}
