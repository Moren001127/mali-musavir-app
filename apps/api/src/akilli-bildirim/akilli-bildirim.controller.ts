import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AkilliBildirimService, DispatchKategori } from './akilli-bildirim.service';

@Controller('akilli-bildirim')
@UseGuards(AuthGuard('jwt'))
export class AkilliBildirimController {
  constructor(private readonly svc: AkilliBildirimService) {}

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
}
