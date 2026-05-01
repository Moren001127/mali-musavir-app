import { Controller, Get, Patch, Param, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.notificationsService.findAll(req.user.tenantId, req.user.sub);
  }

  @Get('unread-count')
  getUnreadCount(@Req() req: any) {
    return this.notificationsService.getUnreadCount(req.user.tenantId, req.user.sub);
  }

  /** DİKKAT: read-all parametresiz route, :id/read'den ÖNCE tanımlı olmalı.
   * NestJS dynamic param route'unu (`:id/read`) literal'den (`read-all`) sonra
   * deklare edersek "read-all" değeri id olarak yakalanır. */
  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@Req() req: any) {
    return this.notificationsService.markAllRead(req.user.tenantId, req.user.sub);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }
}
