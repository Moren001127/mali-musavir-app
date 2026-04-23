import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Req,
  Res,
  Headers,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
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
    @Query('belgeTuru') belgeTuru?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listStoredInvoices({
      tenantId: req.user.tenantId,
      mukellefId,
      donem,
      faturaTuru,
      belgeTuru,
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

  /**
   * Canlı akış log'undan "Görsel" butonu için — belgeNo ile invoice bul.
   * Log'da belgeNo + mukellef adı var; frontend bu endpoint'le MihsapInvoice
   * tablosunda o faturayı bulur ve /mihsap/invoices/:id/file ile gösterir.
   */
  @Get('invoices/find')
  @UseGuards(AuthGuard('jwt'))
  async findByBelgeNo(
    @Req() req: any,
    @Query('belgeNo') belgeNo: string,
    @Query('mukellefId') mukellefId?: string,
  ) {
    if (!belgeNo) return { id: null };
    const found = await this.service.findInvoiceByBelgeNo(
      req.user.tenantId,
      belgeNo,
      mukellefId,
    );
    return { id: found?.id || null, storageUrl: found?.storageUrl || null };
  }

  /** DEBUG — bir faturanın tüm DB alanlarını ve MIHSAP ham payload'unu döndürür.
   *  Hangi tarih alanı "kabul tarihi"dir onu tespit için. */
  @Get('invoices/:id/raw')
  @UseGuards(AuthGuard('jwt'))
  async raw(@Req() req: any, @Param('id') id: string) {
    return this.service.getInvoiceRaw(req.user.tenantId, id);
  }

  /** Fatura dosyası proxy — CORS olmadan binary stream eder */
  @Get('invoices/:id/file')
  @UseGuards(AuthGuard('jwt'))
  async file(@Req() req: any, @Param('id') id: string, @Res() res: any) {
    const data = await this.service.getInvoiceFile(req.user.tenantId, id);
    if (!data) throw new NotFoundException('Dosya bulunamadı');
    res.set({
      'Content-Type': data.contentType,
      'Content-Disposition': `inline; filename="${data.filename}"`,
      'Content-Length': String(data.buffer.length),
      'Cache-Control': 'private, max-age=3600',
    });
    return res.send(data.buffer);
  }

  /**
   * Toplu yazdırma — dönem + ALIS/SATIS için SADECE fatura (e-Fatura/e-Arşiv)
   * belgelerini tek HTML sayfasında birleştirir. Fiş ve Z raporları HARİÇ.
   * Frontend bu response'u yeni sekmede açar → sayfa otomatik window.print() tetikler.
   */
  @Get('invoices/toplu-yazdir')
  @UseGuards(AuthGuard('jwt'))
  async topluYazdir(
    @Req() req: any,
    @Res() res: any,
    @Query('donem') donem: string,
    @Query('faturaTuru') faturaTuru: 'ALIS' | 'SATIS',
    @Query('mukellefId') mukellefId?: string,
  ) {
    if (!donem) throw new BadRequestException('donem gerekli (2026-03)');
    if (faturaTuru !== 'ALIS' && faturaTuru !== 'SATIS') {
      throw new BadRequestException('faturaTuru ALIS veya SATIS olmalı');
    }
    const { html, count, skipped } = await this.service.buildBulkPrintHtml({
      tenantId: req.user.tenantId,
      mukellefId,
      donem,
      faturaTuru,
    });
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Print-Count': String(count),
      'X-Print-Skipped': String(skipped),
    });
    return res.send(html);
  }

  /** Son çekme job'larını listele */
  @Get('jobs')
  @UseGuards(AuthGuard('jwt'))
  async jobs(@Req() req: any, @Query('limit') limit?: string) {
    return this.service.listFetchJobs(req.user.tenantId, limit ? parseInt(limit, 10) : undefined);
  }
}
