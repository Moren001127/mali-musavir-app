import { Body, Controller, Delete, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LucaOperatorService } from './luca-operator.service';

@Controller('luca-operator')
@UseGuards(AuthGuard('jwt'))
export class LucaOperatorController {
  constructor(private readonly operator: LucaOperatorService) {}

  /**
   * Max + araçlı AKIŞLI sohbet (SSE). history: önceki turlar [{role,content}].
   * Olaylar: {type:'text',delta} | {type:'tool',name} | {type:'done',...} | {type:'error',error}
   */
  @Post('chat')
  async chat(
    @Req() req: any,
    @Body() body: { message: string; history?: Array<{ role: 'user' | 'assistant'; content: string }>; voiceMode?: boolean },
    @Res() res: any,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const send = (e: any) => {
      try {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
      } catch {
        /* client koptu */
      }
    };

    try {
      await this.operator.chatStream(
        {
          tenantId: req.user?.tenantId,
          userId: req.user?.sub,
          message: body?.message || '',
          history: body?.history,
          voiceMode: body?.voiceMode,
        },
        send,
      );
    } catch (e: any) {
      send({ type: 'error', error: e?.message || 'Beklenmeyen hata.' });
    } finally {
      res.end();
    }
  }

  /** Operatör tarayıcısı açık mı + öğrenilen menü haritaları (portal paneli). */
  @Get('durum')
  durum(@Req() req: any) {
    return this.operator.getOperatorUiDurum(req.user?.tenantId);
  }

  /** Öğrenilen beceriler (portal paneli). */
  @Get('skills')
  skills(@Req() req: any) {
    return this.operator.getSkillsForUi(req.user?.tenantId);
  }

  /** Beceriyi sil. */
  @Delete('skills/:id')
  deleteSkill(@Req() req: any, @Param('id') id: string) {
    return this.operator.deleteSkill(req.user?.tenantId, id);
  }
}
