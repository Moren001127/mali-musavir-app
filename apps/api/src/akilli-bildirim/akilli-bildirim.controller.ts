import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { AkilliBildirimService, DispatchKategori } from './akilli-bildirim.service';
import { IletimGunluguService } from './iletim-gunlugu.service';
import { sorguCoz } from './iletim-gunlugu';
import { ayAdi } from './aylik-odeme-donem';

@Controller('akilli-bildirim')
@UseGuards(AuthGuard('jwt'))
export class AkilliBildirimController {
  constructor(
    private readonly svc: AkilliBildirimService,
    private readonly gunluk: IletimGunluguService,
  ) {}

  @Get('settings')
  getSettings(@Req() req: any) {
    return this.svc.getSettings(req.user.tenantId);
  }

  @Put('settings/:kategori')
  updateSetting(@Req() req: any, @Param('kategori') kategori: DispatchKategori, @Body() body: Record<string, unknown>) {
    return this.svc.updateSetting(req.user.tenantId, kategori, body || {});
  }

  /** Elle tetikleme. dryRun=1 → sadece ne gönderileceğini listeler, göndermez. */
  @Post('run')
  run(
    @Req() req: any,
    @Body() body: { kategori?: DispatchKategori; taxpayerId?: string; dryRun?: boolean; sinceHours?: number; force?: boolean },
  ) {
    const opts = {
      taxpayerId: body?.taxpayerId,
      dryRun: !!body?.dryRun,
      sinceHours: body?.sinceHours,
      force: !!body?.force,
    };
    if (body?.kategori) return this.svc.runKategori(req.user.tenantId, body.kategori, opts);
    return this.svc.runAll(req.user.tenantId, opts);
  }

  @Get('report')
  report(@Req() req: any, @Query('month') month?: string) {
    return this.svc.report(req.user.tenantId, month);
  }

  @Post('resend-failed')
  resend(@Req() req: any, @Body() body: { month?: string }) {
    return this.svc.resendFailed(req.user.tenantId, body?.month);
  }

  /**
   * İLETİM GÜNLÜĞÜ (Hattat "İletim Raporları" mantığı): belge bazında, tarih sıralı düz günlük.
   * ?month=YYYY-MM&taxpayerId=&belgeTuru=&kanal=WHATSAPP|EMAIL&durum=iletilen|iletilmeyen|tumu&q=&page=1&pageSize=50&sira=desc
   */
  @Get('iletim-gunlugu')
  iletimGunlugu(@Req() req: any, @Query() q: Record<string, unknown>) {
    return this.gunluk.liste(req.user.tenantId, sorguCoz(q));
  }

  /** Aynı süzgeçlerle xlsx (sayfalama yok). */
  @Get('iletim-gunlugu/excel')
  async iletimGunluguExcel(@Req() req: any, @Res() res: Response, @Query() q: Record<string, unknown>) {
    const sorgu = sorguCoz(q);
    const buf = await this.gunluk.excel(req.user.tenantId, sorgu);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Iletim-Gunlugu-${sorgu.month}.xlsx"; filename*=UTF-8''${encodeURIComponent(`İletim Günlüğü ${ayAdi(sorgu.month)}.xlsx`)}`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  }

  /** Günlük iletim raporu mailini elle tetikle (test/yeniden gönderim). */
  @Post('report-email')
  reportEmail(@Req() req: any) {
    return this.svc.sendDailyReport(req.user.tenantId);
  }
}
