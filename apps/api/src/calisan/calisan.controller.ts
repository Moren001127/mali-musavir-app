import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CalisanService } from './calisan.service';

@Controller('calisan')
@UseGuards(AuthGuard('jwt'))
export class CalisanController {
  constructor(private readonly calisan: CalisanService) {}

  @Get('info')
  info() {
    return {
      ad: 'Moren Portal Çalışanı',
      mudur: false,
      ogrenme: true,
      modeller: { kritik: 'claude-opus-4-8', varsayilan: 'claude-sonnet-4-6' },
    };
  }

  /** Görevi çalıştır. critical verilmezse içerikten Opus/Sonnet seçilir. */
  @Post('run')
  run(
    @Req() req: any,
    @Body() body: { task: string; critical?: boolean; context?: string },
  ) {
    return this.calisan.run({
      tenantId: req.user?.tenantId,
      task: body?.task || '',
      critical: body?.critical,
      context: body?.context,
    });
  }

  /** Hangi modelin seçileceğini çağırmadan göster (dry-run). */
  @Post('model')
  model(@Body() body: { task: string; critical?: boolean }) {
    const model = this.calisan.pickModel(body?.task || '', body?.critical);
    return { model, kritik: model === 'claude-opus-4-8' };
  }

  /** ÖĞRENME: kalıcı ders kaydet. */
  @Post('ogren')
  ogren(
    @Req() req: any,
    @Body() body: { title: string; content: string; importance?: number; tags?: string[] },
  ) {
    return this.calisan.recordLesson({
      tenantId: req.user?.tenantId,
      title: body?.title || '',
      content: body?.content || '',
      importance: body?.importance,
      tags: body?.tags,
    });
  }
}
