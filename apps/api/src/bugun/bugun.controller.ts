import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BugunService } from './bugun.service';

@Controller()
export class BugunController {
  constructor(private readonly bugun: BugunService) {}

  /** Gösterge paneli "Bugünün İş Listesi" — isimli, tıklanabilir satırlar (AI'sız). */
  @Get('bugun')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  async get(@Req() req: any, @Query('force') force?: string) {
    return this.bugun.getBugun(req.user.tenantId, force === '1' || force === 'true');
  }
}
