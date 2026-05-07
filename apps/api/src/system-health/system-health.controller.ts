import { Controller, Get, Post, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SystemHealthService } from './system-health.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

/**
 * System Health Endpoints
 *  GET  /system/health         → aktif uyarı listesi (frontend bell butonu)
 *  POST /system/health/run-now → manuel tetik ("Şimdi Kontrol Et" butonu)
 */
@Controller('system')
export class SystemHealthController {
  constructor(private readonly health: SystemHealthService) {}

  @Get('health')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  async getHealth(@Req() _req: any) {
    return this.health.getActiveAlerts();
  }

  @Post('health/run-now')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  async runNow(@Req() _req: any) {
    return this.health.runNow();
  }
}
