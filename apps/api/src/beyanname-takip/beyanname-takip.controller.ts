import {
  Controller, Get, Post, Put, Param, Body, Query, UseGuards, Req, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BeyannameTakipService, BeyanTipi } from './beyanname-takip.service';

const GECERLI_TIPLER: BeyanTipi[] = [
  'KURUMLAR', 'GELIR', 'KDV1', 'KDV2', 'DAMGA', 'MUHSGK', 'POSET', 'BILDIRGE', 'EDEFTER',
];

@Controller('beyanname-takip')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class BeyannameTakipController {
  constructor(private svc: BeyannameTakipService) {}

  // ── CONFIG ──────────────────────────────────────────
  @Get('configs')
  listConfigs(@Req() req: any) {
    return this.svc.listConfigs(req.user.tenantId);
  }

  @Put('configs/:taxpayerId')
  upsertConfig(@Req() req: any, @Param('taxpayerId') taxpayerId: string, @Body() body: any) {
    return this.svc.upsertConfig(req.user.tenantId, taxpayerId, body);
  }

  // ── DONEM ÖZETİ (Dashboard tablosu için) ────────────
  @Get('ozet')
  listOzet(@Req() req: any, @Query('donem') donem: string) {
    if (!donem || !/^\d{4}-\d{2}$/.test(donem)) {
      throw new BadRequestException('donem parametresi yyyy-mm formatında olmalı');
    }
    return this.svc.listDonemOzet(req.user.tenantId, donem);
  }

  // ── DONEM DETAY (mükellef bazında tam liste) ────────
  @Get('detay')
  listDetay(@Req() req: any, @Query('donem') donem: string) {
    if (!donem || !/^\d{4}-\d{2}$/.test(donem)) {
      throw new BadRequestException('donem parametresi yyyy-mm formatında olmalı');
    }
    return this.svc.listDonemDetay(req.user.tenantId, donem);
  }

  // ── DURUM GÜNCELLEME (beyanname onay/red) ───────────
  @Put('durum/:taxpayerId/:beyanTipi/:donem')
  upsertDurum(
    @Req() req: any,
    @Param('taxpayerId') taxpayerId: string,
    @Param('beyanTipi') beyanTipi: string,
    @Param('donem') donem: string,
    @Body() body: any,
  ) {
    if (!GECERLI_TIPLER.includes(beyanTipi as BeyanTipi)) {
      throw new BadRequestException(`Geçersiz beyan tipi: ${beyanTipi}`);
    }
    if (!/^\d{4}-\d{2}$/.test(donem)) {
      throw new BadRequestException('donem yyyy-mm formatında olmalı');
    }
    return this.svc.upsertDurum(req.user.tenantId, taxpayerId, beyanTipi as BeyanTipi, donem, body);
  }
}
