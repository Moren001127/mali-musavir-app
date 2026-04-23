import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GaleriService } from './galeri.service';

@Controller('galeri')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class GaleriController {
  constructor(private svc: GaleriService) {}

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
}
