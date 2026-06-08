import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DriveService } from './drive.service';

@Controller('agent/drive')
export class DriveController {
  constructor(private readonly service: DriveService) {}

  /** Drive baglanti durumu (panel chip'i icin) */
  @Get('status')
  @UseGuards(AuthGuard('jwt'))
  async status(@Req() req: any) {
    return this.service.getStatus(req.user.tenantId);
  }

  /** Google izin ekrani URL'ini uretir — frontend window.location ile yonlendirir.
   *  origin: panelin adresi (state'e imzali gomulur, donus oraya yapilir). */
  @Get('oauth/start')
  @UseGuards(AuthGuard('jwt'))
  async oauthStart(@Req() req: any, @Query('origin') origin?: string) {
    return { url: this.service.buildAuthUrl(req.user.tenantId, origin) };
  }

  /** Google geri donus adresi (PUBLIC — Google tarayicidan yonlendirir, JWT yok).
   *  state imzasi tenantId + origin tasir; basari/hata panele yonlendirilir. */
  @Get('oauth/callback')
  async oauthCallback(
    @Res() res: any,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    if (error) {
      return res.redirect(
        this.service.safePanelUrl(this.service.originFromState(state), `?drive=error&msg=${encodeURIComponent(error)}`),
      );
    }
    if (!code || !state) {
      return res.redirect(
        this.service.safePanelUrl(this.service.originFromState(state), '?drive=error&msg=eksik_parametre'),
      );
    }
    try {
      const result = await this.service.handleCallback(code, state);
      return res.redirect(this.service.safePanelUrl(result.origin, '?drive=connected'));
    } catch (e: any) {
      return res.redirect(
        this.service.safePanelUrl(
          this.service.originFromState(state),
          `?drive=error&msg=${encodeURIComponent((e?.message || 'baglanti_hatasi').slice(0, 120))}`,
        ),
      );
    }
  }

  /** Drive baglantisini kes (yedek kutugu ve Drive dosyalari korunur) */
  @Post('disconnect')
  @UseGuards(AuthGuard('jwt'))
  async disconnect(@Req() req: any) {
    return this.service.disconnect(req.user.tenantId);
  }

  /** Manuel yedekleme baslat (donem + opsiyonel mukellef) */
  @Post('backup')
  @UseGuards(AuthGuard('jwt'))
  async backup(
    @Req() req: any,
    @Body() body: { mukellefId?: string; donem?: string },
  ) {
    const result = await this.service.startBackup({
      tenantId: req.user.tenantId,
      mukellefId: body?.mukellefId,
      donem: body?.donem,
      createdBy: req.user.userId,
    });
    if (!result) throw new BadRequestException('Once Google Drive baglantisi kurun.');
    return result;
  }

  /** Son yedekleme isleri (ilerleme gosterimi) */
  @Get('jobs')
  @UseGuards(AuthGuard('jwt'))
  async jobs(@Req() req: any, @Query('limit') limit?: string) {
    return this.service.listJobs(req.user.tenantId, limit ? parseInt(limit, 10) : 5);
  }

  /** Bir donemde yedeklenmis fatura id'leri ("yedeklendi" isareti icin) */
  @Get('backed-up')
  @UseGuards(AuthGuard('jwt'))
  async backedUp(
    @Req() req: any,
    @Query('mukellefId') mukellefId?: string,
    @Query('donem') donem?: string,
  ) {
    return this.service.listBackedUpInvoiceIds(req.user.tenantId, mukellefId, donem);
  }

  /** Fatura dosyasi — yedekliyse Drive'dan, degilse MIHSAP'tan (proxy/stream) */
  @Get('invoices/:id/file')
  @UseGuards(AuthGuard('jwt'))
  async file(@Req() req: any, @Param('id') id: string, @Res() res: any) {
    const data = await this.service.serveInvoiceFile(req.user.tenantId, id);
    res.set({
      'Content-Type': data.contentType,
      'Content-Disposition': `inline; filename="${data.filename}"`,
      'Content-Length': String(data.buffer.length),
      'Cache-Control': 'private, max-age=3600',
    });
    return res.send(data.buffer);
  }
}
