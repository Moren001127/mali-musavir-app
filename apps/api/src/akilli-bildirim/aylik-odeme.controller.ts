import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AylikOdemeService } from './aylik-odeme.service';

@Controller('aylik-odeme')
@UseGuards(AuthGuard('jwt'))
export class AylikOdemeController {
  constructor(private readonly svc: AylikOdemeService) {}

  @Get()
  list(@Req() req: any, @Query('month') month?: string, @Query('taxpayerId') taxpayerId?: string) {
    const now = new Date();
    const ay = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.svc.list(req.user.tenantId, ay, taxpayerId || undefined);
  }

  @Post('send')
  send(@Req() req: any, @Body() body: { month?: string; taxpayerId?: string }) {
    const now = new Date();
    const ay = body?.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.svc.send(req.user.tenantId, ay, body?.taxpayerId || undefined);
  }
}
