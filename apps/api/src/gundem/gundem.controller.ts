import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { GundemService } from './gundem.service';

@Controller()
export class GundemController {
  constructor(private readonly gundem: GundemService) {}

  /** Gösterge panelindeki "Günün Gündemi" kartı — TCMB kuru + Resmî Gazete (AI süzgeçli). */
  @Get('gundem')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  async get(@Query('force') force?: string) {
    return this.gundem.getGundem(force === '1' || force === 'true');
  }
}
