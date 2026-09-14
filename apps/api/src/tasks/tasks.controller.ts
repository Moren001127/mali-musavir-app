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
import { TasksService, CreateTaskDto, UpdateTaskDto, TopluDto, TakvimdenDto } from './tasks.service';

/**
 * Görevler API — JWT auth gerekli, tenant izolasyonu otomatik.
 *
 * 2026-09-14 Görevler & Notlar yeniden tasarımı:
 *  GET  /tasks/ajanda           → görevler + notlar + ekip "sizden istenen" + vergi takvimi + sayaçlar (tek çağrı)
 *  POST /tasks/toplu            → toplu işlem (tamamla | yeniden-ac | ertele | sil | iptal | kategori | oncelik | sabitle | sabit-kaldir)
 *  POST /tasks/takvimden        → vergi takvimi kaydından görev
 *  POST /tasks/:id/ekibe-ver    → görevi Koordinatör'e ver (arka plan koşusu; sonuç göreve not düşer)
 * Eski uçlar/şekiller aynen korunur (mobil, gösterge paneli).
 */
@Controller('tasks')
@UseGuards(AuthGuard('jwt'))
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  private userId(req: any): string {
    return req.user.userId || req.user.sub;
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateTaskDto) {
    return this.tasks.create(req.user.tenantId, this.userId(req), dto);
  }

  @Get()
  list(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('taxpayerId') taxpayerId?: string,
    @Query('category') category?: string,
    @Query('priority') priority?: string,
    @Query('kaynak') kaynak?: string,
    @Query('tur') tur?: string,
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
      kaynak,
      tur,
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

  /** Ajanda: gorevler, notlar, ekipIstekler, takvim, sayaclar — süzgeçler listelere, sayaçlar tenant geneli. */
  @Get('ajanda')
  ajanda(
    @Req() req: any,
    @Query('taxpayerId') taxpayerId?: string,
    @Query('category') category?: string,
    @Query('priority') priority?: string,
    @Query('kaynak') kaynak?: string,
    @Query('tur') tur?: string,
    @Query('search') search?: string,
    @Query('gun') gun?: string,
  ) {
    return this.tasks.ajanda(req.user.tenantId, { taxpayerId, category, priority, kaynak, tur, search, gun });
  }

  /** Toplu işlem — { ids, islem, until?, category?, priority? } → { ok, etkilenen } */
  @Post('toplu')
  toplu(@Req() req: any, @Body() dto: TopluDto) {
    return this.tasks.toplu(req.user.tenantId, this.userId(req), dto);
  }

  /** Vergi takvimi kaydından görev — { taxCalendarId, taxpayerId?, dueDate?, dueTime? } → Task */
  @Post('takvimden')
  takvimden(@Req() req: any, @Body() dto: TakvimdenDto) {
    return this.tasks.takvimdenOlustur(req.user.tenantId, this.userId(req), dto);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.tasks.findOne(req.user.tenantId, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(req.user.tenantId, id, this.userId(req), dto);
  }

  @Post(':id/complete')
  complete(@Req() req: any, @Param('id') id: string) {
    return this.tasks.complete(req.user.tenantId, id, this.userId(req));
  }

  @Post(':id/snooze')
  snooze(@Req() req: any, @Param('id') id: string, @Body() body: { until: string }) {
    return this.tasks.snooze(req.user.tenantId, id, this.userId(req), body.until);
  }

  @Post(':id/notes')
  addNote(@Req() req: any, @Param('id') id: string, @Body() body: { content: string }) {
    return this.tasks.addNote(req.user.tenantId, id, this.userId(req), body.content);
  }

  /** Görevi Koordinatör'e ver — { canli?: boolean } → { ok, isId } | { ok:false, error } */
  @Post(':id/ekibe-ver')
  ekibeVer(@Req() req: any, @Param('id') id: string, @Body() body: { canli?: boolean }) {
    return this.tasks.ekibeVer(req.user.tenantId, this.userId(req), id, body?.canli === true);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.tasks.remove(req.user.tenantId, id);
  }
}
