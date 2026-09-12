import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LucaService } from '../luca/luca.service';
import { EkipRunnerService } from './ekip-runner.service';
import { KoordinatorService } from './koordinator.service';
import { EkipOnayService } from './ekip-onay.service';

/**
 * EKİP — portal uçları (JWT; luca-operator.controller.ts kalıbı).
 *
 *  GET  /ekip/kadro                 13 ajan + araç sayıları + kademe özetleri + sonKosu/bekleyenOnay/bugunKosu/calisiyor
 *  POST /ekip/:ajanId/calistir      body {gorev, taxpayerId?, dryRun?} → SSE akışı (EkipAkisOlayi)
 *  GET  /ekip/isler?ajanId=&limit=  son iş dosyaları (düz dizi)
 *       + gun=bugun|7|tumu&status=running,failed&dryRun=true|false&kaynak=portal|ses|cron|koordinator&toplam=1
 *         → süzgeçli şekil {isler, toplam, suzgec}
 *  GET  /ekip/isler/:id             tek iş dosyası (tam sonuç)
 *  POST /ekip/isler/:id/iptal       çalışan koşuyu DURDUR → {ok:true,isId} | {ok:false,isId,error} (bitmiş/yok)
 *  GET  /ekip/pano?donemSayisi=&yenile=  mükellef × dönem × aşama (son 3 dönem); 60 sn önbellek
 *  GET  /ekip/durum                 operatör çevrimiçi mi, bekleyen onay, bugünkü koşu, calisan, bugunHata, sonSabahOzeti
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

  /** Kadro + tenant'a özel koşu alanları (sonKosu / bekleyenOnay / bugunKosu / calisiyor). */
  @Get('kadro')
  async kadro(@Req() req: any) {
    return { ajanlar: await this.runner.kadroOzeti(req.user?.tenantId || 'default') };
  }

  /**
   * İş dosyaları. Yalnız ajanId/limit verilirse ESKİ şekil (düz dizi) döner.
   * gun / status / dryRun / kaynak / toplam süzgeçlerinden biri gelirse {isler, toplam, suzgec} döner
   * (toplam = süzgece uyan tüm kayıt sayısı, limit'ten bağımsız).
   */
  @Get('isler')
  isler(
    @Req() req: any,
    @Query('ajanId') ajanId?: string,
    @Query('limit') limit?: string,
    @Query('gun') gun?: string,
    @Query('status') status?: string,
    @Query('dryRun') dryRun?: string,
    @Query('kaynak') kaynak?: string,
    @Query('toplam') toplam?: string,
  ) {
    const tenantId = req.user?.tenantId || 'default';
    const suzgecVar = gun !== undefined || status !== undefined || dryRun !== undefined || kaynak !== undefined || toplam !== undefined;
    if (!suzgecVar) return this.runner.isleriListele(tenantId, { ajanId: ajanId || null, limit: Number(limit) || 30 });
    const dryRunDeger = dryRun === 'true' || dryRun === '1' ? true : dryRun === 'false' || dryRun === '0' ? false : null;
    const gunDeger = gun === 'bugun' || gun === '7' || gun === 'tumu' ? gun : null;
    return this.runner.isleriSuz(tenantId, {
      ajanId: ajanId || null,
      limit: Number(limit) || 30,
      gun: gunDeger,
      status: status || null,
      dryRun: dryRunDeger,
      kaynak: (kaynak as any) || null,
    });
  }

  @Get('isler/:id')
  async is(@Req() req: any, @Param('id') id: string) {
    const r = await this.runner.isGetir(req.user?.tenantId || 'default', id);
    return r || { error: 'İş dosyası bulunamadı.' };
  }

  /**
   * Çalışan koşuyu DURDUR (sahip düğmesi). Agent SDK'ya abort verilir; iş dosyası failed,
   * result.hata='iptal edildi (sahip)', AgentEvent yazılır. Çalışan kayıt yoksa {ok:false, error}.
   */
  @Post('isler/:id/iptal')
  iptal(@Req() req: any, @Param('id') id: string) {
    return this.runner.iptalEt(req.user?.tenantId || 'default', id, 'sahip');
  }

  /** Pano — tenant başına 60 sn önbellek; `yenile=1` önbelleği atlar. Yanıta `onbellek:{vurdu, yasSn}` eklenir. */
  @Get('pano')
  pano(@Req() req: any, @Query('donemSayisi') donemSayisi?: string, @Query('yenile') yenile?: string) {
    return this.runner.pano(req.user?.tenantId || 'default', Number(donemSayisi) || 3, yenile === '1' || yenile === 'true');
  }

  @Get('durum')
  async durum(@Req() req: any) {
    const tenantId = req.user?.tenantId || 'default';
    const [cihaz, bekleyenOnay, bugunkuKosu, calisan, bugunHata, sonSabahOzeti] = await Promise.all([
      this.luca.getOperatorDeviceStatus(tenantId).catch(() => ({ online: false, deviceId: null })),
      this.runner.bekleyenOnaySayisi(tenantId),
      this.runner.bugunkuKosuSayisi(tenantId),
      this.runner.calisanSayisi(tenantId),
      this.runner.bugunHataSayisi(tenantId),
      this.runner.sonSabahOzeti(tenantId),
    ]);
    return {
      operator: { cevrimici: Boolean((cihaz as any)?.online), cihaz: (cihaz as any)?.deviceId || null },
      bekleyenOnay,
      bugunkuKosu,
      sabahOzeti: String(process.env.EKIP_SABAH_OZETI || '').toLowerCase() === 'on',
      maxBagli: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
      // Ekler (PLAN/14 §7-2): şu an koşan iş, bugün hata ile biten iş, son sabah özeti kaydı (yoksa null)
      calisan,
      bugunHata,
      sonSabahOzeti,
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
   * İstemci bağlantıyı GERÇEKTEN keserse (sekme kapandı, "Durdur" sonrası fetch abort) koşu sunucuda da durur.
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

    // BAĞLANTI KOPMASI → koşuyu durdur. DİKKAT: Node 16+ `req.on('close')` gövde okunur okunmaz tetiklenir
    // (yanıt sürerken, ölçüldü: ~26 ms) — onu kullanmak her koşuyu anında iptal ederdi. Gerçek kopma
    // `res.on('close')` + `writableEnded=false` ile anlaşılır; nabız sayesinde close yalnız gerçek kopmada gelir.
    const kopma = new AbortController();
    let bitti = false;
    res.on('close', () => {
      if (!bitti && !res.writableEnded) kopma.abort();
    });

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
        signal: kopma.signal,
      });
    } catch (e: any) {
      send({ type: 'error', error: e?.message || 'Beklenmeyen hata.' });
    } finally {
      bitti = true;
      clearInterval(nabiz);
      res.end();
    }
  }
}
