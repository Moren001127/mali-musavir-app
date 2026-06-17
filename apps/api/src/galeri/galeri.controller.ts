import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, Req, Header, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
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

  // ── SUNUCU (Railway) HGS SORGU ─────────────────────
  /**
   * Faz 0 — KGM sunucu testi. Tek plakayı sunucudan KGM'de sorgular (GİB girişi gerekmez).
   * Sonuç: portal-otomasyon işleri listesinde job.result.kgmUlasildi.
   */
  @Post('kgm-sunucu-test')
  kgmSunucuTest(@Req() req: any, @Body() body: { plaka: string }) {
    return this.svc.kgmSunucuTest(req.user.tenantId, req.user.userId, body?.plaka);
  }

  /**
   * Tam akış — sunucu HGS sorgusu. Dijital Vergi Dairesi'nden plakaları çekip sorgular,
   * sonucu WhatsApp'tan iki sabit numaraya gönderir. Local agent gerekmez.
   */
  @Post('sunucu-sorgu-baslat')
  baslatSunucuSorgu(@Req() req: any, @Body() body: { taxpayerId: string }) {
    return this.svc.baslatSunucuSorgu(req.user.tenantId, req.user.userId, {
      taxpayerId: body?.taxpayerId,
    });
  }

  // ── HGS SONUÇ ALICI NUMARALARI ─────────────────────
  /** HGS sonuç özetinin gönderileceği WhatsApp numaraları (ofis bazlı). */
  @Get('hgs-alicilar')
  async getHgsAlicilar(@Req() req: any) {
    const numaralar = await this.svc.getHgsAliciNumaralar(req.user.tenantId);
    return { numaralar };
  }

  /** Numara listesini kaydet. */
  @Put('hgs-alicilar')
  setHgsAlicilar(@Req() req: any, @Body() body: { numaralar?: string[] }) {
    return this.svc.setHgsAliciNumaralar(req.user.tenantId, body?.numaralar || []);
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
  @Header('Content-Type', 'text/html; charset=utf-8')
  async pdfRapor(
    @Req() req: any,
    @Query('sadeceIhlalli') sadeceIhlalli?: string,
  ): Promise<string> {
    return this.pdfSvc.topluRaporHtml(req.user.tenantId, {
      sadeceIhlalli: sadeceIhlalli === 'true',
    });
  }
}
