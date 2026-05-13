import {
  Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PortalDevService } from './portal-dev.service';

@Controller('portal-dev')
@UseGuards(AuthGuard('jwt'))
export class PortalDevController {
  constructor(private readonly service: PortalDevService) {}

  @Get('agents')
  agents() {
    return this.service.listAgents();
  }

  @Get('tasks')
  list(@Req() req: any, @Query('status') status?: string) {
    return this.service.listTasks(req.user.tenantId, status);
  }

  @Get('tasks/:id')
  getOne(@Req() req: any, @Param('id') id: string) {
    return this.service.getTask(req.user.tenantId, id);
  }

  @Post('tasks')
  create(
    @Req() req: any,
    @Body() body: { title: string; description: string; priority?: string; type?: string },
  ) {
    if (!body?.title?.trim() || !body?.description?.trim()) {
      throw new BadRequestException('title ve description zorunlu');
    }
    return this.service.createTask({
      tenantId: req.user.tenantId,
      userId: req.user.sub,
      title: body.title.trim(),
      description: body.description.trim(),
      priority: body.priority,
      type: body.type,
    });
  }

  @Patch('tasks/:id/status')
  setStatus(@Req() req: any, @Param('id') id: string, @Body() body: { status: string }) {
    if (!body?.status) throw new BadRequestException('status gerekli');
    return this.service.updateTaskStatus(req.user.tenantId, id, body.status);
  }

  @Post('tasks/:id/plan')
  runPlanning(@Req() req: any, @Param('id') id: string) {
    return this.service.runTeamPlanning(req.user.tenantId, req.user.sub, id);
  }

  /** FAZ 6 — DENİZ proposal'ını Portal Dev görevine çevir */
  @Post('from-proposal/:proposalId')
  fromProposal(@Req() req: any, @Param('proposalId') proposalId: string) {
    return this.service.fromProposal({
      tenantId: req.user.tenantId,
      userId: req.user.sub,
      proposalId,
    });
  }
}
