import {
  Controller, Get, Post, Put, Delete, Param, Body, UseGuards, Req, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SystemHealthService } from './system-health.service';
import { LockedModulesService } from './locked-modules.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

/**
 * System Health & Locked Modules Endpoints
 *
 * Health:
 *   GET  /system/health              → aktif uyarı listesi (frontend bell butonu)
 *   POST /system/health/run-now      → manuel tetik
 *
 * Locked Modules (admin yönetimi):
 *   GET    /system/locked-modules            → liste + drift durumu
 *   POST   /system/locked-modules            → yeni dosya kilitle
 *   PUT    /system/locked-modules/:id/rebaseline  → hash güncelle
 *   PUT    /system/locked-modules/:id/unlock      → kilidi kaldır
 *   DELETE /system/locked-modules/:id        → hard delete
 */
@Controller('system')
export class SystemHealthController {
  constructor(
    private readonly health: SystemHealthService,
    private readonly locked: LockedModulesService,
  ) {}

  // === HEALTH ===

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

  // === LOCKED MODULES ===

  @Get('locked-modules')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN', 'STAFF')
  async listLocked(@Req() _req: any) {
    return this.locked.list();
  }

  @Post('locked-modules')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  async lockModule(
    @Req() req: any,
    @Body() body: { path: string; reason: string; notes?: string },
  ) {
    return this.locked.lock({
      path: body.path,
      reason: body.reason,
      notes: body.notes,
      lockedBy: req.user?.email || req.user?.sub || 'unknown',
    });
  }

  @Put('locked-modules/:id/rebaseline')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  async rebaseline(@Req() _req: any, @Param('id') id: string) {
    return this.locked.rebaseline(id);
  }

  @Put('locked-modules/:id/unlock')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  async unlockModule(@Req() _req: any, @Param('id') id: string) {
    return this.locked.unlock(id);
  }

  @Delete('locked-modules/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  async deleteLocked(@Req() _req: any, @Param('id') id: string) {
    return this.locked.destroy(id);
  }
}
