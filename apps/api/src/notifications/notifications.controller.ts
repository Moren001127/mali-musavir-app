import { Controller, Get, Patch, Put, Param, UseGuards, Req, Body, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
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

  /** Kullanicinin bildirim tercihleri (mute edilmis tipler) */
  @Get('preferences')
  getPreferences(@Req() req: any) {
    return this.notificationsService.getPreferences(req.user.sub);
  }

  /** Bildirim tercihlerini guncelle. Body: { mutedTypes: string[] } */
  @Put('preferences')
  setPreferences(@Req() req: any, @Body() body: { mutedTypes?: string[] }) {
    const types = Array.isArray(body?.mutedTypes) ? body.mutedTypes : [];
    if (types.length > 50) throw new BadRequestException('En fazla 50 tip mute edilebilir');
    return this.notificationsService.setPreferences(req.user.tenantId, req.user.sub, types);
  }

  /** DIKKAT: read-all parametresiz route, :id/read'den ONCE tanimli olmali. */
  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@Req() req: any) {
    return this.notificationsService.markAllRead(req.user.tenantId, req.user.sub);
  }

  @Patch(':id/read')
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.notificationsService.markRead(id, req.user.tenantId, req.user.sub);
  }
}
