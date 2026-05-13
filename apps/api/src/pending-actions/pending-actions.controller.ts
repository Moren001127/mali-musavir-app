import {
  Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PendingActionsService, PendingActionStatus, PendingActionSource } from './pending-actions.service';

@Controller('pending-actions')
@UseGuards(AuthGuard('jwt'))
export class PendingActionsController {
  constructor(private readonly service: PendingActionsService) {}

  @Get()
  list(
    @Req() req: any,
    @Query('status') status?: PendingActionStatus,
    @Query('source') source?: PendingActionSource,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(req.user.tenantId, {
      status,
      source,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('count')
  async count(@Req() req: any, @Query('status') status?: PendingActionStatus) {
    const n = await this.service.count(req.user.tenantId, status || 'pending');
    return { count: n };
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.service.getById(req.user.tenantId, id);
  }

  @Patch(':id/approve')
  approve(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { note?: string },
  ) {
    return this.service.approve(req.user.tenantId, id, req.user.sub, body?.note);
  }

  @Patch(':id/reject')
  reject(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { note?: string },
  ) {
    return this.service.reject(req.user.tenantId, id, req.user.sub, body?.note);
  }
}
