import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TasksService, CreateTaskDto, UpdateTaskDto } from './tasks.service';

/**
 * Görevler API — JWT auth gerekli, tenant izolasyonu otomatik.
 */
@Controller('tasks')
@UseGuards(AuthGuard('jwt'))
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateTaskDto) {
    return this.tasks.create(req.user.tenantId, req.user.userId || req.user.sub, dto);
  }

  @Get()
  list(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('taxpayerId') taxpayerId?: string,
    @Query('category') category?: string,
    @Query('priority') priority?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('isTemplate') isTemplate?: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit = 100,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset = 0,
  ) {
    return this.tasks.list({
      tenantId: req.user.tenantId,
      status,
      taxpayerId,
      category,
      priority,
      fromDate: from ? new Date(from) : undefined,
      toDate: to ? new Date(to) : undefined,
      search,
      isTemplate: isTemplate === 'true' ? true : isTemplate === 'false' ? false : undefined,
      limit,
      offset,
    });
  }

  @Get('counts')
  counts(@Req() req: any) {
    return this.tasks.getCounts(req.user.tenantId);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.tasks.findOne(req.user.tenantId, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(req.user.tenantId, id, req.user.userId || req.user.sub, dto);
  }

  @Post(':id/complete')
  complete(@Req() req: any, @Param('id') id: string) {
    return this.tasks.complete(req.user.tenantId, id, req.user.userId || req.user.sub);
  }

  @Post(':id/snooze')
  snooze(@Req() req: any, @Param('id') id: string, @Body() body: { until: string }) {
    return this.tasks.snooze(
      req.user.tenantId,
      id,
      req.user.userId || req.user.sub,
      body.until,
    );
  }

  @Post(':id/notes')
  addNote(@Req() req: any, @Param('id') id: string, @Body() body: { content: string }) {
    return this.tasks.addNote(
      req.user.tenantId,
      id,
      req.user.userId || req.user.sub,
      body.content,
    );
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.tasks.remove(req.user.tenantId, id);
  }
}
