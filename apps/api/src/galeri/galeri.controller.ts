import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GaleriService } from './galeri.service';
import { PdfRaporService } from './pdf-rapor.service';

@Controller('galeri')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class GaleriController {
  constructor(
    private svc: GaleriService,
    private pdfSvc: PdfRaporService,
  ) {}

  // ── ARAÇLAR ───────────────────────────────────────
  @Get('araclar')
  listAraclar(@Req() req: any, @Query('search') search?: string, @Query('aktif') aktif?: string) {
    return this.svc.listAraclar(req.user.tenantId, {
      search,
      aktif: aktif === 'true' ? true : aktif === 'false' ? false : undefined,
    });
  }

  @Post('araclar')
  createArac(@Req() req: any, @Body() body: any) {
    return this.svc.createArac(req.user.tenantId, body);
  }

  @Put('araclar/:id')
  updateArac(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.updateArac(req.user.tenantId, id, body);
  }

  @Delete('araclar/:id')
  deleteArac(@Req() req: any, @Param('id') id: string) {
    return this.svc.deleteArac(req.user.tenantId, id);
  }

  // ── HGS SORGU ────────────────────────────────────
  @Get('araclar/:id/hgs-sorgu-gecmisi')
  sorguGecmisi(@Req() req: any, @Param('id') id: string) {
    return this.svc.listSorguGecmisi(req.user.tenantId, id);
  }

  @Post('araclar/:id/hgs-sorgu-sonuc')
  kaydetSorguSonucu(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.svc.kaydetSorguSonucu(req.user.tenantId, id, body);
  }

  @Get('ozet')
  ozet(@Req() req: any) {
    return this.svc.ozet(req.user.tenantId);
  }

  // ── TOPLU OTOMATIK SORGU ───────────────────────────
  /**
   * Portal UI'dan tetiklenir — "🔄 Toplu Sorgu Başlat" butonu.
   * AgentCommand tablosuna 'hgs'-'toplu-sorgu' komutu yazar;
   * local hgs-agent bu komutu /agent/commands/claim ile alıp çalıştırır.
   */
  @Post('toplu-sorgu-baslat')
  baslatTopluSorgu(
    @Req() req: any,
    @Body() body: { aracIds?: string[]; sadeceAktif?: boolean },
  ) {
    return this.svc.baslatTopluSorgu(req.user.tenantId, req.user.userId, {
      aracIds: body?.aracIds,
      sadeceAktif: body?.sadeceAktif !== false, // varsayılan true
    });
  }

  /** Canlı agent durumu (son ping, çalışıyor mu, aktif komut var mı) */
  @Get('agent-durumu')
  agentDurumu(@Req() req: any) {
    return this.svc.agentDurumu(req.user.tenantId);
  }

  /** Aktif/son toplu sorgu kuyruğundaki komutlar */
  @Get('komut-kuyrugu')
  komutKuyrugu(@Req() req: any) {
    return this.svc.komutKuyrugu(req.user.tenantId);
  }

  // ── PDF RAPOR (Selim Motors logolu, print-optimize HTML) ──
  /**
   * Browser'da açılır, "Ctrl+P → PDF olarak kaydet" ile arşivlenir.
   * Plaka gruplu tablo + her plakanın alt toplamı + genel toplam.
   */
  @Get('pdf-rapor')
  async pdfRapor(
    @Req() req: any,
    @Res() res: Response,
    @Query('sadeceIhlalli') sadeceIhlalli?: string,
  ) {
    const html = await this.pdfSvc.topluRaporHtml(req.user.tenantId, {
      sadeceIhlalli: sadeceIhlalli === 'true',
    });
    res.type('html').send(html);
  }
}
