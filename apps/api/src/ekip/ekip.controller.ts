import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LucaService } from '../luca/luca.service';
import { EkipRunnerService } from './ekip-runner.service';
import { KoordinatorService } from './koordinator.service';
import { EkipOnayService } from './ekip-onay.service';

/**
 * EKİP — portal uçları (JWT; luca-operator.controller.ts kalıbı).
 *
 *  GET  /ekip/kadro                 13 ajan + araç sayıları + kademe özetleri
 *  POST /ekip/:ajanId/calistir      body {gorev, taxpayerId?, dryRun?} → SSE akışı (EkipAkisOlayi)
 *  GET  /ekip/isler?ajanId=&limit=  son iş dosyaları
 *  GET  /ekip/isler/:id             tek iş dosyası (tam sonuç)
 *  GET  /ekip/pano?donemSayisi=     mükellef × dönem × aşama (son 3 dönem)
 *  GET  /ekip/durum                 operatör çevrimiçi mi, bekleyen onay, bugünkü koşu
 *  POST /ekip/koordinator/sabah-ozeti  body {gonder?} → koordinatörü hemen koştur (canlı test)
 *  GET  /ekip/onaylar?durum=&limit=   ekip onay kayıtları (varsayılan bekleyenler)
 *  POST /ekip/onaylar/:previewId/onayla  body {onayMetni?} → yürüt (dışarı gönderim gerçekten gider)
 *  POST /ekip/onaylar/:previewId/reddet  body {not?}
 */
@Controller('ekip')
@UseGuards(AuthGuard('jwt'))
export class EkipController {
  constructor(
    private readonly runner: EkipRunnerService,
    private readonly koordinator: KoordinatorService,
    private readonly onay: EkipOnayService,
    private readonly luca: LucaService,
  ) {}

  @Get('onaylar')
  onaylar(@Req() req: any, @Query('durum') durum?: string, @Query('limit') limit?: string) {
    return this.onay.listele(req.user?.tenantId || 'default', { durum: (durum as any) || 'PENDING', limit: Number(limit) || 50 });
  }

  @Post('onaylar/:previewId/onayla')
  onayla(@Req() req: any, @Param('previewId') previewId: string, @Body() body: { onayMetni?: string }) {
    return this.onay.onayla({
      tenantId: req.user?.tenantId || 'default',
      userId: req.user?.sub || null,
      previewId,
      onayMetni: body?.onayMetni,
      kaynak: 'portal',
    });
  }

  @Post('onaylar/:previewId/reddet')
  reddet(@Req() req: any, @Param('previewId') previewId: string, @Body() body: { not?: string }) {
    return this.onay.reddet({ tenantId: req.user?.tenantId || 'default', userId: req.user?.sub || null, previewId, not: body?.not });
  }

  @Get('kadro')
  kadro() {
    return { ajanlar: this.runner.kadroOzeti() };
  }

  @Get('isler')
  isler(@Req() req: any, @Query('ajanId') ajanId?: string, @Query('limit') limit?: string) {
    return this.runner.isleriListele(req.user?.tenantId || 'default', { ajanId: ajanId || null, limit: Number(limit) || 30 });
  }

  @Get('isler/:id')
  async is(@Req() req: any, @Param('id') id: string) {
    const r = await this.runner.isGetir(req.user?.tenantId || 'default', id);
    return r || { error: 'İş dosyası bulunamadı.' };
  }

  @Get('pano')
  pano(@Req() req: any, @Query('donemSayisi') donemSayisi?: string) {
    return this.runner.pano(req.user?.tenantId || 'default', Number(donemSayisi) || 3);
  }

  @Get('durum')
  async durum(@Req() req: any) {
    const tenantId = req.user?.tenantId || 'default';
    const [cihaz, bekleyenOnay, bugunkuKosu] = await Promise.all([
      this.luca.getOperatorDeviceStatus(tenantId).catch(() => ({ online: false, deviceId: null })),
      this.runner.bekleyenOnaySayisi(tenantId),
      this.runner.bugunkuKosuSayisi(tenantId),
    ]);
    return {
      operator: { cevrimici: Boolean((cihaz as any)?.online), cihaz: (cihaz as any)?.deviceId || null },
      bekleyenOnay,
      bugunkuKosu,
      sabahOzeti: String(process.env.EKIP_SABAH_OZETI || '').toLowerCase() === 'on',
      maxBagli: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
    };
  }

  /** Koordinatörü hemen koştur (cron/env kapısını beklemeden). gonder=false → yalnız üret. */
  @Post('koordinator/sabah-ozeti')
  sabahOzeti(@Req() req: any, @Body() body: { gonder?: boolean }) {
    return this.koordinator.sabahOzeti(req.user?.tenantId || 'default', { gonder: body?.gonder !== false });
  }

  /**
   * Ajanı koştur — SSE. Olaylar: baslangic | text | tool | kuruTest | onay | red | done | error
   * (ekip-runner.service.ts EkipAkisOlayi). dryRun varsayılan TRUE.
   */
  @Post(':ajanId/calistir')
  async calistir(
    @Req() req: any,
    @Param('ajanId') ajanId: string,
    @Body() body: { gorev: string; taxpayerId?: string | null; dryRun?: boolean },
    @Res() res: any,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const send = (e: any) => {
      try {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
      } catch {
        /* istemci koptu */
      }
    };

    // SSE NABIZ: model düşünürken / Luca işi beklenirken 30-40 sn veri akmıyor; ara katman (proxy)
    // boş bağlantıyı kesiyordu ("terminated"). 15 sn'de bir yorum satırı bağlantıyı canlı tutar.
    const nabiz = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* istemci koptu */
      }
    }, 15000);

    try {
      await this.runner.calistir({
        ajanId,
        gorev: body?.gorev || '',
        tenantId: req.user?.tenantId || 'default',
        userId: req.user?.sub || null,
        taxpayerId: body?.taxpayerId || null,
        dryRun: body?.dryRun !== false,
        kaynak: 'portal',
        emit: send,
      });
    } catch (e: any) {
      send({ type: 'error', error: e?.message || 'Beklenmeyen hata.' });
    } finally {
      clearInterval(nabiz);
      res.end();
    }
  }
}
