import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MessageTemplatesService, TemplateDto, AiSuggestDto, TestSendDto } from './message-templates.service';

@Controller('message-templates')
@UseGuards(AuthGuard('jwt'))
export class MessageTemplatesController {
  constructor(private readonly svc: MessageTemplatesService) {}

  @Get()
  list(@Req() req: any) {
    return this.svc.list(req.user.tenantId);
  }

  @Post()
  create(@Req() req: any, @Body() dto: TemplateDto) {
    return this.svc.create(req.user.tenantId, dto);
  }

  // Canlı önizleme: placeholder'ları örnek veriyle doldurur.
  @Post('preview')
  preview(@Body() body: { body?: string; kanal?: string }) {
    return { text: this.svc.renderPreview(body?.body || '', body?.kanal) };
  }

  // AI ile şablon yaz / iyileştir (Max aboneliğinden — ücretli API yok).
  @Post('ai')
  aiSuggest(@Req() req: any, @Body() dto: AiSuggestDto) {
    return this.svc.aiSuggest(req.user.tenantId, dto);
  }

  // Sürükle-bırak sırasını kalıcı kıl.
  @Post('reorder')
  reorder(@Req() req: any, @Body() body: { ids: string[] }) {
    return this.svc.reorder(req.user.tenantId, body?.ids || []);
  }

  // Şablonu örnek veriyle test gönder (owner'ın kendi numarasına/adresine).
  @Post(':id/test')
  test(@Req() req: any, @Param('id') id: string, @Body() dto: TestSendDto) {
    return this.svc.sendTest(req.user.tenantId, id, dto);
  }

  @Put(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: TemplateDto) {
    return this.svc.update(req.user.tenantId, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.svc.remove(req.user.tenantId, id);
  }
}
